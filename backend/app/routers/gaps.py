"""GET /api/gaps — historique des lacunes détectées, pour le panneau droit.

Lecture simple de la table `gaps`, remplie par le tool log_knowledge_gap (voir
app/services/tools.py) — ce endpoint ne fait qu'exposer ce que la boucle
agentique y a déjà écrit.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.db import get_db

router = APIRouter()


@router.get("/gaps")
def list_gaps(conn=Depends(get_db)):
    with conn.cursor() as cur:
        cur.execute(
            "select topic, context, created_at from gaps order by created_at desc"
        )
        rows = cur.fetchall()

    return [
        {"topic": topic, "context": context, "created_at": created_at}
        for topic, context, created_at in rows
    ]
