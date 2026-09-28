# Contrat d'API — Field Copilot

## `POST /api/chat`

### Requête
```json
{
  "message": "La borne EVC-22 disjoncte tout de suite, que faire ?",
  "equipment_context": "EVC-22",
  "conversation_id": "uuid-généré-côté-frontend-au-premier-message",
  "image": {"media_type": "image/jpeg", "data": "<base64, sans le préfixe data:...;base64,>"},
  "live": false
}
```
`equipment_context` est optionnel. Reflète soit le filtre équipement sélectionné dans le
panneau latéral du frontend (voir `DESIGN_SYSTEM.md`), soit — en mode live — l'équipement
reconnu par `/api/live/equipment-check` ci-dessous : le frontend le stocke localement dès
la reconnaissance puis le renvoie sur chaque tour suivant, exactement comme la sélection
manuelle. Même champ, même traitement côté backend, une seule note de contexte à gérer
dans `claude_agent.py`. `conversation_id` permet au backend de retrouver l'historique en
mémoire ou en base pour le multi tour ; pas besoin de persistance long terme pour ce
prototype, un stockage en mémoire process suffit.

`image` (ajouté le 25/08/2026) est optionnel — une photo jointe par le technicien,
envoyée telle quelle au modèle (multimodal) pour `locate_equipment_part`. Base64 dans le
JSON plutôt que multipart/form-data : un seul endpoint à faire évoluer, pas de deuxième
format de requête à gérer pour ce seul cas. Ne fonctionne que pour le chiller CH-12 (voir
`ARCHITECTURE.md`) ; jointe pour une autre question, la photo est simplement vue par le
modèle sans qu'aucun tool ne s'applique. Retiré du mode live le 28/08/2026 (voir
`LIVE_MODE_DECISIONS.md`) : plus aucune frame n'est jointe à `/api/chat`, la
reconnaissance d'équipement et la détection de fin d'étape tournent entièrement via le
sondage périodique ci-dessous, hors de `/api/chat`.

`live` (faux par défaut) — retiré puis réintroduit le 28/08/2026, avec un rôle différent
de son ancien rôle (voir `LIVE_MODE_DECISIONS.md`). Ne transporte plus aucune image ni ne
déclenche de traitement particulier de la requête : sert uniquement à choisir le system
prompt côté agent (`claude_agent.py`, `SYSTEM_PROMPT_BASE` seul, ou concaténé avec
`LIVE_MODE_ADDENDUM` si `live: true`). Nécessaire car `equipment_context` a exactement la
même forme dans les deux cas (mode live ou sélection manuelle en chat texte) — sans ce
signal, le modèle ne peut pas savoir s'il doit répondre d'un bloc (chat texte classique)
ou guider étape par étape en partant du début de la procédure (mode live), et un test réel
a montré que renforcer les règles de guidage sans ce signal faisait basculer le chat texte
classique vers un guidage étape par étape non désiré.

### Réponse : stream Server-Sent Events

Événements successifs pendant que le modèle exécute sa boucle de tool use, pour que le
frontend puisse afficher un indicateur d'activité pertinent plutôt qu'un simple "en train
d'écrire" générique :

```
event: tool_call
data: {"tool": "search_knowledge_base", "input": {"query": "disjoncte au branchement", "equipment": "EVC-22"}}

event: tool_result
data: {"tool": "search_knowledge_base", "result_count": 1, "steps_found": [{"tutorial_id": "D1", "step_n": 4}]}

event: answer_delta
data: {"text": "Le déclenchement du RCD indique "}

event: answer_delta
data: {"text": "un défaut sur la prise de terre..."}

event: final
data: {
  "answer": "texte complet de la réponse",
  "gap": false,
  "citations": [
    {"tutorial_id": "D1", "steps": [4]}
  ],
  "part_match": {"tutorial_id": "CH1", "part_label": "Connecteur d'alimentation", "image_url": "/media/CH1/part-connecteur.jpg", "video_ts": "00:33"}
}
```

Si `gap` est `true`, le frontend affiche la réponse en style alerte (voir
`DESIGN_SYSTEM.md`, variante `.gap`). `citations` peut malgré tout être non vide dans ce
cas : mis à jour le 25/08/2026 après un test montrant le modèle citer une référence d'un
autre équipement comme repère de diagnostic tout en signalant correctement que la
question précise n'est pas documentée — le texte de la réponse mentionnait déjà cette
référence, forcer `citations` à vide aurait caché la carte correspondante sans raison.

`part_match` (ajouté le 25/08/2026) n'apparaît que si `locate_equipment_part` a trouvé
une correspondance ce tour-ci — absent sinon, pas de `null` à gérer côté frontend. Distinct
de `citations` : ce n'est pas la citation d'une étape de tutoriel, juste le repérage d'une
pièce sur une photo. Affiché par le frontend comme une carte séparée (`PartMatchCard.tsx`).

Le frontend n'a pas besoin de connaître le détail des tools pour fonctionner ; les
événements `tool_call` et `tool_result` sont purement informatifs, affichés sous une
forme discrète (ex: "consultation de la base de connaissances…") pour rendre visible en
entretien que le modèle va effectivement chercher l'information plutôt que de l'inventer.

`steps_found` n'est présent que pour `search_knowledge_base` (ajouté le 25/08/2026, à la
demande explicite, pour afficher au survol quelles étapes ont été trouvées) : `input`
seul ne dit rien de ce qui a été trouvé, contrairement à `get_video_segment` dont l'input
identifie déjà l'étape (`tutorial_id`/`step_number`).

## `POST /api/live/equipment-check` et `POST /api/live/step-check`

Ajoutés le 27/08/2026 (voir `LIVE_MODE_DECISIONS.md`, "architecture entonnoir"). Deux
requêtes JSON simples, PAS du SSE — sondées en continu par le frontend (toutes les 3s,
voir `ChatPanel.tsx`) pendant le mode live, pour détecter automatiquement une transition
de phase sans passer par Claude à chaque fois : un vrai tour de conversation
(`/api/chat`) n'est déclenché qu'une fois une transition confirmée par ce sondage, ou par
un message tapé à la main.

```json
// POST /api/live/equipment-check
{"image": {"media_type": "image/jpeg", "data": "<base64>"}}
// -> {"candidates": [{"equipment": "Instant Cooker", "similarity_score": 0.27}]}
```

```json
// POST /api/live/step-check
{"image": {"media_type": "image/jpeg", "data": "<base64>"}, "tutorial_id": "IC1", "current_step": 3}
// -> {"transitioned": true, "score": 0.31}
// ou -> {"transitioned": false}
```

`equipment-check` réutilise `identify_equipment_from_photo` (classification CLIP
zero-shot, texte contre image — voir `equipment_identifier.py`) : `candidates` est la
liste des équipements dont la description écrite (`tutorials.equipment_description` ou
`known_equipment.description`) ressemble le plus à la frame filmée — vide si rien
au-dessus du seuil, un élément si net, plusieurs si ambigu (le frontend continue de
sonder tant que ce n'est pas net, plutôt que de demander confirmation). `step-check`
compare la frame à
`steps.visual_state` de l'étape en cours (description de l'ÉTAT visuel une fois
l'étape terminée, distincte de `steps.description` qui est l'instruction donnée au
technicien) — au-dessus du seuil, l'étape est considérée terminée et le frontend affiche
le bouton "Next step". Les deux endpoints sont des comparaisons CLIP déterministes, sans
aucun appel au modèle Claude.

## `GET /api/knowledge-base`

Retourne la liste complète des tutoriels : `id`, `title`, `equipment`, `category`,
`diagram_type`, `session_date`, `expert` (`name`/`role`), `has_real_video`, et **`steps`**
(tableau complet — `n`/`title`/`description`/`video_ts`).

`has_real_video` (ajouté le 25/08/2026) : vrai pour un seul tutoriel (`CH1`), dit au
frontend d'afficher `RealStepVisual` (vraie vidéo servie depuis `/media`, voir
`ARCHITECTURE.md`) plutôt que `StepVisual` (mock canvas) pour ce tutoriel-là.

Mis à jour à l'étape 4 : la version initiale de ce contrat excluait les étapes
détaillées ("sans les étapes détaillées"), pensé uniquement pour le manifeste du
panneau gauche. Mais la carte de citation du chat a aussi besoin du diagramme et du
détail des étapes citées, et l'événement `final` de `/api/chat` ne renvoie que des
numéros d'étape (`citations: [{tutorial_id, steps: [1,2,4]}]`) — pas leur contenu.
Plutôt qu'un endpoint séparé par tutoriel, renvoyer la base complète ici reste le plus
simple vu sa taille (3 tutoriels, 15 étapes). Le frontend recoupe les deux : `steps`
de cet endpoint pour le contenu, `citations` de `/api/chat` pour savoir lesquelles
citer.

## `GET /api/gaps`

Retourne l'historique des lacunes détectées (`topic`, `context`, `created_at`), pour le
panneau latéral droit.

## `GET /media/<tutorial_id>/<fichier>`

Ajouté le 25/08/2026, pas un router applicatif comme les trois précédents : un simple
montage de fichiers statiques (`data/media/`, voir `ARCHITECTURE.md`) pour la vidéo et
les frames du tutoriel `CH1`. Aucune logique métier, pas de schéma JSON — juste des
fichiers servis tels quels (`source.mp4`, `step-<n>.jpg`, `step-<n>-annotated.jpg`).

## Erreurs

Toute erreur (échec d'appel au modèle, base de données indisponible) retourne un
événement SSE `event: error` avec un message lisible, et le frontend affiche un message
d'erreur dans le fil de discussion sans casser l'interface, comme dans la version de
référence.
