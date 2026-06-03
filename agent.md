# Instructions pour Codex

Ce dépôt contient des scripts Tampermonkey liés à WEDA et Heidi Health.

## Règles générales

- Répondre en français.
- Toujours préserver les versions stables.
- Ne jamais supprimer une fonction sans vérifier ses appels.
- Ne jamais ajouter de dépendance externe sans justification.
- Ne jamais inclure de données patient, secrets, clés API ou identifiants.
- À chaque nouvelle version d’un script, incrémenter la version Tampermonkey et la constante interne de version si elle existe.
- Pour toute modification d’un script Tampermonkey, fournir le fichier complet modifié, pas seulement un patch.
- Avant chaque modification, expliquer brièvement l’impact attendu.
- Après modification, résumer les points à tester manuellement.

## Organisation

- `scripts/` contient les scripts Tampermonkey complets.
- `prompts/` contient les prompts Heidi complets.
- `docs/` contient les procédures, changelog et notes de conception.
- `tests/` contient uniquement des exemples anonymisés.

## Projet principal : Connecteur Heidi-Weda

Préserver impérativement :
- PageUp / PageDown.
- Mémorisation de la dernière URL WEDA.
- Worker WEDA avec hash `#AUTO_HH_WEDA_WORKER=...`.
- Insertion dans le champ contenteditable principal.
- Remplissage des champs structurés uniquement s’ils sont vides.
- Détection AMT / automesure.
- Tags WEDA sans doublon.
- Absence de limite artificielle à 3 tags.
- Évitement de la réouverture de grille après le dernier tag.
- Retour accueil direct par `__doPostBack` si possible.
- Fermeture rapide de l’onglet worker.
- Notifications utiles mais non envahissantes.
- Fonctions de test console.

## Tests manuels minimaux

Après chaque modification du script principal :
1. Tester PageUp depuis WEDA.
2. Tester PageUp depuis Heidi.
3. Tester PageDown depuis WEDA.
4. Tester PageDown depuis Heidi.
5. Vérifier que la bonne session Heidi reste active.
6. Vérifier insertion de la note dans WEDA.
7. Vérifier constantes et suivis.
8. Vérifier tags sans doublons.
9. Vérifier sauvegarde / retour accueil.
10. Vérifier fermeture worker.
