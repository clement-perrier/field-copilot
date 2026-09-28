# Identité visuelle — Field Copilot

Le code source exact (CSS complet, markup SVG des 3 diagrammes, structure des cartes de
citation) existe déjà et fonctionne dans `reference/field-copilot-prototype.html`. Ce
document résume l'intention pour guider le portage en composants React, il ne remplace
pas la lecture du fichier de référence.

## Intention

Esthétique "plan technique / carnet de terrain", pas une esthétique SaaS générique. La
référence visuelle est le schéma industriel annoté et le viseur de caméra AR, en écho au
métier de SightCall (visio-assistance avec overlays visuels). Éviter tout ce qui ressemble
à un template de chatbot générique.

## Tokens couleur (variables CSS déjà définies dans le fichier de référence)

| Rôle | Valeur | Usage |
|---|---|---|
| Fond principal | `#0c1c2b` | fond de page, façon plan bleu |
| Fond panneau | `#12253a` | cartes, panneaux latéraux |
| Fond panneau surélevé | `#16304a` | bulles utilisateur, chips actives |
| Ligne de grille | `rgba(146,196,224,0.16)` | grille de fond façon papier millimétré |
| Accent principal | `#56c7e8` (cyan) | liens, bordures actives, texte assistant |
| Accent alerte | `#f5a623` (ambre) | lacunes détectées, repères vidéo, numéros de schéma |
| Accent succès | `#3fcf9e` | statut "base chargée" |
| Texte principal | `#e9f2f7` | |
| Texte secondaire | `#8fa8bb` | |

## Typographie

- Titres / display : **Barlow Condensed**, gras, majuscules, letter-spacing large
- Corps de texte : **IBM Plex Sans**
- Données, horodatages, identifiants : **IBM Plex Mono**

Les trois sont chargées via Google Fonts dans la référence, à reprendre à l'identique.

## Motif signature : coins façon viseur caméra

Les cartes de citation utilisent des coins en L (`::before`, `::after`, plus deux
éléments `.bl`/`.br`) qui évoquent un cadrage AR, pas un simple `border-radius`. C'est
l'élément distinctif du design, à conserver tel quel sur les cartes de citation dans la
version React (classe `.bracket` dans la référence).

## Composants clés à porter

- **En-tête** : logo circulaire avec point ambre pulsant, statut "base de connaissances
  chargée" en pastille verte
- **Panneau latéral gauche** : sélecteur d'équipement (chips), liste de la base de
  connaissances avec attribution expert
- **Fil de chat** : bulles utilisateur alignées à droite (fond neutre), bulles assistant
  alignées à gauche (fond cyan très transparent, bordure cyan), variante ambre pour les
  réponses en lacune
- **Carte de citation** : titre du tutoriel, badge id, attribution expert, schéma SVG à
  gauche, liste d'étapes numérotées à droite avec repère vidéo en pastille pointillée ambre
- **Panneau latéral droit** : liste des lacunes détectées, compteurs de session

## Diagrammes techniques

La référence (`ups`/`vrf`/`plc`, matériel industriel) reste l'exemple à suivre pour le
*style* : 4 repères numérotés en pastille ambre sur un schéma au trait cyan, plus une
légende associée. Depuis le changement d'équipements du 24/08/2026 (voir `CLAUDE.md`),
les 3 diagrammes concrets ne sont plus ceux de la référence : ce sont `evse` (borne de
recharge EVC-22), `boiler` (chaudière TX-24) et `escooter` (trottinette électrique SC-3),
dessinés à l'identique du gabarit visuel de la référence (même grammaire graphique,
nouveau contenu), paramétrés par `diagram_type` stocké sur chaque tutoriel dans
`data/knowledge_base.json`.

## Responsive

Layout 3 colonnes (sidebar gauche / chat / sidebar droite) qui s'empile en une colonne
sous 980px, chat en premier. Voir la media query déjà en place dans la référence.
