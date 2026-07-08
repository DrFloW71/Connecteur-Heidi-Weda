// ==UserScript==
// @name         Heidi - Scraper sessions pour dataset SFT médical
// @namespace    https://scribe.heidihealth.com/
// @version      1.0.1
// @description  Exporte les sessions Heidi: transcription brute + note finale, au format JSON et JSONL SFT pour fine-tuning local. Sauvegarde persistante IndexedDB.
// @author       Florian Ronez + ChatGPT
// @match        https://scribe.heidihealth.com/fr-FR/scribe/sessions*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /**********************************************************************
     * CONFIGURATION
     **********************************************************************/

    const CONFIG = {
        SCRIPT_NAME: 'Heidi SFT Scraper',
        VERSION: '1.0.1',

        MAX_SESSIONS_PER_RUN: 500,

        DELAY_AFTER_ROW_CLICK_MS: 1200,
        DELAY_AFTER_TAB_CLICK_MS: 900,
        DELAY_AFTER_SCROLL_MS: 1200,
        WAIT_TIMEOUT_MS: 15000,

        // 0 = pas d’export automatique. Les données restent sauvegardées dans IndexedDB.
        AUTO_EXPORT_EVERY_N_SESSIONS: 0,

        BASIC_ANONYMIZATION_FOR_JSONL: false,

        INCLUDE_SESSION_TITLE_IN_JSONL: true,

        KEEP_INCOMPLETE_RAW_RECORDS: true,

        INDEXEDDB_NAME: 'heidi_sft_scraper_db_v1',
        INDEXEDDB_VERSION: 1,
        STORE_RECORDS: 'records',

        SYSTEM_INSTRUCTION: [
            "Tu es un assistant médical local utilisé par un médecin généraliste.",
            "Ta tâche est de transformer une transcription brute de consultation en note médicale structurée pour WEDA.",
            "Tu n'inventes aucune information.",
            "Tu conserves les incertitudes et les formulations prudentes.",
            "Tu ne transformes jamais une hypothèse en diagnostic certain.",
            "Tu mentionnes les traitements, conseils, examens, constantes et consignes de surveillance uniquement s'ils sont présents dans la transcription.",
            "La sortie doit être en Markdown, claire, concise, médicalement fidèle et exploitable dans le dossier patient."
        ].join(" ")
    };

    /**********************************************************************
     * ÉTAT INTERNE
     **********************************************************************/

    const state = {
        db: null,
        initialized: false,
        running: false,
        paused: false,
        startedAt: null,
        endedAt: null,
        processedThisRun: 0,
        skippedThisRun: 0,
        savedThisRun: 0,
        errors: [],
        persistedIds: new Set(),
        cachedCount: 0,
        currentSessionId: null,
        currentTitle: null,
        lastStatus: 'Initialisation...'
    };

    /**********************************************************************
     * OUTILS GÉNÉRAUX
     **********************************************************************/

    function log(...args) {
        console.log(`[${CONFIG.SCRIPT_NAME} v${CONFIG.VERSION}]`, ...args);
    }

    function warn(...args) {
        console.warn(`[${CONFIG.SCRIPT_NAME} v${CONFIG.VERSION}]`, ...args);
    }

    function errorLog(...args) {
        console.error(`[${CONFIG.SCRIPT_NAME} v${CONFIG.VERSION}]`, ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function safeText(value) {
        return String(value || '')
            .replace(/\u00A0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    function normalizeMultiline(value) {
        return String(value || '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();
    }

    function sanitizeFilenamePart(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80) || 'heidi_export';
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
        );
    }

    function visibleElements(selector, root = document) {
        return Array.from(root.querySelectorAll(selector)).filter(isVisible);
    }

    async function waitForCondition(fn, timeoutMs = CONFIG.WAIT_TIMEOUT_MS, intervalMs = 150) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            try {
                const result = fn();
                if (result) return result;
            } catch (_) {}

            await sleep(intervalMs);
        }

        return null;
    }

    function dispatchRealClick(el) {
        if (!el) return false;

        try {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        } catch (_) {
            try {
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
            } catch (_) {}
        }

        const opts = {
            bubbles: true,
            cancelable: true,
            view: window
        };

        try {
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            return true;
        } catch (e) {
            warn('dispatchRealClick fallback click()', e);

            try {
                el.click();
                return true;
            } catch (err) {
                errorLog('Impossible de cliquer', err);
                return false;
            }
        }
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**********************************************************************
     * INDEXEDDB : SAUVEGARDE PERSISTANTE
     **********************************************************************/

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(CONFIG.INDEXEDDB_NAME, CONFIG.INDEXEDDB_VERSION);

            request.onupgradeneeded = event => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(CONFIG.STORE_RECORDS)) {
                    const store = db.createObjectStore(CONFIG.STORE_RECORDS, { keyPath: 'session_id' });
                    store.createIndex('exported_at', 'exported_at', { unique: false });
                    store.createIndex('session_title', 'session_title', { unique: false });
                    store.createIndex('extraction_status', 'extraction_status', { unique: false });
                }
            };

            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject(event.target.error);
        });
    }

    function dbTransaction(storeName, mode = 'readonly') {
        if (!state.db) {
            throw new Error('IndexedDB non initialisée');
        }

        const tx = state.db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        return { tx, store };
    }

    function idbRequestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function getAllRecordsFromDb() {
        const { store } = dbTransaction(CONFIG.STORE_RECORDS, 'readonly');
        const records = await idbRequestToPromise(store.getAll());

        return Array.isArray(records)
            ? records.sort((a, b) => String(a.exported_at || '').localeCompare(String(b.exported_at || '')))
            : [];
    }

    async function getAllRecordIdsFromDb() {
        const { store } = dbTransaction(CONFIG.STORE_RECORDS, 'readonly');

        if (typeof store.getAllKeys === 'function') {
            const keys = await idbRequestToPromise(store.getAllKeys());
            return Array.isArray(keys) ? keys.map(String) : [];
        }

        return new Promise((resolve, reject) => {
            const ids = [];
            const request = store.openCursor();

            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    ids.push(String(cursor.key));
                    cursor.continue();
                } else {
                    resolve(ids);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async function recordExistsInDb(sessionId) {
        if (!sessionId) return false;
        if (state.persistedIds.has(sessionId)) return true;

        const { store } = dbTransaction(CONFIG.STORE_RECORDS, 'readonly');
        const record = await idbRequestToPromise(store.get(sessionId));

        if (record) {
            state.persistedIds.add(sessionId);
            return true;
        }

        return false;
    }

    async function saveRecordToDb(record) {
        if (!record || !record.session_id) {
            throw new Error('Record invalide: session_id manquant');
        }

        record.saved_to_indexeddb_at = nowIso();

        const { store } = dbTransaction(CONFIG.STORE_RECORDS, 'readwrite');
        await idbRequestToPromise(store.put(record));

        state.persistedIds.add(record.session_id);
        state.cachedCount = state.persistedIds.size;
    }

    async function clearDatabaseRecords() {
        const { store } = dbTransaction(CONFIG.STORE_RECORDS, 'readwrite');
        await idbRequestToPromise(store.clear());

        state.persistedIds.clear();
        state.cachedCount = 0;
    }

    async function refreshPersistedIds() {
        const ids = await getAllRecordIdsFromDb();
        state.persistedIds = new Set(ids);
        state.cachedCount = ids.length;
    }

    /**********************************************************************
     * SÉLECTEURS HEIDI
     **********************************************************************/

    function getSessionRows() {
        const patientCells = Array.from(
            document.querySelectorAll('[data-testid="session-list-cell-patient"][data-session-id]')
        );

        const rows = patientCells
            .map(cell => {
                const row = cell.closest('tr');
                const sessionId = cell.getAttribute('data-session-id') || '';
                const titleEl = row?.querySelector('[data-testid="session-list-cell-patient-summary"]');
                const checkbox = row?.querySelector('[data-testid="session-list-cell-checkbox"]');
                const ariaLabel = checkbox?.getAttribute('aria-label') || '';
                const titleFromAria = ariaLabel.replace(/^Sélectionner une session:\s*/i, '').trim();

                return {
                    row,
                    cell,
                    sessionId,
                    title: safeText(titleEl?.innerText || titleFromAria || 'Session sans titre'),
                    index: row?.getAttribute('data-index') || ''
                };
            })
            .filter(item => item.row && item.sessionId);

        const deduped = [];
        const seen = new Set();

        for (const item of rows) {
            if (seen.has(item.sessionId)) continue;
            seen.add(item.sessionId);
            deduped.push(item);
        }

        return deduped;
    }

    function findSessionRowById(sessionId) {
        const cell = document.querySelector(`[data-testid="session-list-cell-patient"][data-session-id="${CSS.escape(sessionId)}"]`);
        if (!cell) return null;

        const row = cell.closest('tr');
        const titleEl = row?.querySelector('[data-testid="session-list-cell-patient-summary"]');

        return {
            row,
            cell,
            sessionId,
            title: safeText(titleEl?.innerText || 'Session sans titre'),
            index: row?.getAttribute('data-index') || ''
        };
    }

    function getListScrollContainer() {
        const table =
            document.querySelector('[data-testid="session-list-table"] table') ||
            document.querySelector('#sessions-left table');

        if (!table) return null;

        let el = table.parentElement;

        while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            const canScroll = el.scrollHeight > el.clientHeight + 20;

            if (canScroll && (overflowY === 'auto' || overflowY === 'scroll')) {
                return el;
            }

            el = el.parentElement;
        }

        return null;
    }

    function getCurrentDetailSessionId() {
        const transcriptTabs = visibleElements('button[data-testid="session-tab-transcript"][id^="transcript/"]');
        const noteTabs = visibleElements('button[data-testid="session-tab-note"][id^="note/"]');

        const tab = transcriptTabs[0] || noteTabs[0];
        const id = tab?.getAttribute('id') || '';

        if (id.includes('/')) {
            return id.split('/').slice(1).join('/').trim();
        }

        return null;
    }

    function getVisibleTranscriptTab() {
        return visibleElements('button[data-testid="session-tab-transcript"], button[id^="transcript/"][role="tab"]')[0] || null;
    }

    function getVisibleNoteTab() {
        return visibleElements('button[data-testid="session-tab-note"], button[id^="note/"][role="tab"]')[0] || null;
    }

    function getVisibleTranscriptContent() {
        return visibleElements('[data-testid="transcript-content"]')[0] || null;
    }

    function getVisibleNoteEditor() {
        return (
            visibleElements('[data-testid="template-block-editor-content"] .ProseMirror')[0] ||
            visibleElements('[data-testid="scribe-tab-block-editor"] .ProseMirror')[0] ||
            visibleElements('.prose-mirror-container .ProseMirror')[0] ||
            null
        );
    }

    /**********************************************************************
     * EXTRACTION TRANSCRIPTION
     **********************************************************************/

    function extractTranscript() {
        const content = getVisibleTranscriptContent();

        if (!content) {
            return {
                transcript_text: '',
                transcript_segments: [],
                transcript_started: '',
                transcript_ended: '',
                transcript_meta_lines: []
            };
        }

        const metaLines = Array.from(content.querySelectorAll('p'))
            .map(p => safeText(p.innerText))
            .filter(t => /^Transcription\s+(commencée|terminée)/i.test(t));

        const transcript_started = metaLines.find(t => /^Transcription\s+commencée/i.test(t)) || '';
        const transcript_ended = metaLines.find(t => /^Transcription\s+terminée/i.test(t)) || '';

        const items = Array.from(content.querySelectorAll('[data-testid="transcript-item"]'));

        const transcript_segments = items.map(item => {
            const timestampEl =
                item.querySelector('.text-xs') ||
                item.querySelector('div');

            const textEl =
                item.querySelector('[data-testid="transcript-item-text"]') ||
                item.querySelector('p:last-child');

            return {
                timestamp: safeText(timestampEl?.innerText || ''),
                text: normalizeMultiline(textEl?.innerText || '')
            };
        }).filter(seg => seg.text);

        const transcript_text = transcript_segments
            .map(seg => seg.timestamp ? `[${seg.timestamp}] ${seg.text}` : seg.text)
            .join('\n\n')
            .trim();

        return {
            transcript_text,
            transcript_segments,
            transcript_started,
            transcript_ended,
            transcript_meta_lines: metaLines
        };
    }

    /**********************************************************************
     * EXTRACTION NOTE FINALE
     **********************************************************************/

    function inlineNodeToMarkdown(node) {
        if (!node) return '';

        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        const tag = node.tagName.toLowerCase();
        const children = Array.from(node.childNodes).map(inlineNodeToMarkdown).join('');

        if (tag === 'strong' || tag === 'b') {
            const t = children.trim();
            return t ? `**${t}**` : '';
        }

        if (tag === 'em' || tag === 'i') {
            const t = children.trim();
            return t ? `*${t}*` : '';
        }

        if (tag === 'u') {
            return children;
        }

        if (tag === 'br') {
            return '\n';
        }

        if (tag === 'code') {
            return '`' + children.trim() + '`';
        }

        return children;
    }

    function blockNodeToMarkdown(node, listIndex = null) {
        if (!node) return '';

        if (node.nodeType === Node.TEXT_NODE) {
            return safeText(node.textContent || '');
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        const tag = node.tagName.toLowerCase();

        if (tag === 'p') {
            return inlineNodeToMarkdown(node).trim();
        }

        if (tag === 'h1') return '# ' + inlineNodeToMarkdown(node).trim();
        if (tag === 'h2') return '## ' + inlineNodeToMarkdown(node).trim();
        if (tag === 'h3') return '### ' + inlineNodeToMarkdown(node).trim();
        if (tag === 'h4') return '#### ' + inlineNodeToMarkdown(node).trim();

        if (tag === 'blockquote') {
            return inlineNodeToMarkdown(node)
                .split('\n')
                .map(line => '> ' + line.trim())
                .join('\n');
        }

        if (tag === 'ul') {
            return Array.from(node.children)
                .filter(child => child.tagName?.toLowerCase() === 'li')
                .map(li => '- ' + inlineNodeToMarkdown(li).trim())
                .join('\n');
        }

        if (tag === 'ol') {
            return Array.from(node.children)
                .filter(child => child.tagName?.toLowerCase() === 'li')
                .map((li, i) => `${i + 1}. ${inlineNodeToMarkdown(li).trim()}`)
                .join('\n');
        }

        if (tag === 'li') {
            if (listIndex !== null) return `${listIndex}. ${inlineNodeToMarkdown(node).trim()}`;
            return '- ' + inlineNodeToMarkdown(node).trim();
        }

        if (tag === 'div') {
            return Array.from(node.childNodes)
                .map(child => blockNodeToMarkdown(child))
                .filter(Boolean)
                .join('\n\n');
        }

        return inlineNodeToMarkdown(node).trim();
    }

    function editorHtmlToMarkdown(editor) {
        if (!editor) return '';

        const blocks = Array.from(editor.childNodes)
            .map(node => blockNodeToMarkdown(node))
            .map(t => normalizeMultiline(t))
            .filter(Boolean);

        return blocks
            .join('\n\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();
    }

    function extractNote() {
        const editor = getVisibleNoteEditor();
        const noteTab = getVisibleNoteTab();
        const templateName = safeText(noteTab?.innerText || '');

        if (!editor) {
            return {
                note_template_name: templateName,
                final_output_text: '',
                final_output_markdown: '',
                final_output_html: ''
            };
        }

        const final_output_text = normalizeMultiline(editor.innerText || '');
        const final_output_html = editor.innerHTML || '';
        const final_output_markdown = editorHtmlToMarkdown(editor) || final_output_text;

        return {
            note_template_name: templateName,
            final_output_text,
            final_output_markdown,
            final_output_html
        };
    }

    /**********************************************************************
     * ANONYMISATION BASIQUE OPTIONNELLE
     **********************************************************************/

    function basicAnonymize(text) {
        if (!text) return '';

        let s = String(text);

        s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
        s = s.replace(/(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}\b/g, '[TELEPHONE]');
        s = s.replace(/\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2])\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, '[NIR]');
        s = s.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, '[DATE]');
        s = s.replace(/\b\d{1,2}\s?h\s?\d{0,2}\b/gi, '[HEURE]');

        return s;
    }

    function maybeAnonymizeForJsonl(text) {
        if (!CONFIG.BASIC_ANONYMIZATION_FOR_JSONL) return text;
        return basicAnonymize(text);
    }

    /**********************************************************************
     * EXPORTS
     **********************************************************************/

    async function buildRawExportObject() {
        const records = await getAllRecordsFromDb();

        return {
            export_metadata: {
                exporter: CONFIG.SCRIPT_NAME,
                version: CONFIG.VERSION,
                exported_at: nowIso(),
                source_url: window.location.href,
                total_records: records.length,
                ids_persisted_in_local_db: state.persistedIds.size,
                processed_this_run: state.processedThisRun,
                skipped_this_run: state.skippedThisRun,
                saved_this_run: state.savedThisRun,
                errors_this_run: state.errors
            },
            records
        };
    }

    async function buildTrainingJsonl() {
        const records = await getAllRecordsFromDb();
        const lines = [];

        for (const record of records) {
            const transcript = record.transcript_text || '';
            const output = record.final_output_markdown || record.final_output_text || '';

            if (!transcript.trim() || !output.trim()) {
                continue;
            }

            const userParts = [];

            userParts.push(`Type de document : ${record.task_type || 'consultation_weda'}`);

            if (record.note_template_name) {
                userParts.push(`Template Heidi : ${record.note_template_name}`);
            }

            if (CONFIG.INCLUDE_SESSION_TITLE_IN_JSONL && record.session_title) {
                userParts.push(`Titre de session : ${record.session_title}`);
            }

            userParts.push('Transcription brute :');
            userParts.push(transcript);

            const item = {
                messages: [
                    {
                        role: 'system',
                        content: CONFIG.SYSTEM_INSTRUCTION
                    },
                    {
                        role: 'user',
                        content: maybeAnonymizeForJsonl(userParts.join('\n\n'))
                    },
                    {
                        role: 'assistant',
                        content: maybeAnonymizeForJsonl(output)
                    }
                ],
                metadata: {
                    source: 'heidi',
                    session_id: record.session_id,
                    exported_at: record.exported_at,
                    saved_to_indexeddb_at: record.saved_to_indexeddb_at || '',
                    task_type: record.task_type || 'consultation_weda',
                    note_template_name: record.note_template_name || '',
                    transcript_started: record.transcript_started || '',
                    transcript_ended: record.transcript_ended || '',
                    extraction_status: record.extraction_status || ''
                }
            };

            lines.push(JSON.stringify(item));
        }

        return lines.join('\n');
    }

    function downloadTextFile(filename, text, mimeType = 'text/plain;charset=utf-8') {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 3000);
    }

    async function exportAll(reason = 'manual') {
        await refreshPersistedIds();

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .replace('Z', '');

        const prefix = `heidi_${sanitizeFilenamePart(reason)}_${timestamp}`;

        const rawObject = await buildRawExportObject();
        const rawJson = JSON.stringify(rawObject, null, 2);
        const jsonl = await buildTrainingJsonl();

        downloadTextFile(`${prefix}_raw_export.json`, rawJson, 'application/json;charset=utf-8');
        downloadTextFile(`${prefix}_training_sft.jsonl`, jsonl, 'application/jsonl;charset=utf-8');

        const jsonlCount = jsonl ? jsonl.split('\n').filter(Boolean).length : 0;

        setStatus(`Export effectué: ${rawObject.records.length} brut(s), ${jsonlCount} JSONL`);
        await updatePanel();
    }

    /**********************************************************************
     * TRAITEMENT SESSION
     **********************************************************************/

    async function clickSession(sessionInfo) {
        const fresh = findSessionRowById(sessionInfo.sessionId) || sessionInfo;
        const target = fresh.cell || fresh.row;

        if (!target) {
            throw new Error(`Session introuvable dans le DOM: ${sessionInfo.sessionId}`);
        }

        state.currentSessionId = sessionInfo.sessionId;
        state.currentTitle = sessionInfo.title;

        setStatus(`Ouverture session: ${sessionInfo.title}`);
        await updatePanel();

        dispatchRealClick(target);

        await waitForCondition(() => {
            const currentId = getCurrentDetailSessionId();
            return currentId === sessionInfo.sessionId ? currentId : null;
        }, CONFIG.WAIT_TIMEOUT_MS);

        await sleep(CONFIG.DELAY_AFTER_ROW_CLICK_MS);

        return true;
    }

    async function openTranscriptTab() {
        const tab = await waitForCondition(() => getVisibleTranscriptTab(), CONFIG.WAIT_TIMEOUT_MS);

        if (!tab) {
            throw new Error('Onglet Transcription introuvable');
        }

        setStatus('Ouverture onglet Transcription');
        await updatePanel();

        dispatchRealClick(tab);
        await sleep(CONFIG.DELAY_AFTER_TAB_CLICK_MS);

        await waitForCondition(() => getVisibleTranscriptContent(), CONFIG.WAIT_TIMEOUT_MS);

        return true;
    }

    async function openNoteTab() {
        const tab = await waitForCondition(() => getVisibleNoteTab(), CONFIG.WAIT_TIMEOUT_MS);

        if (!tab) {
            throw new Error('Onglet Note introuvable');
        }

        setStatus('Ouverture onglet Note');
        await updatePanel();

        dispatchRealClick(tab);
        await sleep(CONFIG.DELAY_AFTER_TAB_CLICK_MS);

        await waitForCondition(() => getVisibleNoteEditor(), CONFIG.WAIT_TIMEOUT_MS);

        return true;
    }

    async function processSession(sessionInfo) {
        const sessionId = sessionInfo.sessionId;
        const title = sessionInfo.title || 'Session sans titre';

        if (await recordExistsInDb(sessionId)) {
            state.skippedThisRun += 1;
            setStatus(`Déjà sauvegardée, ignorée: ${title}`);
            await updatePanel();
            return null;
        }

        const record = {
            source: 'heidi',
            exported_at: nowIso(),
            source_url: window.location.href,
            task_type: 'consultation_weda',
            session_id: sessionId,
            session_title: title,
            list_index: sessionInfo.index || '',
            note_template_name: '',
            transcript_started: '',
            transcript_ended: '',
            transcript_meta_lines: [],
            transcript_text: '',
            transcript_segments: [],
            final_output_text: '',
            final_output_markdown: '',
            final_output_html: '',
            extraction_status: 'pending',
            extraction_errors: []
        };

        try {
            await clickSession(sessionInfo);

            try {
                await openTranscriptTab();
                const transcript = extractTranscript();
                Object.assign(record, transcript);
            } catch (e) {
                record.extraction_errors.push(`Transcription: ${e.message || String(e)}`);
            }

            try {
                await openNoteTab();
                const note = extractNote();
                Object.assign(record, note);
            } catch (e) {
                record.extraction_errors.push(`Note: ${e.message || String(e)}`);
            }

            const hasTranscript = !!record.transcript_text.trim();
            const hasNote = !!(record.final_output_markdown || record.final_output_text || '').trim();

            if (hasTranscript && hasNote) {
                record.extraction_status = 'complete';
            } else if (hasTranscript || hasNote) {
                record.extraction_status = 'partial';
            } else {
                record.extraction_status = 'empty';
            }

            if (CONFIG.KEEP_INCOMPLETE_RAW_RECORDS || record.extraction_status === 'complete') {
                await saveRecordToDb(record);
                state.savedThisRun += 1;
            }

            state.processedThisRun += 1;

            setStatus(`Session sauvegardée: ${title} (${record.extraction_status})`);
            await updatePanel();

            if (
                CONFIG.AUTO_EXPORT_EVERY_N_SESSIONS > 0 &&
                state.savedThisRun > 0 &&
                state.savedThisRun % CONFIG.AUTO_EXPORT_EVERY_N_SESSIONS === 0
            ) {
                await exportAll(`autosave_${state.savedThisRun}_sessions`);
            }

            return record;

        } catch (e) {
            record.extraction_status = 'error';
            record.extraction_errors.push(e.message || String(e));

            state.errors.push({
                at: nowIso(),
                session_id: sessionId,
                title,
                error: e.message || String(e)
            });

            if (CONFIG.KEEP_INCOMPLETE_RAW_RECORDS) {
                try {
                    await saveRecordToDb(record);
                    state.savedThisRun += 1;
                } catch (saveError) {
                    state.errors.push({
                        at: nowIso(),
                        session_id: sessionId,
                        title,
                        error: `Erreur sauvegarde IndexedDB après erreur extraction: ${saveError.message || String(saveError)}`
                    });
                }
            }

            state.processedThisRun += 1;

            errorLog('Erreur session', sessionId, title, e);
            setStatus(`Erreur session sauvegardée: ${title}`);
            await updatePanel();

            return record;
        }
    }

    /**********************************************************************
     * SCROLL ET BOUCLE PRINCIPALE
     **********************************************************************/

    async function scrollDownSessionList() {
        const scroller = getListScrollContainer();

        if (!scroller) {
            warn('Conteneur de scroll introuvable');
            return false;
        }

        const beforeTop = scroller.scrollTop;
        const beforeHeight = scroller.scrollHeight;
        const maxTop = scroller.scrollHeight - scroller.clientHeight;

        if (beforeTop >= maxTop - 5) {
            return false;
        }

        scroller.scrollTop = Math.min(maxTop, beforeTop + Math.floor(scroller.clientHeight * 0.85));

        await sleep(CONFIG.DELAY_AFTER_SCROLL_MS);

        const afterTop = scroller.scrollTop;
        const afterHeight = scroller.scrollHeight;

        return afterTop !== beforeTop || afterHeight !== beforeHeight;
    }

    async function runScraper() {
        if (!state.initialized) {
            setStatus('Base locale pas encore prête');
            await updatePanel();
            return;
        }

        if (state.running) return;

        state.running = true;
        state.paused = false;
        state.startedAt = nowIso();
        state.endedAt = null;
        state.processedThisRun = 0;
        state.skippedThisRun = 0;
        state.savedThisRun = 0;
        state.errors = [];

        await refreshPersistedIds();

        setStatus(`Démarrage extraction — ${state.persistedIds.size} session(s) déjà sauvegardée(s)`);
        await updatePanel();

        let noNewRowsRounds = 0;

        try {
            while (state.running && state.processedThisRun < CONFIG.MAX_SESSIONS_PER_RUN) {
                if (state.paused) {
                    setStatus('Pause');
                    await updatePanel();
                    await sleep(500);
                    continue;
                }

                const rows = getSessionRows();

                const candidates = [];

                for (const row of rows) {
                    if (!row.sessionId) continue;
                    if (state.persistedIds.has(row.sessionId)) {
                        continue;
                    }
                    candidates.push(row);
                }

                if (candidates.length === 0) {
                    const moved = await scrollDownSessionList();

                    if (!moved) {
                        noNewRowsRounds += 1;
                    } else {
                        noNewRowsRounds = 0;
                    }

                    if (noNewRowsRounds >= 2) {
                        setStatus('Fin probable de liste: aucune nouvelle session visible');
                        break;
                    }

                    continue;
                }

                noNewRowsRounds = 0;

                for (const candidate of candidates) {
                    if (!state.running || state.paused) break;
                    if (state.processedThisRun >= CONFIG.MAX_SESSIONS_PER_RUN) break;

                    if (await recordExistsInDb(candidate.sessionId)) {
                        state.skippedThisRun += 1;
                        continue;
                    }

                    await processSession(candidate);
                    await sleep(500);
                }

                await scrollDownSessionList();
            }

        } catch (e) {
            state.errors.push({
                at: nowIso(),
                error: e.message || String(e)
            });
            errorLog('Erreur globale', e);

        } finally {
            state.running = false;
            state.endedAt = nowIso();

            await refreshPersistedIds();

            setStatus(`Extraction terminée ou arrêtée — ${state.cachedCount} session(s) sauvegardée(s) en base locale`);
            await updatePanel();

            if (CONFIG.AUTO_EXPORT_EVERY_N_SESSIONS > 0 && state.savedThisRun > 0) {
                await exportAll('final');
            }
        }
    }

    async function stopScraper() {
        state.running = false;
        state.paused = false;
        setStatus('Arrêt demandé — les sessions déjà extraites sont sauvegardées');
        await updatePanel();
    }

    async function pauseScraper() {
        state.paused = !state.paused;
        setStatus(state.paused ? 'Pause demandée' : 'Reprise demandée');
        await updatePanel();
    }

    /**********************************************************************
     * INTERFACE UTILISATEUR
     **********************************************************************/

    let panelEl = null;

    function setStatus(text) {
        state.lastStatus = text;
        log(text);
    }

    function buttonCss(bg) {
        return [
            `background:${bg}`,
            'color:white',
            'border:0',
            'border-radius:8px',
            'padding:7px 8px',
            'font-size:12px',
            'font-weight:600',
            'cursor:pointer'
        ].join(';');
    }

    function createPanel() {
        if (panelEl) return panelEl;

        panelEl = document.createElement('div');
        panelEl.id = 'heidi-sft-scraper-panel';
        panelEl.style.cssText = [
            'position: fixed',
            'right: 16px',
            'bottom: 16px',
            'z-index: 999999',
            'width: 380px',
            'font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            'font-size: 13px',
            'background: #111827',
            'color: #f9fafb',
            'border: 1px solid rgba(255,255,255,0.18)',
            'border-radius: 12px',
            'box-shadow: 0 12px 32px rgba(0,0,0,0.35)',
            'padding: 12px',
            'line-height: 1.35'
        ].join(';');

        panelEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
                <div>
                    <div style="font-weight:700;">Heidi SFT Scraper</div>
                    <div style="font-size:11px;color:#9ca3af;">v${CONFIG.VERSION} — sauvegarde locale IndexedDB</div>
                </div>
                <button id="heidi-sft-hide" style="${buttonCss('#374151')}">−</button>
            </div>

            <div id="heidi-sft-body">
                <div id="heidi-sft-status" style="background:#1f2937;border-radius:8px;padding:8px;margin-bottom:8px;color:#e5e7eb;">
                    Initialisation...
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
                    <button id="heidi-sft-start" style="${buttonCss('#059669')}">Démarrer</button>
                    <button id="heidi-sft-pause" style="${buttonCss('#d97706')}">Pause</button>
                    <button id="heidi-sft-stop" style="${buttonCss('#dc2626')}">Stop</button>
                    <button id="heidi-sft-export" style="${buttonCss('#2563eb')}">Exporter tout</button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
                    <button id="heidi-sft-refresh-db" style="${buttonCss('#6b7280')}">Recharger base</button>
                    <button id="heidi-sft-clear-db" style="${buttonCss('#991b1b')}">Vider base locale</button>
                </div>

                <div id="heidi-sft-counters" style="font-size:12px;color:#d1d5db;"></div>

                <div style="margin-top:8px;font-size:11px;color:#9ca3af;">
                    Chaque session extraite est sauvegardée immédiatement dans IndexedDB.
                    En cas de rechargement de page, elle ne sera pas retraitée.
                    Le JSONL exclut les sessions sans transcription ou sans note.
                </div>
            </div>
        `;

        document.body.appendChild(panelEl);

        panelEl.querySelector('#heidi-sft-start').addEventListener('click', () => runScraper());
        panelEl.querySelector('#heidi-sft-pause').addEventListener('click', () => pauseScraper());
        panelEl.querySelector('#heidi-sft-stop').addEventListener('click', () => stopScraper());
        panelEl.querySelector('#heidi-sft-export').addEventListener('click', () => exportAll('manual'));

        panelEl.querySelector('#heidi-sft-refresh-db').addEventListener('click', async () => {
            await refreshPersistedIds();
            setStatus(`Base rechargée — ${state.cachedCount} session(s) sauvegardée(s)`);
            await updatePanel();
        });

        panelEl.querySelector('#heidi-sft-clear-db').addEventListener('click', async () => {
            if (!confirm('Vider toute la base locale IndexedDB de ce scraper ? Les sessions pourront ensuite être retraitées.')) return;

            await clearDatabaseRecords();

            state.processedThisRun = 0;
            state.skippedThisRun = 0;
            state.savedThisRun = 0;
            state.errors = [];

            setStatus('Base locale vidée');
            await updatePanel();
        });

        panelEl.querySelector('#heidi-sft-hide').addEventListener('click', () => {
            const body = panelEl.querySelector('#heidi-sft-body');
            const btn = panelEl.querySelector('#heidi-sft-hide');
            const hidden = body.style.display === 'none';

            body.style.display = hidden ? 'block' : 'none';
            btn.textContent = hidden ? '−' : '+';
        });

        return panelEl;
    }

    async function updatePanel() {
        if (!panelEl) return;

        const statusEl = panelEl.querySelector('#heidi-sft-status');
        const countersEl = panelEl.querySelector('#heidi-sft-counters');

        if (statusEl) {
            statusEl.textContent = state.lastStatus || 'Prêt';
        }

        if (!countersEl) return;

        let records = [];
        let complete = 0;
        let partial = 0;
        let empty = 0;
        let errors = 0;
        let jsonlCount = 0;

        if (state.db) {
            try {
                records = await getAllRecordsFromDb();
                complete = records.filter(r => r.extraction_status === 'complete').length;
                partial = records.filter(r => r.extraction_status === 'partial').length;
                empty = records.filter(r => r.extraction_status === 'empty').length;
                errors = records.filter(r => r.extraction_status === 'error').length;

                jsonlCount = records.filter(r => {
                    const transcript = r.transcript_text || '';
                    const output = r.final_output_markdown || r.final_output_text || '';
                    return transcript.trim() && output.trim();
                }).length;

                state.cachedCount = records.length;
            } catch (e) {
                warn('Impossible de lire les compteurs IndexedDB', e);
            }
        }

        countersEl.innerHTML = `
            <div><strong>Base prête:</strong> ${state.initialized ? 'oui' : 'non'}</div>
            <div><strong>Running:</strong> ${state.running ? 'oui' : 'non'} ${state.paused ? '(pause)' : ''}</div>
            <div><strong>Sauvegardées en base locale:</strong> ${state.cachedCount}</div>
            <div><strong>JSONL entraînement exportable:</strong> ${jsonlCount}</div>
            <div><strong>Complètes:</strong> ${complete} — <strong>Partielles:</strong> ${partial} — <strong>Vides:</strong> ${empty} — <strong>Erreurs:</strong> ${errors}</div>
            <div><strong>Traitées ce run:</strong> ${state.processedThisRun}</div>
            <div><strong>Sauvegardées ce run:</strong> ${state.savedThisRun}</div>
            <div><strong>Ignorées ce run car déjà sauvegardées:</strong> ${state.skippedThisRun}</div>
            <div><strong>Session active:</strong> ${state.currentTitle ? escapeHtml(state.currentTitle) : '-'}</div>
        `;
    }

    /**********************************************************************
     * API DEBUG CONSOLE
     **********************************************************************/

    window.HEIDI_SFT_SCRAPER = {
        CONFIG,
        state,
        start: runScraper,
        stop: stopScraper,
        pause: pauseScraper,
        exportAll,
        getSessionRows,
        extractTranscript,
        extractNote,
        refreshPersistedIds,
        getAllRecordsFromDb,
        clearDatabaseRecords
    };

    /**********************************************************************
     * INITIALISATION
     **********************************************************************/

    async function init() {
        createPanel();

        try {
            state.db = await openDatabase();
            await refreshPersistedIds();

            state.initialized = true;

            setStatus(`Prêt — ${state.cachedCount} session(s) déjà sauvegardée(s) en base locale`);
            await updatePanel();

            log('Initialisé. API console disponible: window.HEIDI_SFT_SCRAPER');

        } catch (e) {
            state.initialized = false;
            state.errors.push({
                at: nowIso(),
                error: `Erreur initialisation IndexedDB: ${e.message || String(e)}`
            });

            errorLog('Erreur initialisation IndexedDB', e);
            setStatus('Erreur: IndexedDB non disponible');
            await updatePanel();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }

})();