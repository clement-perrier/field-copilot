"""Les 3 tools que le modèle peut appeler, tels que définis dans ARCHITECTURE.md.

Deux choses par tool :
1. Son schéma (`TOOLS`, envoyé à l'API Anthropic pour que le modèle sache qu'il
   existe et comment l'appeler).
2. Sa fonction d'implémentation (le code Python réellement exécuté quand le modèle
   décide de l'appeler), qui prend la connexion Postgres ouverte par la requête.

La logique de "quand appeler quoi" (le prompt, la boucle) vit dans claude_agent.py,
pas ici : ce fichier ne connaît que l'accès aux données, rien du dialogue avec le
modèle.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services.embeddings import embed

# Lu une seule fois au chargement du module, juste pour construire l'`enum` du
# tool locate_equipment_part ci-dessous — le vrai lookup à l'exécution passe
# par Postgres (table `parts`), comme les deux autres tools. Ça évite de
# recopier à la main les libellés déjà écrits dans knowledge_base.json : si on
# ajoute une pièce au JSON, l'enum suit sans y retoucher ici.
# backend/app/services/tools.py -> app/services -> app -> backend -> racine du repo
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
with open(_REPO_ROOT / "data" / "knowledge_base.json", encoding="utf-8") as _f:
    _KNOWLEDGE_BASE = json.load(_f)

EQUIPMENT_PART_LABELS = [
    part["label"]
    for tutorial in _KNOWLEDGE_BASE["knowledge_base"]
    for part in tutorial.get("parts", [])
]

# En dessous de ce score de similarité cosinus, un résultat est considéré comme non
# pertinent (voir ARCHITECTURE.md : "si aucun résultat au-dessus d'un seuil de
# similarité raisonnable, retourner une liste vide plutôt que de forcer des
# résultats faibles"). Valeur choisie empiriquement pour ce petit corpus technique
# en français — à ajuster à l'étape 3 une fois testée contre les vraies données.
SIMILARITY_THRESHOLD = 0.35

# Nombre de lignes ramenées par la recherche vectorielle avant filtrage par seuil.
SEARCH_LIMIT = 8

TOOLS = [
    {
        "name": "search_knowledge_base",
        "description": (
            "Searches the knowledge base of past interventions for content relevant "
            "to a field technician's question."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The question or described symptoms, in natural language.",
                },
                "equipment": {
                    "type": "string",
                    "description": "Exact equipment filter if known (e.g. \"EVC-22\").",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_video_segment",
        "description": (
            "Retrieves the precise reference of a video clip for a cited step. "
            "Call this tool for EVERY step cited in the response: this call is what "
            "becomes the citation shown to the technician, not the response text."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "tutorial_id": {"type": "string", "description": "Tutorial identifier (e.g. \"D1\")."},
                "step_number": {"type": "integer", "description": "Number of the cited step."},
            },
            "required": ["tutorial_id", "step_number"],
        },
    },
    {
        "name": "log_knowledge_gap",
        "description": (
            "Records a technician's question that is not covered by any documented "
            "intervention in the knowledge base."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "Short summary of the uncovered topic."},
                "context": {"type": "string", "description": "The technician's original question."},
            },
            "required": ["topic"],
        },
    },
    {
        "name": "locate_equipment_part",
        "description": (
            "Identifies a precise part of the CH-12 chiller from a photo sent by the "
            "technician and/or their description, and returns a real video frame annotated "
            "with a visual marker on that part. Only works for the CH-12 chiller (tutorial CH1) "
            "— never call this tool for any other equipment. Always pick the closest label "
            "from the provided list, never invent a part outside of that list."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "part_label": {
                    "type": "string",
                    "enum": EQUIPMENT_PART_LABELS,
                    "description": "The exact label of the part in question, among the allowed values.",
                },
            },
            "required": ["part_label"],
        },
    },
]


def search_knowledge_base(conn, query: str, equipment: str | None = None) -> list[dict]:
    query_vector = embed(query)
    with conn.cursor() as cur:
        # ::vector est nécessaire : un paramètre lié (la list[float] envoyée par
        # psycopg) n'a pas de type pgvector propre tant qu'on ne le précise pas —
        # sans ce cast, Postgres le traite comme un double precision[] générique,
        # que l'opérateur <=> ne sait pas comparer à la colonne `embedding`.
        cur.execute(
            """
            select
                t.id as tutorial_id,
                t.title as tutorial_title,
                s.n as step_n,
                s.title as step_title,
                s.description as step_description,
                t.expert_name,
                t.session_date,
                1 - (s.embedding <=> %(query_vector)s::vector) as similarity_score
            from steps s
            join tutorials t on t.id = s.tutorial_id
            -- ::text nécessaire pour la même raison que ::vector plus haut : sans
            -- lui, Postgres n'arrive pas à déduire le type de ce paramètre à
            -- partir de "... is null" seul et rejette la requête ("could not
            -- determine data type of parameter").
            where %(equipment)s::text is null or t.equipment = %(equipment)s::text
            order by s.embedding <=> %(query_vector)s::vector
            limit %(limit)s
            """,
            {"query_vector": query_vector, "equipment": equipment, "limit": SEARCH_LIMIT},
        )
        columns = [c.name for c in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    # Filtre par seuil après coup : pgvector ne sait pas s'arrêter "quand ça devient
    # mauvais", seulement trier par distance croissante — le seuil est donc appliqué
    # côté Python plutôt que dans le SQL.
    return [r for r in rows if r["similarity_score"] >= SIMILARITY_THRESHOLD]


def get_video_segment(conn, tutorial_id: str, step_number: int) -> dict | None:
    """Renvoie aussi `step_title`/`step_description` (pas seulement les
    métadonnées de citation) — nécessaire depuis la règle de grounding #8
    (28/08/2026) qui demande au modèle d'appeler ce tool pour l'étape 1 d'un
    tutoriel MÊME quand elle n'est pas ressortie de search_knowledge_base
    (ex: "unplug the cooker" n'a pas grand-chose à voir sémantiquement avec
    "the ring smells"). Sans le contenu réel de l'étape ici, le modèle n'aurait
    que la citation (horodatage vidéo) sans savoir quoi en dire."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select t.session_date, s.video_ts, t.title as tutorial_title, s.title as step_title, s.description as step_description
            from steps s
            join tutorials t on t.id = s.tutorial_id
            where t.id = %(tutorial_id)s and s.n = %(step_number)s
            """,
            {"tutorial_id": tutorial_id, "step_number": step_number},
        )
        row = cur.fetchone()
        if row is None:
            return None
        columns = [c.name for c in cur.description]
        return dict(zip(columns, row))


def locate_equipment_part(conn, part_label: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "select tutorial_id, slug, label, video_ts from parts where label = %(label)s",
            {"label": part_label},
        )
        row = cur.fetchone()
        if row is None:
            return None
        tutorial_id, slug, label, video_ts = row
        return {
            "tutorial_id": tutorial_id,
            "part_label": label,
            # Image déjà générée par backend/scripts/extract_frames.py, pas de
            # dessin à la volée : le tool choisit dans un catalogue déjà
            # vérifié, il ne localise rien lui-même — voir CLAUDE.md.
            "image_url": f"/media/{tutorial_id}/part-{slug}.jpg",
            "video_ts": video_ts,
        }


def log_knowledge_gap(conn, topic: str, context: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into gaps (topic, context) values (%(topic)s, %(context)s)",
            {"topic": topic, "context": context},
        )
    conn.commit()  # seul tool à écrire ; les deux autres ne font que lire.


def execute_tool(conn, name: str, tool_input: dict) -> tuple[str, int, list[dict] | None]:
    """Exécute le tool `name` et retourne (contenu texte à renvoyer au modèle,
    nombre de résultats, résumé des étapes trouvées — pour l'événement SSE
    tool_result, voir claude_agent.py). Regroupé ici plutôt que dans
    claude_agent.py pour garder la boucle agentique concentrée sur le dialogue
    avec le modèle, pas sur le détail de chaque tool.

    Le 3e élément (`steps_found`) n'a de sens que pour search_knowledge_base —
    c'est le seul tool dont l'input (une question en langage naturel) ne dit
    rien de ce qui a été trouvé ; `None` pour les trois autres, dont l'input
    identifie déjà ce qui est demandé (tutorial_id/step_number, topic, ou
    part_label).
    """
    if name == "search_knowledge_base":
        results = search_knowledge_base(conn, **tool_input)
        steps_found = [{"tutorial_id": r["tutorial_id"], "step_n": r["step_n"]} for r in results]
        return json.dumps(results), len(results), steps_found

    if name == "get_video_segment":
        result = get_video_segment(conn, **tool_input)
        if result is None:
            return "No matching step found.", 0, None
        return json.dumps(result), 1, None

    if name == "log_knowledge_gap":
        log_knowledge_gap(conn, **tool_input)
        return "Gap recorded.", 1, None

    if name == "locate_equipment_part":
        result = locate_equipment_part(conn, **tool_input)
        if result is None:
            return "No matching part in the catalog.", 0, None
        return json.dumps(result), 1, None

    raise ValueError(f"Tool inconnu : {name}")
