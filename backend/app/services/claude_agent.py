"""La boucle agentique : le modèle Claude décide quels tools appeler, dans quel
ordre, jusqu'à produire une réponse finale. C'est le fichier le plus important du
projet — voir ARCHITECTURE.md, section "Règles de grounding", pour le contexte.

Boucle manuelle explicite (`while`/`for` + `client.messages.stream`) plutôt que le
tool runner du SDK (`client.beta.messages.tool_runner`). Deux raisons à ce choix :
1. Le tool runner est en beta et cache la boucle dans la librairie — exactement le
   genre d'abstraction que CLAUDE.md demande d'éviter pour ce projet ("une boucle
   explicite de 15 lignes que je peux suivre vaut mieux qu'une abstraction générique
   qui cache la logique").
2. On a besoin d'émettre des événements SSE personnalisés (tool_call, tool_result,
   answer_delta) à des moments précis de la boucle — le tool runner ne expose pas
   ces points d'accroche dans la forme dont on a besoin ici.

Comment les citations sont produites, sans mécanisme dédié : le prompt système
demande au modèle d'appeler `get_video_segment` pour CHAQUE étape qu'il cite dans sa
réponse. Cette boucle se contente d'observer quels appels à `get_video_segment` ont
eu lieu pendant le tour pour construire la liste `citations` de l'événement `final`
— pas besoin d'un 4e tool "cite_sources" ni de parser le texte de la réponse.
"""

from __future__ import annotations

import json
import logging

import anthropic

from app.config import settings
from app.services.tools import TOOLS, execute_tool

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

# Trace des appels de tool dans les logs backend (visibles via `docker compose
# logs backend`) — critère explicite de definition of done dans CLAUDE.md :
# "une question couverte par la base déclenche au moins un appel de tool
# visible dans les logs backend". Les événements SSE (tool_call/tool_result)
# ne suffisaient pas seuls : ils ne sont vus qu'en direct par le frontend, rien
# ne reste consultable après coup côté serveur sans ce logger.
logger = logging.getLogger("field_copilot.tools")

MODEL = "claude-opus-5"

# Suffisant pour une réponse courte et actionnable (voir règle de grounding #3 dans
# ARCHITECTURE.md) plus la réflexion interne du modèle (adaptive thinking, activée
# par défaut sur ce modèle — voir plus bas, on ne la désactive pas).
MAX_TOKENS = 8192

# Garde-fou : si le modèle enchaîne les appels de tools sans jamais conclure (boucle
# qui ne convergerait pas), on arrête proprement plutôt que de laisser tourner un
# nombre d'appels API illimité.
MAX_TOOL_ITERATIONS = 6

SYSTEM_PROMPT_BASE = """You are Field Copilot, a conversational technical assistant for field \
technicians who install and repair equipment. You answer based on past interventions, \
captured through video-assistance sessions between experts and clients, then turned into \
structured tutorials.

GROUNDING RULES (strict):
1. Never answer a technical question without first calling search_knowledge_base and \
getting at least one usable result.
2. Every factual claim in your answer must come from a result returned by \
search_knowledge_base — never from your general knowledge of the subject, even if you \
think you know the answer.
3. If search_knowledge_base returns nothing relevant (empty list), call log_knowledge_gap \
with a short topic summarizing the subject, then answer by clearly stating that this case \
isn't documented yet. Never propose an improvised procedure — at most a cautious, generic \
fallback action (make it safe, contact an expert).
4. For EVERY step you cite in your answer, call get_video_segment with the matching \
tutorial_id and step_number before writing the sentence that refers to it. This call IS \
the citation shown to the technician — never cite a step without this call.
5. If the technician attaches a photo, look at it. If the question is about the CH-12 \
chiller and a specific part is the subject, call locate_equipment_part with the closest \
label among the allowed values, using both the photo AND the text. Never call this tool \
for any other equipment, and never force an approximate match when no part truly fits — \
in that case, say so rather than inventing one. NEVER mention the image_url field or any \
file path in your answer: the interface already displays the annotated image separately, \
that field is only for it — just name the part in natural English.
6. Answer in English, concisely and actionably, like an experienced colleague on the \
phone — no unnecessary jargon, no preamble.
"""

# Ajouté séparément de SYSTEM_PROMPT_BASE (28/08/2026) plutôt que fondu dedans :
# concaténé au system prompt UNIQUEMENT quand `live=True` (voir run_agent_turn).
# Nécessaire après un bug réel constaté en direct — sans un signal explicite
# distinguant les deux modes, le modèle n'avait aucun moyen de savoir s'il
# fallait répondre en une fois (chat texte classique) ou guider étape par
# étape (mode live) : les deux envoient la même forme de requête
# (`equipment_context`, pas d'image). Renforcer ces règles sans ce signal a
# fait déraper le chat texte classique vers un guidage étape par étape non
# désiré — voir LIVE_MODE_DECISIONS.md.
LIVE_MODE_ADDENDUM = """
LIVE MODE (the technician is filming the equipment; recognition and step-completion \
tracking happen outside this conversation — see below):
7. Don't call search_knowledge_base until you know both the equipment (given by the \
equipment context note at the start of the message, when present) and a described \
problem or symptom — if the technician hasn't said what's wrong yet, ask.
8. When starting to guide a NEW procedure, begin from the tutorial's step 1 — call \
get_video_segment for step 1 of the matched tutorial_id and describe it first, even if \
search_knowledge_base ranked a later step as the closest match to the symptom described. \
A search match tells you which tutorial applies, not which step is safe to start at: \
earlier steps are frequently prerequisites (unplugging, opening a cover) that search may \
not surface because their wording doesn't resemble the symptom, but that must still \
happen first. Skip straight to a later step only if the technician explicitly says \
they've already completed the earlier ones.
9. Guide the technician ONE step at a time — describe only the next step to perform, \
call get_video_segment for that single step, then stop and wait for them to confirm \
("done", "ok", "next"...) before describing the following one. Never lay out the whole \
procedure at once, even if you already know every step from search_knowledge_base. Use \
the conversation history to track which step comes next — no separate mechanism keeps \
count for you.
"""


def run_agent_turn(
    conn,
    history: list[dict],
    user_message: str,
    equipment_context: str | None,
    image: dict | None = None,
    live: bool = False,
):
    """Générateur qui fait tourner un tour de conversation complet et yield des
    tuples (nom_événement, payload) — le routeur (routers/chat.py) les met en
    forme SSE, cette fonction ne connaît pas le protocole HTTP.

    `history` est mutée en place (les tours user/assistant/tool_result y sont
    ajoutés au fur et à mesure) : l'appelant garde la même liste d'un appel à
    l'autre pour que la conversation ait une mémoire multi-tours.

    `image`, si fourni, est un dict {"media_type": ..., "data": ...} (base64,
    voir routers/chat.py) — utilisé par locate_equipment_part (règle de
    grounding #5) pour une photo de chiller CH-12, jamais stocké au-delà de ce
    tour : seule la conversation texte est gardée en mémoire d'un tour à l'autre.

    Mode live (voir LIVE_MODE_DECISIONS.md) : plus aucune frame n'est envoyée
    ici depuis le 28/08/2026 — l'identification d'équipement et la détection de
    transition d'étape tournent entièrement hors de cette fonction, via le
    sondage périodique du frontend (routers/live.py). L'équipement reconnu
    arrive ici comme un `equipment_context` ordinaire (même mécanisme que la
    sélection manuelle dans le panneau latéral), pas via une image.

    `live`, réintroduit le même jour après l'avoir retiré : sert UNIQUEMENT à
    choisir le system prompt (LIVE_MODE_ADDENDUM ajouté ou non) — plus aucun
    lien avec une image ou un traitement particulier de la requête, contrairement
    à son ancien rôle. Nécessaire car `equipment_context` a exactement la même
    forme en mode live (équipement reconnu automatiquement) et en chat texte
    classique (sélection manuelle) : sans ce signal, le modèle ne peut pas
    distinguer les deux et un chat texte simple se met à guider étape par étape
    au lieu de répondre en une fois — voir LIVE_MODE_DECISIONS.md.
    """
    context_note = f"[Contexte équipement sélectionné : {equipment_context}]\n" if equipment_context else ""

    text_content = context_note + user_message
    # Bloc multimodal (texte + image) seulement si une photo est jointe — sinon
    # une simple chaîne, comme avant, pas de structure inutile dans l'historique.
    if image:
        user_content = [
            {"type": "image", "source": {"type": "base64", "media_type": image["media_type"], "data": image["data"]}},
            {"type": "text", "text": text_content},
        ]
    else:
        user_content = text_content
    history.append({"role": "user", "content": user_content})

    system_prompt = SYSTEM_PROMPT_BASE + LIVE_MODE_ADDENDUM if live else SYSTEM_PROMPT_BASE

    answer_parts: list[str] = []
    citations: dict[str, set[int]] = {}
    part_match: dict | None = None
    gap = False

    for _ in range(MAX_TOOL_ITERATIONS):
        turn_text = ""
        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            tools=TOOLS,
            messages=history,
        ) as stream:
            for event in stream:
                # On ne relaie que le texte : les blocs "thinking" (adaptive
                # thinking, activée par défaut sur ce modèle) ne sont pas
                # destinés au technicien et ne sont pas dans le contrat API.
                if event.type == "content_block_delta" and event.delta.type == "text_delta":
                    turn_text += event.delta.text
                    answer_parts.append(event.delta.text)
                    yield "answer_delta", {"text": event.delta.text}
            response = stream.get_final_message()

        # On rejoue l'intégralité des blocs (texte, thinking, tool_use) tels quels
        # dans l'historique : c'est ce que l'API attend pour comprendre la suite.
        history.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            break  # end_turn (ou refusal/max_tokens) : le modèle a fini son tour.

        # Ce tour a du texte (ex: "Je regarde ce qu'on a...") ET continue après les
        # tools : sans séparateur, ce texte se retrouverait collé à celui du tour
        # suivant ("...cas.Ce qui est documenté..."), les deux tours n'étant pas
        # garantis de s'enchaîner proprement à l'écriture.
        if turn_text:
            answer_parts.append("\n\n")
            yield "answer_delta", {"text": "\n\n"}

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            logger.info("tool_call %s input=%s", block.name, block.input)
            yield "tool_call", {"tool": block.name, "input": block.input}
            content, result_count, steps_found = execute_tool(conn, block.name, block.input)
            logger.info("tool_result %s result_count=%s steps_found=%s", block.name, result_count, steps_found)
            result_event = {"tool": block.name, "result_count": result_count}
            if steps_found is not None:
                result_event["steps_found"] = steps_found
            yield "tool_result", result_event

            if block.name == "get_video_segment" and result_count == 1:
                citations.setdefault(block.input["tutorial_id"], set()).add(block.input["step_number"])
            elif block.name == "log_knowledge_gap":
                gap = True
            elif block.name == "locate_equipment_part" and result_count == 1:
                # `content` est déjà le JSON du dict retourné par locate_equipment_part
                # (tutorial_id/part_label/image_url/video_ts) — pas de requête
                # supplémentaire, on relit juste ce qu'on vient d'envoyer au modèle.
                part_match = json.loads(content)

            tool_results.append(
                {"type": "tool_result", "tool_use_id": block.id, "content": content}
            )

        history.append({"role": "user", "content": tool_results})

    # Le texte peut être vide dans deux cas limites : un refus du modèle, ou le
    # garde-fou MAX_TOOL_ITERATIONS atteint sans qu'il ait conclu par du texte.
    # Dans les deux cas, mieux vaut ce message générique qu'une bulle vide côté UI.
    answer_text = "".join(answer_parts).strip()
    if not answer_text:
        answer_text = "Je n'ai pas pu formuler de réponse claire, peux-tu reformuler ta question ?"

    # `citations` n'est plus vidé de force quand `gap` est vrai : un cas testé le
    # 25/08/2026 (équipement partiellement documenté — un tutoriel existe, mais pas
    # sur le sujet demandé) a montré le modèle citer une référence d'un autre
    # modèle comme repère de diagnostic tout en signalant correctement la lacune
    # sur la question précise. Forcer citations=[] dans ce cas cachait une carte
    # de citation que le texte de la réponse mentionne pourtant explicitement.
    citations_list = [{"tutorial_id": tid, "steps": sorted(steps)} for tid, steps in citations.items()]
    final_event = {
        "answer": answer_text,
        "gap": gap,
        "citations": citations_list,
    }
    # Absent si aucune photo/pièce n'a été identifiée ce tour-ci — pas de clé
    # `part_match: null` à gérer côté frontend pour rien.
    if part_match is not None:
        final_event["part_match"] = part_match
    yield "final", final_event
