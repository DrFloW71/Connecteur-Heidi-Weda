# Synchronisation des prompts Heidi

## Règle fondamentale

Les prompts Heidi existent dans **deux emplacements distincts** qui DOIVENT toujours rester synchronisés :

| Élément | Script | Fichier prompt |
|--------|--------|-----------------|
| Analyse biologies | `scripts/analyse-biologies-weda-heidi.user.js` (lignes 106-528) | `prompts/analyse-biologies-weda-heidi.prompt.txt` |
| Analyse courriers | `scripts/analyse-courriers-weda-heidi.user.js` (lignes 125-166) | `prompts/analyse-courriers-weda-heidi.prompt.txt` |

## Procédure de modification

### ✅ Si vous modifiez le prompt dans le SCRIPT :
1. Éditez la constante `HEIDI_PROMPT_ACTIVE` dans le fichier `.user.js`
2. Copiez le contenu modifié dans le fichier `.prompt.txt` correspondant
3. Testez que Heidi reçoit correctement le nouveau prompt

### ✅ Si vous modifiez le prompt dans le fichier `.prompt.txt` :
1. Éditez le fichier `.prompt.txt`
2. Copiez le contenu dans la constante `HEIDI_PROMPT_ACTIVE` du script
3. Testez que le script fonctionne avec le nouveau prompt

### ⚠️ NE JAMAIS :
- Modifier un prompt sans synchroniser l'autre fichier
- Oublier de tester après une synchronisation
- Laisser diverger les deux versions

## Format des fichiers

**Scripts** : Les prompts sont des chaînes JavaScript multiligne
```javascript
const HEIDI_PROMPT_ACTIVE = `...contenu du prompt...`;
```

**Fichiers prompts** : Texte brut UTF-8 lisible et facile à maintenir
```
...contenu du prompt...
```

## Vérification de synchronisation

Pour vérifier que les versions sont identiques (caractère par caractère) :
1. Ouvrir le fichier `.prompt.txt`
2. Comparer avec la constante `HEIDI_PROMPT_ACTIVE` dans le script
3. S'assurer que les deux sont identiques (ignorant les délimiteurs JS)
