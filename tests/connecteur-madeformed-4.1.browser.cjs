'use strict';

// Edge neuf et hors ligne. Le serveur ci-dessous ne fournit que des identités fictives.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.MADEFORMED_PLAYWRIGHT_MODULE || 'playwright');
const sourcePath = process.env.MADEFORMED_SOURCE_PATH || path.join(__dirname,'..','scripts','Connecteur-madeformed-vers-weda.user..js');
const source = fs.readFileSync(sourcePath,'utf8');
const origin = 'https://pro.madeformed.com';
const checks = [], errors = [], network = [], dialogs = [];
const fixture = {context:'501', binding:'original', search:'ready', profile:'blocked', savedDocuments:new Map(), documentMode:'uncertain'};
const profileRelease = new Set();
let documentId = 7100;
const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function header() {
    return '<nav class="topbar"><ul class="navbar-left"><li class="serv serv-cal"><a href="/agenda">Agenda</a></li><li class="serv serv-msg"><a href="/messages"><span class="hide-mobile">Messagerie</span><span class="notif-badge-counter msg-counter">7</span></a></li></ul>'+
        '<ul id="envNav"><li class="choice active" title="Praticien Fictif '+fixture.context+' - Cabinet Démo"><a href="#"><div pro-id="'+fixture.context+'"></div><span class="pro">Praticien Fictif '+fixture.context+'</span><span class="cab">Cabinet Démo</span></a></li></ul></nav>';
}
function row(id,hour,{uid='',phone='0102030405',name='PATIENT DEMO',channel='svi'}={}) {
    const href=uid?'/agenda?target=user-detail&uid='+uid:'/agenda?target=user-search&field=tel&value='+phone;
    return '<tr class="user-message" data-id="'+id+'" data-user_id="'+uid+'" data-name="'+name+'" data-phone="'+phone+'" data-mod="Message"><td><input type="checkbox"></td><td class="expediteur"><span class="name truncate">'+name+'</span></td><td><span class="date">07/10/2026</span><span class="hour">'+hour+'</span></td><td class="content"><span class="msg-canal" data-canal="'+channel+'">'+channel+'</span><div class="transcription">Message de démonstration sans donnée réelle</div></td><td class="action"><div class="flex"><a class="search ds-btn" href="'+escape(href)+'">Fiche native</a></div></td></tr>';
}
function shell(body,script='',connector=true) {
    return '<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;margin:12px}nav ul{display:flex;gap:12px;list-style:none;padding:0}.cab{display:none}table{border-collapse:collapse;width:100%}td{padding:8px;border-bottom:1px solid #ddd}.date,.hour{display:block}.action .ds-btn{display:inline-flex;background-color:rgb(110,70,30);color:rgb(255,250,240);padding:5px}.theme-new .action .ds-btn{background-color:rgb(30,100,160);color:rgb(245,250,255)}.user-detail{padding:12px}.file{display:block;margin:8px}.patient-input{width:160px}</style></head><body>'+header()+body+(script?'<script>'+script+'</script>':'')+(connector?'<script src="/connector.js"></script>':'')+'</body></html>';
}
function messages() {
    const phone=fixture.binding==='changed'?'0199999999':'0102030405';
    return shell('<main><p class="fixture-notice">TEST HORS LIGNE — identités, rendez-vous et messages entièrement fictifs.</p><table id="messages"><tbody>'+row('1101','14:03',{phone})+row('1102','14:08',{phone})+row('1103','14:12',{phone})+row('1104','14:18',{phone})+row('1201','14:25',{uid:'202',channel:'web',name:'AUTRE DEMO'})+'</tbody></table></main>');
}
function search(phone) {
    const uid=phone==='0199999999'?'203':'201';
    return shell('<div id="infos"><div class="user-search active"><div id="users-result"><div class="user preview" data-user-id="'+uid+'" data-user-name="PATIENT DEMO"><div class="user-name"><span class="nom">PATIENT</span> <span class="prenom">DEMO</span></div><div class="identite-contacts"><a data-tel="'+phone+'">Téléphone fictif</a></div><div class="identite-infos">Né le 01/02/1980 — identité fictive</div></div></div></div></div>','',false);
}
function profile(uid) {
    const cards=(fixture.savedDocuments.get(uid)||[]).map(doc=>'<div class="file" data-id="'+doc.id+'" data-url="/users/'+uid+'/docs/'+doc.id+'"><span class="file-name">'+escape(doc.name)+'</span></div>').join('');
    const body='<div id="infos"><div class="user-detail panel active" data-user-id="'+uid+'"><div class="user-name"><span class="nom">PATIENT</span> <span class="prenom">DEMO</span></div><a class="sc-btn" href="#user-history">Historique</a><a class="sc-btn" href="#user-docs">Documents</a><a class="new-rdv" data-user-id="'+uid+'" href="#">Ajouter un rendez-vous</a><div id="user-history"><div class="history-group futur"><div class="rdv preview" data-rdv-id="8101" data-debut="2026-10-15 14:30"><div class="planning"></div></div></div></div><div id="user-docs" class="files-container is-loaded"><div class="files">'+cards+'</div><form action="/users/'+uid+'/docs" method="post" enctype="multipart/form-data"><div class="file-drop-area" data-step="waiting"><input type="file" name="files[]" multiple max-size="52428800"></div></form></div></div><div class="new-rdv panel"><form action="/rdvs" method="post"><div id="newRdvUsers"><input class="patient-input" name="data[Rdv][user_id]" value="'+uid+'"></div><input name="data[Rdv][date]" value="15/10/2026"><button type="submit">Enregistrer</button></form></div></div>';
    return shell(body,'document.querySelectorAll("a.sc-btn").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();document.querySelector(a.getAttribute("href")).classList.add("active");}));document.querySelector("#user-docs input").addEventListener("change",e=>{const xhr=new XMLHttpRequest();xhr.open("POST",e.target.closest("form").getAttribute("action"));xhr.send(new FormData(e.target.closest("form")));});','',false);
}
function initFixtures() {
    const NativeDate=Date,clockKey='fixture41/clock-start',advanceKey='fixture41/clock-advance';
    // Une initialisation peut aussi visiter about:blank, où Edge refuse sessionStorage.
    const readClock=key=>{try{return sessionStorage.getItem(key);}catch(_){return null;}};
    const writeClock=(key,value)=>{try{sessionStorage.setItem(key,value);}catch(_){}};
    let started=Number(readClock(clockKey)),advance=Number(readClock(advanceKey))||0;
    if(!Number.isFinite(started)||started<=0){started=NativeDate.now();writeClock(clockKey,String(started));}
    class SyntheticDate extends NativeDate {constructor(...args){super(...(args.length?args:[SyntheticDate.now()]));}static now(){return NativeDate.parse('2026-10-07T12:00:00Z')+NativeDate.now()-started+(Number(readClock(advanceKey))||advance);}}
    window.Date=SyntheticDate;window.__fixtureAdvanceClock=ms=>{advance+=ms;writeClock(advanceKey,String(advance));};window.__fixtureWedaOpens=0;
    const callbacks=new Map(),prefix='fixture41/';
    window.GM_getValue=(key,fallback)=>{const raw=localStorage.getItem(prefix+key);return raw===null?fallback:JSON.parse(raw);};
    window.GM_setValue=(key,value)=>{const old=GM_getValue(key,null);localStorage.setItem(prefix+key,JSON.stringify(value));for(const cb of callbacks.get(key)||[])cb(key,old,value,false);};
    window.GM_deleteValue=key=>localStorage.removeItem(prefix+key);
    window.GM_listValues=()=>Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length));
    window.GM_addValueChangeListener=(key,cb)=>{if(!callbacks.has(key))callbacks.set(key,[]);callbacks.get(key).push(cb);return 1;};
    window.GM_removeValueChangeListener=()=>{};window.GM_registerMenuCommand=()=>{};window.GM_setClipboard=value=>{window.__fixtureClipboard=value;};
    try{Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__fixtureClipboard=value;}}});}catch(_){}
    window.GM_openInTab=()=>{window.__fixtureWedaOpens++;throw new Error('WEDA ne doit pas s’ouvrir depuis cette fixture native');};
    window.GM_closeTab=()=>{window.__fixtureCloseCalls=(window.__fixtureCloseCalls||0)+1;};
}
async function nextFrame(page) {await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function panelRect(page) {const box=await page.locator('#tm-mf-weda-panel').boundingBox();assert.ok(box,'Le panneau doit avoir une position visible.');return box;}
function samePoint(actual,expected,message) {assert.ok(Math.abs(actual.x-expected.x)<=1&&Math.abs(actual.y-expected.y)<=1,message+' : '+JSON.stringify({actual,expected}));}
async function dragPanel(page,centerX,centerY,secondaryPointer=false) {
    const before=await panelRect(page);
    await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
    await page.mouse.down();await page.mouse.move(centerX,centerY,{steps:12});
    assert.equal(await page.locator('#tm-mf-weda-panel').evaluate(node=>node.classList.contains('tm-collapsed')),true,'Déplacer la pastille ne doit pas ouvrir le panneau.');
    if(secondaryPointer)await page.locator('#tm-mf-weda-head').evaluate((head,point)=>head.dispatchEvent(new PointerEvent('pointerdown',{pointerId:99,pointerType:'touch',isPrimary:false,button:0,buttons:1,bubbles:true,clientX:point.x,clientY:point.y})),{x:centerX,y:centerY});
    await page.mouse.up();await nextFrame(page);
    assert.equal(await page.locator('#tm-mf-weda-panel').evaluate(node=>node.classList.contains('tm-collapsed')),true,'Le clic généré au relâchement du glissement doit être ignoré.');
    return panelRect(page);
}
async function assertNoGroup(page,reason) {await nextFrame(page);assert.equal(await page.locator('.tm-mf-call-group-head').count(),0,reason);}
async function releaseProfiles() {fixture.profile='ready';for(const resolve of profileRelease)resolve();profileRelease.clear();}
async function attachEvents(page) {page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});}

async function madeformedScenarios(browser) {
    const context=await browser.newContext({viewport:{width:1540,height:1050},timezoneId:'America/Los_Angeles'});
    await context.setOffline(true);await context.addInitScript(initFixtures);
    await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==origin){network.push({blockedOrigin:url.origin});return route.abort();}
        const entry={method:request.method(),path:url.pathname+url.search};network.push(entry);
        if(url.pathname==='/connector.js')return route.fulfill({status:200,contentType:'application/javascript',body:source});
        if(request.method()==='POST'&&/^\/users\/\d+\/docs$/.test(url.pathname)){
            const names=[...(request.postData()||'').matchAll(/filename="([^"]+)"/g)].map(x=>x[1]);
            const documents=names.map(name=>({id:String(++documentId),name}));
            if(fixture.documentMode==='stored'){const uid=url.pathname.split('/')[2];fixture.savedDocuments.set(uid,[...(fixture.savedDocuments.get(uid)||[]),...documents]);}
            return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,documents})});
        }
        if(request.method()!=='GET')throw new Error('Écriture native inattendue : '+entry.path);
        if(url.pathname==='/tasks')return route.fulfill({status:200,contentType:'text/html',body:'<div class="task-list"></div>'});
        if(url.pathname==='/agenda'&&url.searchParams.get('target')==='user-detail'){
            if(fixture.profile==='blocked'&&url.searchParams.get('uid')==='201')await new Promise(resolve=>profileRelease.add(resolve));
            return route.fulfill({status:200,contentType:'text/html',body:profile(url.searchParams.get('uid'))}).catch(()=>{});
        }
        if(url.pathname==='/agenda'&&url.searchParams.get('target')==='user-search'){
            if(fixture.search==='offline')return route.abort();
            return route.fulfill({status:200,contentType:'text/html',body:search(url.searchParams.get('value'))});
        }
        return route.fulfill({status:200,contentType:'text/html',body:url.pathname==='/messages'?messages():shell('<main>Agenda fictif</main>')});
    });
    const page=await context.newPage();await attachEvents(page);await page.goto(origin+'/messages');
    const group=page.locator('.tm-mf-call-group-head');
    await group.waitFor();
    assert.match(await group.locator('strong').innerText(),/4 appels successifs/);
    assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),3);
    assert.ok(network.some(x=>x.path==='/agenda?target=user-detail&uid=201'),'Une lecture RDV lente doit être en cours.');
    assert.notEqual(await page.locator('tr[data-id="1101"] .tm-mf-native-next').innerText(),'Prochain RDV : 15/10 à 14:30');
    checks.push('identité et regroupement SVI terminent avant une lecture RDV volontairement bloquée');

    await page.waitForFunction(()=>GM_getValue('TM_MFM_GROUP_IDENTITIES_V1',{}).entries?.length>=4);
    const memory=await page.evaluate(()=>GM_getValue('TM_MFM_GROUP_IDENTITIES_V1',{}));
    assert.equal(memory.version,1);assert.equal(memory.origin,origin);
    assert.ok(memory.entries.every(x=>/^[a-f0-9]{64}$/.test(x.digest)&&x.uid==='201'));
    assert.equal(JSON.stringify(memory).includes('PATIENT'),false);assert.equal(JSON.stringify(memory).includes('0102030405'),false);
    checks.push('mémoire persistante du regroupement limitée à des liaisons hachées et UID');

    await group.locator('button').click();
    assert.equal(await group.locator('button').getAttribute('aria-expanded'),'true');
    await page.locator('tr[data-id="1201"]').evaluate((node,html)=>node.insertAdjacentHTML('beforebegin',html),row('1105','14:22'));
    await page.waitForFunction(()=>document.querySelector('.tm-mf-call-group-head strong')?.textContent.includes('5 appels successifs'));
    assert.equal(await group.locator('button').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),0);
    await group.locator('button').click();
    await page.waitForFunction(()=>document.querySelectorAll('.tm-mf-call-group-hidden').length===4);
    checks.push('un groupe ouvert reste ouvert après l’arrivée d’un nouvel appel compatible');

    fixture.search='offline';
    await page.reload();await group.waitFor();
    assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),3);
    assert.notEqual(await page.locator('tr[data-id="1101"] .tm-mf-native-next').innerText(),'Prochain RDV : 15/10 à 14:30');
    checks.push('rechargement restaure le regroupement alors que recherche native et historique sont indisponibles');

    await page.evaluate(()=>{const saved=GM_getValue('TM_MFM_GROUP_IDENTITIES_V1',{});saved.entries=Array.from({length:400},(_,index)=>({digest:(index+1).toString(16).padStart(64,'0'),uid:'201',verifiedAt:Date.now()-index}));GM_setValue('TM_MFM_GROUP_IDENTITIES_V1',saved);});
    await page.reload();await page.locator('tr[data-id="1101"] .tm-mf-native-next').waitFor();
    await page.waitForFunction(()=>GM_getValue('TM_MFM_GROUP_IDENTITIES_V1',{}).entries?.length===300);
    await page.evaluate(saved=>GM_setValue('TM_MFM_GROUP_IDENTITIES_V1',saved),memory);
    await page.reload();await group.waitFor();
    checks.push('mémoire du regroupement bornée à 300 liaisons');

    fixture.binding='changed';await page.reload();
    await page.locator('tr[data-id="1101"] .tm-mf-native-next').waitFor();await assertNoGroup(page,'Le téléphone modifié invalide la liaison mémorisée.');
    fixture.binding='original';fixture.context='502';await page.reload();
    await page.locator('tr[data-id="1101"] .tm-mf-native-next').waitFor();await assertNoGroup(page,'La mémoire du contexte précédent ne doit pas regrouper.');
    fixture.context='501';await page.reload();await group.waitFor();
    await page.evaluate(()=>{const saved=GM_getValue('TM_MFM_GROUP_IDENTITIES_V1',{});saved.entries=saved.entries.map(x=>({...x,verifiedAt:Date.now()-7*24*60*60*1000-1000}));GM_setValue('TM_MFM_GROUP_IDENTITIES_V1',saved);});
    await page.reload();await page.locator('tr[data-id="1101"] .tm-mf-native-next').waitFor();await assertNoGroup(page,'À sept jours, la mémoire ne fournit plus l’identité de regroupement.');
    checks.push('mémoire refusée après changement de liaison, changement de contexte et expiration de sept jours');

    fixture.search='ready';await releaseProfiles();await page.reload();await group.waitFor();
    await page.waitForFunction(()=>document.querySelector('tr[data-id="1101"] .tm-mf-native-next')?.textContent==='Prochain RDV : 15/10 à 14:30');
    const action=page.locator('tr[data-id="1101"] [data-action="rdv"]');
    const colors=await action.evaluate(node=>({bg:getComputedStyle(node).backgroundColor,fg:getComputedStyle(node).color}));
    assert.deepEqual(colors,{bg:'rgb(110, 70, 30)',fg:'rgb(255, 250, 240)'});
    await page.evaluate(()=>document.documentElement.classList.add('theme-new'));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('tr[data-id="1101"] [data-action="rdv"]')).backgroundColor==='rgb(30, 100, 160)');
    await page.addStyleTag({content:'.theme-new .action .ds-btn{background-color:rgb(60,130,80);color:rgb(255,255,255)}'});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('tr[data-id="1101"] [data-action="document"]')).backgroundColor==='rgb(60, 130, 80)');
    checks.push('palette des actions suit la couleur native, une mutation de thème et un style tardif');

    const panel=page.locator('#tm-mf-weda-panel'),toggle=page.locator('#tm-mf-weda-toggle');
    assert.equal(await panel.evaluate(node=>node.classList.contains('tm-collapsed')),true);
    assert.equal(await page.locator('#tm-mf-weda-ruby-icon').innerText(),'W');
    const dragged=await dragPanel(page,280,180,true);
    checks.push('pointeur secondaire ignoré pendant le drag primaire sans perdre la suppression du clic final');
    samePoint(dragged,{x:280-dragged.width/2,y:180-dragged.height/2},'La pastille suit la souris.');
    const savedPosition=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null));
    assert.ok(savedPosition&&Number.isFinite(savedPosition.x)&&Number.isFinite(savedPosition.y));
    samePoint(savedPosition,dragged,'La position x/y persistée correspond au coin de la pastille.');
    assert.equal(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_COLLAPSED_V1',true)),true);
    await page.reload();
    assert.equal(await page.locator('#tm-mf-weda-ruby-icon').innerText(),'W');
    samePoint(await panelRect(page),savedPosition,'La position persistée est restaurée après rechargement.');
    checks.push('pastille W déplacée par vrais événements souris sans toggle, coordonnées persistées et restaurées au reload');

    const beforeCancel=await panelRect(page),savedBeforeCancel=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null));
    await page.mouse.move(beforeCancel.x+beforeCancel.width/2,beforeCancel.y+beforeCancel.height/2);
    await page.mouse.down();await page.mouse.move(beforeCancel.x+100,beforeCancel.y+80,{steps:6});
    await page.keyboard.press('Escape');await page.mouse.up();await nextFrame(page);
    samePoint(await panelRect(page),beforeCancel,'Échap restaure la position précédant le glissement.');
    assert.deepEqual(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null)),savedBeforeCancel);
    assert.equal(await panel.evaluate(node=>node.classList.contains('tm-collapsed')),true);
    checks.push('Échap annule un glissement sans modifier la position persistée');

    await page.locator('#tm-mf-weda-head').click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    const keyboardCancel=await page.locator('#tm-mf-weda-head').boundingBox();
    await page.mouse.move(keyboardCancel.x+22,keyboardCancel.y+18);await page.mouse.down();
    await page.mouse.move(keyboardCancel.x+110,keyboardCancel.y+100,{steps:6});
    await page.keyboard.press('Escape');await page.mouse.up();await nextFrame(page);
    await toggle.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'tm-mf-weda-toggle');
    await page.keyboard.press('Space');
    assert.equal(await panel.evaluate(node=>node.classList.contains('tm-collapsed')),true,'Le clic clavier reste accepté après annulation du glissement.');
    checks.push('bouton toggle activable par Tab/Espace après un drag annulé, sans nouveau pointerdown');

    await dragPanel(page,1460,990);
    const desiredEdgePosition=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null));
    await page.setViewportSize({width:640,height:480});await nextFrame(page);
    const recentered=await panelRect(page);
    assert.ok(recentered.x>=0&&recentered.y>=0&&recentered.x+recentered.width<=641&&recentered.y+recentered.height<=481,'Le resize conserve toute la pastille dans la fenêtre.');
    assert.deepEqual(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null)),desiredEdgePosition,'Le recadrage visuel ne modifie pas la position désirée.');
    await page.reload();
    const smallRestored=await panelRect(page);
    assert.ok(smallRestored.x>=0&&smallRestored.y>=0&&smallRestored.x+smallRestored.width<=641&&smallRestored.y+smallRestored.height<=481,'La restauration dans une petite fenêtre reste visible.');
    await page.locator('#tm-mf-weda-head').click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    const expandedAtEdge=await panelRect(page);
    assert.ok(expandedAtEdge.x>=0&&expandedAtEdge.y>=0&&expandedAtEdge.x+expandedAtEdge.width<=641&&expandedAtEdge.y+expandedAtEdge.height<=481,'Ouvrir le panneau le recadre sans déborder.');
    await page.locator('#tm-mf-weda-status').evaluate(node=>{node.dataset.fixtureMinHeight=node.style.minHeight;node.style.minHeight=(node.getBoundingClientRect().height+180)+'px';});
    await page.waitForFunction(()=>{const rect=document.getElementById('tm-mf-weda-panel').getBoundingClientRect();return rect.y>=0&&rect.bottom<=481;});
    const grownPanel=await panelRect(page);
    assert.ok(grownPanel.height>expandedAtEdge.height+1&&grownPanel.y<expandedAtEdge.y-1,'ResizeObserver recadre le panneau quand son contenu augmente.');
    assert.deepEqual(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null)),desiredEdgePosition);
    await page.locator('#tm-mf-weda-status').evaluate(node=>{node.style.minHeight=node.dataset.fixtureMinHeight;delete node.dataset.fixtureMinHeight;});
    await nextFrame(page);
    checks.push('agrandissement dynamique du statut recadré par ResizeObserver sans modifier le point désiré');
    await toggle.click();
    assert.equal(await panel.evaluate(node=>node.classList.contains('tm-collapsed')),true,'Le bouton +/- conserve son clic simple.');
    samePoint(await panelRect(page),smallRestored,'Replier restaure la position de la pastille.');
    assert.deepEqual(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_POSITION_V1',null)),desiredEdgePosition);
    await page.setViewportSize({width:1540,height:1050});await nextFrame(page);
    samePoint(await panelRect(page),desiredEdgePosition,'Agrandir restaure le point désiré.');
    await dragPanel(page,280,180);
    checks.push('pastille et panneau recadrés au resize, point désiré conservé, clic du bouton toggle préservé');

    await page.locator('#tm-mf-weda-head').click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_PANEL_COLLAPSED_V1',null)),false);
    assert.match(await page.locator('#tm-mf-weda-shortcuts').innerText(),/PageDown/);
    await page.reload();
    assert.equal(await panel.evaluate(node=>node.classList.contains('tm-collapsed')),false);
    await page.evaluate(()=>{GM_setValue('TM_MADEFORMED_TO_WEDA_PANEL_COLLAPSED_V1',true);window.dispatchEvent(new Event('focus'));});
    await page.waitForFunction(()=>document.getElementById('tm-mf-weda-panel')?.classList.contains('tm-collapsed'));
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    checks.push('préférence du panneau conservée après reload et synchronisée au focus, raccourcis lisibles');

    // Envoi incertain puis reload : les nouveaux modules ne doivent pas enlever le verrou V4.
    const other=page.locator('tr[data-id="1201"]');
    const pickPromise=page.waitForEvent('filechooser');await other.locator('[data-action="document"]').click();
    await (await pickPromise).setFiles({name:'controle-incertain.txt',mimeType:'text/plain',buffer:Buffer.from('Démonstration fictive')});
    await page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/users/202/docs');
    await page.evaluate(()=>window.__fixtureAdvanceClock(100000));
    await other.locator('.tm-mf-native-action-status button').waitFor();
    const docPosts=()=>network.filter(x=>x.method==='POST'&&/^\/users\//.test(x.path)).length;
    assert.equal(docPosts(),1);assert.notEqual(await other.locator('.tm-mf-native-action-status').getAttribute('data-state'),'success');
    await page.reload();await other.locator('.tm-mf-native-action-status button').waitFor();
    const journal=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_DOCUMENT_PENDING_V1',{}));
    assert.ok(Object.values(journal).some(x=>x.uid==='202'));assert.equal(JSON.stringify(journal).includes('controle-incertain.txt'),false);
    await other.locator('[data-action="document"]').click();
    await page.locator('.tm-mf-native-overlay:not([hidden])').waitFor();
    const readonly=page.frameLocator('.tm-mf-native-overlay:not([hidden]) iframe');
    assert.equal(await readonly.locator('.user-detail.active').getAttribute('data-user-id'),'202');
    assert.equal(await readonly.locator('#user-docs input[type="file"]').isDisabled(),true);assert.equal(docPosts(),1);
    await page.locator('.tm-mf-native-overlay:not([hidden]) .tm-mf-native-close').last().click();
    assert.ok(await page.evaluate(()=>Object.values(GM_getValue('TM_MADEFORMED_DOCUMENT_PENDING_V1',{})).some(x=>x.uid==='202')));
    checks.push('nouveaux modules conservent le verrou document durable et la vérification readonly sans retransmission');

    // Le transfert périmé efface les informations sensibles mais garde une obligation de vérification.
    await page.evaluate(()=>{
        GM_setValue('TM_MFM_WEDA_TRANSFER_AUDIT_V1',Array.from({length:120},(_,index)=>({id:'1791374400000_fixture'+index,action:'sms_to_consultation',status:'open_search',createdAt:Date.now()-1000,updatedAt:Date.now()-index,resultUnknown:false})).concat([{id:'1791374400000_ancien',action:'sms_to_consultation',status:'open_search',createdAt:Date.now()-25*60*60*1000,updatedAt:Date.now()-25*60*60*1000,resultUnknown:false}]));
        GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{id:'1791374400000_demo',action:'send_message',source:'fixture',createdAt:Date.now()-21*60*1000,updatedAt:Date.now()-1000,status:'consultation_opened',patientName:'NOM CONFIDENTIEL FICTIF',patientNameRaw:'NOM CONFIDENTIEL FICTIF',dateOfBirth:'01/02/1980',message:'Texte confidentiel de démonstration',wedaUrl:'https://secure.weda.fr/Patient/201'});
        window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{})?.status==='expired_unknown');
    const expired=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{}));
    assert.equal(expired.resultUnknown,true);
    for(const key of ['patientName','patientNameRaw','dateOfBirth','message','wedaUrl'])assert.equal(expired[key],undefined);
    await page.evaluate(()=>GM_setValue('TM_MADEFORMED_TO_WEDA_PANEL_COLLAPSED_V1',false));
    await page.locator('#tm-mf-weda-review-expired').waitFor();
    const status=await page.locator('#tm-mf-weda-status').innerText();
    assert.equal(status.includes('expired_unknown'),false);assert.match(status,/vérifi|ancien|incertain/i);
    const nativePostsBeforeReview=network.filter(x=>x.method==='POST').length;
    await page.evaluate(()=>{window.confirm=()=>true;});
    await page.locator('#tm-mf-weda-review-expired').click();
    await page.waitForFunction(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',null)===null);
    assert.equal(network.filter(x=>x.method==='POST').length,nativePostsBeforeReview);
    const audit=await page.evaluate(()=>GM_getValue('TM_MFM_WEDA_TRANSFER_AUDIT_V1',[]));
    assert.ok(audit.some(x=>x.id==='1791374400000_demo'));
    assert.ok(audit.length<=100);assert.equal(audit.some(x=>x.id==='1791374400000_ancien'),false);
    assert.ok(audit.every(x=>Object.keys(x).every(key=>['id','action','status','createdAt','updatedAt','resultUnknown'].includes(key))));
    assert.equal(JSON.stringify(audit).includes('CONFIDENTIEL'),false);
    checks.push('transfert expiré perd les données sensibles, garde un statut français et ne se libère que par vérification manuelle sans écriture clinique','trace technique sans identité, limitée à 100 éléments et 24 heures');

    const postsBeforeMigration=network.filter(x=>x.method==='POST').length;
    await page.evaluate(()=>GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{
        id:'1791374400000_open',action:'open_patient',source:'madeformed_messages',createdAt:Date.now()-21*60*1000,
        updatedAt:Date.now()-1000,status:'expired_unknown',resultUnknown:true,sensitiveDataExpiredAt:Date.now()-1000
    }));
    await page.reload();
    await page.waitForFunction(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{})?.status==='error_transfer_expired');
    assert.equal(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{}).resultUnknown),false);
    assert.match(await page.locator('#tm-mf-weda-status').innerText(),/vous pouvez ouvrir un dossier/);
    assert.equal(await page.locator('#tm-mf-weda-review-expired').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__fixtureWedaOpens),0);
    assert.equal(network.filter(x=>x.method==='POST').length,postsBeforeMigration);
    await page.evaluate(()=>{
        window.__fixtureBlockedWedaOpen=window.GM_openInTab;
        window.GM_openInTab=(url,options)=>{window.__fixtureWedaOpens++;window.__fixtureLastOpen={url,options};return {};};
    });
    await page.locator('tr[data-id="1201"] .expediteur .name').click();
    await page.waitForFunction(()=>window.__fixtureWedaOpens===1);
    const reopened=await page.evaluate(()=>({job:GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{}),open:window.__fixtureLastOpen}));
    assert.equal(reopened.job.action,'open_patient');assert.equal(reopened.job.status,'open_search');
    assert.notEqual(reopened.job.id,'1791374400000_open');assert.equal(reopened.job.patientName,'AUTRE DEMO');
    assert.equal(new URL(reopened.open.url).searchParams.get('tmJob'),reopened.job.id);
    assert.equal(network.filter(x=>x.method==='POST').length,postsBeforeMigration);
    await page.evaluate(()=>{window.GM_openInTab=window.__fixtureBlockedWedaOpen;GM_deleteValue('TM_MADEFORMED_TO_WEDA_JOB_V31');});
    checks.push('une ouverture seule expirée en V4.3 est libérée au rechargement sans action automatique ; le clic suivant ouvre un nouveau dossier');

    if(process.env.MADEFORMED_41_PREVIEW_PATH){
        await page.locator('.tm-mf-call-group-head').waitFor();
        await page.waitForFunction(()=>document.querySelector('tr[data-id="1101"] .tm-mf-native-next')?.textContent==='Prochain RDV : 15/10 à 14:30');
        await page.addStyleTag({content:'.fixture-notice{padding:10px;background:#f3e8ff;color:#581c87;font-weight:bold;border:1px solid #c084fc}.icoformed-calendar-new-line::before{content:"📅"}'});
        await page.locator('main').screenshot({path:process.env.MADEFORMED_41_PREVIEW_PATH});
    }
    assert.equal(await page.evaluate(()=>window.__fixtureWedaOpens),1);
    await releaseProfiles();await context.close();
}

async function wedaScenarios(browser) {
    const wedaOrigin='https://secure.weda.fr';
    // Les hooks sont ajoutés seulement à la copie en mémoire du banc. Le fichier distribué reste intact.
    const hooked=source.replace(/\}\)\(\);\s*$/,
        'window.__fixtureApi={getJob,clickWedaPatient,wedaPatientMatch,wedaPatientBind,wedaPatientRequire,clickNewConsultation,wedaPatientBindConsultation,fillConsultationAndSave,saveConsultationOnly,runWorker:()=>{wedaRunning=false;return wedaMain();}};wedaRunning=true;})();');
    assert.notEqual(hooked,source,'Point d’insertion des hooks de test introuvable.');
    const context=await browser.newContext({viewport:{width:1200,height:900}});
    await context.setOffline(true);await context.addInitScript(initFixtures);
    let mode='homonyms',caseIndex=0;
    const wedaRequests=[];
    function wedaShell(body){return '<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;padding:15px}td{padding:10px}[contenteditable]{border:1px solid #888;min-height:100px}</style></head><body>'+body+'<script src="/connector.js"></script></body></html>';}
    function resultLink(index,id,birth){return '<tr'+(birth&&mode!=='cell-date'?' data-ddn="'+birth+'"':'')+'><td><a id="ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_'+index+'" href="/FolderMedical/PatientViewForm.aspx?PatDk='+id+'">PATIENT DEMO</a></td><td>'+(birth||'Date non affichée')+'</td></tr>';}
    await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin!==wedaOrigin){network.push({blockedOrigin:url.origin});return route.abort();}
        wedaRequests.push({method:request.method(),path:url.pathname+url.search});
        if(url.pathname==='/connector.js')return route.fulfill({status:200,contentType:'application/javascript',body:hooked});
        if(request.method()==='POST'&&url.pathname==='/fixture-save')return route.fulfill({status:200,contentType:'application/json',body:'{"success":true}'});
        if(request.method()!=='GET')return route.abort();
        if(url.pathname==='/FolderMedical/FindPatientForm.aspx'){
            const rows=['unique','cell-date'].includes(mode)?resultLink(0,'fixtureAlpha','01/02/1980'):mode==='birth-missing'?resultLink(0,'fixtureAlpha',''):resultLink(0,'fixtureBeta','03/04/1985')+resultLink(1,'fixtureAlpha','01/02/1980');
            return route.fulfill({status:200,contentType:'text/html',body:wedaShell('<main><p>Recherche patient fictive</p><input id="ContentPlaceHolder1_FindPatientUcForm1_TextBoxRecherche"><select id="ContentPlaceHolder1_FindPatientUcForm1_DropDownListRechechePatient"><option value="Nom">Nom</option></select><table id="ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld"><tbody>'+rows+'</tbody></table></main>')});
        }
        if(url.pathname==='/FolderMedical/PatientViewForm.aspx')return route.fulfill({status:200,contentType:'text/html',body:wedaShell('<main>Dossier fictif</main><ul id="ContentPlaceHolder1_MenuNavigate:submenu:2"><li><a href="/FolderMedical/ConsultationForm.aspx?PatDk='+url.searchParams.get('PatDk')+'&ConDk=fixtureConsult">Nouvelle consultation</a></li></ul>')});
        if(url.pathname==='/FolderMedical/ConsultationForm.aspx')return route.fulfill({status:200,contentType:'text/html',body:wedaShell('<main><div id="fixture-editor" contenteditable="true">Texte initial intact</div><input id="ButtonSave" class="buttonheader valid" type="button" value="Enregistrer" onclick="const xhr=new XMLHttpRequest();xhr.open(\'POST\',\'/fixture-save\');xhr.send(\'fixture\');"></main>')});
        return route.fulfill({status:404,contentType:'text/html',body:wedaShell('<main>Route inconnue dans le banc</main>')});
    });
    const page=await context.newPage();await attachEvents(page);
    async function start(nextMode,birth='01/02/1980'){
        mode=nextMode;const id='1791374400000_weda'+(++caseIndex);
        await page.goto(wedaOrigin+'/FolderMedical/FindPatientForm.aspx?tmJob='+id);
        await page.waitForFunction(()=>Boolean(window.__fixtureApi));
        await page.evaluate(({id,birth})=>GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{id,source:'fixture',action:'open_patient',createdAt:Date.now(),updatedAt:Date.now(),status:'search_submitted',searchSubmittedAt:Date.now(),patientName:'PATIENT DEMO',patientNameRaw:'PATIENT DEMO',dateOfBirth:birth,message:'Message fictif à transférer'}),{id,birth});
        return id;
    }

    await start('unique');
    try{await Promise.all([page.waitForURL(url=>url.pathname==='/FolderMedical/PatientViewForm.aspx'&&url.searchParams.get('PatDk')==='fixtureAlpha'),page.evaluate(()=>window.__fixtureApi.clickWedaPatient(window.__fixtureApi.getJob()))]);}
    catch(error){console.error(JSON.stringify({case:'weda-unique',url:page.url(),requests:wedaRequests,job:await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',null)).catch(()=>null),notice:await page.locator('#tm-mf-weda-patient-review').innerText().catch(()=>null),match:await page.evaluate(()=>{const m=window.__fixtureApi.wedaPatientMatch('PATIENT DEMO','01/02/1980');return {reason:m.reason,targets:m.candidates.map(c=>({name:c.name,dates:c.dates,invalidDate:c.invalidDate,patDk:c.patDk}))};}).catch(()=>null)}));throw error;}
    const autoBound=await page.evaluate(()=>window.__fixtureApi.wedaPatientBind(window.__fixtureApi.getJob()));
    assert.equal(autoBound.wedaPatDk,'fixtureAlpha');assert.equal(autoBound.wedaPatientSelectionManual,false);
    checks.push('WEDA : un résultat natif exact avec date de naissance cohérente se lie au bon PatDk');

    await start('birth-missing');
    await page.evaluate(()=>window.__fixtureApi.clickWedaPatient(window.__fixtureApi.getJob()));
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'awaiting_patient_selection');
    await page.evaluate(()=>{window.__fixtureConfirmCount=0;window.confirm=()=>{window.__fixtureConfirmCount++;return false;};});
    await page.locator('#ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_0').click();
    assert.equal(await page.evaluate(()=>window.__fixtureConfirmCount),1);
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'awaiting_patient_selection');
    assert.ok(page.url().includes('FindPatientForm.aspx'));
    await page.evaluate(()=>{window.confirm=()=>{window.__fixtureConfirmCount++;return true;};});
    await Promise.all([page.waitForURL(url=>url.pathname==='/FolderMedical/PatientViewForm.aspx'&&url.searchParams.get('PatDk')==='fixtureAlpha'),page.locator('#ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_0').click()]);
    const verifiedWithoutBirth=await page.evaluate(()=>window.__fixtureApi.wedaPatientBind(window.__fixtureApi.getJob()));
    assert.equal(verifiedWithoutBirth.wedaPatientSelectionManual,true);assert.equal(verifiedWithoutBirth.wedaPatDk,'fixtureAlpha');
    checks.push('WEDA : DOB absente exige une confirmation manuelle, refus conservé puis confirmation explicite acceptée');

    await start('homonyms');
    await page.evaluate(()=>window.__fixtureApi.clickWedaPatient(window.__fixtureApi.getJob()));
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'awaiting_patient_selection');
    assert.ok(page.url().includes('FindPatientForm.aspx'));
    assert.match(await page.locator('#tm-mf-weda-patient-review').innerText(),/choisissez|choix/i);
    await page.locator('#ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_0').click();
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'error_patient_selection_conflict');
    assert.ok(page.url().includes('FindPatientForm.aspx'));
    assert.equal(wedaRequests.some(x=>x.path==='/FolderMedical/PatientViewForm.aspx?PatDk=fixtureBeta'),false);
    checks.push('WEDA : homonymes imposent un choix, une date de naissance contradictoire bloque le clic avant navigation');

    await start('homonyms');
    await page.evaluate(()=>window.__fixtureApi.clickWedaPatient(window.__fixtureApi.getJob()));
    await Promise.all([page.waitForURL('**/PatientViewForm.aspx?PatDk=fixtureAlpha'),page.locator('#ContentPlaceHolder1_FindPatientUcForm1_PatientsGridOld_LinkButtonOldPatientGetNomPrenom_1').click()]);
    const manualBound=await page.evaluate(()=>window.__fixtureApi.wedaPatientBind(window.__fixtureApi.getJob()));
    assert.equal(manualBound.wedaPatDk,'fixtureAlpha');assert.equal(manualBound.wedaPatientSelectionManual,true);
    checks.push('WEDA : choix manuel du résultat exact et DOB cohérente reprend dans le seul dossier choisi');

    await page.evaluate(()=>GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{...window.__fixtureApi.getJob(),action:'sms_to_consultation'}));
    await Promise.all([page.waitForURL('**/ConsultationForm.aspx?PatDk=fixtureAlpha&ConDk=fixtureConsult'),page.evaluate(()=>window.__fixtureApi.clickNewConsultation(window.__fixtureApi.getJob()))]);
    const allowedJob=await page.evaluate(()=>window.__fixtureApi.wedaPatientBindConsultation(window.__fixtureApi.getJob()));
    assert.equal(await page.locator('#fixture-editor').innerText(),'Texte initial intact');
    await page.evaluate(()=>history.replaceState(null,'','/FolderMedical/ConsultationForm.aspx?PatDk=fixtureBeta&ConDk=fixtureConsult'));
    const changedPatient=await page.evaluate(async()=>{try{await window.__fixtureApi.fillConsultationAndSave(window.__fixtureApi.getJob());return 'unexpected';}catch(error){return error.code;}});
    assert.equal(changedPatient,'WEDA_PATIENT_GUARD');
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'error_patient_changed');
    assert.equal(await page.locator('#fixture-editor').innerText(),'Texte initial intact');
    assert.equal(wedaRequests.filter(x=>x.method==='POST').length,0);
    checks.push('WEDA : changement de dossier avant insertion refuse tout collage et tout enregistrement');

    await page.evaluate(()=>{
        history.replaceState(null,'','/FolderMedical/ConsultationForm.aspx?PatDk=fixtureAlpha&ConDk=autreConsultation');
        GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{...window.__fixtureApi.getJob(),status:'consultation_saving'});
    });
    const changedConsultation=await page.evaluate(async()=>{try{await window.__fixtureApi.saveConsultationOnly();return 'unexpected';}catch(error){return error.code;}});
    assert.equal(changedConsultation,'WEDA_PATIENT_GUARD');
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'error_consultation_changed');
    assert.equal(await page.locator('#fixture-editor').innerText(),'Texte initial intact');
    assert.equal(wedaRequests.filter(x=>x.method==='POST').length,0);
    checks.push('WEDA : une autre consultation du même patient est aussi protégée avant Enregistrer');

    await page.evaluate(job=>{
        history.replaceState(null,'','/FolderMedical/ConsultationForm.aspx?PatDk=fixtureAlpha&ConDk=fixtureConsult');
        GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{...job,status:'consultation_saving'});
        window.__fixtureSaveMarkup=document.getElementById('ButtonSave').outerHTML;
        document.getElementById('ButtonSave').remove();
        window.__fixtureSaveResult='pending';
        window.__fixtureApi.saveConsultationOnly().then(()=>{window.__fixtureSaveResult='unexpected';},error=>{window.__fixtureSaveResult=error.code;});
    },allowedJob);
    await page.evaluate(()=>{history.replaceState(null,'','/FolderMedical/ConsultationForm.aspx?PatDk=fixtureBeta&ConDk=fixtureConsult');document.querySelector('main').insertAdjacentHTML('beforeend',window.__fixtureSaveMarkup);});
    await page.waitForFunction(()=>window.__fixtureSaveResult==='WEDA_PATIENT_GUARD');
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob().status),'error_patient_changed');
    assert.equal(wedaRequests.filter(x=>x.method==='POST').length,0);
    checks.push('WEDA : dossier modifié pendant l’attente du bouton est refusé avant le clic natif Enregistrer');

    await page.evaluate(()=>GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{...window.__fixtureApi.getJob(),status:'consultation_saving',createdAt:Date.now()-21*60*1000}));
    await page.evaluate(()=>window.__fixtureApi.runWorker());
    const expiredWorker=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',null));
    assert.equal(expiredWorker?.status,'expired_unknown');assert.equal(expiredWorker?.resultUnknown,true);
    assert.equal(expiredWorker?.patientName,undefined);assert.equal(wedaRequests.filter(x=>x.method==='POST').length,0);
    assert.equal(await page.getByText('Transfert ancien à vérifier dans MadeForMed et WEDA. Aucun envoi ni enregistrement ne sera relancé.',{exact:true}).count(),0);
    checks.push('WEDA : worker conserve un transfert expiré sans nouvelle écriture ni bandeau passif');

    // Un dossier/une consultation réellement liés restent utilisables : les gardes ne bloquent pas tous les transferts.
    await page.evaluate(job=>{
        history.replaceState(null,'','/FolderMedical/ConsultationForm.aspx?PatDk=fixtureAlpha&ConDk=fixtureConsult');
        GM_setValue('TM_MADEFORMED_TO_WEDA_JOB_V31',{...job,createdAt:Date.now(),updatedAt:Date.now(),status:'consultation_clicked'});
        document.getElementById('fixture-editor').textContent='Texte initial intact';
        window.__fixtureEditorInsertions=0;
        new MutationObserver(()=>{if(document.getElementById('fixture-editor').textContent.includes('Message fictif à transférer'))window.__fixtureEditorInsertions++;}).observe(document.getElementById('fixture-editor'),{childList:true,subtree:true,characterData:true});
    },allowedJob);
    try{await page.evaluate(()=>window.__fixtureApi.runWorker());}
    catch(error){console.error(JSON.stringify({case:'weda-positive',url:page.url(),job:await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_JOB_V31',null)),requests:wedaRequests,editor:await page.locator('#fixture-editor').innerText(),errors}));throw error;}
    await page.waitForFunction(()=>window.__fixtureCloseCalls===1);
    const insertedText=await page.locator('#fixture-editor').innerText();
    assert.equal(insertedText.split('Message fictif à transférer').length-1,1);
    assert.ok(insertedText.includes('Texte initial intact'));
    assert.equal(await page.evaluate(()=>window.__fixtureEditorInsertions),1);
    assert.equal(wedaRequests.filter(x=>x.method==='POST'&&x.path==='/fixture-save').length,1);
    assert.equal(await page.evaluate(()=>window.__fixtureApi.getJob()),null);
    assert.equal(await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_CLOSE_REQUEST_V31',{}).reason),'consultation_saved');
    checks.push('WEDA : parcours positif lié insère une seule fois, enregistre une seule fois et demande une seule fermeture');

    const logs=await page.evaluate(()=>GM_getValue('TM_MADEFORMED_TO_WEDA_LOG_V31',[]));
    assert.equal(JSON.stringify(logs).includes('PATIENT DEMO'),false);
    assert.equal(JSON.stringify(logs).includes('01/02/1980'),false);
    assert.equal(JSON.stringify(logs).includes('PatDk='),false);
    assert.equal(JSON.stringify(logs).includes('Message fictif à transférer'),false);
    checks.push('WEDA : les logs conservés masquent nom, date de naissance, message et URL patient');
    await start('cell-date');
    assert.equal(await page.evaluate(()=>window.__fixtureApi.wedaPatientMatch('PATIENT DEMO','01/02/1980').reason),'unique');
    checks.push('WEDA : DOB lue dans deux cellules adjacentes sans espace HTML ni attribut spécifique');
    network.push(...wedaRequests);await context.close();
}

(async()=>{
    if(!process.argv.includes('--weda-only'))assert.ok(source.includes('function mfmNativeIdentityQuickRead(')||source.includes('async function mfmNativeIdentityQuickRead('),'Version 4.1 avec pipeline identité attendue.');
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
        if(!process.argv.includes('--weda-only'))await madeformedScenarios(browser);
        if(!process.argv.includes('--madeformed-only'))await wedaScenarios(browser);
        assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);assert.equal(network.some(x=>x.blockedOrigin),false);
        console.log(JSON.stringify({result:'OK',source:path.basename(sourcePath),checks,javascriptErrors:errors.length,realNetwork:false,requests:network.length,preview:process.env.MADEFORMED_41_PREVIEW_PATH||null}));
    }finally{await releaseProfiles();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
