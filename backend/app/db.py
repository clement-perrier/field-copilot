"""Accès Postgres : une connexion par requête, pas de pool.

Choix volontairement simple : pour le volume d'une démo (un seul technicien qui
teste l'app), ouvrir une connexion psycopg par requête HTTP et la refermer à la
fin est largement suffisant et beaucoup plus facile à expliquer qu'un pool de
connexions (psycopg_pool) dont il faudrait justifier la taille, le cycle de vie,
etc. Si ce prototype devait un jour supporter plusieurs techniciens en
simultané, un pool serait la première chose à ajouter ici.

`get_db` est une dépendance FastAPI (voir routers/*.py) : FastAPI l'appelle avant
la route, lui injecte la connexion via `yield`, et exécute le `finally` après la
réponse — que la route ait levé une exception ou non.
"""

from __future__ import annotations

import psycopg
from pgvector.psycopg import register_vector

from app.config import settings


def get_db():
    conn = psycopg.connect(settings.database_url)
    register_vector(conn)  # permet d'envoyer/recevoir des `list[float]` Python
    # directement comme type `vector` pgvector, sans conversion manuelle.
    try:
        yield conn
    finally:
        conn.close()
