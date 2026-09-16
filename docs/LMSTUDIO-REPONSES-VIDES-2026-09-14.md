# Réponses LM Studio vides : diagnostic et correction

Suivi : un second défaut, distinct, lors des appels avec images a été reproduit et corrigé dans LM Studio. Voir [le diagnostic du plantage vision et la version courriers 0.1.62](LMSTUDIO-VISION-CRASH-2026-09-14.md). Le présent document conserve le constat du premier incident.

Le 14 septembre 2026, l'API locale répond correctement sur `http://localhost:1234/v1` et expose `gemma-4-26b-a4b-it`. Le problème reproduit n'est pas une rupture de connexion.

Avec le prompt complet du script de biologie et un exemple fictif sans identité, l'ancien budget de 220 jetons donne HTTP 200, `finish_reason: length`, `content: ""`, 220 jetons générés dont 217 de raisonnement. Le modèle atteint la limite avant de produire sa réponse finale. Le script signalait seulement une réponse vide.

## Correction livrée

| Script complet dans `scripts/LM studio/` | Version | Budget de génération |
| --- | --- | --- |
| `analyse-biologies-weda-LMstudio.user.js` | 0.1.13 | 8192 au lieu de 220 |
| `analyse-courriers-weda-LMstudio-avec-ATCD.user.js` | 0.1.61 | 8192 au lieu de 900 ; identité 4096 au lieu de 220 |
| `analyse-documents-uploader-weda-LMstudio.user.js` | 0.2.3 | 8192 au lieu de 900 ; identité 4096 au lieu de 220 |
| `Copilote-Weda-LMstudio.user.js` | 0.6.8 | 8192 au lieu de 2200 |
| `antecedents-cim10-weda-LMstudio-avec-colorisation.user.js` | 6.2.7 | 12000, secours 6000, inchangés |

Ces plafonds couvrent le raisonnement et la réponse finale ; ils ne forcent pas le modèle à générer autant de jetons. Le mode raisonnement et la configuration LM Studio sont conservés. Une génération plus longue peut prendre davantage de temps ; les délais existants restent applicables.

Les cinq scripts refusent les sorties tronquées, y compris un texte final partiel plausible. Ils signalent la cause avec `finish_reason`, `completion_tokens` et `reasoning_tokens`, sans recopier le contenu du raisonnement dans l'erreur. Ils n'utilisent jamais `reasoning_content` comme résultat médical. Les blocs de contenu texte sont pris en charge. Le secours historique `output_text` du Copilote est conservé.

Pour les antécédents, une sortie tronquée n'est plus confondue avec une saturation du contexte qui aurait déclenché une nouvelle requête avec un budget réduit. Les prompts et les règles de traitement médical sont inchangés.

## Validation effectuée

- 74 tests automatisés réussis ; le test réseau facultatif est ignoré dans cette exécution.
- Test réseau lancé séparément et réussi : fonctions réelles de construction de requête, transport `GM_xmlhttpRequest` simulé avec `fetch` vers LM Studio local, puis extraction de la réponse par le code corrigé.
- Avec le prompt complet de biologie : `finish_reason: stop`, 976 jetons dont 955 de raisonnement, réponse finale `Bilan RAS, CRP 2 mg/L, DFG 95`, environ 7,6 secondes.
- Vérification syntaxique des cinq scripts et `git diff --check` réussies.
- Les modifications locales préexistantes du flux courriers/recherche patient sont conservées.

Commandes PowerShell depuis la racine du dépôt :

```powershell
node --test tests/*.test.cjs
$env:WEDA_LMSTUDIO_LIVE = '1'
node --test --test-name-pattern='LM Studio local:' tests/lmstudio-response.test.cjs
Remove-Item Env:WEDA_LMSTUDIO_LIVE
```

Ce contrôle démontre la correction de la génération sur LM Studio local. Il ne constitue pas une validation clinique ni un test du flux complet de sauvegarde dans WEDA. Les quatre autres flux n'ont pas été exécutés avec des dossiers réels.

## Installation et vérification restantes

L'accès à l'éditeur Tampermonkey a été refusé par la politique de sécurité du navigateur. Aucune mise à jour de l'extension n'a donc été effectuée. L'accès à la fenêtre Windows de LM Studio a également expiré en attendant l'autorisation de l'outil ; aucun réglage de LM Studio n'a été modifié.

1. Dans Tampermonkey, remplacer le contenu de chaque script existant par son fichier complet corrigé, puis enregistrer. Éviter de créer une seconde copie active du même script.
2. Recharger les pages WEDA concernées et vérifier les versions affichées, notamment **0.1.13** pour les biologies.
3. Lancer une analyse manuelle de biologie et vérifier la présence d'un titre final cohérent avec la source, puis l'enregistrement et le passage à la ligne suivante selon le fonctionnement habituel.
4. Vérifier les extractions d'identité et synthèses des courriers/uploader, ainsi que les résultats CIM-10 et le panneau Copilote lors de leur prochaine utilisation.

La sauvegarde exacte des cinq fichiers avant intervention se trouve dans `C:\Users\flori\AppData\Local\Temp\weda-lmstudio-before-20260914-192116`. Elle inclut les modifications locales préexistantes. Elle permet de revenir à l'état précédant cette correction sans réinitialiser le dépôt.
