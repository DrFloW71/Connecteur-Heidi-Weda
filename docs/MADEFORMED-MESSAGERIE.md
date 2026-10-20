# Messagerie dans tous les onglets utilisateurs — version 4.3

Tous les utilisateurs secondaires utilisent désormais le même bouton et le même compteur Dr Ronez. Le connecteur réutilise le bouton natif s’il existe, sinon ajoute « Messagerie » à côté d’« Agenda ». Le clic retrouve Dr Ronez par son libellé visible, reprend son lien de sélection fourni par MadeForMed (quel que soit le rang `cabspro`), puis ouvre sa messagerie. Seul le bouton de l’environnement principal garde son compteur natif comme source. Aucun utilisateur secondaire n’est nommé dans le code : les futurs utilisateurs sont traités par cette même règle.

## Correction du compteur

Dans le navigateur réel, la version 3.61 crée la pastille dans Mme Rignault, mais son contenu reste vide et les logs indiquent l’échec de la lecture du compteur. La comparaison avec l’environnement Dr Ronez montre un compteur natif non vide. Les tests précédents simulaient une réponse réussie de `/messages/count` dans les autres environnements et ne reproduisaient pas cet échec.

La version 3.62 reprend désormais le nombre effectivement affiché par le bouton natif de l’environnement principal. Elle partage ce nombre via le stockage du userscript et son mécanisme de notification entre onglets. La valeur est associée au professionnel principal et au cabinet afin de ne pas afficher le compteur d’un autre contexte. Aucun contenu de message ni donnée patient n’est enregistré dans ce partage.

La pastille ajoutée conserve la classe native `notif-badge-counter`, dont le fond rouge et les règles de positionnement ont été vérifiés, avec une classe propre au connecteur `tm-mf-message-counter`. Elle n’est plus ciblée par l’actualisation native `.msg-counter` du mauvais environnement. Le connecteur n’appelle plus `/messages/count` pour ce compteur.

Le nombre partagé est mis à jour lorsque le compteur natif Dr Ronez change, puis repris par les autres onglets. Lorsqu’un zéro est réellement observé dans ce compteur natif, la pastille secondaire est vidée. Si aucune valeur correspondante n’est disponible, ou si elle date de plus de 24 heures, la pastille affiche « … » avec une invitation à ouvrir la messagerie principale pour actualiser le nombre. Le nombre affiché est le dernier reçu de cette source native ; aucun rafraîchissement ne change le professionnel actif.

## Tous les utilisateurs, y compris les futurs — version 3.63

M. Madoz possédait un bouton natif, que la version 3.62 conservait avec son propre compteur vide. La version 3.63 adapte aussi les boutons natifs des utilisateurs secondaires : elle remplace leur compteur par le nombre partagé principal et aligne leur clic sur cette même messagerie. Elle évite de créer un deuxième bouton, et restaure le bouton et le compteur natifs lorsque l’environnement principal devient actif. Les nouveaux éléments de la barre sont pris en charge lors de leur apparition.

## Navigation sur les autres ordinateurs — version 3.64

Le symptôme signalé sur l’autre ordinateur était une arrivée dans l’agenda sans ouverture de la messagerie. La version 3.63 supposait que l’environnement principal portait toujours le rang `cabspro=0`, exigeait `sessionStorage` pour terminer la bascule et abandonnait une demande après 30 secondes.

La version 3.64 retrouve l’onglet Dr Ronez par son libellé, indépendamment de sa position. Elle utilise le lien de sélection réellement présent dans cet onglet ; aucun identifiant numérique de compte ou de poste n’est inscrit dans le script. En présence de plusieurs onglets Dr Ronez, le cabinet actif permet de les distinguer ; une ambiguïté ne déclenche pas de bascule vers un autre utilisateur.

Le lien porte désormais l’intention d’ouvrir la messagerie dans un fragment `#tm-mf-open-messages=…`. Ce fragment accompagne le lien dans un nouvel onglet et survit à la redirection vers l’agenda. Sa conservation a été vérifiée sur le service réel depuis le lien natif Dr Ronez. Le stockage de session constitue seulement une compatibilité supplémentaire : son indisponibilité n’interrompt plus l’ouverture. Le connecteur attend le bon professionnel et son bouton natif, pendant deux minutes au maximum, puis consomme la demande sans boucle. Le fragment est retiré en préservant l’état de l’historique.

Les compteurs restent propres à chaque navigateur : une installation neuve peut afficher « … » avant la première ouverture de Dr Ronez. Cela ne bloque pas le lien. Le partage du badge entre les utilisateurs actuels et futurs reste identique.

## Installation et contrôle réel

1. Remplacer le script dans Tampermonkey par le fichier complet en version 4.3, enregistrer et recharger MadeForMed.
2. Ouvrir une fois l’onglet Dr Ronez : cette étape initialise le partage avec son compteur natif.
3. Revenir à Mme Rignault : vérifier un seul bouton « Messagerie » et la pastille rouge portant le même nombre que celui qui vient d’être affiché par Dr Ronez.
4. Refaire la vérification dans M. Madoz et les autres onglets, qu’ils possèdent ou non un bouton natif. Tous doivent afficher le même nombre principal.
5. Si deux onglets du navigateur sont ouverts, observer que les changements du compteur natif sont repris dans l’autre onglet du connecteur.
6. Vérifier que le clic « Messagerie » ouvre toujours celle de Dr Ronez et que « Ajouter une tâche », PageDown et l’ouverture WEDA par le nom du patient fonctionnent comme auparavant.

L’éditeur Tampermonkey est une page d’extension inaccessible au contrôle du navigateur disponible dans cette session. L’installation est donc manuelle. La première ouverture de Dr Ronez après installation est nécessaire si aucun nombre n’a encore été partagé.

## Vérification

- Inspection du navigateur réel en version 3.61 : pastille secondaire vide, avertissement technique du compteur, compteur natif Dr Ronez présent ; Mme Rignault rétablie après cette comparaison.
- Syntaxe JavaScript valide et 44 tests Node réussis : `node --test tests/connecteur-madeformed-consignes.test.cjs tests/connecteur-madeformed-messagerie.test.cjs`.
- Tests du partage du nombre principal, zéro, cache inconnu ou périmé, autre médecin, autre cabinet et absence d’appel réseau secondaire.
- Simulation dans un navigateur isolé hors ligne : six utilisateurs, dont un utilisateur secondaire avec bouton natif et deux futurs utilisateurs ajoutés après le chargement du script, avec et sans bouton natif ; partage persistant, synchronisation entre deux onglets, zéro natif, barres remplacées ou tardives, restauration dynamique du bouton principal, navigation sans doublon et aucune requête `/messages/count` du connecteur.
- Aucune écriture de message ou tâche sur le service réel pendant les vérifications.
- Version 3.62 vérifiée réellement après installation : Mme Rignault affiche une pastille visible portant « 1 », avec le fond rouge natif. Version 3.63 installée et fonctionnement confirmé par Florian le 6 octobre 2026. La vérification finale dans son navigateur a été effectuée par Florian ; les futurs utilisateurs ont été couverts par la simulation décrite ci-dessus.

- Version 3.64 : simulation hors ligne réussie dans deux profils isolés, avec dix environnements utilisateurs, dont un profil neuf sans valeur mémorisée et avec tout `sessionStorage` bloqué. Dr Ronez placé au rang 2 après un autre utilisateur au rang 0 ; clic normal, lien ouvert directement dans un nouvel onglet et bouton principal tardif aboutissent à sa messagerie, sans erreur JavaScript ni écriture de message ou tâche.
- Test de navigateur reproductible : `tests/connecteur-madeformed-messagerie.browser.cjs`, exécuté avec Playwright disponible localement via `MADEFORMED_PLAYWRIGHT_MODULE` (ou le module `playwright` habituel). Les requêtes sont servies par des routes fictives, dans des profils neufs hors ligne.
- Validation finale de la version 3.64 sur le compte de l’autre ordinateur à effectuer après son installation : depuis M. Madoz ou Mme Rignault, « Messagerie » doit sélectionner Dr Ronez puis ouvrir les messages, et non rester dans l’agenda. Vérifier aussi un clic ouvrant un nouvel onglet, le badge rouge, « Ajouter une tâche » et PageDown.

La version 3.65 conserve ce module et ses contrôles. Le même banc de navigateur a été réexécuté avec le script complet 3.65 : dix utilisateurs, deux profils, aucun échec ni erreur JavaScript. Les nouveautés sont décrites dans [la notice RDV, Documents et appels](MADEFORMED-RDV-DOCUMENTS-APPELS.md).
