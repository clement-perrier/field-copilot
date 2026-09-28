"""POST /api/chat — reçoit le message du technicien, fait tourner la boucle
agentique (app/services/claude_agent.py) et relaie les événements en Server-Sent
Events tels que définis dans API_CONTRACT.md.
"""

from __future__ import annotations

import json
import logging

import anthropic
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import get_db
from app.services.claude_agent import run_agent_turn

router = APIRouter()

# Logué en plus du message envoyé au frontend (celui-ci reste volontairement
# court) : un cas réel (photo au format HEIC envoyée par un iPhone, rejetée
# par l'API du modèle) n'était visible que comme "erreur" générique côté
# technicien, sans détail exploitable côté serveur pour comprendre pourquoi.
logger = logging.getLogger("field_copilot.chat")


class ChatImage(BaseModel):
    media_type: str
    data: str  # base64, sans le préfixe "data:...;base64," — retiré côté frontend


class ChatRequest(BaseModel):
    message: str
    equipment_context: str | None = None
    conversation_id: str
    image: ChatImage | None = None
    # Réintroduit le 28/08/2026 après un retrait le même jour (voir
    # LIVE_MODE_DECISIONS.md) : sert uniquement à choisir le system prompt côté
    # agent (guidage étape par étape vs réponse complète), plus aucun lien avec
    # une image. `equipment_context` a la même forme en mode live (reconnu
    # automatiquement) et en chat texte classique (sélectionné à la main) —
    # sans ce booléen, le modèle ne peut pas distinguer les deux.
    live: bool = False


# Historique des conversations en mémoire process, clé par conversation_id (généré
# côté frontend). Pas de persistance long terme nécessaire pour ce prototype (voir
# API_CONTRACT.md) : si le backend redémarre, les conversations en cours repartent
# de zéro, ce qui est acceptable pour une démo.
_conversations: dict[str, list[dict]] = {}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/chat")
def chat(payload: ChatRequest, conn=Depends(get_db)):
    history = _conversations.setdefault(payload.conversation_id, [])

    def event_stream():
        try:
            image = payload.image.model_dump() if payload.image else None
            for event_name, event_data in run_agent_turn(
                conn, history, payload.message, payload.equipment_context, image, payload.live
            ):
                yield _sse(event_name, event_data)
        except anthropic.APIError as e:
            logger.error("anthropic.APIError sur /api/chat : %s", e)
            yield _sse("error", {"message": f"Erreur API modèle : {e}"})
        except Exception as e:  # défaut Postgres, etc. — voir API_CONTRACT.md "Erreurs"
            logger.exception("Erreur inattendue sur /api/chat")
            yield _sse("error", {"message": f"Erreur serveur : {e}"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
