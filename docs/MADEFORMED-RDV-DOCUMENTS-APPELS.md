# RDV, documents et appels MadeForMed — version 4.5

Le fichier complet à installer est `scripts/Connecteur-madeformed-vers-weda.user..js`. La version Tampermonkey et la constante interne valent toutes deux `4.5`. La V4.0 reste la référence stable, fonctionnellement identique à la 3.65.

## Nom du panneau V4.5 — 29 octobre 2026

Le panneau porte le nom « MFM Helper + WEDA ». Ses infobulles, libellés d’accessibilité et alertes utilisent le même nom. La pastille conserve la lettre W.

## Déblocage des ouvertures périmées V4.4 — 29 octobre 2026

Une simple ouverture de dossier (`action: open_patient`) ne transfère aucune réponse et ne crée aucune consultation. La V4.3 la classait pourtant comme un transfert au résultat inconnu après vingt minutes, puis bloquait les clics patients, les envois et Reset jusqu’à une vérification manuelle.

La V4.4 libère les actions lorsqu’une ouverture seule expire, y compris lorsqu’elle était déjà conservée sous `expired_unknown` par la V4.3. Le panneau affiche « Ouverture précédente expirée ; vous pouvez ouvrir un dossier ». Le contenu sensible reste effacé et la trace technique est conservée. L’ancienne ouverture ne reprend pas ; seul un nouveau clic crée une nouvelle demande. Les anciens callbacks ne peuvent ni réactiver la tâche périmée ni agir sur une nouvelle tâche depuis l’ancien onglet.

Les transferts de réponse dont le résultat est incertain conservent le verrou et le bouton « J’ai vérifié le résultat ». Après contrôle manuel dans MadeForMed et WEDA, ce bouton clôt l’attente sans renvoi ni enregistrement supplémentaire.

Pour appliquer la correction, remplacer le script dans Tampermonkey par le fichier complet V4.4, enregistrer, puis recharger les onglets MadeForMed et WEDA. L’ouverture périmée déjà bloquée est reclassée au chargement ; aucun Reset n’est nécessaire.

Validation locale : 208 tests Node et 29 contrôles dans Edge isolé hors ligne réussis, sans erreur JavaScript ni réseau réel. Ils couvrent la migration d’un état V4.3 au rechargement, le clic patient suivant, l’expiration des ouvertures seules, le refus des callbacks périmés et le maintien du verrou pour les réponses incertaines. Syntaxe et `git diff --check` valides. Aucun test sur le compte authentifié n’a été effectué.

## Pastille déplaçable V4.3 — 13 octobre 2026

La pastille porte désormais la lettre W. Maintenir le bouton gauche et glisser la pastille, ou l’en-tête du panneau ouvert, permet de déplacer le connecteur. Un clic simple conserve l’ouverture/repli ; les boutons ne commencent pas de déplacement.

La position est mémorisée à la fin du glissement dans le stockage du userscript et restaurée après rechargement. Elle reste commune aux pages MadeForMed de cette installation. Le recadrage après changement de taille de fenêtre ou du contenu du panneau ne remplace pas la position préférée. Sans position enregistrée, le coin inférieur droit reste la position par défaut. Échap, une interruption du geste ou la perte de focus annulent le déplacement en cours.

Validation : 17 contrôles dans Edge isolé hors ligne, aucune erreur JavaScript. Ils couvrent le glissement réel, l’absence d’ouverture accidentelle, la restauration, l’annulation, les clics souris/clavier, un second pointeur ignoré, le redimensionnement et le recadrage après augmentation du contenu. Syntaxe et `git diff --check` valides ; les fonctions hors interface ont été comparées à la sauvegarde V4.2 et restent identiques.

Les fonctions de transfert, tâches, messagerie, rendez-vous et documents restent inchangées. Après installation, recharger MadeForMed, déplacer W puis recharger pour vérifier la restauration.

## Ajustement V4.2 — 13 octobre 2026

Le bandeau passif « Transfert ancien à vérifier dans MadeForMed et WEDA » est supprimé, ainsi que sa variante courte. Le verrou des transferts anciens reste actif ; aucun envoi ni enregistrement n’est automatiquement relancé. Les avertissements lors d’une action interrompue ou d’un problème d’identité sont conservés.

Validation : syntaxe valide, 55 tests ciblés réussis et 11 contrôles WEDA dans Edge isolé hors ligne, sans erreur JavaScript. Le contrôle confirme l’absence du bandeau et de nouvelle écriture pour un transfert expiré. Installer le fichier complet 4.2 puis recharger WEDA pour faire disparaître le bandeau de l’ancienne version.

## Améliorations retenues pour la V4.1

La V4.1 reprend les points 1, 2, 3, 4, 5, 9, 16, 17 et 20 de la comparaison avec « MFM x WEDA.txt » :

- Identification du patient séparée de l’historique des RDV, avec deux lecteurs en parallèle, lecture GET native stable et repli vers une fenêtre invisible. L’identité peut être publiée dès la recherche native fiable ; un clic réutilise la recherche en cours.
- Priorité aux séquences SVI, pour regrouper les appels sans attendre les historiques des autres lignes.
- Mémoire locale de regroupement pendant sept jours, limitée à 300 entrées. Elle associe une empreinte SHA-256 du contexte/message à un UID natif et une date de vérification. Elle ne conserve ni nom ni téléphone en clair, mais reste une mémoire pseudonymisée. Elle autorise exclusivement l’affichage groupé ; RDV, documents et WEDA conservent leurs contrôles indépendants.
- Groupe déplié maintenu ouvert lors de l’arrivée d’un nouvel appel ; scans regroupés et mutations sans effet sur les lignes ignorées.
- Recherche WEDA limitée aux résultats patients natifs avec nom exact normalisé. Les homonymes demandent un choix explicite, même si une date paraît distinguer un résultat. Une date contradictoire bloque le transfert ; une date absente demande une vérification explicite. Le dossier et la consultation sont recontrôlés pendant les attentes et avant les écritures. Lorsqu’un lien natif ne donne pas l’identifiant du dossier choisi, une confirmation ciblée dans la fiche ouverte est nécessaire avant de reprendre.
- Diagnostics masqués dans le stockage, la console et les logs copiés. Journal technique limité à 100 transferts et 24 heures, sans identité ni texte clinique. Après vingt minutes, le contenu sensible du transfert est effacé ; un résultat inconnu reste signalé et ne peut être automatiquement effacé ou relancé. « J’ai vérifié le résultat » clôt cette attente après contrôle manuel dans MadeForMed et WEDA.
- Couleurs des boutons « Ajouter un RDV » et « Envoyer un document » reprises des contrôles natifs, y compris lors d’un changement de thème.
- État ouvert/replié du panneau Ruby mémorisé, étapes de transfert lisibles et rappel des raccourcis existants.

PageDown, les tâches, la messagerie principale et sa pastille commune, les dates Europe/Paris et les protections des documents incertains sont conservés. Aucun nouveau raccourci, transfert RDV vers prescription, mode Copilote ou conservation de l’onglet WEDA n’est ajouté.

Les fonctions 7 à 10 proviennent du script fourni par Florian, `Madeformed_x_Weda_v2.22_CONSIGNES_MESSAGES.txt`. Leur intégration conserve les tâches de l’agenda, la messagerie principale et les transferts WEDA. Les adaptations renforcent l’identité du patient, les dates du cabinet et la preuve d’apparition des documents.

## Prochain rendez-vous

Dans les messages : `Prochain RDV : 15/10 à 14:30`. Dans l’agenda : `→ 15/10 14:30`, en excluant le rendez-vous de la ligne elle-même. La lecture utilise la fiche native et son historique ; les rendez-vous passés, annulés ou de date invalide sont écartés.

Les dates utilisent `Europe/Paris`, quel que soit le fuseau de l’ordinateur. Une heure inexistante ou ambiguë lors du changement d’heure n’est pas interprétée arbitrairement. Le cache est partagé entre les lignes du même patient et du même contexte pendant 60 secondes, avec invalidation lors d’un changement de contexte et après les actions nécessitant une nouvelle lecture.

Le connecteur privilégie l’identifiant natif du patient. Deux identifiants contradictoires bloquent les actions. Une recherche par téléphone choisit automatiquement une fiche uniquement si un seul résultat correspond au nom complet et au numéro. Sinon, l’indicateur affiche `choisir le patient` et les actions demandent un choix explicite parmi les résultats natifs. Sans lien patient exploitable, les actions restent désactivées.

## Ajouter un RDV

L’icône calendrier porte le libellé et l’infobulle « Ajouter un RDV ». Elle prépare le formulaire MadeForMed dans une fenêtre intégrée avec le patient identifié. Une recherche ambiguë présente d’abord les patients possibles.

Le créneau, le professionnel, le motif et l’enregistrement restent dans le formulaire natif. Aucun rendez-vous n’est créé à l’ouverture. PageDown et les clics dans ces contrôles ne déclenchent pas de transfert vers WEDA. La fermeture libère les temporisateurs de la fenêtre.

## Envoyer un document

L’icône document porte le libellé et l’infobulle « Envoyer un document ». Le clic ouvre le sélecteur Windows ; le choix des fichiers autorise leur ajout dans le dossier identifié via le champ et le formulaire natifs chargés dans une fenêtre invisible.

Formats prévus : texte, images, audio, vidéo, PDF, Word, Excel, PowerPoint et OpenDocument. Limite : 50 Mo par fichier (52 428 800 octets), avec respect des limites natives plus strictes de taille, formats ou sélection multiple.

Avant l’envoi, le module contrôle le patient, le médecin/cabinet, l’adresse et la méthode du formulaire, ainsi que le champ natif. Il transmet les fichiers une seule fois et déclenche un seul événement de sélection natif.

Une réponse réseau positive ne confirme pas l’ajout. Il faut de nouvelles cartes de documents dans le bon dossier, avec de nouveaux identifiants et les noms complets exacts des fichiers. Deux fichiers de même nom nécessitent deux nouveaux documents distincts. Une carte préexistante ou « ancienne note.pdf » ne prouve pas l’ajout de « note.pdf ».

Si le résultat est incertain, la ligne affiche « Ajout à vérifier ». « Vérifier » recharge le dossier en lecture seule : champs d’envoi désactivés, aucun fichier réinjecté. Fermer conserve l’attente. « J’ai vérifié le dossier » clôt cette attente après contrôle de l’utilisateur, sans annoncer un succès automatiquement confirmé.

Un journal minimal préserve l’attente après fermeture, remplacement d’une ligne et rechargement. Il contient le contexte, les références du message et du patient, les IDs des documents préexistants, le nombre attendu et la date de tentative. Aucun nom, téléphone, nom de fichier ou contenu n’y est conservé. Après rechargement, la présence des fichiers doit être vérifiée manuellement. Sans UID patient natif, le patient doit être choisi à nouveau ; seule une sélection correspondant au dossier verrouillé permet de l’ouvrir. Une identité modifiée reste bloquée au fil des relectures et est recontrôlée pendant le choix et le chargement.

## Regrouper les appels

Activé par défaut, le regroupement est réglable avec « Regrouper les appels ON/OFF » dans le panneau du connecteur ou le menu Tampermonkey. Le choix est mémorisé sur l’ordinateur.

Seuls les appels SVI natifs appartenant avec certitude au même patient sont concernés. Ils doivent être consécutifs dans la même liste, sur une durée totale d’au plus 30 minutes. Un autre patient, un autre canal ou une interruption de la liste sépare les groupes.

La première ligne reste visible avec, par exemple, `4 appels successifs · 14:03–14:18` et « Afficher les 4 appels ». Ce bouton affiche ou replie les autres lignes ; OFF les restitue toutes. Aucun message natif n’est supprimé, fusionné, marqué ou modifié sur le serveur.

Une tâche/consigne, un brouillon, une erreur, une sélection active ou un message ciblé par un lien empêche le masquage. Un lien de tâche révèle la ligne avant le défilement. Le module suit les remplacements et ajouts de lignes par MadeForMed.

## Installation et contrôle sur le compte réel

1. Conserver le texte d’une tâche non enregistrée avant le rechargement, si nécessaire.
2. Remplacer le connecteur existant dans Tampermonkey par le fichier complet 4.3, enregistrer et recharger MadeForMed.
3. Vérifier un prochain RDV connu dans un message et dans l’agenda ; un résultat ambigu doit demander le patient.
4. Ouvrir « Ajouter un RDV », contrôler le patient et les champs natifs, puis fermer si aucun RDV n’est à créer.
5. Lors d’un ajout de document souhaité, contrôler sa présence dans le dossier. Si le résultat est incertain, « Vérifier » ne renvoie aucun fichier.
6. Vérifier un groupe SVI, le dépliage et OFF ; les tâches et brouillons doivent rester visibles.
7. Contrôler « Ajouter une tâche », la messagerie et sa pastille dans les autres utilisateurs, puis les usages habituels de PageDown et de WEDA.
8. Replier ou ouvrir Ruby, puis recharger la page : cet état doit être conservé. Un groupe d’appels déplié doit rester ouvert lorsqu’un nouvel appel apparaît.
9. Dans WEDA, vérifier le choix explicite en présence d’homonymes et le contrôle de la date de naissance. Si l’identifiant du dossier ne peut être relié au lien choisi, vérifier la fiche avant de confirmer. Un changement de patient ou de consultation doit interrompre le transfert.

## Validation de la V4.1

- Script complet : syntaxe valide, `@version` et `VERSION` égales à `4.1` ; `git diff --check` passe.
- Suite Node complète : 306 tests, 304 réussis, aucun échec et deux tests LM Studio réels ignorés faute d’activation explicite.
- Bancs Edge isolés : 59 contrôles distincts réussis (22 dans le nouveau banc V4.1, 19 dans le banc natif et 18 dans le banc Messagerie), sans erreur JavaScript ni accès réseau réel. Le parcours WEDA positif produit une insertion, une demande native d’enregistrement et une fermeture. Les changements de patient ou de consultation bloquent les écritures.
- Défauts trouvés et corrigés pendant la validation : publication d’identité après Reset, date de naissance concaténée entre cellules WEDA, double clic d’enregistrement, masquage du préfixe +33, prolongation du contenu par une date de transfert future, perte du verrou d’incertitude après une sauvegarde demandée, et fermeture de secours avant la garde WEDA.
- La fermeture automatique conserve le canal natif de demande `CLOSE_KEY` et ses secours par listener/polling. Un simple statut de sauvegarde ou l’effacement du job ne suffit plus à fermer l’onglet depuis MadeForMed.
- Les blocs Messagerie et tâches sont identiques à la V4.0. Les fonctions Documents et leurs protections de vérification en lecture seule et de non-retransmission ont été conservées. Aucun accès supplémentaire ni dépendance du userscript n’a été ajouté.
- La V4.1 a été validée sur des données synthétiques, des formulaires fictifs et des profils neufs hors ligne. Elle n’a pas été installée ni testée sur le compte authentifié pendant cette mise à jour ; les contrôles réels ci-dessus restent à effectuer après installation. Aucun patient réel, rendez-vous réel, document réel ou message réel n’a été modifié par les tests.

## Validation historique de la V4.0

- Syntaxe du script complet et des bancs valide ; `git diff --check` passe.
- Résultat Node final : 226 tests, 224 réussis, aucun échec et deux tests LM Studio réels ignorés faute d’activation explicite. Les 122 tests du connecteur MadeForMed passent tous ; les autres couvrent les modules déjà présents dans le dépôt.
- `tests/connecteur-madeformed-native.browser.cjs` charge le script complet dans Edge isolé hors ligne avec uniquement des patients, messages, fichiers et réponses fictifs. Il couvre les prochaines dates, le formulaire natif, PageDown, les documents multiples, un succès réseau sans carte, le rechargement, le choix obligatoire du patient, le refus d’un autre patient sans ouverture de sa fiche, la vérification en lecture seule sans retransmission et les groupes SVI.
- `tests/connecteur-madeformed-messagerie.browser.cjs` contrôle dix utilisateurs et deux profils, dont un ordinateur neuf, le stockage de session bloqué, des utilisateurs futurs, les badges et la messagerie principale.
- Banc natif final : 19 contrôles réussis, zéro erreur JavaScript, zéro ouverture WEDA, un enregistrement RDV après clic explicite et trois requêtes d’envoi fictives, sans retransmission lors des vérifications ou rechargements.
- Le module WEDA, le panneau historique et la messagerie ont été comparés à la sauvegarde 3.64. Les tâches gardent leur comportement avec l’ajout de la révélation d’une ligne repliée.
- Le navigateur réel a été inspecté en lecture seule : structures des messages, liens de recherche patient, rendez-vous et icônes de l’agenda. Il utilisait encore la version 3.64. La 3.65 n’a pas été installée dans Tampermonkey pendant cette session. Les créations de RDV et les envois ont été testés sur des fixtures, sans écriture dans un dossier réel. Le parcours authentifié des nouveaux formulaires reste à vérifier après installation.

Depuis la racine du dépôt, avec Node.js et Playwright disponibles :

```powershell
node --check 'scripts/Connecteur-madeformed-vers-weda.user..js'
$testPaths = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.cjs' -File | Select-Object -ExpandProperty FullName
node --test @testPaths
# Si nécessaire, utiliser le module Playwright déjà installé :
# $env:MADEFORMED_PLAYWRIGHT_MODULE = 'chemin/du/module/playwright'
node 'tests/connecteur-madeformed-4.1.browser.cjs'
node 'tests/connecteur-madeformed-native.browser.cjs'
node 'tests/connecteur-madeformed-messagerie.browser.cjs'
git diff --check
```
