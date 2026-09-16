# Plantage LM Studio pendant la lecture des courriers scannés

## Cause reproduite

Le nouveau journal WEDA provient bien du script **0.1.61**. La correction précédente du budget de sortie est donc installée. Le nouvel échec est distinct :

1. Un PDF d'une page n'a pas de couche texte exploitable.
2. Le rendu dans le worker échoue sur `createElement`, mais le secours sur le thread principal réussit et fournit une image. Ce premier avertissement n'est pas la cause de l'éjection du modèle.
3. La requête d'identification du patient avec cette image reçoit HTTP 400, `{"error":"terminated"}`.
4. La requête suivante reçoit `No models loaded`.

Un test local avec une image entièrement fictive reproduit le plantage en environ quatre secondes. Le journal **runtime** de LM Studio identifie précisément :

```text
llama-context.cpp:1730:
GGML_ASSERT((cparams.causal_attn || cparams.n_ubatch >= n_tokens_all)
  && "non-causal attention requires n_ubatch >= n_tokens") failed
```

Le moteur `llama.cpp-win-x86_64-nvidia-cuda12-avx2` **2.37.0** s'arrête ensuite avec le code Windows `3221226505`. Ce n'est pas un déchargement demandé par le script. La taille du lot physique d'entrée est insuffisante pour l'attention utilisée par les images de Gemma.

La réduction expérimentale du contexte à 32768 jetons et de la concurrence à une requête n'a pas résolu l'assertion. Elle n'a pas été conservée.

Un [signalement Unsloth du 8 septembre 2026](https://github.com/unslothai/unsloth/issues/10559) décrit la même assertion et le réglage `-ub 2048 -b 2048`. Les noms des paramètres LM Studio figurent dans son [schéma officiel de configuration](https://github.com/lmstudio-ai/lmstudio-js/blob/main/packages/lms-kv-config/src/schema.ts). La validation sur cette machine est indépendante de ce signalement.

## Correction LM Studio appliquée

Dans la configuration propre au modèle `gemma-4-26b-a4b-it` :

```text
llm.load.llama.physicalBatchSize = 2048
llm.load.llama.evalBatchSize = 2048
```

Fichier modifié :

```text
C:\Users\flori\.lmstudio\.internal\user-concrete-model-default-config\unsloth\gemma-4-26B-A4B-it-GGUF\gemma-4-26B-A4B-it-UD-Q4_K_S.gguf.json
```

Sa sauvegarde exacte porte le suffixe `.before-vision-fix-20260914.bak` dans le même dossier. Les autres réglages de ce fichier, notamment le prompt système, le contexte demandé de 80000 et les quatre sessions parallèles, sont conservés. Le modèle a été rechargé depuis cette configuration ; `lms ps --json` confirme un contexte effectif de 80128, quatre sessions et un modèle toujours chargé après les tests.

## Correction du script courriers 0.1.62

- Vérification du modèle disponible pour chaque tâche, sans réutiliser indéfiniment un cache devenu invalide ni inventer l'identifiant `local-model`.
- Propagation des pannes de LM Studio pendant l'identification : elles ne deviennent plus une identité prétendument absente.
- Erreurs réseau, HTTP, délais et réponses tronquées : arrêt sur le courrier courant et suspension du mode automatique. La panne ne marque pas le document comme traité et ne déclenche pas le passage au suivant.
- Une panne d'analyse d'image ne crée plus un résultat local « PDF illisible » à la place de la réponse du modèle.
- Les erreurs HTTP ne recopient plus le corps de la réponse serveur dans les logs ; elles conservent le statut et un diagnostic de panne.

Les règles médicales, la sélection patient, les budgets de sortie corrigés précédemment et le rendu des images sont conservés.

Sauvegarde du script avant cette intervention :

```text
C:\Users\flori\AppData\Local\Temp\weda-courriers-before-vision-20260914-205039.user.js
```

## Validation et limites

- 82 tests automatisés réussis, deux tests réseau facultatifs ignorés dans cette exécution.
- Test vision réel exécuté séparément via la fonction de transport du script : une image puis quatre images fictives donnent `VISION-742`, puis le texte seul donne `OK`. Chaque réponse termine avec `finish_reason: stop` et le modèle reste disponible après chaque requête.
- La première lecture réussie après correction a pris environ 2,3 secondes ; le test séparé à quatre images environ 4,2 secondes.
- Vérification syntaxique du script et `git diff --check` réussies.
- Aucun dossier patient n'a été utilisé ou modifié dans les tests.

Commandes reproductibles depuis le dépôt :

```powershell
node --test --test-reporter=spec tests/*.test.cjs
$env:WEDA_LMSTUDIO_VISION_LIVE = '1'
node --test --test-reporter=spec --test-name-pattern='lecture réelle' tests/analyse-courriers-lmstudio-service.test.cjs
Remove-Item Env:WEDA_LMSTUDIO_VISION_LIVE
```

La correction du moteur est active sur la machine, y compris pour le script 0.1.61 déjà installé. La version 0.1.62 n'a pas été installée dans Tampermonkey : l'accès à cet éditeur avait été refusé par la politique de sécurité du navigateur, sans contournement. Pour ajouter les protections, remplacer le script existant par `scripts/LM studio/analyse-courriers-weda-LMstudio-avec-ATCD.user.js`, enregistrer et recharger WEDA.

Vérification manuelle restante : relancer le courrier scanné ayant échoué, vérifier la bonne identification du patient et la synthèse, puis le déroulement habituel dans WEDA. Le fonctionnement complet sur les documents réels n'a pas été validé par cette intervention.
