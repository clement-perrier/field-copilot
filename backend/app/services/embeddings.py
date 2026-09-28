"""Calcul d'embeddings pour la recherche vectorielle sur la table `steps`.

Utilisé à la fois par scripts/seed.py (embeddings des descriptions d'étapes à
l'indexation, étape 3) et par le tool search_knowledge_base ci-dessous (embedding
de la question du technicien à la volée, étape 2) : un seul endroit pour ce calcul,
pour que les deux utilisent exactement le même modèle — sinon les vecteurs ne
seraient pas comparables entre eux.

Choix : un modèle local (sentence-transformers/all-MiniLM-L6-v2) plutôt qu'une API
d'embeddings externe (Voyage, OpenAI...). Ça évite une deuxième clé API à gérer et
à expliquer en entretien, au prix d'un `pip install` plus lourd (le modèle et ses
dépendances tournent dans le conteneur backend, pas d'appel réseau à l'exécution).
"""

from __future__ import annotations

import io

from PIL import Image
from sentence_transformers import SentenceTransformer

# Modèle petit et rapide, suffisant pour matcher des descriptions techniques courtes
# sur un corpus de cette taille (15 étapes). 384 dimensions — voir la colonne
# `embedding vector(384)` dans backend/migrations/001_schema.sql, qui doit rester
# alignée avec ce chiffre si jamais on change de modèle.
EMBEDDING_DIMENSION = 384
_MODEL_NAME = "all-MiniLM-L6-v2"

# Modèle CLIP pour le mode live (voir LIVE_MODE_DECISIONS.md) : contrairement
# à all-MiniLM-L6-v2 ci-dessus, qui n'encode que du texte, CLIP a DEUX
# encodeurs (texte et image) entraînés ensemble pour placer une image et une
# description qui se correspondent au même endroit du même espace vectoriel —
# ce qui permet de comparer une frame filmée à une simple description écrite
# (embed_text_clip ci-dessous), sans jamais avoir besoin de photo de
# référence ni demander à Claude de juger ce qu'il voit. Même bibliothèque
# (sentence-transformers) que le modèle texte, pas de nouvelle dépendance ni
# de nouvelle clé API à gérer.
#
# clip-ViT-L-14 plutôt que clip-ViT-B-32 (choix initial) : testé en conditions
# réelles le 27/08/2026, la variante B-32 ne discriminait pas assez finement
# entre états visuellement proches d'un même équipement (2/5 de bonnes
# classifications sur un test contrôlé) ; L-14 fait bien mieux (4/5, marge
# nette sur l'identification d'équipement) pour ~0.46s par image sur CPU —
# largement assez rapide pour un sondage répété. Pas de contrainte de
# dimension à respecter ici : aucun embedding CLIP n'est stocké en base (ni la
# frame ni les descriptions), tout est comparé à la volée — voir
# LIVE_MODE_DECISIONS.md pour la discussion complète.
_IMAGE_MODEL_NAME = "clip-ViT-L-14"

# Chargés une seule fois au premier appel, puis réutilisés (quelques centaines de
# ms à charger — pas question de recharger à chaque requête). Deux modèles
# distincts : espaces vectoriels différents, jamais comparables entre eux.
_model: SentenceTransformer | None = None
_image_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def _get_image_model() -> SentenceTransformer:
    global _image_model
    if _image_model is None:
        _image_model = SentenceTransformer(_IMAGE_MODEL_NAME)
    return _image_model


def embed(text: str) -> list[float]:
    """Retourne l'embedding normalisé de `text` sous forme de liste de floats.

    Normalisé (norme 1) pour que la distance cosinus pgvector (`<=>`) soit
    directement interprétable comme `1 - similarité`, sans calcul supplémentaire.
    """
    vector = _get_model().encode(text, normalize_embeddings=True)
    return vector.tolist()


def embed_image(image_bytes: bytes) -> list[float]:
    """Retourne l'embedding CLIP normalisé de l'image (encodeur image), sous
    forme de liste de floats — utilisé pour la frame filmée en direct."""
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    vector = _get_image_model().encode(image, normalize_embeddings=True)
    return vector.tolist()


def embed_text_clip(text: str) -> list[float]:
    """Retourne l'embedding CLIP normalisé de `text` (encodeur TEXTE de CLIP,
    pas le modèle `embed()` ci-dessus — les deux espaces vectoriels ne sont
    pas comparables). Comparable par similarité cosinus à `embed_image` :
    c'est ce qui permet la classification zero-shot (comparer une frame
    filmée à une simple description écrite, sans photo de référence) — voir
    LIVE_MODE_DECISIONS.md.
    """
    vector = _get_image_model().encode(text, normalize_embeddings=True)
    return vector.tolist()
