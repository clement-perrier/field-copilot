Construis Field Copilot : la version backend/frontend séparée, avec vrai tool use, du
prototype de démo déjà présent dans ce dossier.

Avant d'écrire une seule ligne de code, lis dans l'ordre : CLAUDE.md, ARCHITECTURE.md,
API_CONTRACT.md, DESIGN_SYSTEM.md, puis `reference/field-copilot-prototype.html` en
entier, puis `data/knowledge_base.json`. Ce sont les seules sources de vérité sur les
données, le contrat d'API et l'identité visuelle : n'invente rien qui les contredise.

C'est un projet de démonstration pour un entretien d'embauche : je dois être capable
d'expliquer chaque partie moi-même si on m'interroge dessus. Ça compte plus que la
complétude. Privilégie la solution la plus simple et la plus lisible à la plus élégante,
limite les dépendances et les couches d'abstraction, commente les parties non triviales.

Construis dans cet ordre. Après chaque étape, arrête-toi, résume en quelques phrases ce
que tu as construit et pourquoi tu as fait ces choix précis, et attends que je te dise de
continuer avant de passer à l'étape suivante :

1. Scaffold du repo : `backend/` (FastAPI, structure standard app/routers/services),
   `frontend/` (React + TypeScript + Vite), `docker-compose.yml` avec un service
   Postgres portant l'extension pgvector.

2. Backend, cœur technique du projet : implémente les trois tools définis dans
   ARCHITECTURE.md (`search_knowledge_base`, `get_video_segment`, `log_knowledge_gap`)
   avec le SDK Python officiel Anthropic, la boucle agentique qui laisse le modèle les
   appeler, et le endpoint `/api/chat` en streaming SSE tel que décrit dans
   API_CONTRACT.md. C'est la partie la plus importante à bien faire, le reste peut être
   plus simple.

3. Base de données : migrations SQL du schéma décrit dans ARCHITECTURE.md, script de
   seed qui charge `data/knowledge_base.json` tel quel, calcule les embeddings des
   descriptions d'étapes et les insère.

4. Frontend : porte l'interface de `reference/field-copilot-prototype.html` en
   composants React fidèles à DESIGN_SYSTEM.md (mêmes couleurs, polices, motif de coins,
   diagrammes SVG), branchés sur `/api/chat` en SSE au lieu d'un appel direct au modèle.
   Ajoute un affichage discret des appels de tool en cours, pour rendre visible que le
   modèle va chercher l'information.

5. `README.md` à la racine : instructions de lancement en une commande si possible, et
   une section "pour l'entretien" qui indique précisément quels fichiers regarder pour
   expliquer la boucle de tool use en live.

Contraintes à respecter strictement, rappelées de CLAUDE.md : ne jamais inventer de
nouvelles interventions ou données fictives au-delà de `data/knowledge_base.json`, ne
jamais exposer la clé API côté frontend, garder le prompt système et les règles de
grounding uniquement côté backend. Pas d'authentification, pas de déploiement, pas de
vraies vidéos : ce sont des choix de scope assumés, pas des oublis à corriger.

Objectif final : pouvoir lancer le projet, poser une question couverte par la base et
voir dans les logs backend l'appel réel à `search_knowledge_base`, poser une question hors
périmètre et voir `log_knowledge_gap` s'exécuter et la lacune apparaître dans l'interface.
Mais l'objectif réel derrière ça, c'est qu'à la fin je puisse rouvrir n'importe quel
fichier du projet et t'expliquer, ou expliquer à quelqu'un d'autre, ce qu'il fait et
pourquoi il est écrit ainsi. Si à un moment tu sens qu'une partie devient trop dense ou
trop abstraite pour être expliquée simplement, dis-le moi explicitement plutôt que de
continuer.
