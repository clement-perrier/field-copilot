# Field Copilot

Prototype technique pour un second entretien (SightCall) : assistant conversationnel pour
techniciens de terrain, qui répond à partir d'interventions passées via une vraie boucle
de tool use (recherche vectorielle Postgres/pgvector) plutôt qu'un contexte statique
envoyé au modèle. Contexte complet : `CLAUDE.md`, `ARCHITECTURE.md`, `API_CONTRACT.md`.

## Lancer le projet

Prérequis : Docker Desktop, une clé API Anthropic.

```bash
cp .env.example .env   # renseigner ANTHROPIC_API_KEY dedans
docker compose up --build
```

Une fois les 3 services démarrés (`docker compose ps` pour vérifier que `db` est
`healthy`), peupler la base — volontairement une commande séparée, pas un effet de bord
silencieux du démarrage :

```bash
docker compose exec backend python -m scripts.seed
```

- Frontend : http://localhost:5173
- Backend : http://localhost:8000 (`/health` pour vérifier qu'il tourne)
- Logs backend en direct, filtrés sur les appels de tool uniquement (sans le bruit
  HTTP/uvicorn) — à garder ouvert dans un terminal à côté du navigateur pendant la
  démo : `docker compose logs -f backend | grep --line-buffered "field_copilot.tools"`

Pour repartir de zéro (schéma + données) : `docker compose down -v` puis relancer les deux
commandes ci-dessus.

## Pour l'entretien — où regarder dans le code

Dans l'ordre où je les expliquerais si on me demande de dérouler la boucle de tool use :

1. **`backend/app/services/claude_agent.py`** — le fichier le plus important. La boucle
   agentique manuelle (pas le tool runner du SDK, choix expliqué en commentaire en tête de
   fichier), le prompt système avec les règles de grounding, et le mécanisme de citation :
   pas de tool dédié à la citation de tutoriel, c'est l'appel à `get_video_segment` qui
   *est* la citation (`locate_equipment_part`, lui, a bien un retour dédié, `part_match`
   — voir `API_CONTRACT.md`, c'est un mécanisme différent, pas une citation de tutoriel).
2. **`backend/app/services/tools.py`** — les 4 tools définis dans `ARCHITECTURE.md` :
   schémas JSON envoyés au modèle, implémentations SQL (le filtre équipement dans la
   clause `WHERE`, avant le tri par distance vectorielle). `locate_equipment_part` est le
   seul dont l'enum du schéma est construit depuis `data/knowledge_base.json` au chargement
   du module, plutôt qu'écrit à la main — voir CLAUDE.md pour pourquoi (et pour la
   différence entre ce prototype et un vrai pipeline de détection de points chauds).
3. **`backend/app/routers/chat.py`** — comment la boucle devient un flux SSE
   (`event: tool_call` / `tool_result` / `answer_delta` / `final`).
4. **`backend/app/services/embeddings.py`** — pourquoi un modèle d'embedding local
   (sentence-transformers) plutôt qu'une API externe : pas de deuxième clé à gérer.
5. **`frontend/src/api.ts`** — le pendant côté client : `EventSource` ne supportant pas
   les requêtes POST, un petit lecteur SSE écrit à la main sur `fetch()`.
6. **`docker-compose.yml`** — deux gotchas de réseau Docker rencontrés en testant en
   conditions réelles, tous deux commentés dans le fichier : `DATABASE_URL` et
   `VITE_BACKEND_URL` doivent pointer vers le nom du service (`db`, `backend`), pas
   `localhost`, qui à l'intérieur d'un conteneur désigne le conteneur lui-même.
7. **`data/knowledge_base.json`** — la donnée source, chargée telle quelle par
   `backend/scripts/seed.py`.
8. **`frontend/src/components/RealStepVisual.tsx`** — le seul tutoriel (`CH1`) à afficher
   une vraie vidéo plutôt que le mock canvas de `StepVisual.tsx` : les deux composants
   cohabitent, sélectionnés par `tutorial.has_real_video`. Les frames fixes et l'annotation
   (cercle sur l'objet de la réparation) sont pré-générées par
   `backend/scripts/extract_frames.py` — déjà exécuté, les fichiers sont commités dans
   `data/media/CH1/`, à relancer seulement si la vidéo source change.
9. **Joindre une photo (chiller CH-12)** — bouton 📎 dans `ChatPanel.tsx`, image encodée
   en base64 et envoyée dans `/api/chat` (`ChatRequest.image`), vue par le modèle en
   multimodal (`claude_agent.py`), résolue en une pièce du catalogue par
   `locate_equipment_part` (`tools.py`), affichée par `PartMatchCard.tsx`. Voir `CLAUDE.md`
   pour la discussion complète : pourquoi ce n'est pas de la recherche par similarité
   d'image, et ce qu'un vrai produit ferait différemment (catalogue de points chauds
   construit en amont, relu par un humain, pas de génération de position à la requête).

## Hors périmètre (choix assumés, pas des oublis)

Pas d'authentification, pas de déploiement cloud, pas de recherche par similarité d'image.
Le but est de prouver la boucle tool use + grounding + citation + détection de lacune de
bout en bout — voir `CLAUDE.md` pour le détail complet de ces choix.

Exception assumée et isolée : le tutoriel `CH1` (chiller CH-12) s'appuie sur une vraie
vidéo libre de droits (réutilisée à titre de démo, pas une vraie session filmée pour
SightCall) au lieu du mock canvas des 5 autres tutoriels — voir `CLAUDE.md`, note du
25/08/2026, et la section suivante pour les fichiers concernés.

Deuxième exception isolée, même date : le technicien peut joindre une photo de son
chiller CH-12 pour repérer une pièce précise (`locate_equipment_part`). Ce n'est pas la
recherche par similarité d'image exclue ci-dessus — pas de base d'images de référence
interrogée par embeddings, seulement Claude qui regarde une photo unique. Voir `CLAUDE.md`
pour la distinction complète, y compris ce qu'un vrai produit ferait différemment.

## Stack

FastAPI (Python) · Postgres + pgvector · React/TypeScript/Vite · SDK Python officiel
Anthropic, modèle `claude-opus-5`. Détail dans `ARCHITECTURE.md`.
