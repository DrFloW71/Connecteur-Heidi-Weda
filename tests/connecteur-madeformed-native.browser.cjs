'use strict';

// Navigateur neuf, hors ligne ; toutes les pages et requêtes sont des fixtures synthétiques.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.MADEFORMED_PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname,'..','scripts','Connecteur-madeformed-vers-weda.user..js'),'utf8');
const rdvOnly = process.argv.includes('--rdv-only');
const origin = 'https://pro.madeformed.com';
const requests = [], errors = [], dialogs = [];
const checks = [];
let documentMode = 'cards';
let nextDocumentId = 6000;
const persistedDocuments = new Map();

function header() {
    return '<nav class="topbar"><ul class="navbar-left"><li class="serv serv-cal"><a href="/agenda">Agenda</a></li><li class="serv serv-msg"><a href="/messages"><span class="hide-mobile">Messagerie</span><span class="notif-badge-counter msg-counter">7</span></a></li></ul>' +
        '<ul id="envNav"><li class="choice active" title="Praticien Démo - Cabinet Démo"><a href="#"><div pro-id="501"></div><span class="pro">Dr Ronez</span><span class="cab">Cabinet Démo</span></a></li></ul></nav>';
}

function messageRow(id, uid, hour, channel = 'svi', extra = '') {
    const search = uid ? '/agenda?target=user-detail&amp;uid=' + uid : '/agenda?target=user-search&amp;field=tel&amp;value=0102030405';
    const conflictLink = id === '9401' ? '/agenda?target=user-detail&amp;uid=102' : search;
    return '<tr class="user-message" data-id="' + id + '" data-user_id="' + uid + '" data-name="' + (uid ? 'PATIENT DEMO' : 'FAMILLE EXEMPLE') +
        '" data-phone="0102030405" data-mod="Message"><td><input type="checkbox" class="native-select"></td>' +
        '<td class="expediteur"><span class="name">' + (uid ? 'PATIENT DEMO' : 'FAMILLE EXEMPLE') + '</span></td>' +
        '<td><span class="date">07/10/2026</span><span class="hour">' + hour + '</span></td>' +
        '<td class="content"><span class="msg-canal" data-canal="' + channel + '">' + channel + '</span><div class="transcription">Message fictif</div>' + extra + '</td>' +
        '<td class="action"><div class="flex"><a class="search ds-btn" href="' + conflictLink + '">Fiche</a></div></td></tr>';
}

function mainPage() {
    return shell(
        '<main><table id="messages"><tbody>' +
        messageRow('9101','101','14:03') + messageRow('9102','101','14:08') + messageRow('9103','101','14:12') + messageRow('9104','101','14:18') +
        messageRow('9201','102','14:20','web') + messageRow('9301','','14:21','web') + messageRow('9401','101','14:22','web') +
        '</tbody></table><div id="agenda"><div class="rdv" data-id="8001" data-user-id="101" data-debut="2026-10-15 14:30"><div class="user-infos"><span class="nom">PATIENT DEMO</span></div><span class="rdv-icons"></span></div></div></main>'
    );
}

function shell(body, script = '') {
    return '<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;margin:8px}nav{height:36px}nav ul{display:flex;list-style:none;gap:12px;padding:0;margin:0}.cab{display:none}table{width:95%;border-collapse:collapse}td{padding:5px;border-bottom:1px solid #ddd}.expediteur{min-width:220px}.content{min-width:220px}.action{min-width:220px}.date,.hour{display:block}#infos{min-height:700px}.user-detail{padding:14px}.panel{background:#fff}.new-rdv.panel{display:none}.new-rdv.panel.active{display:block}button,input{font:14px Arial}.native-file{display:block;margin:12px}.file{padding:5px}.icoformed-calendar-new-line::before{content:"📅"}</style></head><body>' +
        header() + body + (script ? '<script>' + script + '</script>' : '') + '<script src="/connector.js"></script></body></html>';
}

function searchPage() {
    return shell('<div id="infos"><div class="user-search active"><div id="users-result">' + ['103','104'].map((uid,index) =>
        '<div class="user preview" data-user-id="' + uid + '" data-user-name="FAMILLE EXEMPLE"><div class="user-name"><span class="nom">FAMILLE</span> <span class="prenom">EXEMPLE</span></div>' +
        '<div class="identite-contacts"><a data-tel="0102030405">Téléphone fictif</a></div><div class="identite-infos">Fiche de test ' + (index+1) + '</div></div>'
    ).join('') + '</div></div></div>');
}

function profilePage(uid) {
    const history = '<div id="user-history"><div class="history-group futur">' +
        '<div class="rdv preview" data-rdv-id="8001" data-debut="2026-10-15 14:30"><div class="planning"><span class="effecteur">Praticien Démo</span><span class="acte">Consultation fictive</span></div></div>' +
        '<div class="rdv preview" data-rdv-id="8002" data-debut="2026-10-20 15:00"><div class="planning"><span class="effecteur">Praticien Démo</span><span class="acte">Consultation fictive</span></div></div>' +
        '<div class="rdv preview" data-rdv-id="8003" data-debut="2026-10-14 10:00" data-status="Annulée"><div class="planning"></div></div></div></div>';
    const docs = '<div id="user-docs" class="files-container is-loaded"><div class="files">' +
        '<div class="file" data-id="5900" data-url="/users/' + uid + '/docs/5900" title="ancien-exemple.txt"><span class="file-name">ancien-exemple.txt</span></div>' +
        (persistedDocuments.get(uid) || []).map(doc => '<div class="file" data-id="' + doc.id + '" data-url="/users/' + uid + '/docs/' + doc.id + '"><span class="file-name">' + doc.name + '</span></div>').join('') + '</div>' +
        '<form action="/users/' + uid + '/docs" method="post" enctype="multipart/form-data"><div class="file-drop-area" data-step="waiting">' +
        '<input class="native-file" type="file" name="files[]" multiple max-size="52428800"></div></form></div>';
    const form = '<div class="new-rdv panel"><form action="/rdvs" method="post"><div id="newRdvUsers"><input class="patient-input" name="data[Rdv][user_id]" value="' + uid + '"></div>' +
        '<input name="data[Rdv][date]" value="20/10/2026"><input name="data[Rdv][time]" value="15:00"><button class="native-save-rdv" type="submit">Enregistrer le RDV</button></form></div>';
    const body = '<div id="infos"><div class="user-detail panel active" data-user-id="' + uid + '"><div class="user-name"><span class="nom">PATIENT</span> <span class="prenom">DEMO</span></div>' +
        '<a class="sc-btn" href="#user-history">Historique</a><a class="sc-btn" href="#user-docs">Documents</a><a class="new-rdv" data-user-id="' + uid + '" href="#">Ajouter un rendez-vous</a>' +
        history + docs + '</div>' + form + '</div>';
    const script = [
        'const fixtureUid=' + JSON.stringify(uid) + ',fixtureMode=' + JSON.stringify(documentMode) + ';',
        'document.querySelectorAll("a.sc-btn").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();document.querySelector(a.getAttribute("href")).classList.add("active");}));',
        'document.querySelector("a.new-rdv").addEventListener("click",e=>{e.preventDefault();document.querySelector(".new-rdv.panel").classList.add("active");});',
        'document.querySelector(".new-rdv form").addEventListener("submit",e=>{e.preventDefault();const xhr=new XMLHttpRequest();xhr.open("POST","/rdvs");xhr.addEventListener("load",()=>document.querySelector(".new-rdv.panel").classList.remove("active"));xhr.send(new FormData(e.currentTarget));});',
        'const nativeInput=document.querySelector("#user-docs input");',
        'nativeInput.addEventListener("change",()=>{const form=nativeInput.closest("form"),xhr=new XMLHttpRequest();xhr.open("POST",form.getAttribute("action"));xhr.addEventListener("load",()=>{',
        'if(fixtureMode!=="cards")return;const response=JSON.parse(xhr.responseText);for(const doc of response.documents||[]){const card=document.createElement("div");card.className="file";card.dataset.id=doc.id;card.dataset.url="/users/"+fixtureUid+"/docs/"+doc.id;card.title=doc.name;const name=document.createElement("span");name.className="file-name";name.textContent=doc.name;card.append(name);document.querySelector("#user-docs .files").append(card);}});xhr.send(new FormData(form));});'
    ].join('\n');
    return shell(body, script);
}

function countRequests(predicate) { return requests.filter(predicate).length; }
function profileReads(uid) { return countRequests(x => x.method === 'GET' && x.path === '/agenda?target=user-detail&uid=' + uid); }
function docPosts() { return requests.filter(x => x.method === 'POST' && /^\/users\/[1-9]\d*\/docs$/.test(x.path)); }

(async () => {
    const browser = await chromium.launch({channel:'msedge',headless:true});
    try {
        const context = await browser.newContext({viewport:{width:1600,height:1300},timezoneId:'America/Los_Angeles'});
        await context.setOffline(true);
        await context.addInitScript(() => {
            const RealDate = Date, started = RealDate.now();
            let advance = 0;
            class FixtureDate extends RealDate {
                constructor(...args) { super(...(args.length ? args : [FixtureDate.now()])); }
                static now() { return RealDate.parse('2026-10-07T12:00:00Z') + RealDate.now() - started + advance; }
            }
            window.Date = FixtureDate;
            window.__fixtureAdvanceClock = ms => { advance += ms; };
            window.__fixtureWedaOpens = 0;
            const listeners = new Map(), prefix = 'nativeFixtureGM/';
            window.GM_getValue = (key,fallback) => {const raw=localStorage.getItem(prefix+key);return raw===null?fallback:JSON.parse(raw);};
            window.GM_setValue = (key,value) => {
                const old=window.GM_getValue(key,null);localStorage.setItem(prefix+key,JSON.stringify(value));
                for(const cb of listeners.get(key)||[]) cb(key,old,value,false);
            };
            window.GM_deleteValue = key => localStorage.removeItem(prefix+key);
            window.GM_addValueChangeListener = (key,cb) => {if(!listeners.has(key))listeners.set(key,[]);listeners.get(key).push(cb);};
            window.GM_registerMenuCommand = () => {};
            window.GM_setClipboard = () => {};
            window.GM_openInTab = () => {window.__fixtureWedaOpens++;throw new Error('Ouverture WEDA inattendue pendant une action native');};
        });
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin !== origin) return route.abort();
            const entry = {method:request.method(),path:url.pathname+url.search};
            if (request.method() === 'POST') entry.body = request.postData() || '';
            requests.push(entry);
            if (url.pathname === '/connector.js') return route.fulfill({status:200,contentType:'application/javascript',body:source});
            if (request.method() === 'POST' && /^\/users\/[1-9]\d*\/docs$/.test(url.pathname)) {
                const names = [...entry.body.matchAll(/filename="([^"]+)"/g)].map(x => x[1]);
                const documents = names.map(name=>({id:String(++nextDocumentId),name}));
                if (documentMode === 'cards') {
                    const uid = url.pathname.split('/')[2];
                    persistedDocuments.set(uid, [...(persistedDocuments.get(uid) || []), ...documents]);
                }
                return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
                    success:true,documents
                })});
            }
            if (request.method() === 'POST' && url.pathname === '/rdvs') return route.fulfill({status:200,contentType:'application/json',body:'{"success":true}'});
            if (request.method() !== 'GET') throw new Error('Écriture inattendue : '+entry.path);
            if (url.pathname === '/tasks') return route.fulfill({status:200,contentType:'text/html',body:'<div class="task-list"></div>'});
            if (url.pathname === '/agenda' && url.searchParams.get('target') === 'user-detail') return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:profilePage(url.searchParams.get('uid'))});
            if (url.pathname === '/agenda' && url.searchParams.get('target') === 'user-search') return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:searchPage()});
            return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:url.pathname === '/messages' ? mainPage() : shell('<main>Agenda synthétique</main>')});
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror',error=>errors.push(error.message));
        page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
        await page.goto(origin+'/messages');
        const first = page.locator('#messages tr.user-message[data-id="9101"]');
        await page.waitForFunction(() => document.querySelector('#messages tr[data-id="9101"] .tm-mf-native-next')?.textContent === 'Prochain RDV : 15/10 à 14:30');
        assert.equal(await page.locator('#agenda .tm-mf-native-next-agenda').innerText(),'→ 20/10 15:00');
        assert.equal(await first.locator('[data-action="rdv"]').count(),1);
        assert.equal(await first.locator('[data-action="document"]').count(),1);
        assert.equal(await page.locator('.tm-mf-native-action').count(),14);
        assert.equal(profileReads('101'),1);
        // Plusieurs mutations et lectures du même patient ne doivent pas ouvrir d'autres fiches avant 60 s.
        await page.evaluate(() => {document.body.append(document.createElement('aside'));window.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('focus'));});
        await page.waitForFunction(() => document.querySelector('#messages tr[data-id="9301"] .tm-mf-native-next')?.textContent === 'Prochain RDV : choisir le patient');
        assert.equal(profileReads('101'),1);
        assert.equal(await page.locator('#messages tr[data-id="9401"] .tm-mf-native-next').innerText(),'Prochain RDV : choisir le patient');
        assert.equal(await page.locator('#messages tr[data-id="9401"] [data-action="rdv"]').isDisabled(),true);
        assert.equal(requests.some(x=>x.method==='POST'),false);
        checks.push('prochain RDV message et agenda avec exclusion du RDV courant','cache partagé 60 s sans nouvelle lecture avant expiration','identité ambiguë ou contradictoire sans dossier choisi');

        // Le formulaire reste natif, son patient est contrôlé et seul un clic humain synthétique crée le POST.
        await first.locator('[data-action="rdv"]').click();
        await page.locator('.tm-mf-native-rdv-only').waitFor();
        const rdv = page.frameLocator('.tm-mf-native-rdv-only iframe');
        assert.equal(await rdv.locator('#newRdvUsers input.patient-input').inputValue(),'101');
        assert.equal(countRequests(x=>x.method==='POST'&&x.path==='/rdvs'),0);
        await page.keyboard.press('PageDown');
        assert.equal(await page.evaluate(()=>window.__fixtureWedaOpens),0);
        await rdv.locator('.native-save-rdv').click();
        await page.waitForFunction(() => !document.querySelector('.tm-mf-native-rdv-only'));
        assert.equal(countRequests(x=>x.method==='POST'&&x.path==='/rdvs'),1);
        checks.push('Ajouter un RDV préselectionne le patient dans le formulaire natif','aucun enregistrement RDV avant un clic explicite','PageDown et clic natif ne lancent pas WEDA');

        // La recherche ambiguë présente deux choix explicites et préselectionne uniquement celui choisi.
        await page.locator('#messages tr[data-id="9301"] [data-action="rdv"]').click();
        try { await page.locator('.tm-mf-native-choices:not([hidden]) .tm-mf-native-choice').first().waitFor(); }
        catch(error) { console.error(JSON.stringify({errors,requests:requests.slice(-15),overlays:await page.locator('.tm-mf-native-overlay').evaluateAll(nodes=>nodes.map(x=>({html:x.outerHTML.slice(0,1800),style:getComputedStyle(x).display,rect:x.getBoundingClientRect().toJSON()}))),frames:page.frames().map(f=>f.url()),row:await page.locator('#messages tr[data-id="9301"]').innerText()})); throw error; }
        assert.equal(await page.locator('.tm-mf-native-choice').count(),2);
        await page.locator('.tm-mf-native-choice').first().click();
        await page.locator('.tm-mf-native-rdv-only').waitFor();
        assert.equal(await page.frameLocator('.tm-mf-native-rdv-only iframe').locator('#newRdvUsers input.patient-input').inputValue(),'103');
        await page.locator('.tm-mf-native-rdv-only .tm-mf-native-close').click();
        assert.equal(countRequests(x=>x.method==='POST'&&x.path==='/rdvs'),1);
        checks.push('choix manuel requis pour deux patients possibles, sans création automatique');

        if (!rdvOnly) {
            // Deux fichiers, un seul change natif, un POST XHR/FormData et de vraies cartes .file.
            documentMode = 'cards';
            const chooserEvent = page.waitForEvent('filechooser');
            await first.locator('[data-action="document"]').click();
            const chooser = await chooserEvent;
            await chooser.setFiles([
                {name:'document-exemple.txt',mimeType:'text/plain',buffer:Buffer.from('Document fictif sans donnée patient')},
                {name:'document-exemple.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFixture uniquement')}
            ]);
            try { await page.waitForFunction(() => document.querySelector('#messages tr[data-id="9101"] .tm-mf-native-action-status')?.dataset.state === 'success'); }
            catch(error) { console.error(JSON.stringify({errors,posts:docPosts(),status:await first.locator('.tm-mf-native-action-status').innerText(),frames:await Promise.all(page.frames().slice(1).map(async frame=>({url:frame.url(),profile:await frame.locator('.user-detail.active').getAttribute('data-user-id').catch(()=>null),docs:await frame.locator('#user-docs').innerText().catch(()=>null)})))})); throw error; }
            assert.equal(docPosts().length,1);
            assert.equal(docPosts()[0].path,'/users/101/docs');
            assert.match(docPosts()[0].body,/filename="document-exemple\.txt"/);
            assert.match(docPosts()[0].body,/filename="document-exemple\.pdf"/);
            assert.match(await first.locator('.tm-mf-native-action-status').innerText(),/2 documents envoyés/);
            checks.push('envoi multiple via input natif et XHR FormData','confirmation par nouvelles cartes natives du bon dossier');

            // Réseau réussi mais aucune carte : jamais de confirmation ni de retransmission.
            documentMode = 'network-only';
            const second = page.locator('#messages tr[data-id="9201"]');
            const uncertainChooserEvent = page.waitForEvent('filechooser');
            await second.locator('[data-action="document"]').click();
            const uncertainChooser = await uncertainChooserEvent;
            await uncertainChooser.setFiles({name:'document-incertain.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture de résultat incertain')});
            await page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/users/102/docs');
            await page.evaluate(()=>window.__fixtureAdvanceClock(100000));
            await second.locator('.tm-mf-native-action-status button').waitFor();
            assert.match(await second.locator('.tm-mf-native-action-status').innerText(),/vérifier/i);
            assert.notEqual(await second.locator('.tm-mf-native-action-status').getAttribute('data-state'),'success');
            assert.equal(docPosts().length,2);
            await second.locator('.tm-mf-native-action-status button').click();
            await page.locator('.tm-mf-native-overlay:not([hidden])').waitFor();
            assert.equal(await page.frameLocator('.tm-mf-native-overlay:not([hidden]) iframe').locator('.user-detail.active').getAttribute('data-user-id'),'102');
            assert.equal(docPosts().length,2);

            assert.equal(await page.frameLocator('.tm-mf-native-overlay:not([hidden]) iframe').locator('#user-docs input[type="file"]').isDisabled(),true);
            await page.locator('.tm-mf-native-overlay:not([hidden]) .tm-mf-native-close').last().click();
            assert.equal(docPosts().length,2);
            // Le journal minimal restaure uniquement la vérification, jamais le transfert de fichiers.
            await page.reload();
            const restoredSecond = page.locator('#messages tr[data-id="9201"]');
            await restoredSecond.locator('.tm-mf-native-action-status button').waitFor();
            assert.match(await restoredSecond.locator('.tm-mf-native-action-status').innerText(),/précédent.*vérifier/i);
            await restoredSecond.locator('[data-action="document"]').click();
            await page.locator('.tm-mf-native-overlay:not([hidden])').waitFor();
            assert.equal(await page.frameLocator('.tm-mf-native-overlay:not([hidden]) iframe').locator('#user-docs input[type="file"]').isDisabled(),true);
            assert.equal(docPosts().length,2);
            await page.locator('.tm-mf-native-overlay:not([hidden]) .tm-mf-native-close').last().click();
            checks.push('succès réseau sans carte reste incertain','Vérifier consulte le dossier en lecture seule sans second POST','rechargement restaure une vérification manuelle sans retransmission');


            assert.ok(source.includes('function mfmGroupCallsSetup()'), 'Module de regroupement attendu dans le principal.');
            await page.locator('.tm-mf-call-group-head').waitFor();
            assert.match(await page.locator('.tm-mf-call-group-head strong').innerText(),/4 appels successifs.*14:03–14:18/);
            if (process.env.MADEFORMED_NATIVE_PREVIEW_PATH) {
                await page.waitForFunction(() => document.querySelector('#messages tr[data-id="9101"] .tm-mf-native-next')?.textContent === 'Prochain RDV : 15/10 à 14:30');
                await page.evaluate(() => {
                    const notice=document.createElement('p');notice.className='fixture-notice';
                    notice.textContent='APERÇU DE TEST — Tous les patients, messages et documents de cette image sont fictifs.';
                    notice.style.cssText='background:#f3e8ff;border:1px solid #c084fc;padding:10px;color:#581c87;font-weight:bold;';
                    document.querySelector('main').prepend(notice);
                });
                const previewStyle = await page.addStyleTag({content:'#tm-mf-weda-panel{visibility:hidden!important}'});
                await page.locator('main').screenshot({path:process.env.MADEFORMED_NATIVE_PREVIEW_PATH});
                await previewStyle.evaluate(node=>node.remove());
            }

            assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),3);
            assert.equal(await page.locator('#messages tr.user-message').count(),7);
            await page.locator('.tm-mf-call-group-head button').click();
            assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),0);
            await page.locator('.tm-mf-call-group-head button').click();
            assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),3);
            // Un brouillon dans un appel qui serait masqué garde les quatre appels visibles.
            await page.locator('#messages tr[data-id="9103"] textarea').evaluate(node => {node.value='Brouillon fictif';node.dispatchEvent(new Event('input',{bubbles:true}));});
            await page.waitForFunction(()=>document.querySelectorAll('.tm-mf-call-group-hidden').length===0);
            assert.equal(await page.locator('.tm-mf-call-group-head button').isDisabled(),true);
            await page.locator('#messages tr[data-id="9103"] textarea').evaluate(node => {node.value='';node.dispatchEvent(new Event('input',{bubbles:true}));});
            await page.locator('.tm-mf-call-group-hidden').first().waitFor({state:'attached'});
            await page.evaluate(()=>{location.hash='#tm-mf-message=9104';});
            await page.waitForFunction(()=>document.querySelectorAll('.tm-mf-call-group-hidden').length===0);
            await page.evaluate(()=>{location.hash='';});
            assert.equal(await page.locator('#messages tr[data-id="9104"].tm-mf-consignes-highlight').count(),1);
            assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),0);
            await page.locator('#tm-mf-weda-head').click();
            await page.locator('#tm-mf-weda-group-calls').click();
            assert.equal(await page.locator('#tm-mf-weda-group-calls').innerText(),'Regrouper les appels OFF');
            assert.equal(await page.locator('.tm-mf-call-group-hidden').count(),0);
            assert.equal(await page.locator('.tm-mf-call-group-head').count(),0);
            assert.equal(await page.locator('#messages tr.user-message').count(),7);
            checks.push('quatre appels SVI repliés dans la fenêtre de 30 min sans supprimer les messages','brouillon et message lié protégés','Regrouper les appels OFF restitue toutes les lignes');

            // Cas sensible : ligne sans UID, deux patients possibles et un transfert déjà incertain.
            documentMode = 'network-only';
            const family = page.locator('#messages tr[data-id="9301"]');
            const familyChooserEvent = page.waitForEvent('filechooser');
            await family.locator('[data-action="document"]').click();
            const familyChooser = await familyChooserEvent;
            await familyChooser.setFiles({name:'document-famille-incertain.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture familiale ambiguë, sans donnée réelle')});
            const familyChoices = page.locator('.tm-mf-native-document-chooser .tm-mf-native-choice');
            await familyChoices.first().waitFor();
            assert.equal(await familyChoices.count(),2);
            assert.equal(docPosts().length,2);
            await familyChoices.nth(0).click(); // UID 103 choisi explicitement.
            await page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/users/103/docs');
            await page.evaluate(()=>window.__fixtureAdvanceClock(100000));
            await family.locator('.tm-mf-native-action-status button').waitFor();
            assert.match(await family.locator('.tm-mf-native-action-status').innerText(),/vérifier/i);
            assert.equal(docPosts().length,3);
            assert.equal(docPosts()[2].path,'/users/103/docs');
            await page.reload();

            const restoredFamily = page.locator('#messages tr[data-id="9301"]');
            await restoredFamily.locator('.tm-mf-native-action-status button').waitFor();
            assert.match(await restoredFamily.locator('.tm-mf-native-action-status').innerText(),/précédent.*vérifier/i);
            const lockedProfileReads = profileReads('103');
            const otherProfileReads = profileReads('104');
            await restoredFamily.locator('[data-action="document"]').click();
            try { await familyChoices.first().waitFor(); }
            catch(error) { console.error(JSON.stringify({case:'choix-restaure',errors,requests:requests.slice(-12),status:await restoredFamily.locator('.tm-mf-native-action-status').innerText(),frames:page.frames().map(frame=>frame.url()),overlays:await page.locator('.tm-mf-native-overlay').evaluateAll(nodes=>nodes.map(node=>({hidden:node.hidden,text:node.textContent.slice(0,200)})))})); throw error; }
            assert.equal(await familyChoices.count(),2);
            assert.equal(profileReads('103'),lockedProfileReads,'Aucune fiche verrouillée ne doit être ouverte avant le choix après reload.');
            assert.equal(docPosts().length,3);
            await familyChoices.nth(1).click(); // UID 104 : différent de celui de l’envoi précédent.
            await page.waitForFunction(()=>document.querySelector('#messages tr[data-id="9301"] .tm-mf-native-action-status')?.textContent.includes('Vérification indisponible'));
            assert.equal(profileReads('104'),otherProfileReads,'Le mauvais choix doit être refusé avant ouverture de sa fiche.');
            assert.equal(profileReads('103'),lockedProfileReads);
            assert.equal(docPosts().length,3);
            assert.equal(await page.locator('.tm-mf-native-overlay:not([hidden])').count(),0);
            const journalAfterRefusal = await page.evaluate(()=>GM_getValue('TM_MADEFORMED_DOCUMENT_PENDING_V1',{}));
            assert.ok(Object.values(journalAfterRefusal).some(record=>record.uid==='103'),'Le refus ne doit pas libérer le verrou de l’envoi incertain.');

            // La vérification reste disponible ; cette fois l’utilisateur confirme le dossier 103.
            await restoredFamily.locator('.tm-mf-native-action-status button').click();
            await familyChoices.first().waitFor();
            assert.equal(await familyChoices.count(),2);
            await familyChoices.nth(0).click();
            await page.locator('.tm-mf-native-overlay:not([hidden])').waitFor();
            const verifiedFamily = page.frameLocator('.tm-mf-native-overlay:not([hidden]) iframe');
            assert.equal(await verifiedFamily.locator('.user-detail.active').getAttribute('data-user-id'),'103');
            assert.equal(await verifiedFamily.locator('#user-docs input[type="file"]').isDisabled(),true);
            assert.equal(profileReads('104'),otherProfileReads);
            assert.equal(docPosts().length,3);
            await page.locator('.tm-mf-native-overlay:not([hidden]) .tm-mf-native-close').last().click();
            assert.equal(docPosts().length,3);
            checks.push('ligne sans UID : choix explicite avant le premier envoi','après reload un nouveau choix est obligatoire avant ouverture du dossier verrouillé','mauvais patient refusé sans fiche ni retransmission et verrou conservé','nouveau choix correct ouvre seulement le dossier verrouillé en lecture seule');

        }
        assert.equal(await page.evaluate(()=>window.__fixtureWedaOpens),0);
        assert.deepEqual(errors,[]);
        assert.deepEqual(dialogs,[]);
        assert.equal(requests.some(x=>x.path.startsWith('/messages/count')),false);
        assert.equal(requests.some(x=>x.method==='POST'&&!/^\/users\/[1-9]\d*\/docs$/.test(x.path)&&x.path!=='/rdvs'),false);
        console.log(JSON.stringify({result:'OK',mode:rdvOnly?'RDV':'complet',checks,javascriptErrors:errors.length,wedaOpened:0,
            nativeAppointmentSaves:countRequests(x=>x.method==='POST'&&x.path==='/rdvs'),documentPosts:docPosts().length,realNetwork:false,preview:process.env.MADEFORMED_NATIVE_PREVIEW_PATH||null}));
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
