# Architecture cible — Field Copilot (version tool use)

## Vue d'ensemble

```
frontend (React/TS/Vite)
   │  POST /api/chat  (SSE)
   ▼
backend (FastAPI)
   │  boucle agentique : le modèle décide quels tools appeler
   ├── search_knowledge_base(equipment?, symptom?, query)  → Postgres/pgvector
   ├── get_video_segment(tutorial_id, step_number)          → Postgres (métadonnées)
   ├── log_knowledge_gap(topic, context)                    → Postgres (table gaps)
   └── locate_equipment_part(part_label)                    → Postgres (table parts)
   │
   │  mode live (voir LIVE_MODE_DECISIONS.md) : deux étapes déterministes
   │  autour de la boucle, PAS des tools que Claude appelle — Claude ne peut
   │  pas passer les octets d'une image en paramètre d'un appel de tool
   ├── identify_equipment_from_photo(image)                 → Postgres/pgvector (table equipment_photos)
   └── find_part_for_step(tutorial_id, step_n)               → Postgres (table parts)
       + locate_part_in_frame(...)                           → vision par ordinateur classique (ORB), pas de requête
   ▼
Postgres + pgvector
   ├── table tutorials       (id, title, equipment, category, expert_name, expert_role,
   │                           session_date)
   ├── table steps           (id, tutorial_id, n, title, description, video_ts, embedding vector(384))
   ├── table gaps            (id, topic, context, created_at)
   ├── table parts           (id, tutorial_id, slug, label, video_ts,
   │                           step_n, center_x, center_y, radius) — ajoutée le 25/08/2026,
   │                           4 derniers champs le 26/08/2026 pour le mode live
   └── table equipment_photos (id, equipment, image_path, embedding vector(512)) — ajoutée le 26/08/2026
```

## Pourquoi une boucle agentique plutôt qu'un contexte statique

La version de référence (`reference/field-copilot-prototype.html`) envoie toute la base
de connaissances dans le prompt système à chaque appel. Ça fonctionne à 6 tutoriels, plus
du tout à l'échelle d'un vrai historique d'interventions. La version cible laisse le
modèle décider quand et quoi rechercher, avec des appels successifs si besoin (d'abord
par équipement, puis affiner par symptôme).

## Définition des tools

Utiliser le format tool use natif du SDK Anthropic (Python). Quatre tools (le 4e,
`locate_equipment_part`, ajouté le 25/08/2026 — voir plus bas et CLAUDE.md pour la
discussion complète de sa conception) :

### `search_knowledge_base`
- **Description** : recherche dans la base de connaissances des interventions passées
  pertinentes pour une question de technicien.
- **Input schema** :
  - `query` (string, requis) — la question ou les symptômes décrits, en langage naturel
  - `equipment` (string, optionnel) — filtre exact sur l'équipement si connu (ex: "EVC-22")
- **Comportement backend** : embedding de `query`, recherche vectorielle sur la table
  `steps` (filtrée par `equipment` si fourni via une clause SQL avant la recherche
  vectorielle, pas après), retour des N meilleurs résultats avec leur tutoriel parent,
  score de similarité, et texte complet de l'étape.
- **Retour** : liste d'objets `{tutorial_id, tutorial_title, step_n, step_title,
  step_description, expert_name, session_date, similarity_score}`. Si aucun résultat
  au-dessus d'un seuil de similarité raisonnable, retourner une liste vide plutôt que
  de forcer des résultats faibles.

### `get_video_segment`
- **Description** : récupère la référence précise d'un extrait vidéo pour une étape citée.
- **Input schema** : `tutorial_id` (string, requis), `step_number` (integer, requis)
- **Retour** : `{session_date, video_ts, tutorial_title}`. Pas de vrai fichier vidéo dans
  ce prototype, seulement la référence horodatée, comme dans la version de référence.

### `log_knowledge_gap`
- **Description** : enregistre une question du technicien qui n'est couverte par aucune
  intervention documentée.
- **Input schema** : `topic` (string, requis) — résumé court du sujet non couvert,
  `context` (string, optionnel) — la question originale du technicien
- **Comportement backend** : insertion dans la table `gaps`. Pas de retour nécessaire au
  modèle au-delà d'une confirmation, cet appel est un effet de bord.

### `locate_equipment_part`
- **Description** : à partir d'une photo (jointe au message, optionnelle) et/ou d'une
  description texte, identifie une pièce précise du chiller CH-12 (seul équipement
  concerné) et retourne une frame vidéo réelle déjà annotée d'un repère visuel sur cette
  pièce.
- **Input schema** : `part_label` (string, requis) — **enum fermé**, construit au
  chargement de `tools.py` à partir de `data/knowledge_base.json` (champ `parts` du
  tutoriel CH1). Le modèle ne peut donc pas inventer de pièce hors de ce vocabulaire.
- **Comportement backend** : lookup exact dans la table `parts` par libellé — aucune
  détection d'image ni calcul de position à l'exécution, seulement le choix d'une entrée
  déjà vérifiée. Voir CLAUDE.md pour la différence entre ce que fait ce tool (classifier
  dans un catalogue restreint) et ce que ferait un vrai produit (authoring semi-automatisé
  du catalogue, relu par un humain, en amont).
- **Retour** : `{tutorial_id, part_label, image_url, video_ts}`. `image_url` pointe vers
  une image pré-générée par `backend/scripts/extract_frames.py` (`/media/CH1/part-<slug>.jpg`),
  jamais dessinée à la volée.
- **Restriction** : le prompt système (règle de grounding #5) interdit explicitement
  d'appeler ce tool pour un autre équipement que CH-12 — l'enum fermé rend de toute façon
  toute autre pièce inatteignable.

## Mode live : deux étapes déterministes, pas des tools

Ajouté le 26/08/2026 — voir `LIVE_MODE_DECISIONS.md` pour l'historique complet des
options envisagées et écartées. Contrairement aux quatre tools ci-dessus, ces deux
étapes ne passent jamais par une décision de Claude : le modèle ne peut de toute façon
pas transporter les octets d'une image dans les paramètres JSON d'un appel de tool, il
ne fait que la voir. Ce sont donc des fonctions Python appelées directement par
`claude_agent.py`, en dehors de la boucle de tool use.

### Identification de l'équipement filmé
- **Où** : `app/services/equipment_identifier.py`, appelée avant même que Claude ne
  commence à traiter le message.
- **Comment** : embedding CLIP (`app/services/embeddings.py::embed_image`, 512
  dimensions — modèle différent de celui utilisé pour le texte) de la frame filmée,
  comparé par similarité cosinus aux photos de référence de `equipment_photos`, avec un
  seuil (`EQUIPMENT_SIMILARITY_THRESHOLD`). Même principe que `search_knowledge_base`
  pour le texte, sur un autre espace vectoriel.
- **Résultat** : injecté comme note en langage naturel avant le message du technicien
  (ex: "l'équipement filmé correspond à SC-3"), pas comme un tool_result — une nouvelle
  règle de grounding (#7) dit à Claude comment réagir selon 0/1/N candidats.

### Localisation d'une pièce sur la frame filmée
- **Où** : `app/services/part_locator.py`, appelée dans la boucle, juste après le
  premier appel de `get_video_segment` réussi du tour (une seule fois, pas à chaque
  étape citée).
- **Étape 1, lookup SQL pur** (`find_part_for_step`) : quelle pièce est associée à
  `(tutorial_id, step_number)` — remplace le choix que faisait auparavant Claude via
  l'enum de `locate_equipment_part`.
- **Étape 2, matching ORB** (`locate_part_in_frame`) : mise en correspondance de points
  caractéristiques (vision par ordinateur classique, `cv2.ORB` — aucun réseau de
  neurones) entre la photo de référence pré-annotée de la pièce et la frame filmée.
  Retourne une position en % de la frame (pas en pixels) si suffisamment de points
  concordent de façon géométriquement cohérente (seuils `MIN_INLIERS` et bornes de
  plausibilité de l'échelle trouvée), `None` sinon — jamais de position forcée.
- **Échec du matching** : le champ `part_visible: false` est ajouté au résultat renvoyé
  à Claude pour ce `get_video_segment`, avec le libellé de la pièce — la règle de
  grounding #9 lui dit d'en informer le technicien en s'appuyant sur la description de
  l'étape déjà connue, plutôt que de rester silencieux ou d'inventer une position.

## Règles de grounding (prompt système backend, jamais exposé au frontend)

Reprendre exactement l'esprit des règles déjà validées dans le prototype de référence
(voir la fonction `buildSystemPrompt` de `reference/field-copilot-prototype.html`),
adaptées au contexte tool use :

1. Le modèle ne doit jamais répondre à une question technique sans avoir d'abord appelé
   `search_knowledge_base` et obtenu au moins un résultat exploitable.
2. Toute affirmation factuelle dans la réponse finale doit être reliée à un `tutorial_id`
   et un `step_n` retournés par un appel de tool, jamais à la connaissance générale du modèle.
3. Si `search_knowledge_base` ne retourne rien de pertinent, le modèle appelle
   `log_knowledge_gap` et répond en indiquant explicitement que ce cas n'est pas encore
   documenté, sans proposer de procédure inventée.
4. La réponse finale doit citer ses sources de façon structurée pour que le frontend
   puisse afficher les cartes de citation (voir `API_CONTRACT.md` pour le format exact).

## Schéma de base de données (Postgres + pgvector)

```sql
create extension if not exists vector;

create table tutorials (
  id text primary key,
  title text not null,
  equipment text not null,
  category text not null,
  diagram_type text not null,        -- 'evse' | 'boiler' | 'escooter' | 'chiller'
  expert_name text not null,
  expert_role text not null,
  session_date text not null,
  tags text[] not null default '{}',
  -- Vrai pour un seul tutoriel (CH1, ajouté le 25/08/2026) : vraie vidéo
  -- réutilisée à titre de démo au lieu du mock canvas — voir CLAUDE.md.
  has_real_video boolean not null default false
);

create table steps (
  id serial primary key,
  tutorial_id text not null references tutorials(id),
  n integer not null,
  title text not null,
  description text not null,
  video_ts text not null,
  embedding vector(384)              -- 384 = dimension de all-MiniLM-L6-v2 (embedding local, voir app/services/embeddings.py)
);

create table gaps (
  id serial primary key,
  topic text not null,
  context text,
  created_at timestamptz not null default now()
);

-- Catalogue de "points chauds" pour locate_equipment_part (ajouté le 25/08/2026)
-- un par pièce nommée d'un tutoriel à vraie vidéo. Vide pour les tutoriels qui
-- n'en ont pas (seul CH1 en a). step_n/center_x/center_y/radius ajoutés le
-- 26/08/2026 pour le mode live (voir section ci-dessus) : la position de la
-- pièce sur SA PROPRE photo de référence, annotée à l'authoring, jamais calculée
-- à la volée. shape/angle ajoutés le 27/08/2026 : cercle ou flèche (plus
-- précis pour une pièce ronde) — `radius` change de sens selon `shape` (taille
-- du cercle, ou longueur de flèche), `angle` ne sert que pour une flèche.
create table parts (
  id serial primary key,
  tutorial_id text not null references tutorials(id),
  slug text not null,       -- data/media/<tutorial_id>/part-<slug>.jpg
  label text not null,      -- même libellé que la légende du schéma SVG (diagrams.tsx)
  video_ts text not null,
  step_n integer not null,
  center_x integer not null,
  center_y integer not null,
  radius integer not null,
  shape text not null default 'circle',
  angle integer
);

-- Photos de référence par équipement, pour identify_equipment_from_photo
-- (ajoutée le 26/08/2026, voir section "mode live" ci-dessus). embedding CLIP,
-- 512 dimensions — pas comparable à la colonne embedding de `steps` (384,
-- modèle texte différent), d'où une table séparée plutôt qu'une colonne de
-- plus sur `tutorials`.
create table equipment_photos (
  id serial primary key,
  equipment text not null,
  image_path text not null,
  embedding vector(512)
);
```

## Script de seed

Écrire un script `backend/scripts/seed.py` qui lit `data/knowledge_base.json`, insère les
tutoriels et les étapes, calcule l'embedding de chaque `description` d'étape, et le
stocke. Ne pas transformer ni enrichir le contenu du JSON, l'insérer tel quel.

## Diagrammes techniques

Les 3 schémas SVG de la référence (onduleur, VRF, automate) restent le gabarit visuel à
suivre (voir `DESIGN_SYSTEM.md`), mais ne correspondent plus aux équipements retenus
depuis le 24/08/2026. Dessiner 3 nouveaux schémas — `evse`, `boiler`, `escooter` — dans
la même grammaire graphique (trait cyan, 4 repères numérotés en pastille ambre, légende),
directement en composants React (un composant par type, ou un composant paramétré par
`diagram_type`), à l'étape 4 du plan.

Un 4ᵉ schéma, `chiller`, a été ajouté le 25/08/2026 pour le tutoriel CH1 (même grammaire
graphique) — voir `frontend/src/diagrams.tsx`.
