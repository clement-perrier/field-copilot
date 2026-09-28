# Field Copilot — contexte projet pour Claude Code

## Contrainte la plus importante : je dois pouvoir tout expliquer moi-même

Ce projet sert de démonstration technique pour un second entretien d'embauche. Ce n'est
pas seulement le résultat qui compte, c'est ma capacité à expliquer, ligne par ligne si
on me le demande, pourquoi chaque partie existe et comment elle fonctionne. Un projet qui
tourne mais que je ne sais pas expliquer est pire qu'inutile dans ce contexte, il peut se
retourner contre moi si un ingénieur creuse une question pendant l'entretien.

Ce que ça change concrètement dans ta façon de travailler sur ce projet :

- Préfère toujours la solution la plus simple et la plus lisible à la plus élégante ou la
  plus complète. Une boucle explicite de 15 lignes que je peux suivre vaut mieux qu'une
  abstraction générique de 5 lignes qui cache la logique dans une librairie ou un pattern
  que je ne maîtrise pas.
- Limite le nombre de fichiers, de couches d'abstraction et de dépendances au strict
  nécessaire. Chaque dépendance ajoutée doit pouvoir se justifier simplement si on me
  demande pourquoi elle est là.
- Commente les parties non triviales directement dans le code, en particulier la boucle
  de tool use, la logique de grounding, et tout endroit où le comportement du modèle
  n'est pas évident à deviner en lisant le code seul.
- Avance par étapes courtes. Après chaque étape du plan ci-dessous, arrête-toi, résume en
  quelques phrases ce que tu viens de construire et pourquoi tu as fait ces choix
  précis, et attends que je te dise de continuer. Ne pas enchaîner silencieusement les
  cinq étapes d'un coup même si tout te semble clair.
- Si un choix technique a plusieurs options raisonnables (par exemple la façon de streamer
  les événements SSE, ou la façon de structurer la boucle agentique), explique
  brièvement l'option retenue et pourquoi, plutôt que de trancher en silence.

## Ce que c'est
Prototype technique pour un second entretien avec le CEO de SightCall. Il fait suite à
une première version (`reference/field-copilot-prototype.html`) qui fonctionne mais qui
tourne entièrement côté client : base de connaissances et prompt système exposés en clair
dans le navigateur, aucun véritable tool use, aucune vraie base vectorielle.

L'objectif de ce que tu vas construire : refaire la même démo, avec la même identité
visuelle et les mêmes données, mais avec une vraie séparation front / back, une vraie
base vectorielle, et surtout une vraie boucle de tool use où le modèle appelle des
fonctions pour aller chercher l'information au lieu de recevoir tout le contexte d'un coup.

## Documents à lire avant de coder, dans cet ordre
1. `ARCHITECTURE.md` — composants, schéma de données, définition des tools
2. `API_CONTRACT.md` — contrat d'API entre le front et le back, schémas des tools
3. `DESIGN_SYSTEM.md` — identité visuelle à reproduire
4. `reference/field-copilot-prototype.html` — implémentation de référence : CSS, SVG
   des schémas techniques, structure des messages de chat. Ne pas réinventer ce qui
   y fonctionne déjà, le porter.
5. `data/knowledge_base.json` — les 3 interventions fictives déjà écrites (une par
   équipement grand public — borne de recharge EVC-22, chaudière TX-24, trottinette
   électrique SC-3 — choix fait le 24/08/2026 en remplacement du matériel industriel
   d'origine, voir note ci-dessous)

## Règles strictes, ne pas dévier
- `data/knowledge_base.json` fait foi tel qu'il est écrit aujourd'hui. Toute nouvelle
  donnée fictive (intervention, équipement, expert) doit être ajoutée à ce fichier
  d'abord, pas improvisée ailleurs dans le code — le reste du projet (seed, tools,
  frontend) doit pouvoir se contenter de le lire tel quel sans jamais avoir besoin
  d'inventer un complément à la volée.
  Note : la version initiale de cette règle interdisait strictement toute invention.
  Elle a été assouplie le 24/08/2026 le temps de remplacer le matériel industriel
  (PG-4000/VRF-200/AX-7) par des équipements plus grand public, à ma demande explicite.
  Le 25/08/2026, toujours à ma demande explicite, l'assouplissement a été étendu à
  l'ajout d'un second tutoriel sur un équipement déjà présent (F2, frein SC-3) — pour
  pouvoir tester la recherche vectorielle quand plusieurs tutoriels existent pour le
  même équipement, et les questions qui couvrent plusieurs réparations à la fois.
  Toujours le 25/08/2026, un 4e équipement (SC-7, tutoriel G1 — batterie, pas frein)
  a été ajouté pour tester le grounding sous couverture *partielle* : un équipement
  documenté mais pas sur le sujet demandé, différent du cas "équipement totalement
  absent" déjà couvert par le test SC-5. Ça reste une extension ponctuelle et
  documentée, pas une autorisation permanente d'improviser des données ailleurs
  dans le projet.
- La clé API du modèle doit rester côté serveur, jamais exposée au frontend, jamais
  commitée. Utiliser une variable d'environnement `ANTHROPIC_API_KEY`.
- Le prompt système et les règles de grounding vivent uniquement côté backend.
- Le modèle doit répondre en utilisant les tools définis dans `ARCHITECTURE.md`, pas
  en recevant toute la base de connaissances dans le contexte à chaque appel.
- Garder le style visuel exact du prototype de référence (couleurs, polices, motif de
  coins façon viseur caméra, diagrammes SVG numérotés). C'est un choix de design déjà
  validé, ne pas le redessiner.

## Hors périmètre pour ce prototype
Pas d'authentification, pas de déploiement cloud, pas de recherche par similarité d'image.
Le but est de prouver la boucle tool use + grounding + citation + détection de lacune de
bout en bout, pas de livrer un produit complet.

Nuance ajoutée le 25/08/2026, à ma demande explicite, pour approfondir la préparation
entretien : chaque étape citée affiche maintenant un visuel — une image fixe toujours
visible (le "frame clé" qu'une vraie pipeline SightCall extrairait de la vidéo), et un
clic dessus joue le clip propre à cette étape, déjà découpé de la session complète
(`frontend/src/components/StepVisual.tsx`, un `<canvas>` animé façon viseur AR, pas un
fichier vidéo, durée de clip arbitraire). À ce moment-là ça restait "pas de vraies vidéos"
au sens strict — les interventions sont fictives, il n'existe aucune vraie captation à
montrer — mais ça démontrait l'affordance qu'aurait un vrai lecteur. Le composant
l'étiquette explicitement comme illustratif en permanence, pour ne jamais donner
l'impression que c'est une vraie session — ce qui reste vrai pour tous les tutoriels
existants (D1, E1, F1, F2, G1).

Le 25/08/2026, toujours à ma demande explicite, "pas de vraies vidéos" a cessé d'être une
exclusion totale : le CEO apprécie les cas concrets avec vidéo réelle, donc un nouveau
tutoriel est ajouté avec une vraie vidéo libre de droits (Creative Commons / stock
gratuit, jamais une vidéo dont les droits ne sont pas clairs), découpée en étapes calées
sur de vrais timestamps, avec pour certaines étapes une frame extraite et annotée d'un
repère visuel (ex: cercle) sur l'objet de la réparation. Ce tutoriel doit être identifiable
comme le seul reposant sur une vraie captation — ne pas laisser croire, y compris pour ce
tutoriel, à une vraie session d'intervention terrain filmée pour l'occasion : c'est une
vidéo de démonstration réutilisée, pas une preuve d'intervention réelle documentée par
SightCall. Les autres tutoriels restent sur `StepVisual.tsx` (illustratif, pas de vraie
vidéo) : ce n'est pas un remplacement généralisé, seulement un second mode de preuve
visuelle ajouté à côté du premier.

Toujours le 25/08/2026, à ma demande explicite : le technicien peut joindre une photo de
son chiller CH-12 (et uniquement CH-12) à son message, accompagnée d'un texte décrivant
une pièce précise. Le modèle (Claude, vision native) regarde la photo, la met en relation
avec le texte, et choisit — via le tool `locate_equipment_part` — la pièce correspondante
parmi un petit vocabulaire fermé (les 4 pièces déjà nommées dans le schéma du chiller). Le
backend renvoie alors une vraie frame vidéo déjà annotée d'un cercle sur cette pièce (voir
`backend/scripts/extract_frames.py`).

Ce n'est *pas* la recherche par similarité d'image exclue plus haut : il n'y a pas de base
d'images de référence interrogée par embeddings, seulement Claude qui regarde une photo
unique, comme il lirait un texte. Mais la distinction avec un vrai produit mérite d'être
claire, si la question m'est posée en entretien :

- **En production**, ce genre de fonctionnalité reposerait sur un catalogue de "points
  chauds" construit **une fois, en amont, hors ligne**, par équipement : un humain (ou un
  modèle de vision dont les propositions de zones sont *relues et corrigées par un
  humain* avant publication, jamais publiées telles quelles) pointe où se trouve chaque
  pièce nommée dans la vraie vidéo de référence. À la requête, le système ne fait que
  **classer** la demande de l'utilisateur dans ce catalogue déjà vérifié — jamais générer
  une nouvelle position à la volée. C'est ce qui rend la sortie fiable : l'IA choisit
  parmi des réponses déjà approuvées, elle n'invente rien au moment de répondre.
- **Ici**, l'étape d'authoring est faite à la main par moi (les coordonnées du cercle dans
  `extract_frames.py`, 4 pièces, un seul équipement — raisonnable à cette échelle, pas
  automatisable sérieusement pour si peu). La seule chose réellement dynamique dans notre
  système, c'est l'étape de classement : Claude choisit, à la requête, la pièce du
  catalogue qui correspond le mieux à la photo + au texte du technicien, via un `enum`
  fermé dans le schéma du tool (donc littéralement incapable de sortir du catalogue
  vérifié). Cette limite à un vocabulaire fermé n'est pas une simplification du prototype
  à corriger plus tard : c'est le choix qui rend la fonctionnalité montrable en direct
  sans risque qu'un cercle tombe au mauvais endroit devant le CEO.

Pourquoi pas une génération dynamique de coordonnées (demander au modèle de désigner un
point x/y sur la frame vidéo) : la photo du technicien est celle de *son* chiller réel,
jamais la même unité physique que celle filmée dans notre vidéo de démo (angle,
éclairage, arrière-plan différents) — demander au modèle de localiser précisément un pixel
dans une image qu'il n'a jamais vue, à partir d'une autre photo, est un exercice de
généralisation visuelle bien moins fiable que de choisir parmi un petit nombre de
catégories déjà validées. Discuté et tranché ainsi avec Claude Code le 25/08/2026.

## Stack cible
Voir `ARCHITECTURE.md` pour le détail. En résumé : backend Python (FastAPI), Postgres
avec l'extension pgvector (fallback SQLite + sqlite-vec accepté si Postgres n'est pas
disponible en local, à signaler clairement si ce choix est fait), frontend React +
TypeScript + Vite, streaming de réponse en Server-Sent Events, SDK Python officiel
Anthropic pour l'appel au modèle et la gestion du tool use.

## Definition of done
- `docker compose up` (ou une commande unique équivalente documentée dans le README
  généré) démarre backend, base de données et frontend.
- Une question couverte par la base déclenche au moins un appel de tool visible dans
  les logs backend, et la réponse affiche la citation correspondante avec le schéma.
- Une question hors périmètre déclenche `log_knowledge_gap` et apparaît dans le panneau
  de lacunes.
- Le README explique en une page comment lancer le projet et où regarder dans le code
  pour voir la boucle de tool use, en vue d'une explication live en entretien.
- Je suis capable, à la fin, de reprendre chaque fichier principal et d'expliquer avec
  mes mots ce qu'il fait et pourquoi il est écrit ainsi. Si à un moment ce n'est pas le
  cas, c'est un signal qu'il faut simplifier cette partie plutôt que d'ajouter une
  explication de plus dans le README.
