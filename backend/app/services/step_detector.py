"""Détection déterministe de la fin d'une étape en mode live, par
classification CLIP zero-shot (texte contre image) — même principe que
equipment_identifier.py, voir LIVE_MODE_DECISIONS.md, section "pivot texte".

Compare la frame filmée à `steps.visual_state` (ce que montre la caméra une
fois l'étape terminée, pas l'instruction — voir 001_schema.sql), pas à une
photo de référence : élimine la sensibilité à l'éclairage/l'angle/l'objectif
qui a rendu le matching ORB peu fiable en conditions réelles.

Comme equipment_identifier.py, volontairement PAS un tool Claude — appelée
directement par le nouvel endpoint léger de sondage (routers/live.py), jamais
via un tour de conversation Claude (trop lent et coûteux pour être interrogé
en continu toutes les quelques secondes).
"""

from __future__ import annotations

import numpy as np

from app.services.embeddings import embed_image, embed_text_clip

# Seuil de départ, pas encore calibré sur un vrai cas de transition en
# conditions réelles (voir LIVE_MODE_DECISIONS.md) — dans la même plage que
# les scores observés lors du test de classification d'états du 27/08/2026
# (0.266 à 0.330 pour une classification correcte avec clip-ViT-L-14). À
# ajuster une fois testé en direct, comme tous les autres seuils du projet.
STEP_TRANSITION_THRESHOLD = 0.25


def detect_step_transition(conn, tutorial_id: str, current_step: int, image_bytes: bytes) -> dict | None:
    """Retourne {"score": float} si la frame ressemble à l'état de complétion
    de `current_step` (donc : on peut proposer de passer à l'étape suivante),
    None sinon — soit parce que rien n'est décrit pour cette étape (`.get`
    silencieux, pas d'erreur), soit parce que le seuil n'est pas atteint.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select visual_state from steps where tutorial_id = %(tutorial_id)s and n = %(n)s",
            {"tutorial_id": tutorial_id, "n": current_step},
        )
        row = cur.fetchone()

    if row is None or row[0] is None:
        return None

    frame_vector = np.array(embed_image(image_bytes))
    state_vector = np.array(embed_text_clip(row[0]))
    # Les deux déjà normalisés (voir embeddings.py) : le produit scalaire EST
    # la similarité cosinus.
    score = float(frame_vector @ state_vector)

    if score < STEP_TRANSITION_THRESHOLD:
        return None
    return {"score": score}
