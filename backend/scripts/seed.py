"""Script de seed : charge data/knowledge_base.json tel quel, calcule l'embedding
de chaque description d'étape, et insère tutoriels + étapes dans Postgres.

Lancé manuellement (`python -m scripts.seed`, depuis backend/, une fois les
conteneurs démarrés — voir le README pour la commande exacte), pas au démarrage
du conteneur : peupler la base reste une action explicite et visible plutôt
qu'un effet de bord silencieux du `docker compose up`.

Ré-exécutable sans erreur : les tables sont vidées avant d'être repeuplées (utile
pendant le développement, si le contenu de knowledge_base.json change).
"""

from __future__ import annotations

import json
from pathlib import Path

import psycopg
from pgvector.psycopg import register_vector

from app.config import settings
from app.services.embeddings import embed

# backend/scripts/seed.py -> backend/ -> racine du repo -> data/knowledge_base.json
DATA_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "knowledge_base.json"


def main() -> None:
    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    conn = psycopg.connect(settings.database_url)
    register_vector(conn)  # pour pouvoir passer une list[float] comme paramètre `vector`

    try:
        with conn.cursor() as cur:
            # Ordre important : steps et parts référencent tutorials par clé étrangère.
            # known_equipment n'a pas de clé étrangère (equipment n'est pas une clé
            # ailleurs non plus, voir 001_schema.sql) mais vidée aussi pour rester
            # ré-exécutable sans doublons.
            cur.execute("delete from steps")
            cur.execute("delete from parts")
            cur.execute("delete from known_equipment")
            cur.execute("delete from tutorials")

            for tutorial in data["knowledge_base"]:
                cur.execute(
                    """
                    insert into tutorials
                        (id, title, equipment, category, diagram_type,
                         expert_name, expert_role, session_date, tags, has_real_video,
                         equipment_description)
                    values
                        (%(id)s, %(title)s, %(equipment)s, %(category)s, %(diagram_type)s,
                         %(expert_name)s, %(expert_role)s, %(session_date)s, %(tags)s, %(has_real_video)s,
                         %(equipment_description)s)
                    """,
                    {
                        "id": tutorial["id"],
                        "title": tutorial["title"],
                        "equipment": tutorial["equipment"],
                        "category": tutorial["category"],
                        "diagram_type": tutorial["diagram"],
                        "expert_name": tutorial["expert"]["name"],
                        "expert_role": tutorial["expert"]["role"],
                        "session_date": tutorial["session_date"],
                        "tags": tutorial["tags"],
                        "has_real_video": tutorial["has_real_video"],
                        # Absent pour les tutoriels non utilisés en mode live.
                        "equipment_description": tutorial.get("equipment_description"),
                    },
                )

                for step in tutorial["steps"]:
                    cur.execute(
                        """
                        insert into steps
                            (tutorial_id, n, title, description, video_ts, embedding, visual_state, auto_detect)
                        values
                            (%(tutorial_id)s, %(n)s, %(title)s, %(description)s, %(video_ts)s,
                             %(embedding)s, %(visual_state)s, %(auto_detect)s)
                        """,
                        {
                            "tutorial_id": tutorial["id"],
                            "n": step["n"],
                            "title": step["title"],
                            "description": step["description"],
                            "video_ts": step["video_ts"],
                            # Seul champ calculé plutôt que copié tel quel du JSON —
                            # c'est le seul écart autorisé à "insérer tel quel".
                            "embedding": embed(step["description"]),
                            "visual_state": step.get("visual_state"),
                            # Absent = fiable par défaut (voir 001_schema.sql) — seules
                            # les étapes explicitement marquées dans le JSON sautent la
                            # détection automatique.
                            "auto_detect": step.get("auto_detect", True),
                        },
                    )

                # Absent pour les tutoriels sans catalogue de pièces (tous sauf CH1) —
                # contrairement à has_real_video, ce n'est pas un simple booléen,
                # `.get(..., [])` évite de forcer un tableau vide inutile dans le JSON.
                for part in tutorial.get("parts", []):
                    cur.execute(
                        """
                        insert into parts
                            (tutorial_id, slug, label, video_ts, step_n, center_x, center_y, radius, shape, angle)
                        values
                            (%(tutorial_id)s, %(slug)s, %(label)s, %(video_ts)s,
                             %(step_n)s, %(center_x)s, %(center_y)s, %(radius)s, %(shape)s, %(angle)s)
                        """,
                        {
                            "tutorial_id": tutorial["id"],
                            "slug": part["slug"],
                            "label": part["label"],
                            "video_ts": part["video_ts"],
                            "step_n": part["step_n"],
                            "center_x": part["center_x"],
                            "center_y": part["center_y"],
                            "radius": part["radius"],
                            # Absents pour CH-12 (parts déjà écrites avant l'ajout
                            # des flèches) : cercle par défaut, comme avant.
                            "shape": part.get("shape", "circle"),
                            "angle": part.get("angle"),
                        },
                    )

            # Équipements reconnus mais non documentés (ajouté le 27/08/2026,
            # voir LIVE_MODE_DECISIONS.md) — vide pour l'instant, mais lu depuis
            # le même fichier que le reste plutôt qu'improvisé ailleurs (règle
            # du projet), prêt à recevoir des entrées sans changement de code.
            for known in data.get("known_equipment", []):
                cur.execute(
                    "insert into known_equipment (equipment, description) values (%(equipment)s, %(description)s)",
                    {"equipment": known["equipment"], "description": known["description"]},
                )

        conn.commit()

        n_tutorials = len(data["knowledge_base"])
        n_steps = sum(len(t["steps"]) for t in data["knowledge_base"])
        n_parts = sum(len(t.get("parts", [])) for t in data["knowledge_base"])
        n_known_equipment = len(data.get("known_equipment", []))
        print(
            f"Seed terminé : {n_tutorials} tutoriels, {n_steps} étapes embeddées, "
            f"{n_parts} pièces insérées, {n_known_equipment} équipements concurrents connus."
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
