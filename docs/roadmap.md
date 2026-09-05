## Current focus


## vérifier
- dans les relearning il y a un problème de regroupement des mêmes groupes
- dans les relearning, mettre la même image qui a posé problème
- pour les groupes de texte, ne pas nécessairement demander d'écrire mais juste laisser choisir la qualité
- bug dans l'import des packs avec la question du tag merging
- les pauses de questions disparaissent dans entrainement mais prennent toujours une place dans le calendrier
- pourquoi j'ai 153 à faire aujourd'hui (obligé de changer le rythme et revenir dessus pour update le nombre)
- laisser les boutons de tag manager et queue manager across type dans manage
- ctrl+s pour sauvegarder les changements
- petite animation pour les inline quality de map
- la map se floute pendant une demi seconde quand les boutons qualité apparaissent
- ajouter search input dans le groupe de texte
- ajouter avec un bouton en dessous de la dernière ligne comme dans les medias
- splitting groups based on their difficulty is great but if you give the same mode to both groups, why split them in the first place ?

## Urgent
- bouton synchroniser depuis le menu (push pull)
- quand on a modifié localement un groupe, proposer de reupdate le pack associé
- système social (amis, packs privés, ...)
- laisser les créateurs personnaliser la devanture de leur pack
- dans les settings, un truc pour me contacter
- app mobile
- dire clairement qu'il faut attendre 5 min pour refaire les erreurs
- pour type prompt valider automatiquement au lieu de entrer
- une question maitrisée est uniquement en type all ? -> un doute entre deux réponses = pas puni
- how is the mode for relearning chosen ? shouldn't we keep the same mode or one with similar difficulty ?
- le zoom d'image est un peu naze
- problème: les qcm ne demandent parfois pas de réflexion (raisonner pas élimination) et reportent à plus tard même lorsqu'on met dur -> réduire le threshold du choix du mode en fonction du progress de la question ?
- demander si on veut ajouter le pack à la review au moment de l'importer ?
- menu study à améliorer
- shuffle toutes les questions dans la review
- arrêter de cut les groups dans la review puisqu'on a le inline
- eventuellement ajouter des zones en plus pour cibler une difficulté de mode en qcm
- enlever les questions isolées et remplacer par des groupes de 1 question
- quand je réponds à la moitié d'un groupe dans la review, enregistrer localement les réponses et ne pas attendre la fin du groupe pour enregistrer
- mieux afficher les relearning
- l'email supabase
- mettre un bouton supprimer le pack si on l'a importé par erreur
- bug: si je me trompe à une question et que je change dans le recap, ça me l'envoie quand même dans le relearning
- bouton pour shuffle un groupe dans le queue manager
- inline pour type_prompt d'images
- afficher le pseudo plutot que l'email
- mettre un input optionnel pour les questions de type texte
- gros temps de chargement quand je rentre dans la review
- les modes d'associations (qcm, text truc, ...) ne doivent pas apparaître s'il y a moins de x éléments
- type_all media n'a pas de inline quality et type_prompt non plus
- l'animation des inline quality n'a pas le temps d'être vue car le bouton disparaît trop vite (quand même zoomer sur la zone suivante mais laisser le temps de voir l'animation)
-> pas sûr qu'il y ait une animation dans tous les modes en fait
- everytime i go back to the main menu, I see that the rebalancing added a few questions to today's queue.
- flèches de gauche et droite pour changer la qualité dans recap
- le retour arrière ne fonctionne pas comme il faut partout
- bug du flou avec la qualité pas corrigé
- enlever le type_all mais ajouter un mode one shot sans erreur autorisée


## quick fixes

- faire en sorte que les interfaces des menus soient bien positionnées sur l'écran
- ajouter le timer final dans la recap d'entrainement de maps
- ajouter un chip reconnaissable pour le type image au dessus du titre dans la preview de groupe (et décaler les chips pour qu'elles hug le bord gauche)
- ajouter des raccourcis clavier pour les nouveaux modes
- mettre une petite loupe plutôt que le + pour la preview des images
- scroll automatique à enlever quand on quitte la preview d'une image de 
- pouvoir zoomer sur les images pour les questions isolées
- ajouter le nombre de questions des groupes media (et d'autres ?)

## bugs

- il faudrait charger la question suivante pendant qu'on répond à celle d'avant et pas avant
- si j'ai un groupe split en deux dans la review, je crois que le relearning les garde séparés en deux groupes au lieu de les regrouper

## to do when i have more time

- aller voir l'historique d'une seule question et facilement voir la réponse que j'ai donnée à chaque fois
- heatmap des zones les plus durs pour les maps
- trouver un meilleur agencement pour les aliases dans map preview
- supprimer une question appelle le rebalancing ?
- permettre d'accepter une réponse fausse si faute de frappe
- ajouter une barre de progression qui montre la maîtrise d'une question dans manage (et éventuellement un historique de la progression en fonction du temps)
- fine tune les difficultés des modes en fonction des prédictions des reviews en prenant type_all en ref
- qcm de maps : choisir des zones proches pour les réponses
- uniformiser le style partout
- augmenter la difficulté des qcm en proposant des réponses plus proches
- essayer de deviner la mode_difficulty (je sais pas comment ça s'appelle) d'un qcm en fonction des propals
- faire les modes en fonctions des gaps dans le calendrier ?
- faire un truc automatique pour importer les maps svg (data-code, les shapes pour les zones trop petites)
- un mode où je dois pointer sur une map le plus proche possible
- site de quiz en ligne relié
- ajouter type liste (ordonné et désordonné ? alphabet grec / albums d'asterix)
- créer de nouveaux modes timeline (et revoir la création ?)
- leaderboard des packs
- suivre des amis
- faire des packs publics/amis only/privés
- challenge des amis sur des packs
- quels sont les principes à respecter pour un rendu graphique idéal ? vérifie que c'est appliqué partout
- permettre d'avoir un "type" map où il faut cliquer sur toutes les zones qui respectent un critère (ex: les pays où on parle français) (pas forcément binaire)
- faire des qcm pas que de 4 réponses (peut aider à adapter la difficulté)
- bouton pour réinitialiser une question (ou juste sa progression)

## refactors

## ideas

- faire un mode "compétition" où on peut jouer contre d'autres personnes en temps réel
- ia pour proposer des qcm si on a pas la réponse (à la TLMVPSP)
- faire une extension pour chrome pour facilement créer des questions à partir de n'importe quelle page web (ex : pour faire une question sur une ville, aller sur la page wikipedia de la ville et créer la question à partir de là en sélectionnant la zone de la carte) (avec de l'ia éventuellement pour suggérer la question et les réponses à partir du contenu de la page)
- quand on vient d'ajouter une question, ajouter un indicateur et on doit passer la souris sur la card dans la liste pour enlever l'indicateur (à la LoL)
- systeme de mmr
- différentes langues disponibles
- scraper le site de émilien
- indice dans l'entraînement (exemple: premières lettres, éliminer la moitié des zones restantes, ...)
- type liste ? (= juste énumérer)
- les questions ratées réapparaissent avec un mode différent (si disponible pour le type de question)
- un module pour entrainer à bien écrire les caractères spéciaux (dessiner et reconnaître les kanjis ou autre)
----> peut aussi servir pour dessiner des drapeaux, des symboles, des logos (soit self evaluation, soit reconnaissance par l'ia)
- organiser la section tags de training en arborescence conformément à l'arborescence des tags dans manage
- autoriser l'italique, le gras, le souligné
- faire un truc cooperatif à la git pour les packs
- quand on change de preview dans manage, garder l'état en mémoire et attendre pour enregistrer ou annuler
- peut être avoir plein de templates de maps à disposition pour aider les gens à faire leurs custom svg
- faire des modes de jeu infinis et fun (mini jeux)
- si c'est la même map, permettre de combiner des trainings de deux trucs différents (pays + capitales du monde par exemple)
- un mode 1v1 (ou plus) sur un pack en particulier ou sur un pack aléatoire ou sur un pack aléatoire en commun ? sur un tirage aléatoire du pack (pour pas faire tout le pack) ex: chacun son tour remplir une map, le dernier gagne
- enlever le truc des versions de packs et juste permettre d'éditer un pack
- laisser un champ d'input optionnel pour tous les types (même texte) mais laisser quand même le choix de qualité au user
- regarder les essais et le temps mis pour suggérer une qualité
- un truc pour relier les questions entre elles (ex: france -> pays du monde, capitale, drapeau, ...)
- comment interroger sur les explorateurs pour tenir compte de l'année et de ce qu'ils ont découvert ?


## Conseils/idées issus de la littérature scientifique

- varier les contextes
- "cite les pays frontaliers de l'allemagne"
- indices (progressifs)
- mode free recall (?)
- objectif de rétention par thème : par exemple 85 %, 90 %, 95%
- bloquer un trop gros load de nouvelles questions
- autoriser réviser en avance
- afficher une prédiction sur la proba de s'en souvenir ajdhui
- mettre un statut sur les questions : new / learning / fragile / stable / mastered
- faire un mode différent pour les nouvelles questions ? apprentissage into quiz ?
- ajouter un input pour les questions textes puis créer automatiquement des cartes "différence entre X et Y" après avoir identifié des confusions récurrentes entre certains auteurs ou autre ("quel auteur est associé au naturalisme ?", "madame bovary vs germinal", "classe ces auteurs par mouvement littéraire")
- dans l'entraînement : mode "mes erreurs récentes", "différences proches"
- interleaving : mélanger intelligement les thèmes proches
- option pour questions timeline : "qui est antérieur : X ou Y ?"
- créer plusieurs chemins vers la même connaissance : date > événement / événement > date (i.e. générer automatiquement des cartes inverses).
associer les paires, retrouver à partir d'une image, trouver tous les éléments d'une catégorie
- accompagner un palais mental
- accompagner pour PAO (table de 00-99)
- pour chaque carte, faire un bouton : créer une image mentale absurde (mini-histoire, lien phonétique, lien spatial, image visuelle absurde)
- graphe de connaissances pour faire des questions synthèse, comparer, expliquer, match
- signaler les cartes trop longues
- éviter la charge cognitive ! signaler cartes trop longes, écran minimaliste
- feature transformer info brute en questions efficaces : import d'un texte > extraction automatique de faits > proposition de questions > détection des dates, lieux, personnes > génération de cartes "inverses"/"pourquoi"/"différence entre" > validation manuelle
- au lieu de faire directement les questions, le user écrit des connaissances qui font un knowledge graph qui permet de générer automatiquement les questions

## Product Suggestions

Add question history view from Manage: answer history, lapses, interval, next review, manual reschedule.
Add settings UI for scheduler targets, per-type daily weights, theme/display preferences, backup location, import behavior.
Improve content ingestion: CSV import/export UI, “import from URL”, local media copy, duplicate detection, and batch tag/collection editing.
Add map review mode variants: visible answer list, hidden answer list, strict JetPunk-style mode, small-zone emphasis.

## Long term improvements

Desktop hardening: automatic backups, restore flow, portable data location chooser, startup health checks.
AI-assisted authoring: generate draft questions, aliases, distractors, timeline entries, or map labels from selected text/URLs, but keep review data user-verifiable.
Optional sync later: only after local data/migrations/backups are strong. Sync will multiply edge cases.
