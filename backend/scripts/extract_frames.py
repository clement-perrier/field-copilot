"""Script d'extraction et d'annotation d'images pour le tutoriel CH1 — le seul
de la base à s'appuyer sur une vraie vidéo (voir CLAUDE.md, note du 25/08/2026).

Deux choses générées ici, toutes deux des fichiers statiques pré-calculés, rien
de dynamique :

1. Pour chaque étape, la frame fixe à son `video_ts` réel que le frontend
   affiche en permanence (RealStepVisual.tsx) — exactement ce qu'une vraie
   pipeline SightCall ferait, sauf qu'ici la vidéo est authentique.
2. Le "catalogue de pièces" (tutorial["parts"], lu depuis knowledge_base.json) :
   pour chaque pièce nommée du chiller
   (les mêmes 4 que la légende du schéma SVG, diagrams.tsx), une frame annotée
   d'un cercle amber. C'est l'équivalent, en beaucoup plus simple, de l'étape
   d'authoring qu'aurait un vrai produit (un humain — ou un modèle de vision
   dont les propositions sont relues par un humain — pointe où se trouve
   chaque pièce, une fois, en amont). Le tool `locate_equipment_part` (voir
   backend/app/services/tools.py) ne fait ensuite que choisir dans ce
   catalogue déjà vérifié, jamais dessiner une nouvelle position à la volée —
   voir CLAUDE.md pour la discussion complète de ce choix.

Coordonnées relevées à la main en regardant chaque image (1280x720, après
compression), et vivent dans data/knowledge_base.json (champs step_n/center_x/
center_y/radius de chaque pièce) depuis le 26/08/2026 — avant cette date elles
étaient dupliquées ici même, en dur, ce qui allait à l'encontre de la règle du
projet faisant du JSON la seule source de vérité pour toute donnée de ce genre
(voir CLAUDE.md). Ce script ne fait plus que lire le JSON, il n'invente rien.

Contrairement à seed.py, à lancer depuis l'hôte (`python -m scripts.extract_frames`
depuis backend/, hors conteneur) et pas via `docker compose exec backend` : le
conteneur backend monte `./data` en lecture seule (voir docker-compose.yml),
seulement suffisant pour que seed.py lise knowledge_base.json — ce script,
lui, doit écrire dans data/media/. Effet de bord explicite d'authoring de
contenu, pas une étape du build Docker. Ré-exécutable sans risque, écrase les
fichiers de sortie existants.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

# pillow n'est pas dans backend/requirements.txt : ce script ne tourne jamais
# dans le conteneur backend (voir plus haut), donc ce serait une dépendance
# runtime jamais utilisée. `pip install pillow` en local suffit pour le lancer.
from PIL import Image, ImageDraw

# backend/scripts/extract_frames.py -> backend/ -> racine du repo
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_PATH = REPO_ROOT / "data" / "knowledge_base.json"
MEDIA_DIR = REPO_ROOT / "data" / "media"

TUTORIAL_ID = "CH1"
AMBER = "#f5a623"  # var(--amber), même couleur que les repères numérotés des schémas

# Cercle dessiné à la main sur la frame de l'étape 2 (raccord du tuyau de
# refroidissement, en haut du chiller) — affiché dans RealStepVisual.tsx.
STEP_ANNOTATION = {
    "step_n": 2,
    "center": (610, 140),
    "radius": 50,
    "width": 5,
}

# Largeur du trait, uniquement décorative (pas de sens pour le matching ORB
# côté backend, seulement pour dessiner le cercle sur l'image statique
# ci-dessous) — pas dans knowledge_base.json pour cette raison, une valeur
# fixe suffit.
CIRCLE_WIDTH = 6


def video_ts_to_seconds(video_ts: str) -> float:
    minutes, seconds = video_ts.split(":")
    return int(minutes) * 60 + int(seconds)


def extract_frame(video_path: Path, timestamp_s: float, out_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(video_path),
            "-ss", str(timestamp_s),
            "-frames:v", "1",
            str(out_path),
        ],
        check=True,
    )


def annotate_circle(src_path: Path, out_path: Path, center: tuple[int, int], radius: int, width: int) -> None:
    img = Image.open(src_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    cx, cy = center
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=AMBER, width=width)
    img.save(out_path, quality=90)


def main() -> None:
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    tutorial = next(t for t in data["knowledge_base"] if t["id"] == TUTORIAL_ID)
    tutorial_dir = MEDIA_DIR / TUTORIAL_ID
    video_path = tutorial_dir / "source.mp4"

    frame_paths: dict[int, Path] = {}
    for step in tutorial["steps"]:
        out_path = tutorial_dir / f"step-{step['n']}.jpg"
        extract_frame(video_path, video_ts_to_seconds(step["video_ts"]), out_path)
        frame_paths[step["n"]] = out_path
        print(f"étape {step['n']} ({step['video_ts']}) -> {out_path.name}")

    annotate_circle(
        frame_paths[STEP_ANNOTATION["step_n"]],
        tutorial_dir / f"step-{STEP_ANNOTATION['step_n']}-annotated.jpg",
        STEP_ANNOTATION["center"],
        STEP_ANNOTATION["radius"],
        STEP_ANNOTATION["width"],
    )
    print(f"annotation -> step-{STEP_ANNOTATION['step_n']}-annotated.jpg")

    for part in tutorial.get("parts", []):
        out_path = tutorial_dir / f"part-{part['slug']}.jpg"
        center = (part["center_x"], part["center_y"])
        annotate_circle(frame_paths[part["step_n"]], out_path, center, part["radius"], CIRCLE_WIDTH)
        print(f"pièce « {part['label']} » -> {out_path.name}")


if __name__ == "__main__":
    main()
