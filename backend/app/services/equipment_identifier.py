"""Identification déterministe de l'équipement filmé en mode live, par
classification CLIP zero-shot (texte contre image) — voir
LIVE_MODE_DECISIONS.md, section "pivot texte".

Remplace l'approche précédente (image contre image, table equipment_photos,
retirée) : plus besoin d'aucune photo de référence, juste une description
écrite par équipement (`tutorials.equipment_description`, et
`known_equipment` pour les équipements reconnus mais non documentés — sert de
concurrents à la classification, voir plus bas pourquoi c'est nécessaire).

Volontairement PAS un tool Claude : le modèle ne peut pas reproduire les
octets bruts d'une photo dans un appel de tool. Cette fonction est appelée
directement par claude_agent.py, avant que la conversation avec Claude ne
commence — et par routers/live.py pour le sondage périodique du frontend.
"""

from __future__ import annotations

import numpy as np

from app.services.embeddings import embed_image, embed_text_clip

# Les similarités texte/image de CLIP vivent sur une échelle bien plus basse
# que les similarités image/image (constaté le 27/08/2026 : le bon candidat
# scorait 0.284, pas 0.75+ comme avec l'ancienne approche image contre image)
# — un seuil absolu recopié de l'ancien mécanisme n'aurait aucun sens ici.
# EQUIPMENT_MIN_SCORE : en dessous, on ne fait confiance à AUCUN candidat
# (rien de connu ne ressemble à ce qui est filmé). EQUIPMENT_MIN_MARGIN :
# l'écart minimum entre le 1er et le 2e pour considérer le match comme net —
# en dessous, plusieurs équipements sont candidats, on retourne les deux (le
# reste du pipeline demande alors confirmation au technicien, voir
# claude_agent.py, règle de grounding #7). Les deux à calibrer davantage une
# fois testés sur un vrai cas ambigu — pour l'instant seul le cas "match net"
# a été vérifié en conditions réelles (marge de 0.103 sur le test du 27/08).
EQUIPMENT_MIN_SCORE = 0.20
EQUIPMENT_MIN_MARGIN = 0.05


def identify_equipment_from_photo(conn, image_bytes: bytes) -> list[dict]:
    """Retourne les équipements connus (documentés ou non) dont la
    description ressemble à `image_bytes`, au-dessus du seuil et à portée du
    meilleur candidat — liste vide si rien de connu, un seul élément si net,
    plusieurs si ambigu. Jamais un choix forcé.
    """
    with conn.cursor() as cur:
        cur.execute("select equipment, equipment_description from tutorials where equipment_description is not null")
        candidates = list(cur.fetchall())
        cur.execute("select equipment, description from known_equipment")
        candidates += list(cur.fetchall())

    if not candidates:
        return []

    frame_vector = np.array(embed_image(image_bytes))
    # Les deux embedding déjà normalisés (norme 1, voir embeddings.py) : le
    # produit scalaire EST la similarité cosinus, pas besoin de la calculer
    # à part.
    scored = [
        {"equipment": equipment, "similarity_score": float(frame_vector @ np.array(embed_text_clip(description)))}
        for equipment, description in candidates
    ]
    scored.sort(key=lambda r: -r["similarity_score"])

    if not scored or scored[0]["similarity_score"] < EQUIPMENT_MIN_SCORE:
        return []

    top_score = scored[0]["similarity_score"]
    return [r for r in scored if top_score - r["similarity_score"] <= EQUIPMENT_MIN_MARGIN]
