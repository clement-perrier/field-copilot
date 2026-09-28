-- Schéma Postgres + pgvector — voir ARCHITECTURE.md pour le détail des 3 tables.
--
-- Ce fichier est monté dans /docker-entrypoint-initdb.d du conteneur Postgres
-- (voir docker-compose.yml) : l'image officielle exécute automatiquement tout
-- .sql présent dans ce dossier au tout premier démarrage du volume de données
-- — pas d'outil de migration séparé à justifier pour ce prototype.

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
  -- Vrai pour exactement un tutoriel (CH1, ajouté le 25/08/2026) : celui-là
  -- s'appuie sur une vraie vidéo (libre de droits, réutilisée) au lieu du
  -- mock canvas de StepVisual.tsx. Faux partout ailleurs — les autres
  -- interventions restent entièrement fictives, voir CLAUDE.md.
  has_real_video boolean not null default false,
  -- Description visuelle de l'équipement (ajouté le 27/08/2026, voir
  -- LIVE_MODE_DECISIONS.md, "pivot texte"), pour l'identification en mode
  -- live par classification CLIP zero-shot (texte contre image) — remplace
  -- equipment_photos (comparaison image contre image, retirée). Nullable :
  -- seuls les tutoriels utilisés en mode live en ont besoin.
  equipment_description text
);

create table steps (
  id serial primary key,
  tutorial_id text not null references tutorials(id),
  n integer not null,
  title text not null,
  description text not null,
  video_ts text not null,
  -- 384 dimensions : dimension de sortie de all-MiniLM-L6-v2 (voir
  -- backend/app/services/embeddings.py). Si ce modèle change, cette colonne doit
  -- changer avec lui — les deux ne sont pas indépendants.
  embedding vector(384),
  -- Description de ce que montre la caméra une fois cette étape terminée
  -- (ajouté le 27/08/2026, voir LIVE_MODE_DECISIONS.md) — pas la même chose
  -- que `description` (une instruction pour le technicien, pas une
  -- description visuelle) : sert à détecter automatiquement la transition
  -- vers l'étape suivante en mode live, par classification CLIP zero-shot.
  -- Nullable : seuls les tutoriels utilisés en mode live en ont besoin.
  visual_state text,
  -- Faux pour les étapes où la comparaison CLIP s'est révélée peu fiable en
  -- conditions réelles (couvercle ouvert/fermé, anneau remis en place — voir
  -- LIVE_MODE_DECISIONS.md : même bruit non détectable pour un état localisé
  -- sur une petite pièce d'un objet qui reste, par ailleurs, identique).
  -- Pour ces étapes, le sondage périodique est sauté et le bouton "Next step"
  -- est disponible dès l'arrivée sur l'étape — confirmation du technicien
  -- plutôt qu'une détection automatique dont la fiabilité n'était pas au
  -- rendez-vous. Vrai par défaut : la plupart des étapes ont une détection
  -- fiable, l'exception doit être explicite dans les données, pas l'inverse.
  auto_detect boolean not null default true
);

create table gaps (
  id serial primary key,
  topic text not null,
  context text,
  created_at timestamptz not null default now()
);

-- Catalogue de "points chauds" pour le tool locate_equipment_part (ajouté le
-- 25/08/2026, voir CLAUDE.md) : un par pièce nommée d'un tutoriel à vraie
-- vidéo. Vide pour les tutoriels qui n'en ont pas (seul CH1 en a) — pas de
-- colonne booléenne équivalente à has_real_video ici, l'absence de lignes
-- suffit à exprimer "pas de catalogue de pièces pour ce tutoriel".
--
-- step_n/center_x/center_y/radius ajoutés le 26/08/2026 pour le mode live
-- (voir LIVE_MODE_DECISIONS.md) : la position de chaque pièce sur SA PROPRE
-- photo de référence (data/media/<tutorial_id>/part-<slug>.jpg), annotée à la
-- main (ou proposée par Claude et relue par un humain) lors de l'authoring,
-- jamais calculée à la volée. step_n relie une pièce à l'étape du tutoriel où
-- elle est concernée — c'est ce qui permet un lookup SQL direct depuis
-- (tutorial_id, step_number), là où avant seul Claude savait faire ce lien
-- (choix d'un label dans un enum, voir la discussion sur locate_equipment_part
-- dans LIVE_MODE_DECISIONS.md).
-- shape/angle ajoutés le 27/08/2026 (voir LIVE_MODE_DECISIONS.md) : un cercle
-- entourant une pièce ronde (ex: un joint d'étanchéité) englobe aussi tout ce
-- qu'il y a autour, moins précis qu'une flèche qui pointe dessus. `radius`
-- change de sens selon `shape` : taille du cercle si 'circle', longueur de la
-- flèche si 'arrow' — pas de colonne redondante en plus pour ça. `angle` ne
-- sert que pour 'arrow' (direction, en degrés, d'où vient la flèche vers la
-- pièce) — voir FrameAnnotationCard.tsx pour la convention exacte.
create table parts (
  id serial primary key,
  tutorial_id text not null references tutorials(id),
  slug text not null,       -- suffixe du fichier image : data/media/<tutorial_id>/part-<slug>.jpg
  label text not null,      -- même libellé que la légende du schéma SVG (diagrams.tsx)
  video_ts text not null,
  step_n integer not null,
  center_x integer not null,
  center_y integer not null,
  radius integer not null,
  shape text not null default 'circle',
  angle integer
);

-- Équipements reconnaissables mais sans tutoriel documenté (ajouté le
-- 27/08/2026, voir LIVE_MODE_DECISIONS.md) — sert de "concurrents" à la
-- classification d'équipement en mode live : sans eux, un équipement filmé
-- n'est comparé qu'à une seule référence connue (celle du tutoriel en cours),
-- et n'importe quoi qui lui ressemble un minimum peut dépasser le seuil par
-- coïncidence, faute d'alternative pour le départager (faux positif constaté
-- en test réel : une machine à café reconnue comme l'Instant Cooker). Pas de
-- colonne embedding ici : le texte est cours, le recalculer à la volée à
-- chaque comparaison est bon marché, pas besoin de le stocker.
create table known_equipment (
  id serial primary key,
  equipment text not null,
  description text not null
);

-- Pas d'index vectoriel (ivfflat/hnsw) : à 20 lignes dans `steps`, un scan
-- séquentiel est déjà instantané et exact. Un index ANN ajouterait un paramètre
-- (nombre de listes, etc.) à justifier sans aucun bénéfice mesurable à cette
-- échelle — à reconsidérer si le corpus de tutoriels grossissait réellement.
