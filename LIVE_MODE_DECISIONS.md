# Mode live — cheminement de décision (26/08/2026)

Ce document retrace les options envisagées entre le retour du CEO après le premier
entretien et la solution retenue, pour pouvoir expliquer en entretien pourquoi
certaines pistes ont été écartées plutôt que de ne montrer que le résultat final.
Contexte : après la première démo (chat texte + citations), le CEO a jugé que c'était
hors sujet par rapport à ce qu'il avait demandé — une vraie session filmée, en temps
réel, où l'assistant annote la vidéo pendant que le technicien filme.

## Option écartée 1 — Caméra self-view cosmétique

Idée initiale : ouvrir la caméra du technicien juste pour donner l'ambiance d'un appel
vidéo en cours, sans que le modèle ne l'analyse.

Écartée parce que : purement décorative, elle ne répond pas au vrai besoin (annoter ce
qui est filmé) et risque de paraître gadget si quelqu'un demande "et cette caméra, elle
sert à quoi exactement ?".

## Option écartée 2 — Rejouer la vraie vidéo CH-12 stylée comme un appel

Idée : habiller la vraie vidéo déjà existante du chiller CH-12 (`RealStepVisual`) d'un
chrome façon appel vidéo (bandeau, timer), pour éviter d'avoir besoin d'un vrai
équipement à filmer le jour de la démo.

Écartée parce que : le CEO a précisé vouloir du temps réel sur ce que le technicien
filme lui-même, pas une rediffusion d'une session préexistante, même bien habillée.

## Option écartée 3 — Tracking continu en temps réel

Idée : un cercle qui suit la pièce en direct pendant que la caméra bouge, comme un
vrai suivi d'objet vidéo.

Écartée parce que : c'est un problème de vision par ordinateur à part entière
(détection + tracking frame par frame), pas quelque chose qu'on obtient en demandant à
Claude — trop risqué à faire tenir de façon fiable dans le délai disponible avant
l'entretien, avec un vrai risque de plantage en direct.

## Option écartée 4 — Gel de frame, mais catalogue fermé façon CH-12 généralisé

Idée : garder le principe déjà en place pour `locate_equipment_part` (Claude choisit
parmi une liste de pièces déjà cataloguées et pré-annotées), simplement étendu à
d'autres équipements.

Écartée / limitée parce que : un catalogue fermé suppose un travail d'annotation fait
à l'avance pour chaque pièce de chaque équipement. Ça ne colle pas à "je filme
n'importe quoi et je pose une question dessus" — l'essence même de la demande du CEO
est de ne pas être limité à un catalogue préparé à l'avance.

## Solution retenue — gel de frame silencieux + coordonnées dynamiques

À l'envoi d'une question en mode live, le frontend capture silencieusement la frame
courante de la caméra (la vidéo continue de tourner à l'écran, seule cette image est
figée en arrière-plan pour le traitement). Cette frame et le texte de la question sont
envoyés ensemble, exactement comme le fait déjà la fonctionnalité photo existante pour
le chiller CH-12. Le modèle cherche d'abord dans la base de connaissances comme
d'habitude, puis exprime lui-même, via un nouveau tool (`annotate_frame`), une
position approximative (en pourcentage de l'image) sur la frame reçue — pas de
catalogue préétabli, pas de calcul déterministe côté serveur : c'est une estimation
visuelle du modèle, comme il décrirait une position en mots si on le lui demandait en
texte.

Compromis assumé : contrairement au catalogue fermé de `locate_equipment_part`
(fiable par construction, mais limité aux pièces déjà annotées), cette estimation
dynamique peut être imprécise. Ce risque est accepté consciemment ici parce qu'il n'y
a pas d'alternative qui réponde à la demande réelle du CEO — la fiabilité doit être
vérifiée par un test en conditions réelles avant l'entretien, sur l'objet qui sera
effectivement filmé.

Cette solution assouplit la décision documentée le 25/08/2026 dans `CLAUDE.md`, qui
écartait justement la génération dynamique de coordonnées au profit d'un catalogue
fermé — assouplissement fait à la demande explicite de l'utilisateur le 26/08/2026,
après retour direct du CEO, pas une dérive silencieuse de la règle initiale.

## Décision affinée — identification d'équipement par embedding image, pas par le modèle

En creusant la solution retenue ci-dessus, un doute légitime est apparu : faire
reposer la reconnaissance de l'équipement filmé sur le raisonnement visuel libre du
modèle revient à réintroduire la même faiblesse déjà écartée pour la position du
cercle (pas de garantie, pas de source de vérité vérifiable).

Solution : ajouter un modèle d'embedding image local (CLIP, via `sentence-transformers`
— même bibliothèque que l'embedding texte déjà en place, pas de nouvelle clé API),
indexer une photo de référence par équipement dans une nouvelle table pgvector, et
comparer la frame capturée à ces références par similarité cosinus, avec un seuil
généreux. Le modèle Claude n'intervient plus dans l'identification elle-même : soit un
seul candidat au-dessus du seuil (utilisé directement), soit plusieurs (on demande
confirmation au technicien dans le chat), soit aucun (équipement non couvert). C'est
le même mécanisme, déjà éprouvé, que `search_knowledge_base` sur le texte — juste
appliqué à un autre espace vectoriel.

Point d'architecture qui en découle : ce ne peut pas être un tool que Claude appelle
avec l'image en paramètre — le modèle ne peut pas reproduire les octets bruts d'une
photo dans un appel de tool, il ne fait que la voir. C'est donc une étape déterministe
côté backend, exécutée automatiquement dès qu'une photo est jointe, avant que Claude
commence à raisonner — pas une décision qu'il prend lui-même.

## Positionnement du cercle sur la frame filmée — deux essais, un rejet, une validation

Contrainte posée explicitement par le CEO : l'annotation doit être dessinée sur ce que
le technicien vient réellement de filmer, pas sur une photo de référence de substitution.
Deux techniques testées en amont de tout code applicatif (spikes isolés, données réelles
de CH-12 comme vérité terrain), pour ne pas construire d'infrastructure autour d'une
idée non vérifiée.

**Essai 1, rejeté — grille + embedding CLIP texte/image.** Idée : découper la frame en
grille, comparer l'embedding CLIP du texte de la pièce (base de connaissance) à
l'embedding image de chaque case, garder la case la plus proche. Testé sur les 4
pièces annotées de CH-12, plusieurs tailles de grille (4×4/6×6/8×8) et plusieurs
formulations de texte : **2 réussites sur 24**, et les échecs ne sont pas "proches" —
sur la pièce "Réservoir de liquide de refroidissement", la case gagnante pointait un
carton en arrière-plan plutôt que le réservoir. Cause probable : découper l'image en
morceaux détruit le contexte visuel dont CLIP a besoin, et les scores de similarité ne
se distinguaient quasiment pas entre bonnes et mauvaises zones (0,23–0,31 sur toute la
plage). Conclusion : cette technique n'est pas fiable pour de la localisation fine,
seulement pour des comparaisons d'image entière (d'où son usage conservé pour
l'identification d'équipement ci-dessus, un problème beaucoup plus grossier).

**Essai 2, validé — mise en correspondance de points caractéristiques (ORB).**
Technique de vision par ordinateur classique (pré-deep learning, aucun réseau de
neurones) : détecter des points caractéristiques dans une photo de référence
pré-annotée de la pièce (même principe que le catalogue `parts` déjà en place pour
CH-12) et dans la frame filmée en direct, les mettre en correspondance, puis calculer
par homographie où la zone de référence se retrouve dans la nouvelle frame. Testé sur
les mêmes 4 pièces, avec une transformation de perspective simulée (rotation/zoom/angle,
sévérité "mild" et "strong") pour imiter un cadrage différent en direct : **8 réussites
sur 8**, écart de quelques pixels seulement même sous la déformation la plus forte.

Condition nécessaire, qui n'est pas une contrainte nouvelle : il faut que ce soit
**le même objet physique** entre la photo de référence et le direct (la technique
retrouve une texture/forme précise, pas un concept général) — donc des photos de
référence prises à l'avance sur l'équipement réel utilisé pendant la démo, ce qui
était de toute façon déjà prévu.

Réserves à vérifier en conditions réelles avant l'entretien, pas des raisons de
rejeter la méthode : le test simule un angle différent par déformation géométrique de
la même image (un vrai second cliché aurait aussi un éclairage différent, généralement
bien toléré par ORB mais pas testé ici), et la pièce visée doit avoir assez de texture
distinctive pour produire des points caractéristiques exploitables.

**Décision** : le positionnement du cercle sur la base de connaissance passe par cette
mise en correspondance de points caractéristiques, pas par une estimation du modèle de
langage ni par l'embedding sémantique testé en essai 1. Le rôle de Claude dans le
mode live se limite donc à : lire la question, aider à formuler la requête de
`search_knowledge_base`, et rédiger la réponse — jamais à juger une position.

## Authoring des photos de référence — assisté par Claude, revu par un humain

Le matching ORB (essai 2 ci-dessus) suppose qu'une photo de référence de chaque pièce
existe déjà, avec sa position marquée à l'avance (`center`/`radius`). Question posée :
qui fait ce marquage, sachant qu'en production on ne peut pas dépendre d'une personne
qui pointe des pixels à la main à chaque nouveau tutoriel ajouté à la base ?

Réponse : ce que `CLAUDE.md` décrit déjà comme le modèle de production pour ce genre de
catalogue — "un humain (ou un modèle de vision dont les propositions de zones sont
relues et corrigées par un humain avant publication, jamais publiées telles quelles)".
La nuance qui rend ça acceptable, contrairement à l'annotation en direct rejetée plus
haut : c'est une étape hors ligne, une seule fois par pièce, avec relecture humaine
avant publication — une erreur ne part jamais en production sans avoir été vue.

Pas besoin de le tester à part : les 4 photos de référence de CH-12 déjà en place dans
le projet ont été positionnées exactement de cette façon (Claude propose, relu avant
publication) et se sont avérées correctes en usage réel tout au long de cette
conversation (cercles bien positionnés sur "Connecteur d'alimentation" notamment) —
preuve en conditions réelles plutôt qu'un spike de plus. Ce pattern est donc formalisé
comme process répétable pour l'ajout de nouvelles pièces/tutoriels, pas réinventé.

## Essai 3 — robustesse du matching ORB à un filtre de balance des couleurs

Question posée en préparant le contenu Instant Cooker (27/08/2026) : la photo de
référence sera prise à un endroit de l'appartement, la frame filmée en direct à un
autre endroit, avec un filtre logiciel léger de balance des couleurs (chaud/froid,
pas de flou ni de vignettage). Le spike précédent (essai 2) ne testait qu'une
déformation géométrique sur la MÊME image — jamais de vrai changement de couleur.

Testé sur les 4 pièces de CH-12, combinant la déformation géométrique déjà validée
avec deux filtres simulés (virage chaud, virage froid — gains différents par canal
BGR, rien de plus agressif) : **13/16 dans le cercle vérité terrain, zéro faux
positif** — les 4 échecs restants sont tous des "pas de correspondance" (le mode
d'échec sûr), jamais un cercle mal placé affiché avec assurance.

Les 3 échecs touchent tous la même pièce ("Connecteur d'alimentation"), déjà la plus
fragile de l'essai 2 (échouait déjà sur l'angle "strong" seul, à la limite du seuil
d'inliers). Pas un problème introduit par le filtre de couleur spécifiquement : une
pièce avec peu de texture distinctive a une marge de confiance plus fine dès le
départ, et n'importe quelle perturbation supplémentaire risque de la faire tomber
sous le seuil. Conclusion actionnable pour le choix des photos de l'Instant Cooker :
cadrer chaque pièce avec un peu de texture/détail autour (pas une surface lisse et
uniforme), pour donner à ORB davantage de points caractéristiques à retrouver.

## Authoring IC1 (Instant Cooker) — un bug trouvé, une nouvelle leçon empirique

En préparant les vraies photos de démo (27/08/2026), deux choses sont sorties de ce
qui n'était encore que théorique :

**Bug trouvé et corrigé** : `part_locator.py::reference_image_path` pointait vers
`part-<slug>.jpg` (l'image déjà annotée d'un cercle, utilisée par l'ancienne
fonctionnalité `locate_equipment_part`/CH-12) au lieu de la frame brute de l'étape.
Un cercle dessiné en dur sur l'image de référence devient un faux repère visuel
qu'ORB chercherait à retrouver dans la frame filmée, où il n'existe pas. Jamais
remarqué avant parce que le spike de test utilisait directement les frames brutes,
pas le vrai chemin de production. Corrigé : la référence ORB est maintenant
`step-<n>.jpg` (la photo brute), le nom `part-<slug>.jpg` annoté reste réservé à
l'ancien usage CH-12 uniquement.

**Nouvelle leçon empirique** : sur les deux premières étapes (prise électrique,
étiquette "Open"), le matching échouait même sans AUCUNE perturbation — seulement 7
points caractéristiques détectés dans un patch de 390×390px, contre des centaines
dans l'image entière. Cause : ces zones sont sur la carrosserie en acier brossé,
lisse et réfléchissante — peu de texture exploitable pour ORB, indépendamment de
l'angle ou de la couleur. Corrigé en élargissant le rayon du patch (150→350px et
224→400px) pour inclure plus de matière texturée autour de la cible — validé ensuite
à 10/10 sous la perturbation angle+couleur complète. Complète la leçon de l'essai 3
("privilégier un cadrage avec de la texture") : une surface réfléchissante/lisse est
un signal plus fort à éviter qu'une simple question de taille de pièce.

## Pivot majeur — abandon du matching ORB, classification CLIP zero-shot par texte

Après une soirée entière à essayer de fiabiliser le matching ORB en conditions
réelles (résolution, éclairage/CLAHE, seuils — voir sections précédentes), le
diagnostic final : ORB compare des pixels, donc reste sensible à toute
variation entre la photo de référence et la frame filmée (angle, lumière,
objectif) — ce qu'un technicien produira toujours en filmant à main levée. Le
27/08/2026, recadrage complet de l'objectif avec l'utilisateur : "impression
de temps réel" suffit (pas besoin d'un temps réel exact), et la preuve que le
moteur utilise la base de connaissance ne dépend pas de *comment* on
positionne un repère visuel — elle dépend du fait que le *sujet* à montrer
vienne de la base, ce qui était déjà acquis (search_knowledge_base,
find_part_for_step).

**Nouvelle direction, testée avant d'être construite** (même discipline que
toute la soirée) : au lieu de comparer une frame à une PHOTO de référence,
comparer une frame à une DESCRIPTION ÉCRITE, via la classification zero-shot
native de CLIP (texte et image dans le même espace vectoriel, voir plus haut).

- **Essai image-contre-image sur les états** (comparer 5 photos d'IC1 entre
  elles) : raté — plage de similarité étroite (0.74-0.91), et les deux états
  opposés du tutoriel (joint retiré / joint remis) obtenaient le score le
  plus haut du tableau. Confirme que CLIP répond à l'ambiance générale d'une
  photo, pas à un détail d'état précis, quand on compare deux images.
- **Essai texte-contre-image, `clip-ViT-B-32`** : 2/5 seulement, à peine
  mieux que le hasard.
- **Essai texte-contre-image, `clip-ViT-L-14`** (modèle plus grand) : 4/5,
  avec le seul raté à un score très proche du bon candidat — la capacité du
  modèle compte énormément ici. ~0.46s par image sur CPU, largement assez
  rapide pour un sondage répété.
- **Essai de discrimination d'équipement** (Instant Cooker contre café/
  lave-vaisselle/vélo, texte only, `clip-ViT-L-14`) : succès net, marge de
  0.103 entre le 1er et le 2e candidat.

**Découverte en cours de route, pas anticipée** : un technicien a filmé sa
machine à café et le moteur (image-contre-image, `equipment_photos`, un seul
équipement connu) l'a reconnue comme l'Instant Cooker — faux positif. Cause
structurelle : avec une seule référence connue, le système ne peut que
répondre "est-ce que ça ressemble assez ?" (un seuil), jamais "à quoi ça
ressemble le plus parmi ce que je connais ?" (une vraie discrimination). Le
test de discrimination ci-dessus confirme qu'avoir de VRAIS concurrents (même
sans photo, juste du texte) résout ce risque bien mieux qu'un ajustement de
seuil.

**Décision** : remplacement complet du matching ORB et de la comparaison
image-contre-image (`equipment_photos`, supprimée) par une classification
CLIP zero-shot texte-contre-image, appliquée aux deux niveaux :
- **Équipement** : `tutorials.equipment_description` + `known_equipment`
  (équipements reconnus mais non documentés, ajoutés seulement comme
  concurrents pour la discrimination — vide pour l'instant, à la demande
  explicite de l'utilisateur, la table existe déjà prête à en recevoir).
- **Étape** : `steps.visual_state` (ce que montre la caméra une fois l'étape
  terminée — différent de `description`, qui est une instruction pour le
  technicien, pas une description visuelle).

Plus aucune photo de référence nécessaire nulle part dans le mode live — élimine
d'un coup toute la sensibilité à l'éclairage/l'objectif/l'angle qui a occupé
toute la soirée. Compromis assumé : la position n'est plus annotée avec un
cercle/une flèche précise sur la frame (`part_locator.py`/ORB laissé en place,
inutilisé pour l'instant plutôt que retiré) — remplacé par une détection de
transition d'étape, jugée plus utile pour l'objectif reformulé ("impression de
temps réel", pas positionnement pixel-précis).

## Architecture "entonnoir" — équipement → problème → étapes

Trois phases côté frontend (`ChatPanel.tsx`), pilotées par un sondage
périodique (toutes les 3s pendant le mode live) qui appelle deux nouveaux
endpoints légers (`routers/live.py`, `/api/live/equipment-check` et
`/api/live/step-check`) — volontairement PAS de vrai tour de conversation
Claude à chaque sondage : trop lent et ça coûterait un appel API réel pour
rien la plupart du temps. Un tour de conversation normal (`/api/chat`) n'est
déclenché que par un vrai message de l'utilisateur (tapé, ou via le bouton
"Next step").

1. **Équipement** : sondage → `identify_equipment_from_photo` (texte). Un
   seul candidat net → message de transition généré côté frontend (pas par
   Claude), passage en phase "problème".
2. **Problème** : purement conversationnel, pas de sondage visuel — le
   technicien décrit le souci, `search_knowledge_base` (inchangé, déjà
   fiable) verrouille sur un tutoriel dès qu'une étape est citée.
3. **Étapes** : sondage → `detect_step_transition` (texte, contre
   `visual_state` de l'étape courante). Dès qu'une transition est détectée,
   le bouton "Next step" apparaît (jamais affiché en dehors de cette
   phase/condition, demande explicite du 27/08/2026) ; au clic, un message
   pré-rempli relance une vraie conversation Claude pour l'étape suivante —
   c'est la citation retournée qui met à jour l'étape suivie côté frontend,
   pas un compteur séparé.

## Retour du premier test réel de l'entonnoir, et deux corrections

Le 27/08/2026 (soirée), premier test réel de bout en bout du nouvel entonnoir CLIP sur
téléphone via tunnel Cloudflare. Retour de l'utilisateur : "the detection of steps
finished was great, works smoothly!" — la détection de transition d'étape (texte contre
image, voir plus haut) fonctionne bien en conditions réelles, contrairement au matching
ORB qu'elle remplace. Deux corrections identifiées pendant ce test :

1. **Bouton "Next step" qui restait affiché pendant l'attente de la réponse.** Il ne
   disparaissait qu'à la réception de l'événement `final` (`onFinal` remet
   `stepReadyToAdvance` à `false`), donc restait visible et cliquable pendant tout
   l'aller-retour réseau vers Claude après le premier clic. Corrigé en réinitialisant
   `stepReadyToAdvance` directement dans le gestionnaire de clic du bouton, avant même
   d'appeler `sendMessage` — pas la peine d'attendre la réponse pour le faire disparaître,
   `onFinal` continue de le refaire à `false` de toute façon pour le cas où l'étape
   suivante s'avère déjà terminée.

2. **Retrait complet de la frame envoyée à chaque message.** Depuis le pivot CLIP (voir
   plus haut), la reconnaissance d'équipement ET la détection de fin d'étape tournent déjà
   entièrement via le sondage périodique (`/api/live/*`), hors de `/api/chat`. Mais
   `sendMessage` continuait, par héritage de l'ancienne architecture ORB, à capturer une
   frame fraîche et à l'attacher à CHAQUE message envoyé en mode live (`live: true` +
   `image` sur `/api/chat`) — un reliquat inutile signalé par l'utilisateur en testant
   ("I can see we send a frame when sending a message, we can remove this feature now").

   Retirer cette frame posait une vraie question : `claude_agent.py` s'en servait aussi
   pour injecter une note "équipement reconnu automatiquement" dans le message (règle de
   grounding #7 de l'époque), nécessaire pour que Claude sache quel équipement chercher.
   Sans frame, cette note aurait disparu et cassé l'entonnoir (Claude redemanderait
   l'équipement à chaque tour). Solution retenue : réutiliser le mécanisme de contexte
   déjà existant pour la sélection manuelle du panneau latéral (`equipment_context` →
   note `[Contexte équipement sélectionné : ...]`, déjà géré par le prompt système sans
   règle dédiée). Dès que le sondage identifie l'équipement (phase "equipment" de
   l'entonnoir), son nom est gardé en état côté frontend (`recognizedEquipment`) et
   renvoyé comme `equipment_context` sur tous les tours suivants — même champ, même
   traitement que la sélection manuelle, pas un deuxième mécanisme à maintenir.

   Conséquence en cascade, toute la chaîne image-par-message devient inutile et a été
   retirée complètement plutôt que laissée en dormance (cohérent avec la préférence du
   projet pour supprimer le code mort plutôt que le garder "au cas où") : le flag `live`
   et l'événement SSE `photo_match` de `/api/chat` (le endpoint léger
   `/api/live/equipment-check` reste, lui, inchangé — c'est un endpoint différent, pas
   concerné), la note `photo_match_note`/l'import `identify_equipment_from_photo` dans
   `claude_agent.py`, la règle de grounding #7 (obsolète, son contenu n'existe plus), et
   côté frontend tous les vestiges (`onPhotoMatch`, `PhotoMatchEvent`, capture de frame
   dans `sendMessage`). `/api/chat` redevient un point d'entrée unique sans branche de
   comportement selon le mode live/non-live — seule la présence d'une `image` (upload
   manuel CH-12) change quoi que ce soit côté agent, comme avant l'introduction du mode
   live.

## Deuxième test réel de l'entonnoir : messages dupliqués, et deux angles de caméra

Deuxième test réel (28/08/2026, même soirée) : "ca l'a fait a la premiere session mais
pas la second" — la reconnaissance d'équipement a marché à la première tentative live
mais pas à la deuxième, avec un symptôme clair : jusqu'à 5 messages "I recognize the
equipment: Instant Cooker..." dupliqués dans le fil de discussion.

**Cause du bug.** `setInterval` déclenche un nouveau tick de sondage toutes les 3s sans
jamais attendre que le précédent ait reçu sa réponse. Sur une connexion plus lente (tunnel
Cloudflare, ou un appel CLIP momentanément plus lent), plusieurs appels
`/api/live/equipment-check` peuvent partir avant que le premier ne revienne. Chacun,
une fois résolu, retrouvait indépendamment `candidates.length === 1` et poussait son
propre message + rappelait `setLivePhase("problem")` — rien ne empêchait ce doublon,
puisque la seule protection existante (`if (livePhase === "problem") return` en tête
d'effet) ne s'applique qu'au PROCHAIN rendu de l'effet, pas aux appels déjà en vol.

**Corrigé** avec deux `useRef` (pas des `useState`, qui ont un cycle de rendu
asynchrone insuffisant pour une garde à l'intérieur d'un même tick) :
- `pollBusyRef` : un tick de sondage qui trouve le précédent encore en vol saute son
  tour plutôt que d'empiler un appel réseau supplémentaire (bénéfice secondaire : moins
  de charge CPU inutile sur le conteneur backend, cohérent avec l'esprit de
  `LIVE_POLL_INTERVAL_MS`).
- `equipmentAnnouncedRef` : garde dédiée à l'annonce elle-même, remise à `false`
  uniquement à l'activation du mode live — garantit qu'un seul message "I recognize..."
  est jamais poussé par session live, quel que soit le nombre d'appels en vol qui
  résolvent avec succès.

**Deuxième retour, sur le contenu plutôt que le code** : deux ajustements de
`visual_state` (IC1) pour coller à ce qui se passe réellement en démo, décidés en testant
la nouvelle formulation contre les vraies photos de référence (`data/media/IC1/step-*.jpg`,
via `embed_image`/`embed_text_clip` dans le conteneur backend — même méthode que les
essais précédents) plutôt qu'en changeant le texte à l'aveugle :

- **Étape 1 (débranchement)** : le texte disait "not plugged into the outlet" (prise
  murale), alors que la vraie photo de référence — et le geste que l'utilisateur préfère
  pour la démo — montre le cordon débranché à la prise DE L'APPAREIL, pas au mur.
  Reformulé pour décrire ce geste précisément. Score contre `step-1.jpg` : 0.283 → 0.288
  (léger mieux, pas de régression).
- **Étape 2 (ouverture)** : filmer le couvercle détaché fonctionnait bien ; filmer la
  cuve ouverte SANS le couvercle dans le cadre ne déclenchait rien. Cause probable : le
  texte d'origine ("the lid removed...") a pour sujet principal l'objet "couvercle" —
  quand celui-ci n'est pas dans le cadre, le texte n'a plus d'ancrage visuel fort.
  Reformulé pour décrire les deux cadrages explicitement (couvercle tenu à la main, OU
  cuve vue de dessus sans couvercle) plutôt qu'un seul. Score contre `step-2.jpg`
  (photo "couvercle tenu", le cas qui marchait déjà) : 0.254 → 0.287 — améliore aussi le
  cas qui fonctionnait, pas seulement neutre. Limite assumée : aucune vraie photo
  "cuve seule, sans couvercle" n'existe dans `data/media/IC1/` pour vérifier
  empiriquement que le cas signalé comme cassé est désormais couvert — la reformulation
  repose sur un raisonnement (décrire des éléments visibles dans CE cadrage : cuve,
  rebord métallique, joint, plutôt que l'objet couvercle) plus qu'sur une mesure directe.
  À reconfirmer au prochain test live.

## Troisième test réel : faux positif sur l'étape "ouverture", et sa vraie cause

Retour immédiat après la reformulation de l'étape 2 ci-dessus : "the lid opening step
is not quite right, I didn't open the lid yet that the next step button appeared
already" — un faux positif, pas le faux négatif qu'on cherchait à corriger. Vérifié tout
de suite contre la vraie photo de cuiseur FERMÉ (`step-1.jpg`, celle du débranchement) :
le texte élargi de l'étape précédente y obtenait 0.250, littéralement AU SEUIL
(`STEP_TRANSITION_THRESHOLD = 0.25`) — un pile-ou-face que la variance réelle
(éclairage, angle) suffisait à faire basculer côté "transitioned: true". Ce chiffre
était déjà visible dans le tableau de test de la reformulation précédente, mais lu à
l'époque comme "ça discrimine bien step-2 vs step-1" (0.250 < 0.287) sans remarquer
qu'il était aussi dangereusement proche du seuil de déclenchement absolu — l'erreur
n'était pas dans le test, mais dans quoi le test aurait dû vérifier en plus : la marge
par rapport au SEUIL, pas seulement la marge entre candidats.

**Cause précise, identifiée en comparant les deux formulations mot à mot** : la
formulation élargie ouvrait sur "an open pressure cooker with the lid off" — une phrase
générique (juste "pressure cooker" + "lid") qui décrit assez bien N'IMPORTE QUEL cadrage
de l'appareil, ouvert ou non, puisque CLIP encode surtout les objets/noms présents plutôt
que la relation logique entre eux (une négation comme "no lid resting on top" ne suffit
pas à exclure un cuiseur fermé — le nom "lid" reste présent dans le texte, que la
négation porte dessus ou non).

**Corrigé** en remplaçant l'ouverture générique par une description spatiale précise —
"looking down into the empty inner pot... with no lid on top" — qui ancre le texte sur un
ANGLE DE VUE (vue plongeante dans une cavité) improbable pour un appareil fermé filmé de
côté, plutôt que sur la seule présence/absence nominale d'un couvercle. Revérifié contre
les trois photos réelles avant déploiement :

| photo (état réel)        | score vs texte étape 2 (reformulé) |
|---------------------------|-------------------------------------|
| step-1.jpg (fermé)        | 0.212 (bien sous le seuil 0.25)     |
| step-2.jpg (couvercle tenu, cas qui marchait déjà) | 0.268 (au-dessus, marge confortable) |
| step-3.jpg (joint retiré) | 0.294 (état ultérieur, cohérent — voir remarque plus bas) |

Puis reconfirmé de bout en bout via `/api/live/step-check` (pas seulement le script de
similarité brute) : `step-1.jpg` → `{"transitioned": false}`, `step-2.jpg` →
`{"transitioned": true, "score": 0.268}`.

**Leçon méthodologique pour la suite** : en testant une reformulation de `visual_state`,
toujours vérifier DEUX choses, pas une seule — (1) le score sur la photo cible dépasse le
seuil avec une marge confortable, ET (2) le score sur la photo de l'étape PRÉCÉDENTE
reste clairement EN DESSOUS du seuil, pas seulement inférieur au score de la cible. Un
bon écart relatif entre deux candidats ne garantit rien si l'un des deux est lui-même
trop proche du seuil absolu.

## Message d'accueil à l'activation du mode live

Ajouté le 28/08/2026, à la demande explicite : un message assistant (purement frontend,
comme les autres annonces de transition — voir plus haut) apparaît dès l'activation du
mode live, avant même la première reconnaissance d'équipement. Nécessaire : sans lui,
rien n'indiquait au technicien que le sondage avait déjà commencé entre le clic sur le
bouton caméra et la première détection.

## Étape "nettoyage" : soupçon de faux positif sur le robinet seul

Retour du 28/08/2026 (même soirée) : "j'ai l'impression que pour l'étape du nettoyage
cela détecte le robinet, il faudrait au moins de l'eau qui coule aussi" — le texte
d'origine ("a rubber sealing ring being rinsed under running water in a sink") pourrait
se satisfaire de la simple présence d'un robinet dans le cadre, avant même l'ouverture
de l'eau.

Limite assumée dès le départ, comme pour l'étape 2 : aucune photo de référence "robinet
fermé, pas d'eau" n'existe dans `data/media/IC1/` pour confirmer directement
l'hypothèse de faux positif — impossible de la reproduire après coup sans le
cuiseur physique. Testé quand même ce qui pouvait l'être : plusieurs reformulations
mettant l'eau EN MOUVEMENT au centre du texte (plutôt que le robinet comme objet),
comparées aux 5 vraies photos de l'entonnoir IC1 :

| texte | step-4 (cible) | meilleur concurrent (step-3, anneau retiré) | marge |
|---|---|---|---|
| ancien ("being rinsed under running water") | 0.266 | 0.231 | 0.035 |
| "water actively flowing from a faucet onto a rubber sealing ring in a sink" | **0.311** | 0.203 | **0.108** |

Une première tentative plus verbeuse (mentionnant explicitly "spray", "ripples",
"translucent ring") a été testée et REJETÉE : elle faisait baisser le score partout, y
compris sur la photo cible (0.246 contre 0.266 pour l'ancien texte) — signe que
détailler davantage n'aide pas forcément CLIP, contrairement à l'intuition ; ce qui
fonctionne c'est de centrer le texte sur le mouvement de l'eau comme sujet principal, pas
d'empiler les adjectifs descriptifs. Le texte retenu triple la marge de discrimination
par rapport à l'étape la plus proche, sans rien changer d'autre — adopté et reseedé,
reste néanmoins à confirmer en conditions réelles (robinet fermé puis ouvert) faute de
photo de référence pour ce cas précis.

## Intervalle de sondage abaissé à 1500ms

Question du 28/08/2026 : peut-on sonder plus fréquemment ? Mesuré avant de changer la
valeur (curl direct, backend chaud, en local donc sans le tunnel Cloudflare) : un appel
`/api/live/step-check` répond en ~1.3-1.4s. C'est ce chiffre, pas une intuition, qui
fixe le plancher utile — `pollBusyRef` (voir plus haut) saute déjà tout tick dont le
précédent n'est pas revenu, donc un intervalle plus court que le temps de réponse réel
ne fait qu'empiler des ticks sautés sans rien accélérer. `LIVE_POLL_INTERVAL_MS` abaissé
de 3000 à 1500 — proche du plancher mesuré, avec une marge pour le round-trip
supplémentaire du tunnel (non mesurable en local).

## "Pourquoi ça m'a envoyé l'étape 3 au lieu de l'étape 1 ?"

Retour du 28/08/2026 : en testant le nettoyage, le guidage a démarré à l'étape 3
(retirer le joint) au lieu de l'étape 1 (débrancher). Reproduit immédiatement via curl
(`equipment_context: "Instant Cooker"`, message décrivant l'odeur/résidu du joint) :
`search_knowledge_base` classe les étapes par similarité sémantique avec la question
posée — "smells and has residue" est sémantiquement proche des étapes 3/4/5 (retirer,
laver, remettre le joint) mais loin des étapes 1/2 (débrancher, ouvrir), qui ne sont
donc JAMAIS remontées dans les résultats de recherche. Le modèle n'a alors littéralement
aucune visibilité sur leur existence et enchaîne sur ce que la recherche lui montre —
en l'occurrence l'étape 3 en premier, sautant l'étape de sécurité (débrancher) au
passage.

**Corrigé** en deux temps :
1. Nouvelle règle de grounding : au démarrage d'une NOUVELLE procédure, toujours
   commencer par l'étape 1 du tutoriel trouvé — appeler `get_video_segment` pour
   l'étape 1 explicitement, même si `search_knowledge_base` n'a jamais classé cette
   étape parmi ses résultats. Un résultat de recherche indique QUEL tutoriel s'applique,
   pas QUELLE étape est sûre pour commencer.
2. Ce faisant, découvert que `get_video_segment` ne renvoyait jamais le contenu réel de
   l'étape (titre/description) — seulement les métadonnées de citation (horodatage
   vidéo, date de session). Ça fonctionnait tant que le modèle apprenait déjà le contenu
   de l'étape via `search_knowledge_base` (qui, lui, renvoie bien titre/description) ;
   mais pour l'étape 1, jamais vue en recherche, `get_video_segment` était la SEULE
   source d'information — d'où une première réponse vague ("start at the beginning of
   the procedure as shown in the clip") une fois la règle #1 appliquée seule, sans ce
   deuxième correctif. `get_video_segment` renvoie maintenant aussi `step_title` et
   `step_description`.

En profitant du passage sur l'étape 1 d'IC1, corrigé aussi une incohérence de contenu
laissée par la reformulation du `visual_state` de cette étape (voir plus haut, "vraie
cause des échecs de matching") : la DESCRIPTION de l'étape (le texte que Claude récite au
technicien) disait encore "unplug... from the wall outlet" alors que le `visual_state`
avait déjà été corrigé pour décrire un débranchement à la prise DU cuiseur — texte de
`description` aligné sur la même version des faits.

**Effet de bord découvert en testant la correction** : renforcer les règles de la
section "LIVE MODE" du prompt a fait basculer le chat texte CLASSIQUE (sans mode live)
vers un guidage étape par étape non désiré — reproduit de façon répétée (2 essais,
2/2). Cause : depuis le retrait du flag `live` la veille (voir plus haut, "retrait
complet de la frame..."), plus aucun signal ne distingue une session live d'un chat
texte classique avec équipement sélectionné à la main — les deux envoient
`equipment_context` sous exactement la même forme. Question posée explicitement à
l'utilisateur plutôt que tranchée seule (deux options : réintroduire un flag `live`
minimal, ou laisser le modèle deviner depuis le contexte) — réponse : réintroduire le
flag. Fait, mais avec un rôle différent de l'ancien : `live` ne transporte plus AUCUNE
image ni logique de traitement de requête, il sert UNIQUEMENT à choisir le system prompt
appliqué (`SYSTEM_PROMPT_BASE` seul, ou concaténé avec `LIVE_MODE_ADDENDUM` si
`live: true`) — la section "LIVE MODE" du prompt (règles 7-9) n'existe même plus dans le
texte envoyé au modèle quand `live` est faux, pas seulement "moins appliquée". Revérifié
par comparaison directe : même requête, `live: true` → guidage étape par étape démarrant
à l'étape 1 ; `live: false` (ou absent) → procédure complète en une réponse, comme avant
toute cette série de correctifs.

## Régression : "next" apparaît presque à chaque fois, pour la mauvaise raison

Retour du 28/08/2026, juste après le passage de l'intervalle de sondage à 1500ms :
"quasiment à chaque fois le bouton next est apparu alors pour la mauvaise raison".

**Fausse piste écartée par le test** : soupçonné d'abord que la nouvelle règle "toujours
commencer à l'étape 1" fasse boucler `currentStepN` en arrière à chaque tour (donc
re-détecter en boucle une condition déjà vraie depuis longtemps, ex: le cordon resté
débranché). Testé directement via curl (tour 1 : décrire le problème → étape 1 ; tour 2 :
"Done, next step please." → étape 2) : la progression est correcte, `currentStepN` avance
bien. Cette piste n'est pas la cause.

**Découverte en creusant** : la matrice complète des 5 textes contre les 5 vraies photos
(jamais faite avant, seulement des comparaisons par paires isolées à chaque
reformulation) révèle que le texte de l'étape 5 ("ring fitted back snugly...", jamais
retouché depuis l'écriture initiale, avant que la méthode de test empirique soit établie
cette nuit) est structurellement cassé : il score PLUS HAUT sur la photo de l'étape 3
(anneau qu'on retire) que sur sa propre photo cible (0.312 contre 0.313 — quasi égalité).
Plusieurs reformulations testées (insistant sur "à plat", "pressé dans la rainure",
"aucune main dessus") n'ont rien résolu : soit la confusion avec la photo de l'étape 3
persiste, soit le score sur la vraie cible tombe sous le seuil. Confirmation d'une
limite déjà documentée tout au début de ce fichier ("essai image-contre-image", "les
deux états opposés du tutoriel obtenaient le score le plus haut du tableau") : retirer
un anneau et le remettre produisent une composition visuelle quasi identique pour un
modèle qui ne voit qu'une image fixe, texte ou pas. **Sans impact opérationnel
aujourd'hui** : l'étape 5 est la DERNIÈRE étape du tutoriel IC1, et le garde-fou
`isLastStep` (ajouté un tour plus tôt, "ne pas afficher le bouton sur la dernière
étape") arrête déjà le sondage avant de jamais comparer ce texte à une frame réelle —
donc pas la cause du bug rapporté ce tour-ci, mais un défaut réel, documenté ici pour ne
pas le re-découvrir plus tard si la logique `isLastStep` change.

**Cause retenue, la plus probable** : le changement du tour précédent (intervalle de
sondage 3000ms → 1500ms). Plusieurs `visual_state` n'ont qu'une marge étroite entre leur
score sur la vraie photo cible et le seuil `STEP_TRANSITION_THRESHOLD = 0.25` — l'étape 2
par exemple n'a que 0.018 d'écart (0.268 mesuré). Doubler la fréquence de sondage double
aussi le nombre d'occasions, sur toute la durée d'une session live, qu'un simple bruit de
frame (flou de bougé, autofocus, variation d'éclairage du téléphone) fasse franchir ce
seuil par accident — un effet purement statistique, pas un bug de logique. Cohérent avec
un symptôme qui touche "presque à chaque fois" plutôt qu'une étape précise : un effet de
fréquence général, pas une confusion ciblée entre deux étapes.

**Corrigé** : `LIVE_POLL_INTERVAL_MS` remonté à 3000ms (retour à la valeur d'avant le
tour précédent). Pas retouché les seuils individuels par ailleurs — l'étape 2 reste avec
sa marge de 0.018, à surveiller au prochain test réel ; si le problème persiste même à
3000ms, la prochaine étape sera d'augmenter spécifiquement cette marge-là plutôt que de
retoucher l'intervalle une deuxième fois.

## Étape 1 : cordon encore branché détecté comme débranché

Retour du 28/08/2026 : "Plugged cord trigger next step when unplugged cord should do it"
— le cordon encore branché déclenche le bouton "Next step", pas seulement le cordon
réellement débranché.

Hypothèse retenue : même limite structurelle que la confusion étape 3/étape 5 documentée
plus haut. Saisir le cordon AVANT de le débrancher et le tenir APRÈS l'avoir débranché
produisent une composition quasi identique sur une image fixe (main + connecteur + prise,
à quelques centimètres près) — la direction du geste ne se voit pas sur une seule photo.

Cinq reformulations testées (écart/séparation visible, cordon "dangling", prise
explicitement vide, sujet principal = la prise plutôt que la main, "appareil hors
tension") contre la seule vraie photo disponible (`step-1.jpg`, l'état cible réel) :
aucune ne dépasse significativement le texte actuel (0.269-0.282 contre 0.288) — toutes
dans la marge de bruit. Contrairement aux étapes 2 et 4 (où une meilleure formulation
avait dégagé une marge nette et mesurable), ici aucune direction textuelle testée ne
sort du bruit — signe que le problème n'est probablement pas la formulation mais la
limite structurelle elle-même.

**Non corrigé** faute de photo de référence pour l'état "encore branché, pas encore
touché" — aucune des 5 photos existantes ne représente cet état (toutes montrent des
étapes déjà en cours). Contrairement à l'étape 5 (où un faux positif masquerait une
vraie étape de sécurité), un déclenchement prématuré ici reste à faible enjeu : le
technicien clique "next" un peu tôt, débranche, et l'étape 2 prend le relais
normalement. Texte actuel conservé (déployer une variante non prouvée, potentiellement
pire, aurait été contraire à la méthode suivie toute la soirée). À reprendre avec une
vraie photo "branché, non touché" si le problème persiste et qu'une vraie correction
est nécessaire.

## Étape 2 enfin corrigée, avec la vraie photo manquante

L'utilisateur a fourni trois nouvelles photos réelles (28/08/2026) : la cuve ouverte
SANS couvercle dans le cadre (exactement la photo manquante signalée deux fois plus
haut), et deux gros plans du dessous du couvercle (avec le joint, puis sans — celui-ci
retiré à la main pour la photo).

Premier test avec cette photo enfin disponible : le texte "either looking down into the
empty inner pot... or the black lid itself held up..." (déployé plus tôt sur la seule
foi du raisonnement) scorait **0.216** contre cette photo — sous le seuil. Confirmation
chiffrée du bug signalé par l'utilisateur : la reformulation précédente, jamais
vérifiable faute de photo, ne couvrait en réalité PAS ce cadrage malgré des phrases qui
semblaient viser explicitement dessus.

Plusieurs reformulations plus détaillées testées (composition/angle décrits
explicitement) : aucune ne dépassait 0.24 sur la photo cible. Ce qui a fonctionné, à
l'inverse : une formulation beaucoup plus COURTE — "a pressure cooker with its lid
removed" — sans aucun détail de composition. Résultat mesuré :

| photo | score |
|---|---|
| cuve ouverte, sans couvercle (la cible manquante) | **0.274** |
| couvercle tenu à la main (cas déjà acquis) | 0.286 |
| cuiseur fermé (faux positif à éviter) | 0.236 |
| étape 4, lavage (pas de confusion) | 0.161 |

Confirme une leçon déjà entrevue plus tôt dans la soirée (l'échec de la formulation
verbeuse pour l'étape 4) : pour CLIP, décrire MOINS mais avec des mots plus généraux
fonctionne parfois mieux que multiplier les détails de composition — l'inverse de
l'intuition en rédaction technique classique. Revérifié de bout en bout via
`/api/live/step-check` avec les deux vraies photos : `transitioned: true` sur la cuve
ouverte sans couvercle, `transitioned: false` sur le cuiseur fermé.

Photos ajoutées à `data/media/IC1/` : `step-2-open-no-lid.jpg`,
`lid-underside-with-ring.jpg`, `lid-underside-without-ring.jpg` (ces deux dernières pas
encore exploitées pour reformuler l'étape 3, dont le texte actuel reste correct contre
elles — 0.259, marge correcte mais pas testée à fond).

## Découverte plus profonde : CLIP ne sépare pas "couvercle mis" de "couvercle retiré"

Retour du 28/08/2026, juste après le correctif précédent : "avec couvercle fermé ça
trigger le next step". Reproduit et diagnostiqué avec `equipment.jpg` (la photo du
cuiseur fermé, cadrage normal, utilisée pour la reconnaissance d'équipement — pas
besoin d'une nouvelle photo, celle-là suffisait) : score de **0.247** contre le texte de
l'étape 2 ("a pressure cooker with its lid removed") — quasiment au seuil (0.25).

Plusieurs reformulations courtes testées (ajout de "not on top", "taken off and set
aside", "no longer attached", "without its lid") : AUCUNE n'améliore la situation, et
plusieurs l'aggravent (le score du cuiseur fermé remonte au lieu de baisser).

**Test décisif** : plutôt que continuer à deviner des formulations, vérifié si CLIP peut
ne serait-ce que séparer sémantiquement les deux CONCEPTS eux-mêmes ("couvercle mis" vs
"couvercle retiré"), indépendamment de toute photo précise — en comparant chaque photo
aux deux textes à la fois et en mesurant l'écart entre les deux scores :

| photo | score texte "ouvert" | score texte "fermé" | écart |
|---|---|---|---|
| cuve ouverte sans couvercle (cible) | 0.274 | 0.274 | 0.000 |
| couvercle tenu à la main (cible) | 0.286 | 0.285 | +0.001 |
| cuiseur fermé, zone prise | 0.236 | 0.239 | -0.003 |
| cuiseur fermé, vue normale | 0.247 | 0.257 | **-0.009** |

L'écart est quasi nul PARTOUT, y compris sur les deux vraies photos ouvertes — la
formulation "fermé" ne perd même pas face à "ouvert" sur les photos réellement ouvertes.
**Conclusion retenue** : ce n'est plus un problème de formulation. CLIP ne représente
quasiment pas la distinction "couvercle attaché / détaché" comme un axe sémantique
séparé pour cet objet — la silhouette générale du cuiseur (grand, inox, couvercle noir)
domine l'embedding bien plus qu'un attribut relationnel sur une petite pièce. Troisième
cas identique ce soir sur le même schéma (prise branchée/débranchée, joint retiré/remis,
maintenant couvercle mis/retiré) : à chaque fois, un état binaire sur une petite partie
d'un objet dominant et globalement inchangé.

Question posée explicitement à l'utilisateur plutôt que tranchée seule (deux options :
garder tel quel en acceptant le risque résiduel — marge 0.274 contre 0.247, soit 0.027,
faible mais réelle — ou désactiver le sondage automatique pour cette étape précise et
passer en confirmation manuelle) — réponse : garder tel quel, risque accepté, même
traitement que le cas de la prise électrique déjà documenté. Aucun changement de code
ni de données à ce stade ; ce constat sert surtout de repère pour la suite (steps 1, 2
d'ouverture et 5 partagent cette même limite structurelle — steps 3 et 4, qui portent
sur un changement plus localisé/distinctif comme un jet d'eau ou un objet totalement
absent du cadre, restent robustes).

## Correction du diagnostic précédent : compromis précision/rappel, pas une limite dure

L'utilisateur a mis en doute la conclusion de l'entrée précédente ("ça marchait à la
toute première implémentation, qu'est-ce qu'on a changé ?") — bonne question, jamais
vérifiée : je n'avais testé le texte "CLIP ne sépare pas ouvert/fermé" que sur la
version COURTE actuelle, jamais sur les deux versions précédentes de ce texte contre
`equipment.jpg` (jamais testée avant ce tour-ci, alors que ce fichier existait depuis le
tout début).

Comparaison des trois versions historiques de `visual_state` (étape 2) contre les 4
photos pertinentes :

| version | fermé (normal) | fermé (zone prise) | couvercle tenu | ouvert sans couvercle |
|---|---|---|---|---|
| 1. toute première ("the lid removed from an open pressure cooker, revealing...") | 0.195 ✓ | 0.229 ✓ | 0.254 | 0.225 ✗ |
| 2. intermédiaire ("either looking down into the empty inner pot... or the black lid...") | 0.206 ✓ | 0.212 ✓ | 0.268 | 0.216 ✗ |
| 3. courte, déployée puis cassée ("a pressure cooker with its lid removed") | **0.247 ✗** | 0.236 | 0.286 | 0.274 ✓ |

Ça change complètement le diagnostic : ce n'est PAS une limite dure de CLIP (contrairement
à ce que l'entrée précédente concluait) — c'est un compromis précision/rappel classique.
Les versions 1 et 2, assez spécifiques (elles nomment des détails visibles uniquement
quand c'est ouvert : "revealing the inner pot", "the rubber sealing ring around the
rim"), restaient sûres contre l'état fermé mais ratenaient le cadrage "ouvert sans
couvercle" — c'est exactement le bug ORIGINAL rapporté par l'utilisateur avant toute
cette série de correctifs, et la raison du confirmé souvenir "ça marchait avant" (pour
le rejet du cas fermé, pas pour la détection complète). En raccourcissant pour
enfin couvrir ce cadrage manqué, le texte est devenu trop générique et a perdu la
sûreté contre l'état fermé.

**Corrigé** en cherchant un compromis plutôt qu'un extrême : garder le texte court, mais
réintroduire UN détail concret discriminant (le joint visible) plutôt que zéro (version 3)
ou plusieurs (versions 1/2). Quatre variantes testées, la meilleure retenue par marge
minimale la plus large sur les deux fronts à la fois :

"a pressure cooker with its lid off, the rubber sealing ring clearly visible inside"

| photo | score | marge |
|---|---|---|
| fermé (normal) | 0.244 | +0.006 sous le seuil |
| fermé (zone prise) | 0.240 | +0.010 sous le seuil |
| couvercle tenu | 0.290 | +0.040 au-dessus |
| ouvert sans couvercle | 0.268 | +0.018 au-dessus |

Revérifié de bout en bout via `/api/live/step-check` sur les 4 photos : `false` sur les
deux états fermés, `true` sur les deux états ouverts. Reseedé.

**Leçon méthodologique** : ne pas s'arrêter à une conclusion "c'est une limite du modèle,
rien à faire" sans avoir d'abord testé TOUT l'historique des formulations contre les
données disponibles — la vraie réponse était dans une comparaison que je n'avais
simplement jamais faite, pas dans une limite réelle de CLIP.

## Anti-rebond + marge élargie pour l'étape 3, et confirmation d'une vraie limite dure

Retour du 28/08/2026, juste après le correctif de l'étape 2 : "lid is on and the button
is appearing" (persiste malgré la marge positive mesurée — hypothèse retenue : bruit de
capture réel, pas simulable depuis ici — voir plus bas) et, pour l'étape 3 : filmer le
dessous du couvercle SANS le joint ne déclenche rien, mais filmer le geste de retirer le
joint À MI-CHEMIN déclenche le bouton à tort.

**Hypothèse écartée par le test** : différence de résolution/qualité entre les photos de
référence (pleine résolution) et la frame réellement capturée en direct
(`MAX_CAPTURE_EDGE = 1280`, JPEG qualité 85%, voir `LiveCamera.tsx`). Repro : photos de
référence dégradées aux mêmes paramètres puis réembeddées — écart négligeable partout
(±0.003). Pas la cause.

**Corrigé, deux angles à la fois** :

1. **Anti-rebond côté frontend** : un geste transitoire (mi-chemin) peut ponctuellement
   dépasser le seuil sur UNE frame sans que l'état final soit atteint. Le sondage exige
   maintenant DEUX `transitioned: true` D'AFFILÉE avant d'afficher le bouton
   (`STEP_CONFIRM_HITS = 2`, `consecutiveTransitionHitsRef`, remis à zéro dès qu'un
   sondage répond `false` OU dès qu'on change d'étape). Un geste en cours ne tient pas
   deux sondages de suite (6s à l'intervalle actuel), un état vraiment stabilisé si.
   S'applique à toutes les étapes, pas seulement l'étape 3 — bénéfice attendu aussi sur
   le cas "couvercle fermé" rapporté en même temps.

2. **Marge élargie pour l'étape 3**, avec les nouvelles photos fournies plus tôt
   (`lid-underside-without-ring.jpg`, gros plan du dessous du couvercle sans le joint) :
   l'ancien texte n'avait que 0.009 de marge dessus (0.259 contre seuil 0.25) — trop fin
   pour survivre au bruit réel, cohérent avec "rien ne se passe" en filmant cet état.
   Nouveau texte testé et retenu : "the pressure cooker lid's groove empty, its rubber
   sealing ring removed and set aside" — marge repassée à 0.061 sur cette photo (0.311)
   et 0.041 sur `step-3.jpg` (0.291), sans nouveau faux positif sur `step-2.jpg`
   (couvercle tenu, joint encore en place : 0.216, sous le seuil).

**Testé et confirmé comme vraie limite dure cette fois** (contrairement au couvercle,
où la conclusion "limite dure" s'était révélée fausse) : le gros plan extrême du dessous
du couvercle ne permet PAS à CLIP de séparer "joint en place" de "joint retiré" — testé
avec le même protocole de marge croisée (comparer chaque photo aux deux textes "avec" et
"sans" à la fois) qui avait servi à corriger le couvercle : joint présent, texte-"avec"
=0.294 / texte-"sans"=0.294 (écart nul) ; joint absent, texte-"avec"=0.312 /
texte-"sans"=0.306 (écart NÉGATIF — la photo SANS le joint score même un peu plus haut
sur le texte "AVEC"). Contrairement au couvercle, ici même la photo qui devrait gagner
ne gagne pas — pas de compromis précision/rappel à trouver, le signal n'existe
simplement pas sur ce cadrage précis. Le texte retenu reste donc calé sur le cadrage
plus large (main tenant l'anneau / joint absent avec un peu de contexte), pas sur
l'extrême gros plan.

## Essai de la comparaison par marge (état "fait" vs "pas fait") — abandonné

Retour du 28/08/2026, juste après l'anti-rebond + l'élargissement de marge de l'étape
3 : "Non c'est pire, et à toute les étapes." L'utilisateur propose de changer de
stratégie : comparer deux descriptions d'ÉTAT contrastées (avant/après) plutôt qu'un
seuil absolu sur une seule description — le même principe que
`identify_equipment_from_photo` (marge entre candidats), qui n'a jamais posé de
problème de toute la soirée contrairement au seuil absolu de `step_detector.py`.

**Testé rigoureusement avant d'implémenter** (colonne `not_done_state` ajoutée, testée
en Python direct dans le conteneur, jamais câblée dans `step_detector.py`) — deux
itérations de paires contrastées pour les étapes 2 et 3 :

- Première paire (quasi-négation minimale, ex: "lid off" vs "lid on") : marges quasi
  nulles partout (±0.003 à ±0.018), plusieurs signes FAUX y compris sur les vraies
  photos cibles (`step-2-open-no-lid` donnait une marge négative alors qu'elle aurait dû
  être positive).
- Deuxième paire (textes volontairement plus distincts, pas une simple négation) :
  meilleures marges sur certains cas, mais nouveaux signes FAUX ailleurs — ex: pour
  l'étape 2, `step-1.jpg` (cuiseur fermé, zone prise) donnait une marge de +0.044
  (FAUSSE, devrait être négative) parce que le texte "pas fait" décrivait une scène
  calme ("posé sur un comptoir") qui ne correspondait pas à la photo réelle (une main
  active près du cordon) — le texte "fait" gagnait par défaut, pas parce que l'état
  était réellement atteint.

**Conclusion retenue** : le principe qui fait le succès de la marge pour l'identification
d'équipement (comparer des CATÉGORIES sémantiquement éloignées) ne se transpose pas à ce
cas — les deux textes "fait"/"pas fait" décrivent le MÊME objet avec une nuance fine,
donc très proches l'un de l'autre dans l'espace d'embedding ; leur différence est
dominée par le bruit de formulation contingent (quelle scène annexe le texte "pas fait"
décrit-il) plutôt que par un axe sémantique d'état propre. Pas un problème de
formulation cette fois — une vraie limite de méthode pour ce type de comparaison
fine sur objet unique.

**Décidé, après bilan de la soirée** : sur les 5 étapes d'IC1, seules 2 (le joint tenu à
la main hors du couvercle — étape 3, cadrage large ; l'eau qui coule — étape 4) ont
montré des marges confortables et stables à CHAQUE test de la soirée, quelle que soit
l'approche. Les 3 autres (prise branchée/débranchée, couvercle mis/retiré, gros plan
joint présent/absent) ont résisté à environ 15 formulations différentes sur deux
stratégies de comparaison distinctes (seuil absolu, marge). Face à ce constat, deux
options proposées : restreindre la détection automatique aux 2 étapes fiables (le reste
en confirmation manuelle), ou revenir à la version d'avant cette série de correctifs.
Choix de l'utilisateur : **revenir en arrière** — anti-rebond retiré, texte de l'étape 3
reseté au texte d'origine ("a rubber sealing ring lifted completely out of the lid, no
longer seated in its groove", marge 0.259/0.030 mesurée plus haut), colonne
`not_done_state` et son câblage dans `seed.py`/`001_schema.sql` retirés (jamais utilisés
en production, code mort). L'étape 2 (corrigée plus tôt avec les vraies photos
fournies) reste inchangée — son correctif est indépendant de cette série et avait déjà
été validé de bout en bout avant l'anti-rebond.

## Test réel sur téléphone — la vraie cause des échecs de matching

Premier vrai test caméra live du 27/08/2026, après authoring d'IC1 : tous les matchings
de pièce échouaient (5/5), y compris le joint qui passait 10/10 en synthétique. Deux
causes réelles trouvées en cours de route, dans l'ordre où elles ont été découvertes :

**1. Écart de résolution référence/frame live** (corrigé, insuffisant à lui seul) —
les photos de référence sont à pleine résolution téléphone (~4080px) alors que
`LiveCamera.tsx` limitait la capture à 1280px. Corrigé en ramenant la référence à une
échelle comparable au moment du matching (`part_locator.py`, `REFERENCE_MAX_EDGE`). Les
échecs ont persisté après ce correctif.

**2. La vraie cause : `getUserMedia` sans contrainte de résolution** — des logs de
diagnostic ajoutés dans `locate_part_in_frame` (comptage de points caractéristiques et
d'appariements à chaque étape, pas juste succès/échec) ont montré que la frame captée
faisait en réalité **640×480**, une résolution webcam très basse — `MAX_CAPTURE_EDGE`
(1280) n'a jamais eu l'occasion de s'appliquer puisque la source elle-même plafonnait
bien plus bas. Cause : l'appel `getUserMedia` ne demandait que `facingMode`, sans
`width`/`height` — sans contrainte, le navigateur retombe sur une résolution par défaut
conservatrice plutôt que d'exploiter les capacités réelles de la caméra du téléphone.
`good_matches` tombait à 0-2 sur 8 requis : la frame était simplement trop pauvre en
détail pour qu'ORB y retrouve quoi que ce soit. Corrigé en ajoutant `width: {ideal:
1920}, height: {ideal: 1080}` à la contrainte vidéo.

Leçon pour la suite : le seuil `MIN_GOOD_MATCHES`/`MIN_INLIERS` n'était jamais le
problème ici — les spikes synthétiques, en travaillant toujours à haute résolution,
n'ont jamais pu révéler un bug qui ne se manifeste qu'avec une source vidéo réellement
basse résolution. Les logs de diagnostic (comptage à chaque étape, pas juste un
booléen) ont été ce qui a permis de trouver la vraie cause rapidement plutôt que de
deviner — à garder en place au moins jusqu'à l'entretien.

## Cercle ou flèche — plus précis pour une pièce ronde

Remarque du 27/08/2026, en préparant le tuto joint d'étanchéité (rond, comme la pièce
qu'il faut désigner) : un cercle qui entoure une pièce ronde englobe forcément une
bonne partie de ce qu'il y a autour, moins précis qu'une flèche qui pointe directement
dessus.

Ça ne remet rien en cause côté calcul : le matching ORB retourne toujours juste une
position (et un facteur d'échelle) dans la frame filmée, complètement indépendant de la
façon dont on l'affiche ensuite. Seul le rendu change. Colonnes ajoutées à `parts` :
`shape` ('circle' | 'arrow', défaut 'circle' pour ne pas casser les 4 pièces de CH-12
déjà en base) et `angle` (direction en degrés, uniquement pour une flèche). `radius`
change de sens selon `shape` plutôt que d'ajouter une colonne redondante : taille du
cercle, ou longueur de la flèche. Le choix de la forme et de l'angle se fait une fois,
à l'authoring (comme le reste du catalogue de pièces), jamais calculé à la requête.

## Guidage étape par étape — scopé au mode live uniquement

En redécrivant le contenu de la base de connaissance le 27/08/2026, un trou est apparu
entre l'intention posée tout au début de cette conversation ("guider une étape à la
fois, en attendant confirmation") et ce qui avait réellement été câblé dans le prompt
système : rien n'empêchait Claude de décrire toutes les étapes d'un tutoriel en une
seule réponse, y compris en mode live — seule l'annotation visuelle (le cercle) était
limitée à la première étape citée du tour (`part_lookup_done`), pas le texte.

Décision : nouvelle règle de grounding (#10), ajoutée sous l'en-tête "LIVE MODE" du
prompt système (`claude_agent.py`) aux côtés des règles #7-9, donc scopée au mode live
uniquement — le chat texte classique garde son comportement existant (peut citer
plusieurs étapes d'un coup, cas déjà testé et documenté dans `DEMO_SCRIPT.md`, section
B, pas remis en cause). En mode live, Claude ne décrit plus qu'une seule étape par
réponse, appelle `get_video_segment` pour cette étape unique, puis attend une
confirmation avant de continuer — pas de nouveau mécanisme de suivi côté backend,
Claude s'appuie sur l'historique de conversation déjà transmis à chaque tour pour
savoir où il en est. Cohérent avec le fait qu'une seule pièce est de toute façon
annotée par tour.

## Échec du matching ORB — deux cas distincts, et le message à l'utilisateur

Question posée : que se passe-t-il si la pièce n'apparaît pas dans la frame filmée
(mauvais angle, hors champ) ?

Deux cas à distinguer, pas un seul :
1. **Pas assez de correspondances** — cas géré par le seuil de confiance déjà prévu
   (nombre d'inliers minimum) : sous le seuil, pas de cercle, réponse texte seule.
   Comportement sûr, cohérent avec `search_knowledge_base` qui retourne une liste vide
   plutôt que de forcer un résultat faible.
2. **Faux positif confiant** — plus dangereux : une texture qui ressemble par hasard
   (autre vis, motif répétitif) peut produire assez de correspondances cohérentes pour
   passer le seuil et donner une homographie plausible mais fausse — un cercle affiché
   avec assurance, au mauvais endroit. À limiter par un seuil d'inliers conservateur et
   une vérification de cohérence géométrique de l'homographie (pas juste le nombre de
   points), et impérativement à tester en rehearsal avant l'entretien (pointer
   délibérément la caméra ailleurs que sur la pièce, vérifier que le système dit
   honnêtement qu'il ne la trouve pas plutôt que d'inventer une position) — nouveau cas
   à ajouter à `DEMO_SCRIPT.md`, au même titre que la lacune totale ou l'ambiguïté déjà
   couvertes côté texte.

**Message à l'utilisateur en cas d'échec** : ne pas se contenter de "recadre", ça
suppose que le technicien sait déjà où chercher — alors que c'est justement ce qu'il
demande. À la place, nommer la pièce ET réutiliser le repère de localisation déjà
présent dans la description de l'étape (retournée par `search_knowledge_base`, aucune
nouvelle donnée à ajouter) : *"Je ne retrouve pas [pièce] dans l'image. D'après la
procédure, [repère tiré de la description de l'étape] — essaie de cadrer cette zone."*

## Ré-identification de l'équipement à chaque message — à valider à l'usage

Constat en relisant le code le 27/08/2026 : `identify_equipment_from_photo` tourne à
CHAQUE message tant que le mode live est actif (`claude_agent.py` ne teste que
`if live and image_bytes`, pas "seulement au premier message"), avec la frame captée
pour ce message précis — pas une identification faite une fois puis mémorisée.

Deux effets possibles si le technicien recadre légèrement entre deux questions sur le
même équipement :
- **Bénin** : le score tombe sous le seuil, Claude redemande confirmation — répétitif
  mais sans risque, l'utilisateur reconfirme.
- **À surveiller sérieusement** : la frame mal cadrée ressemble par hasard davantage à
  la photo de référence d'un AUTRE équipement du catalogue et bascule dessus sans
  redemander — mauvaise base consultée silencieusement.

Décision : garder le comportement actuel (pas de mise en cache de l'équipement
confirmé) plutôt que de deviner la bonne solution sans données réelles — mais tester
spécifiquement ce scénario (mal cadrer volontairement entre deux questions sur le même
équipement) dès que de vraies photos de référence seront en place, avant l'entretien.
Si le cas "bascule silencieuse" se produit en pratique, revenir sur cette décision
(ex: mémoriser l'équipement déjà confirmé pour la conversation, ne ré-identifier que si
aucun équipement n'est encore confirmé).

**Piste reportée, pas construite maintenant** : si la pièce n'est toujours pas trouvée,
demander au technicien de filmer lentement autour de l'équipement et retenter le
matching ORB à intervalle régulier (~1s) jusqu'à obtenir une correspondance — extension
naturelle des deux mécanismes déjà validés (capture de frame, matching ORB), juste
déclenchée en boucle plutôt qu'une fois. Mise de côté pour rester cohérent avec la
décision déjà prise de partir sur une seule frame capturée à la première question.

## Intervalle de sondage redescendu à 2500ms, et retour discret par frame

Demande du 27/08/2026 : sonder un peu plus souvent (`LIVE_POLL_INTERVAL_MS` 3000 →
2500ms) et donner un retour visuel à chaque frame envoyée pendant le mode live, pas
seulement aux vraies transitions (reconnaissance d'équipement, fin d'étape). Pas de
nouveau test de fiabilité mené ici — 2500ms reste net au-dessus du plancher technique
mesuré (~1.3-1.4s, voir plus haut) et `pollBusyRef` continue de sauter tout tick dont le
précédent n'est pas revenu, donc pas de risque d'empilement de requêtes.

Pour le retour visuel, question posée explicitement à l'utilisateur avant d'implémenter
(deux options avec des compromis réels, pas un détail à trancher seul) : un vrai flux SSE
côté backend pour ces ticks, ou un simple affichage frontend basé sur la réponse REST déjà
reçue par `checkEquipment`/`checkStepTransition`. Réponse : affichage frontend seul — les
deux endpoints renvoient déjà tout le nécessaire (candidats reconnus / transition
détectée) de façon synchrone, un flux SSE n'aurait rien apporté de plus qu'une complexité
de connexion persistante à maintenir pour rien. Implémenté comme une ligne de statut
unique (`pollStatus` dans `ChatPanel.tsx`) mise à jour EN PLACE à chaque tick — pas un
message ajouté au fil de discussion à chaque frame, ce qui noierait rapidement la
conversation vu la fréquence du sondage.
