'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Playwright sert uniquement à ce test isolé, jamais au userscript installé.
const { chromium } = require(process.env.MADEFORMED_PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'Connecteur-madeformed-vers-weda.user..js'), 'utf8');
let active = 0;
const requests = [];
const errors = [];
const dialogs = [];
const labels = ['Dr Ronez', 'Collaborateur Exemple', 'Infirmière Exemple', 'Dr Secondaire'];
const messaging = '<li class="serv serv-msg"><a class="shortcut" href="/messages"><span class="hide-mobile">Messagerie</span><i class="hide-desktop ri-question-answer-fill"></i><span class="notif-badge-counter msg-counter">7</span></a></li>';
function header() {
    return '<nav class="topbar"><ul class="navbar-left"><li class="serv serv-cal"><a class="shortcut" href="/agenda"><span class="hide-mobile">Agenda</span></a></li>' + (active === 0 ? messaging : ([1,4].includes(active) ? messaging.replace('>7</span>', '>' + (active === 4 ? '13' : '') + '</span>') : '')) + '</ul><div id="navScrollBox"><ul id="envNav">' + labels.map((label, index) => '<li class="choice' + (active === index ? ' active' : '') + '"><a href="' + (active === index ? '#' : '/pros?cabspro=' + index) + '"><div class="avatar-pro" pro-id="' + (42 + index) + '">P</div><span class="pro truncate">' + label + '</span></a></li>').join('') + '</ul></div></nav>';
}
function pageHtml(delayed = false) {
    const bar = header();
    return '<!doctype html><html><head><meta charset="utf-8"></head><body>' + (delayed ? '' : bar) + '<main>Page fictive de vérification</main>' + (delayed ? '<script>setTimeout(()=>document.body.insertAdjacentHTML("afterbegin",' + JSON.stringify(bar) + '),200);</script>' : '') + '<script src="/connector.js"></script></body></html>';
}
(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext();
        await context.setOffline(true);
        await context.addInitScript(() => {
            const listeners = new Map();
            const prefix = 'syntheticGM/';
            window.GM_getValue = (key, fallback) => {
                const raw = localStorage.getItem(prefix + key);
                return raw === null ? fallback : JSON.parse(raw);
            };
            window.GM_setValue = (key, value) => {
                const old = window.GM_getValue(key, null);
                localStorage.setItem(prefix + key, JSON.stringify(value));
                for (const callback of listeners.get(key) || []) callback(key, old, value, false);
            };
            window.GM_deleteValue = key => localStorage.removeItem(prefix + key);
            window.GM_registerMenuCommand = () => {};
            window.GM_addValueChangeListener = (key, callback) => {
                if (!listeners.has(key)) listeners.set(key, []);
                listeners.get(key).push(callback);
            };
            window.addEventListener('storage', event => {
                if (!event.key?.startsWith(prefix)) return;
                const key = event.key.slice(prefix.length);
                for (const callback of listeners.get(key) || []) callback(key,
                    event.oldValue ? JSON.parse(event.oldValue) : null,
                    event.newValue ? JSON.parse(event.newValue) : null, true);
            });
            window.GM_setClipboard = () => {};
            window.GM_openInTab = () => { throw new Error('Ouverture WEDA inattendue'); };
        });
        await context.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== 'https://pro.madeformed.com') return route.abort();
            requests.push({ method: request.method(), path: url.pathname + url.search });
            if (url.pathname === '/connector.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: source });
            if (url.pathname === '/pros') {
                active = Number(url.searchParams.get('cabspro'));
                return route.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace("/agenda" + location.hash)</script>' });
            }
            if (url.pathname === '/messages' && active !== 0) return route.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace("/agenda")</script>' });
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(url.searchParams.has('delay')) });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
        await page.goto('https://pro.madeformed.com/agenda');
        assert.equal(await page.locator('.serv-msg').count(), 1);
        assert.equal(await page.locator('.tm-mf-global-messaging').count(), 0);
        assert.equal(await page.locator('.msg-counter').innerText(), '7');
        for (const user of [1, 2, 3]) {
            await page.goto('https://pro.madeformed.com/pros?cabspro=' + user);
            const added = page.locator('.tm-mf-shared-messaging-link');
            try { await added.waitFor(); } catch (error) { console.log(JSON.stringify({errors,requests,url:page.url(),html:(await page.content()).slice(0,2500),version:await page.locator("#tm-mf-weda-panel").count()})); throw error; }
            assert.equal(await page.locator('.serv-msg').count(), 1);
            assert.equal(new URL(await added.getAttribute('href')).searchParams.get('cabspro'), '0');
            assert.ok(new URL(await added.getAttribute('href')).hash.startsWith('#tm-mf-open-messages='));
            assert.equal(await added.locator('.hide-mobile').innerText(), 'Messagerie');
            assert.equal(await added.locator('.tm-mf-message-counter').innerText(), '7');
            assert.equal(await added.locator('.msg-counter').count(), 0);
            await added.click();
            await page.waitForURL('https://pro.madeformed.com/messages');
            assert.equal(await page.locator('#envNav .choice.active .pro').innerText(), labels[0]);
            assert.equal(await page.locator('.serv-msg').count(), 1);
            assert.equal(await page.locator('.tm-mf-global-messaging').count(), 0);
            assert.equal(await page.locator('.msg-counter').innerText(), '7');
            assert.equal(await page.evaluate(() => sessionStorage.getItem('TM_MADEFORMED_MESSAGING_NAV_V1')), null);
        }
        labels.push('Futur utilisateur avec messagerie', 'Futur utilisateur sans messagerie');
        for (const user of [4,5]) {
            await page.goto('https://pro.madeformed.com/pros?cabspro=' + user);
            const link = page.locator('.tm-mf-shared-messaging-link');
            await link.waitFor();
            assert.equal(await link.locator('.tm-mf-message-counter').innerText(), '7');
            assert.equal(await page.locator('.serv-msg').count(), 1);
            await link.click();
            await page.waitForURL('https://pro.madeformed.com/messages');
        }
        const primary = await context.newPage();
        await primary.goto('https://pro.madeformed.com/pros?cabspro=0');
        await primary.locator('.serv-msg .msg-counter').waitFor();
        await page.goto('https://pro.madeformed.com/pros?cabspro=2');
        await page.locator('.tm-mf-message-counter').waitFor();
        await primary.locator('.serv-msg .msg-counter').evaluate(node => {node.textContent = '3';});
        await page.waitForFunction(() => document.querySelector('.tm-mf-message-counter')?.textContent === '3');
        assert.equal(active, 2);
        await primary.locator('.serv-msg .msg-counter').evaluate(node => {node.textContent = '';});
        await page.waitForFunction(() => document.querySelector('.tm-mf-message-counter')?.textContent === '');
        await primary.locator('.serv-msg .msg-counter').evaluate(node => {node.textContent = '7';});
        await page.waitForFunction(() => document.querySelector('.tm-mf-message-counter')?.textContent === '7');
        await primary.close();
        active = 2;
        const replacement = header();
        await page.evaluate(html => { document.querySelector('nav.topbar').outerHTML = html; }, replacement);
        await page.locator('.tm-mf-shared-messaging-link').waitFor();
        assert.equal(await page.locator('.serv-msg').count(), 1);
        await page.evaluate(html => { document.querySelector('.navbar-left').insertAdjacentHTML('beforeend', html); }, messaging);
        await page.waitForFunction(() => !document.querySelector('.tm-mf-global-messaging'));
        assert.equal(await page.locator('.serv-msg').count(), 1);
        assert.equal(await page.locator('.tm-mf-message-counter').innerText(), '7');
        active = 2;
        await page.goto('https://pro.madeformed.com/agenda?delay=1');
        await page.locator('.tm-mf-shared-messaging-link').waitFor();
        assert.equal(await page.locator('.serv-msg').count(), 1);
        await page.goto('https://pro.madeformed.com/pros?cabspro=1');
        await page.locator('.tm-mf-shared-messaging-link').waitFor();
        active = 0;
        await page.evaluate(html => {
            const next = new DOMParser().parseFromString(html, 'text/html').querySelector('#envNav');
            document.querySelector('#envNav').replaceWith(next);
        }, header());
        await page.waitForFunction(() => document.querySelector('.serv-msg a')?.getAttribute('href') === '/messages' && !document.querySelector('.tm-mf-shared-messaging-link'));
        assert.equal(await page.locator('.serv-msg .msg-counter').count(), 1);
        active = 1;
        await page.evaluate(html => {
            const next = new DOMParser().parseFromString(html, 'text/html').querySelector('#envNav');
            document.querySelector('#envNav').replaceWith(next);
        }, header());
        await page.locator('.tm-mf-shared-messaging-link').waitFor();
        assert.equal(await page.locator('.tm-mf-message-counter').innerText(), '7');
        await page.evaluate(() => { Object.defineProperty(window.sessionStorage, 'setItem', {value:() => {throw new Error('Stockage indisponible fictif');}}); });
        await page.locator('.tm-mf-shared-messaging-link').click();
        await page.waitForURL('https://pro.madeformed.com/messages');
        assert.equal(active, 0);
        assert.equal(dialogs.length, 0);
        assert.equal(new URL(page.url()).hash, '');
        const fresh = await browser.newContext();
        await fresh.setOffline(true);
        // Poste neuf : aucun compteur mémorisé ; toutes les lectures/écritures sessionStorage échouent.
        await fresh.addInitScript(() => {
            const storage = new Map();
            window.GM_getValue = (key, fallback) => storage.get(key) ?? fallback;
            window.GM_setValue = (key, value) => storage.set(key, value);
            window.GM_deleteValue = key => storage.delete(key);
            window.GM_registerMenuCommand = () => {};
            window.GM_addValueChangeListener = () => {};
            for (const method of ['getItem', 'setItem', 'removeItem']) {
                Object.defineProperty(window.sessionStorage, method, {value:() => {throw new Error('Session bloquée fictive');}});
            }
        });
        let freshActive = 0;
        const freshLabels = ['Collaborateur Exemple', 'Infirmière Exemple', 'Dr Ronez', 'Futur utilisateur'];
        function freshHeader(includeMessage = true) {
            const native = (freshActive === 0 || freshActive === 2) && includeMessage
                ? messaging.replace('>7</span>', freshActive === 2 ? '>6</span>' : '></span>') : '';
            return '<nav class="topbar"><ul class="navbar-left"><li class="serv serv-cal"><a href="/agenda">Agenda</a></li>' + native + '</ul><ul id="envNav">' + freshLabels.map((label, index) =>
                '<li class="choice' + (freshActive === index ? ' active' : '') + '"><a href="' + (freshActive === index ? '#' : '/pros?cabspro=' + index) + '"><div pro-id="' + (80 + index) + '"></div><span class="pro">' + label + '</span><span class="cab">Cabinet Exemple</span></a></li>').join('') + '</ul></nav>';
        }
        let slowHeader = false;
        await fresh.route('**/*', async route => {
            const url = new URL(route.request().url());
            requests.push({method:route.request().method(), path:url.pathname + url.search});
            if (url.origin !== 'https://pro.madeformed.com') return route.abort();
            if (url.pathname === '/connector.js') return route.fulfill({status:200, contentType:'application/javascript', body:source});
            if (url.pathname === '/pros') {
                freshActive = Number(url.searchParams.get('cabspro'));
                return route.fulfill({status:200, contentType:'text/html', body:'<script>location.replace("/agenda" + location.hash)</script>'});
            }
            if (url.pathname === '/messages' && freshActive !== 2) return route.fulfill({status:200, contentType:'text/html', body:'<script>location.replace("/agenda" + location.hash)</script>'});
            const delayed = slowHeader && freshActive === 2 && url.pathname === '/agenda';
            const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + freshHeader(!delayed) + '<main>Page fictive</main><script src="/connector.js"></script>' +
                (delayed ? '<script>setTimeout(()=>document.querySelector(".navbar-left").insertAdjacentHTML("beforeend",' + JSON.stringify(messaging.replace('>7</span>', '>6</span>')) + '),250)</script>' : '') + '</body></html>';
            return route.fulfill({status:200, contentType:'text/html', body:html});
        });
        const freshPage = await fresh.newPage();
        freshPage.setDefaultTimeout(10000);
        freshPage.on('pageerror', error => errors.push(error.message));
        freshPage.on('dialog', async dialog => {dialogs.push(dialog.message()); await dialog.accept();});
        await freshPage.goto('https://pro.madeformed.com/agenda');
        await freshPage.locator('.tm-mf-shared-messaging-link').waitFor();
        const portableHref = await freshPage.locator('.tm-mf-shared-messaging-link').getAttribute('href');
        assert.equal(new URL(portableHref).searchParams.get('cabspro'), '2');
        assert.equal(await freshPage.locator('.tm-mf-message-counter').innerText(), '…');
        await freshPage.locator('.tm-mf-shared-messaging-link').click();
        await freshPage.waitForURL('https://pro.madeformed.com/messages');
        assert.equal(freshActive, 2);
        assert.equal(await freshPage.locator('#envNav .choice.active .pro').innerText(), 'Dr Ronez');
        assert.equal(await freshPage.locator('.msg-counter').innerText(), '6');
        // Le même lien fonctionne dans un nouvel onglet, sans clic préparant une session.
        const newTab = await fresh.newPage();
        newTab.on('pageerror', error => errors.push(error.message));
        await newTab.goto(portableHref);
        await newTab.waitForURL('https://pro.madeformed.com/messages');
        assert.equal(await newTab.locator('#envNav .choice.active .pro').innerText(), 'Dr Ronez');
        await newTab.close();
        await freshPage.goto('https://pro.madeformed.com/pros?cabspro=3');
        await freshPage.locator('.tm-mf-shared-messaging-link').waitFor();
        slowHeader = true;
        await freshPage.locator('.tm-mf-shared-messaging-link').click();
        await freshPage.waitForURL('https://pro.madeformed.com/messages');
        assert.equal(await freshPage.locator('#envNav .choice.active .pro').innerText(), 'Dr Ronez');
        assert.equal(new URL(freshPage.url()).hash, '');
        assert.equal(dialogs.length, 0);
        await fresh.close();
        assert.deepEqual(errors, []);
        assert.equal(requests.some(request => request.path.startsWith('/messages/count')), false);
        assert.equal(requests.some(request => request.method !== 'GET'), false);
        console.log(JSON.stringify({result:'OK', simulatedUsers:10, browserProfiles:2, checks:['bouton natif et compteur conservés','bascule vers la messagerie principale depuis trois autres utilisateurs','remplacement dynamique de la barre','apparition tardive de la barre','suppression du doublon quand le bouton natif revient','stockage de session bloqué sans interrompre la navigation','nombre partagé depuis la page principale','actualisation entre deux onglets','zéro natif partagé','aucune lecture de /messages/count dans les autres rôles','bouton natif secondaire comme Madoz','deux futurs utilisateurs ajoutés sans modification du script','restauration du bouton natif principal après changement dynamique','ordinateur neuf sans compteur mémorisé','Dr Ronez au rang 2 après un utilisateur au rang 0','redirection conservant la demande','lien ouvert dans un nouvel onglet','bouton natif principal tardif'], javascriptErrors:errors.length, writes:0}));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
