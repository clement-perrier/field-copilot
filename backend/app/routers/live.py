"""Endpoints légers de sondage pour le mode live — voir LIVE_MODE_DECISIONS.md,
section "pivot texte" et "entonnoir étape par étape".

Volontairement séparés de /api/chat : le frontend appelle ces routes en
continu (toutes les quelques secondes, tant que la caméra live est active)
pour détecter automatiquement une transition (équipement reconnu, étape
terminée) — les faire passer par une vraie conversation Claude à chaque frame
serait lent et coûterait un appel API réel pour rien la plupart du temps. Ces
routes ne font QUE de la comparaison CLIP déterministe (equipment_identifier.py
/ step_detector.py), jamais d'appel au modèle. Un vrai tour de conversation
Claude (/api/chat) n'est déclenché qu'une fois une transition confirmée ici.
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db import get_db
from app.routers.chat import ChatImage
from app.services.equipment_identifier import identify_equipment_from_photo
from app.services.step_detector import detect_step_transition

router = APIRouter()


class EquipmentCheckRequest(BaseModel):
    image: ChatImage


@router.post("/live/equipment-check")
def equipment_check(payload: EquipmentCheckRequest, conn=Depends(get_db)):
    image_bytes = base64.b64decode(payload.image.data)
    candidates = identify_equipment_from_photo(conn, image_bytes)
    return {"candidates": candidates}


class StepCheckRequest(BaseModel):
    image: ChatImage
    tutorial_id: str
    current_step: int


@router.post("/live/step-check")
def step_check(payload: StepCheckRequest, conn=Depends(get_db)):
    image_bytes = base64.b64decode(payload.image.data)
    result = detect_step_transition(conn, payload.tutorial_id, payload.current_step, image_bytes)
    if result is None:
        return {"transitioned": False}
    return {"transitioned": True, "score": result["score"]}
