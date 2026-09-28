"""GET /api/knowledge-base — liste des tutoriels, panneau gauche ET cartes de
citation du chat.

Lecture simple, sans logique de recherche vectorielle (contrairement à
search_knowledge_base côté tools.py) : ce endpoint sert juste à donner au
frontend de quoi afficher, pas à répondre à une question.

Étendu par rapport au contrat d'origine (API_CONTRACT.md ne prévoyait que
id/title/equipment/expert/session_date, "sans les étapes détaillées") :
la carte de citation du chat a besoin du diagramme (`diagram_type`) et du
détail de chaque étape citée (titre, description, horodatage vidéo) pour se
construire — cette information n'existe nulle part ailleurs côté frontend,
puisque l'événement `final` de /api/chat ne renvoie que des numéros d'étape
(voir claude_agent.py). Vu la taille de la base (4 tutoriels, 20 étapes), la
renvoyer en entier ici plutôt que d'ajouter un endpoint séparé par tutoriel
reste la solution la plus simple.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.db import get_db

router = APIRouter()


@router.get("/knowledge-base")
def list_knowledge_base(conn=Depends(get_db)):
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, title, equipment, category, diagram_type,
                   expert_name, expert_role, session_date, has_real_video
            from tutorials
            order by id
            """
        )
        tutorial_rows = cur.fetchall()

        cur.execute(
            "select tutorial_id, n, title, description, video_ts, auto_detect from steps order by tutorial_id, n"
        )
        step_rows = cur.fetchall()

    steps_by_tutorial: dict[str, list[dict]] = {}
    for tutorial_id, n, title, description, video_ts, auto_detect in step_rows:
        steps_by_tutorial.setdefault(tutorial_id, []).append(
            {"n": n, "title": title, "description": description, "video_ts": video_ts, "auto_detect": auto_detect}
        )

    return [
        {
            "id": id_,
            "title": title,
            "equipment": equipment,
            "category": category,
            "diagram_type": diagram_type,
            "session_date": session_date,
            "expert": {"name": expert_name, "role": expert_role},
            "steps": steps_by_tutorial.get(id_, []),
            "has_real_video": has_real_video,
        }
        for id_, title, equipment, category, diagram_type, expert_name, expert_role, session_date, has_real_video in tutorial_rows
    ]
