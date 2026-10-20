# Tâches dans MadeForMed — version 4.3

Le module de consignes du script fourni a été intégré dans `scripts/Connecteur-madeformed-vers-weda.user..js`.

## Utilisation

1. Remplacer le contenu du connecteur dans Tampermonkey par le fichier complet en version 4.3, enregistrer et recharger MadeForMed.
2. Sous l'expéditeur de chaque message, cliquer sur « + » à côté de « Ajouter une tâche ».
3. Saisir la consigne et cliquer sur « Ajouter la tâche ». Le formulaire natif MadeForMed crée une tâche de l’agenda. Si un sélecteur de destinataire est présent, le module choisit « Secrétaire » et vérifie cette attribution. Lorsque le formulaire natif ne propose aucune attribution, aucun champ de destinataire n’est ajouté.
4. La consigne enregistrée apparaît sous le message avec son état : À faire, À venir ou Effectuée. Les actions disponibles sont Modifier, Supprimer et Tâche accomplie.
5. « Actualiser » relit les tâches MadeForMed. Une actualisation est aussi prévue chaque minute lorsque la page est visible et au retour sur la page.

Le texte, le lien vers le message et les informations de référence sont enregistrés dans la tâche MadeForMed. Les consignes ne sont pas conservées dans le stockage Tampermonkey ou localStorage. Le module contrôle le médecin/cabinet actif avant les opérations et vérifie leur résultat. Si l'enregistrement reste incertain, « Vérifier l'enregistrement » relit le résultat sans envoyer à nouveau la tâche.

PageDown et les clics du connecteur sont ignorés dans la zone de consigne. La détection du SMS exclut aussi ces zones, y compris pour le bouton Lancer et le menu Tampermonkey.

## Vérification effectuée localement

- Contrôle de syntaxe JavaScript et 15 tests Node, sans dépendance ajoutée au dépôt : `node --test tests/connecteur-madeformed-consignes.test.cjs`.
- Inspection du formulaire réel MadeForMed : aucun sélecteur ou champ d’attribution de destinataire n’est proposé dans cet agenda.
- Contrôle des deux variantes de formulaire dans un navigateur isolé, avec messagerie et serveur de tâches fictifs : affichage, ajout, modification, validation, suppression, ajout dynamique d'un message et protection de PageDown. Quatre écritures simulées pour les quatre actions, aucune erreur JavaScript.
- Aucun enregistrement n'a été effectué sur le service réel pendant ces vérifications.

## Points à tester sur le service réel

- Vérifier la présence d'une seule zone de consigne par message et son ouverture/fermeture avec +/−.
- Ajouter une consigne de test autorisée et vérifier sa présence dans les tâches natives de l’agenda et, si le formulaire propose un destinataire, son attribution au secrétariat, puis son affichage après rechargement de la messagerie.
- Vérifier Modifier, Tâche accomplie et Supprimer sur cette tâche de test.
- Vérifier qu'une saisie de consigne ne déclenche pas le transfert SMS par PageDown.
- Vérifier les fonctions existantes : PageDown dans la fenêtre SMS, ouverture du dossier WEDA par le nom du patient, sauvegarde de la consultation et fermeture de l'onglet WEDA.

## Correction 3.58

Le formulaire réellement observé ne contient ni `.dest-item`, ni `.dest-selected`, ni `data[Task][dest]`. La version 3.57 arrêtait la création en cherchant obligatoirement « Secrétaire ». La version 3.58 accepte cette variante native de l’agenda, selon le choix de Florian, et affiche les consignes sans exiger un avatar de secrétaire sur la carte de tâche. Un sélecteur d’attribution présent mais incomplet ou incohérent reste bloquant.

Les erreurs avant enregistrement indiquent désormais l’étape bloquante ou une cause technique fixe. Aucun contenu de réponse réseau, texte de consigne ou identité n’est ajouté aux journaux d’erreur. Les contrôles du cabinet, du type de tâche et des tentatives incertaines sont conservés.

Avant de recharger une messagerie contenant une consigne non enregistrée, copier son texte pour pouvoir la ressaisir après la mise à jour de Tampermonkey.

## Compatibilité 3.65

La zone « Ajouter une tâche » est conservée. Un message ciblé par le lien d’une tâche est révélé avant le défilement s’il appartenait à un groupe d’appels replié. Les lignes contenant une tâche, une saisie en cours ou une erreur restent visibles. Les contrôles RDV et Documents sont exclus des clics et raccourcis déclenchant WEDA. Voir [la notice RDV, Documents et appels](MADEFORMED-RDV-DOCUMENTS-APPELS.md).
