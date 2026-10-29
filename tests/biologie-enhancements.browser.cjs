'use strict';
// Navigateur neuf, réseau intégralement intercepté, identités entièrement fictives.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.BIOLOGY_PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const factory = fs.readFileSync(path.join(root, 'scripts/lib/biologie-weda.js'), 'utf8');
const checks = [], errors = [], external = [];
const origin = 'https://secure.weda.fr';
const fixture = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
  '<form><input type="hidden" name="__VIEWSTATE" value="synthetic"><input type="hidden" name="__EVENTVALIDATION" value="synthetic">' +
  '<table id="ContentPlaceHolder1_HprimsGrid"><tbody><tr class="grid-header"><td>Résultats</td></tr>' +
  '<tr class="grid-selecteditem"><td>29/10/2026</td><td>XX</td><td><a id="ContentPlaceHolder1_HprimsGrid_LinkButtonHprimNom_0" href="javascript:__doPostBack(\'ctl00$ContentPlaceHolder1$HprimsGrid$ctl02$LinkButtonHprimNom\',\'\')">DEMO</a></td><td>FICTIF</td><td>01/01/1980</td></tr></tbody></table>' +
  '<a id="ContentPlaceHolder1_HyperLinkGotoPatient" href="/FolderMedical/PatientViewForm.aspx?PatDk=demo-A&crypt=fictif">Onglet : DEMO FICTIF</a>' +
  '<input id="ContentPlaceHolder1_TextBoxHprimTitre" value="CRP ↑ 12 mg/L [2 mg/L le 28/10/2026]">' +
  '<div id="ContentPlaceHolder1_LabelHprimDataStructure"><div>29/10/2026 DEMO FICTIF 01/01/1980</div><table class="hprimgrid"><tr><th></th><th>Libellé</th><th>Valeur</th><th>Unité</th><th>Minimum</th><th>Maximum</th></tr><tr><td></td><td>CRP</td><td>12</td><td>mg/L</td><td>0</td><td>5</td></tr></table></div>' +
  '<div id="ContentPlaceHolder1_PatientsGrid"><button type="button" id="ContentPlaceHolder1_PatientsGrid_ButtonHistoriqueResultat_0">H</button></div>' +
  '<div id="ContentPlaceHolder1_PanelHistoriqueSuivi" style="display:none"><button type="button" id="close-history">Fermer</button><table id="ContentPlaceHolder1_HistoriqueSuiviGrid"></table></div>' +
  '<div id="test-panel"><div class="wbh-body"></div></div></form></body></html>';

async function run() {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.fulfill({status:200,contentType:'text/html',body:fixture});
    });
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin + '/FolderMedical/HprimForm.aspx');
    await page.addScriptTag({content:factory});
    await page.evaluate(() => {
      window.values = new Map(); window.historyClicks = 0;
      window.testState = {running:false,phase:'idle',currentStableKey:'row-A'};
      window.testRow = {key:'row-A',stableKey:'row-A',date:'29/10/2026',cells:['29/10/2026','XX','DEMO','FICTIF','01/01/1980'],row:document.querySelector('.grid-selecteditem')};
      window.contentKey = 'content-A'; window.matches = true;
      window.api = createWedaBiologyEnhancements({
        window,document,location,prefix:'test/',panelId:'test-panel',positionKey:'test/position',
        getRows:()=>[testRow],matches:()=>matches,contentKey:()=>contentKey,getState:()=>testState,
        getValue:(key,fallback)=>values.has(key)?values.get(key):fallback,setValue:(key,value)=>values.set(key,value),deleteValue:key=>values.delete(key),
        sourceKey:()=> 'test/source',heartbeat:()=>{},start:()=>{},message:message=>{window.lastMessage=message;},
      });
      document.querySelector('#ContentPlaceHolder1_PatientsGrid_ButtonHistoriqueResultat_0').onclick = () => {
        historyClicks++;
        const panel = document.querySelector('#ContentPlaceHolder1_PanelHistoriqueSuivi'); panel.style.display='';
        setTimeout(()=>{
          const old=document.querySelector('#ContentPlaceHolder1_HistoriqueSuiviGrid'),grid=document.createElement('table');
          grid.id=old.id;grid.innerHTML='<tr><th>Items du résultat</th><th>Historique</th></tr><tr><td>CRP : 12mg/L</td><td>28/10/2026 : 2mg/L</td></tr>';old.replaceWith(grid);
        },30);
      };
      document.querySelector('#close-history').onclick=()=>{document.querySelector('#ContentPlaceHolder1_PanelHistoriqueSuivi').style.display='none';};
      api.setup();
    });
    await page.waitForSelector('#wbe-current-summary');
    assert.equal(await page.locator('.wbe-summary').count(),1);
    assert.match(await page.locator('.wbe-summary').innerText(),/Précédent.*2 mg\/L/);
    assert.match(await page.locator('.wbe-summary').innerText(),/Variation : \+10 mg\/L/);
    if(process.env.BIOLOGY_SCREENSHOT_PATH) await page.screenshot({path:process.env.BIOLOGY_SCREENSHOT_PATH,fullPage:true});
    checks.push('Carte groupée, valeur précédente et variation neutre');
    const popupPromise=page.waitForEvent('popup');
    await page.locator('#ContentPlaceHolder1_HprimsGrid a').click({modifiers:['Control']});
    const popup=await popupPromise;
    await popup.waitForLoadState();
    assert.match(popup.url(),/PatientViewForm\.aspx\?PatDk=demo-A&crypt=fictif/);
    await popup.close();
    checks.push('Ctrl+clic : lien natif du patient sélectionné vérifié');
    await page.locator('#ContentPlaceHolder1_TextBoxHprimTitre').fill('Titre corrigé manuellement');
    await page.waitForFunction(()=>document.querySelector('#wbe-current-summary')?.textContent.includes('Titre corrigé manuellement'));
    assert.equal(await page.locator('#ContentPlaceHolder1_TextBoxHprimTitre').inputValue(),'Titre corrigé manuellement');
    checks.push('La présentation suit la saisie manuelle sans la réécrire');
    const history = await page.evaluate(async()=>{
      testState={running:true,phase:'clickedRow',currentStableKey:'row-A'};
      return api.collectHistory('Libellé\tValeur\tUnité\tMinimum\tMaximum\tStatut Weda\nCRP\t12\tmg/L\t0\t5\tHAUT',testRow,'content-A');
    });
    assert.equal(history[0].display,'2 mg/L');
    assert.equal(await page.locator('#ContentPlaceHolder1_PanelHistoriqueSuivi').isVisible(),false);
    checks.push('Historique frais, daté, comparé et fermé par sa commande native');
    await page.evaluate(()=>{document.querySelector('#ContentPlaceHolder1_PanelHistoriqueSuivi').style.display='';});
    const skipped=await page.evaluate(()=>api.collectHistory('Libellé\tValeur\tUnité\tMinimum\tMaximum\tStatut Weda\nCRP\t12\tmg/L\t0\t5\tHAUT',testRow,'content-A'));
    assert.deepEqual(skipped,[]); assert.equal(await page.evaluate(()=>historyClicks),1);
    checks.push('Historique déjà ouvert laissé à l’utilisateur');
    await page.evaluate(()=>{document.querySelector('#ContentPlaceHolder1_PanelHistoriqueSuivi').style.display='none';});
    const changed = await page.evaluate(async()=>{
      const pending=api.collectHistory('Libellé\tValeur\tUnité\tMinimum\tMaximum\tStatut Weda\nCRP\t12\tmg/L\t0\t5\tHAUT',testRow,'content-A');
      setTimeout(()=>{contentKey='content-B';},10);
      try{await pending;return 'incorrect';}catch(error){return error.message;}
    });
    assert.match(changed,/sélection.*changé/);
    checks.push('Changement de bilan pendant la lecture : interruption');
    await page.evaluate(()=>{contentKey='content-A';testState.running=false;api.rememberDisplayTitle('CRP ↑ 12 mg/L [2 mg/L le 28/10/2026]','content-A');});
    const localCache=await page.evaluate(()=>values.get('test/displayTitles.v1'));
    assert.equal(localCache[0].patientId,'demo-A');
    await page.evaluate(()=>{history.replaceState(null,'','/FolderMedical/PatientViewForm.aspx?PatDk=demo-B&crypt=fictif');api.setup(true);});
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-wbe-enhanced]').count(),0);
    await page.evaluate(()=>{history.replaceState(null,'','/FolderMedical/PatientViewForm.aspx?PatDk=demo-A&crypt=fictif');api.setup(true);});
    // Ajouter un élément natif affichant exactement le titre enregistré.
    await page.evaluate(()=>{
      const label=document.createElement('span');label.id='dossier-title';label.textContent=values.get('test/displayTitles.v1')[0].title;
      document.querySelector('#ContentPlaceHolder1_LabelHprimDataStructure').prepend(label);
    });
    await page.waitForSelector('[data-wbe-enhanced]');
    checks.push('Dossier patient : titre exact et PatDk local exigés');
    await context.close();

    // Bootstrap des fichiers complets : aucune régression de chargement.
    for(const relative of ['LM studio/analyse-biologies-weda-LMstudio.user.js','Heidi/analyse-biologies-weda-heidi.user.js']) {
      const context=await browser.newContext();
      await context.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/FolderMedical/HprimForm.aspx');
      await page.evaluate(()=>{
        const values=new Map(),listeners=new Map();
        window.requests=[];window.saves=[];
        window.endHandlers=new Set();
        window.Sys={WebForms:{PageRequestManager:{getInstance:()=>({
          add_endRequest:callback=>endHandlers.add(callback),remove_endRequest:callback=>endHandlers.delete(callback),
        })}}};
        window.GM_getValue=(key,fallback)=>values.has(key)?values.get(key):fallback;
        window.GM_setValue=(key,value)=>{values.set(key,value);};
        window.GM_deleteValue=key=>values.delete(key);window.GM_addValueChangeListener=(key,callback)=>listeners.set(key,callback);
        window.GM_info={script:{version:'test'}};window.unsafeWindow=window;
        window.__doPostBack=target=>{if(/TextBoxHprimTitre/.test(target))saves.push(target);};
        window.GM_xmlhttpRequest=options=>{
          requests.push({url:options.url,payload:options.data?JSON.parse(options.data):null});
          setTimeout(()=>options.onload({status:200,responseText:JSON.stringify(options.method==='GET'?{data:[{id:'synthetic-model'}]}:
            {choices:[{message:{content:'CRP ↑ 999 mg/L'},finish_reason:'stop'}]})}),10);
          return {abort:()=>options.onabort()};
        };
        document.querySelector('#ContentPlaceHolder1_PatientsGrid_ButtonHistoriqueResultat_0').onclick=()=>{
          document.querySelector('#ContentPlaceHolder1_PanelHistoriqueSuivi').style.display='';
          const old=document.querySelector('#ContentPlaceHolder1_HistoriqueSuiviGrid'),grid=document.createElement('table');
          grid.id=old.id;grid.innerHTML='<tr><th>Items du résultat</th><th>Historique</th></tr><tr><td>CRP : 12</td><td>28/10/2026 : 2mg/L</td></tr>';old.replaceWith(grid);
        };
        document.querySelector('#close-history').onclick=()=>{document.querySelector('#ContentPlaceHolder1_PanelHistoriqueSuivi').style.display='none';};
      });
      const original=fs.readFileSync(path.join(root,'scripts',relative),'utf8');
      const end=original.lastIndexOf('})();');
      const exports='window.bioTest={biologyEnhancements,getBiologyRows,getDisplayedBiologyContentKey,extractHprimTable,extractAndSendCurrentBiology,setState,getState,stopWedaWorkflow,applyRememberedTitleForSelectedRow,validateHeidiResultAgainstWaitingState,validateTitleAssignmentTarget,channel:CURRENT_CHANNEL_ID,handler:'+
        (relative.startsWith('LM')?'handleLmStudioResult':'handleHeidiResult')+'};\n';
      await page.addScriptTag({content:original.slice(0,end)+exports+original.slice(end)});
      await page.waitForSelector('#wbe-current-summary');
      assert.equal(await page.getByText('Réanalyser toute la page',{exact:true}).count(),1);
      checks.push('Chargement complet : '+relative);
      if(relative.startsWith('LM')) {
        await page.evaluate(async()=>{
          const b=bioTest,row=b.getBiologyRows()[0],key=b.getDisplayedBiologyContentKey();
          b.setState({running:true,phase:'clickedRow',currentIndex:0,currentRowKey:row.key,currentStableKey:row.stableKey,previousContentKey:key,allowUnchangedContentKey:key});
          await b.extractAndSendCurrentBiology();
        });
        const requests=await page.evaluate(()=>window.requests);
        assert.equal(requests.filter(request=>request.payload).length,1);
        assert.ok(requests.filter(request=>request.payload).every(request=>!JSON.stringify(request.payload).includes('demo-A')));
        assert.ok(requests.filter(request=>request.payload).every(request=>!JSON.stringify(request.payload).includes('28/10/2026')));
        checks.push('Circuit LM Studio complet : source courante et antériorités locales, aucun PatDk transmis');
      } else {
        await page.evaluate(async()=>{
          const b=bioTest,row=b.getBiologyRows()[0],key=b.getDisplayedBiologyContentKey();
          b.biologyEnhancements.setSource('synthetic-job',key,b.extractHprimTable(document.querySelector('table.hprimgrid')),[{id:'crp',date:'28/10/2026',display:'2 mg/L'}]);
          b.setState({running:true,phase:'waitingHeidi',currentIndex:0,currentRowKey:row.key,currentStableKey:row.stableKey,currentJobId:'synthetic-job',currentContentKey:key});
          await b.handler({jobId:'synthetic-job',channelId:b.channel,ok:true,title:'CRP ↑ 999 mg/L',raw:'CRP ↑ 999 mg/L',
            rowIndex:0,rowKey:row.key,rowStableKey:row.stableKey,contentKey:key});
        });
        checks.push('Retour Heidi : résultat corrigé depuis la source locale');
      }
      assert.equal(await page.locator('#ContentPlaceHolder1_TextBoxHprimTitre').inputValue(),'CRP ↑ 12 mg/L [2 mg/L le 28/10/2026]');
      assert.equal(await page.evaluate(()=>saves.length),1,'Un seul déclenchement de sauvegarde : '+relative+' '+JSON.stringify(await page.evaluate(()=>bioTest.getState())));
      assert.equal(await page.evaluate(()=>bioTest.getState().phase),'savingTitle');
      await page.evaluate(()=>{
        for(const callback of [...endHandlers])callback(null,{get_error:()=>new Error('Échec serveur fictif')});
      });
      assert.equal(await page.evaluate(()=>bioTest.getState().phase),'error');
      assert.match(await page.evaluate(()=>bioTest.getState().message),/échec de sauvegarde/);
      checks.push('Erreur de postback conservée comme échec : '+relative);
      const guards=await page.evaluate(()=>{
        const b=bioTest,row=b.getBiologyRows()[0],key=b.getDisplayedBiologyContentKey();
        const result=b.validateHeidiResultAgainstWaitingState({jobId:'other-job'},b.getState());
        document.querySelector('table.hprimgrid tr:last-child td:nth-child(3)').textContent='42';
        const assignment=b.validateTitleAssignmentTarget({rowIndex:0,rowKey:row.key,rowStableKey:row.stableKey,contentKey:key});
        b.stopWedaWorkflow();
        return {result,assignment};
      });
      assert.equal(guards.result.ok,false);assert.equal(guards.assignment.ok,false);
      await page.locator('#ContentPlaceHolder1_TextBoxHprimTitre').fill('Correction humaine à conserver');
      await page.evaluate(()=>bioTest.applyRememberedTitleForSelectedRow());
      assert.equal(await page.locator('#ContentPlaceHolder1_TextBoxHprimTitre').inputValue(),'Correction humaine à conserver');
      assert.equal(await page.evaluate(()=>saves.length),1);
      checks.push('Écriture unique, refus d’une autre cible et conservation de la saisie manuelle : '+relative);
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(JSON.stringify({checks,errors,external},null,2));
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
