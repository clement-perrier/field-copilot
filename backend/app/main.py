"""Point d'entrée de l'API FastAPI.

Rôle de ce fichier, volontairement réduit au minimum : créer l'application,
brancher CORS pour le dev local, et enregistrer les routers. La logique métier
(tools, boucle agentique, requêtes SQL) vit dans app/services/ et app/routers/,
jamais ici.
"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import chat, gaps, knowledge_base, live

# Sans ça, les logger.info(...) de claude_agent.py (trace des tool calls) sont
# silencieusement ignorés — le logging Python n'affiche rien en dessous de
# WARNING par défaut. C'est ce qui rend la boucle de tool use visible dans
# `docker compose logs backend`, pas seulement dans le flux SSE éphémère.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

app = FastAPI(title="Field Copilot API")

# En dev, Vite tourne sur localhost:5173 et le backend sur localhost:8000 : deux
# origines différentes du point de vue du navigateur. Le proxy Vite (voir
# frontend/vite.config.ts) évite déjà ce problème pour les requêtes /api en dev,
# mais on autorise aussi CORS explicitement ici pour ne pas dépendre uniquement
# du proxy (ex: si le frontend est ouvert directement sans passer par Vite).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chaque router correspond à une section du contrat d'API (voir API_CONTRACT.md).
# Contenu réel ajouté aux étapes 2 (chat) et 3 (knowledge-base, gaps) du plan.
app.include_router(chat.router, prefix="/api")
app.include_router(knowledge_base.router, prefix="/api")
app.include_router(gaps.router, prefix="/api")
app.include_router(live.router, prefix="/api")

# Sert data/media/ (vidéo + frames du tutoriel CH1, voir CLAUDE.md) tel quel.
# Même calcul de chemin que backend/scripts/seed.py pour data/knowledge_base.json
# (3 dossiers au-dessus de ce fichier) : identique en local et dans le conteneur,
# où /app (= backend/) et /data sont deux montages distincts qui se recomposent
# de la même façon une fois remontés à la racine. Ce mount est en lecture, pas
# d'écriture ici : aucun conflit avec le montage `:ro` de data/ dans docker-compose.yml.
MEDIA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "media"
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/health")
def health():
    """Vérification rapide que le backend tourne — utilisé pour valider le
    scaffold Docker avant d'écrire la moindre logique métier."""
    return {"status": "ok"}
