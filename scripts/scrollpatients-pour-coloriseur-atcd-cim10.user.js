// ==UserScript==
// @name         WEDA Coloriseur ATCD CIM-10 Batch - module autonome
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  Module batch pour lancer uniquement le coloriseur d'antécédents CIM-10 sur plusieurs patients à la suite.
// @match        https://secure.weda.fr/*
// @all-frames   true
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    /************************************************************
     * CONFIGURATION
     ************************************************************/

    const VERSION_BATCH = '1.0.3';
    const HOST_WEDA = 'secure.weda.fr';
    const LOG_PREFIX = '[AUTO-ATCD-COLOR-BATCH]';
    const WORKER_HASH_PREFIX = 'AUTO_ATCD_COLOR_BATCH_WORKER=';

    const BATCH_KEY_QUEUE = 'auto_atcd_color_batch_queue_v1';
    const BATCH_KEY_STATE = 'auto_atcd_color_batch_state_v1';
    const BATCH_KEY_LOG = 'auto_atcd_color_batch_log_v1';
    const BATCH_KEY_CURRENT = 'auto_atcd_color_batch_current_v1';
    const BATCH_KEY_COMMAND = 'auto_atcd_color_batch_command_v1';
    const BATCH_KEY_WORKER_HEARTBEAT = 'auto_atcd_color_batch_worker_heartbeat_v1';
    const BATCH_KEY_RESULT = 'auto_atcd_color_batch_result_v1';
    const BATCH_KEY_LOCK = 'auto_atcd_color_batch_lock_v1';
    const BATCH_KEY_CHAIN_LOCK = 'auto_atcd_color_batch_chain_lock_v1';

    const COLORISEUR_COMMAND_KEY = 'supp_atcd_non_cim10_patient_command_v1';
    const COLORISEUR_RESULT_KEY = 'supp_atcd_non_cim10_patient_result_v1';
    const SESSION_BATCH_WORKER_INFO = 'auto_atcd_color_batch_worker_info_v1';
    const SESSION_BATCH_ANTECEDENTS_RELOAD_RETRY = 'auto_atcd_color_batch_antecedents_reload_retry_v1';

    const PAGE_LOAD_TIMEOUT_MS = 30000;
    const ANTECEDENTS_NAV_TIMEOUT_MS = 45000;
    const COLORISEUR_LAUNCH_TIMEOUT_MS = 45000;
    const PATIENT_TIMEOUT_MS = 8 * 60 * 1000;
    const HEARTBEAT_INTERVAL_MS = 3000;
    const HEARTBEAT_STALE_MS = 15000;
    const WORKER_NO_HEARTBEAT_FOCUS_MS = 10000;
    const WORKER_NO_HEARTBEAT_REOPEN_MS = 25000;
    const WORKER_NO_HEARTBEAT_TIMEOUT_MS = 60000;
    const WORKER_STALE_FOCUS_COOLDOWN_MS = 30000;
    const MAX_WORKER_STALE_FOCUS_ATTEMPTS = 3;
    const STALE_ACTIVE_WORKER_RECOVER_MS = 2 * 60 * 1000;
    const WEDA_IMPORT_RESCUE_AFTER_MS = 20000;
    const WEDA_IMPORT_RESCUE_COOLDOWN_MS = 30000;
    const MAX_WEDA_IMPORT_RESCUES_PER_PATIENT = 2;
    const WEDA_IMPORT_TERMINAL_STALL_MS = 90 * 1000;
    const CIM10_EXISTING_JOB_WAIT_MAX_AGE_MS = 90 * 1000;
    const CONTROLLER_LOCK_TTL_MS = 30000;
    const CHAIN_LOCK_TTL_MS = 45000;
    const WORKER_HANDOFF_DELAY_MS = 1800;
    const WORKER_CHAIN_HANDOFF_ENABLED = false;
    const NEXT_PATIENT_AFTER_WORKER_CLOSE_DELAY_MS = 1000;
    const OPEN_WORKER_ACTIVE = true;
    const OPEN_WORKER_INSERT = false;
    const FOCUS_OPENER_BEFORE_WORKER_CLOSE = true;
    const KEEP_COLORISEUR_WORKER_FOREGROUND = true;
    const COLORISEUR_WORKER_FOREGROUND_INTERVAL_MS = 9000;
    const MAX_LOG_ENTRIES = 120;
    const PANEL_ID = 'auto-atcd-color-batch-panel';
    const LOG_PANEL_ID = 'auto-atcd-color-batch-log-panel';

    const PATIENT_TERMINAL_STATUSES = new Set(['success', 'error', 'timeout', 'skipped']);
    const ACTIVE_STATUSES = new Set([
        'running',
        'opening_patient',
        'waiting_patient_page',
        'going_to_antecedents',
        'clicking_coloriseur',
        'waiting_coloriseur_done',
        'closing_worker',
        'next_patient'
    ]);

    const runtime = {
        processing: false,
        lockTimer: null,
        panelInstalled: false,
        workerHeartbeatTimer: null,
        workerStatus: 'idle',
        workerClickedAt: null,
        workerResultPublishedAt: null,
        workerResult: null,
        coloriseurLaunchCommandId: '',
        coloriseurDirectResult: null,
        coloriseurDirectError: null,
        coloriseurDirectSettledAt: null,
        outcomeWaiter: null,
        wakeDecisionLogAt: {}
    };

    const CONTROLLER_ID = getOrCreateSessionValue('auto_atcd_color_batch_controller_id_v1', () => {
        return `ctrl_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    });

    /************************************************************
     * OUTILS GENERIQUES
     ************************************************************/

    function isTopWindow() {
        try {
            return window.self === window.top;
        } catch (_) {
            return true;
        }
    }

    if (!isTopWindow()) {
        return;
    }

    function nowMs() {
        return Date.now();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitFor(fn, timeoutMs, intervalMs = 500) {
        const start = nowMs();
        while (nowMs() - start < timeoutMs) {
            let result = null;
            try {
                result = fn();
            } catch (_) {
                result = null;
            }
            if (result) return result;
            await sleep(intervalMs);
        }
        return null;
    }

    function isWeda() {
        return window.location.hostname === HOST_WEDA;
    }

    function isBatchPanelPage() {
        return isWeda() && /^\/FolderMedical\/StatistiqueForm\.aspx$/i.test(window.location.pathname || '');
    }

    function getOrCreateSessionValue(key, buildValue) {
        try {
            const existing = sessionStorage.getItem(key);
            if (existing) return existing;
            const value = buildValue();
            sessionStorage.setItem(key, value);
            return value;
        } catch (_) {
            return buildValue();
        }
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function lowerText(value) {
        return normalizeText(value).toLowerCase();
    }

    function limitText(value, maxLen = 120) {
        const text = normalizeText(value);
        if (text.length <= maxLen) return text;
        return `${text.slice(0, maxLen - 1)}...`;
    }

    function safeJsonStringify(value) {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    function safePrettyJson(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (_) {
            return String(value);
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

    function parseMaybeJson(raw, fallback) {
        if (raw === null || raw === undefined || raw === '') return fallback;
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function gmGetJson(key, fallback) {
        try {
            return parseMaybeJson(GM_getValue(key, null), fallback);
        } catch (e) {
            console.warn(LOG_PREFIX, 'Lecture GM impossible', key, e);
            return fallback;
        }
    }

    function gmSetJson(key, value) {
        try {
            GM_setValue(key, JSON.stringify(value));
        } catch (e) {
            console.warn(LOG_PREFIX, 'Ecriture GM impossible', key, e);
        }
    }

    function gmDelete(key) {
        try {
            GM_deleteValue(key);
        } catch (_) {}
    }

    function getAccessibleDocuments() {
        const docs = [];
        const seen = new Set();

        function addDoc(doc) {
            if (!doc || seen.has(doc)) return;
            seen.add(doc);
            docs.push(doc);

            const frames = doc.querySelectorAll ? doc.querySelectorAll('iframe, frame') : [];
            for (const frame of frames) {
                try {
                    addDoc(frame.contentDocument || (frame.contentWindow && frame.contentWindow.document));
                } catch (_) {}
            }
        }

        addDoc(document);
        return docs;
    }

    function queryAllDeep(selector) {
        const results = [];
        for (const doc of getAccessibleDocuments()) {
            try {
                results.push(...doc.querySelectorAll(selector));
            } catch (_) {}
        }
        return results;
    }

    function isVisible(el) {
        if (!el) return false;
        const doc = el.ownerDocument || document;
        const view = doc.defaultView || window;
        try {
            const style = view.getComputedStyle(el);
            if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (_) {
            return true;
        }
    }

    function isInsideBatchPanel(el) {
        try {
            return !!(el && el.closest && el.closest(`#${PANEL_ID}`));
        } catch (_) {
            return false;
        }
    }

    function getElementText(el) {
        if (!el) return '';
        return normalizeText([
            el.innerText,
            el.textContent,
            el.value,
            el.getAttribute && el.getAttribute('title'),
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('alt')
        ].filter(Boolean).join(' '));
    }

    function clickElement(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        const doc = el.ownerDocument || document;
        const view = doc.defaultView || window;
        const eventOptions = { bubbles: true, cancelable: true, view };

        try { el.dispatchEvent(new view.MouseEvent('mouseover', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousemove', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mousedown', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('mouseup', eventOptions)); } catch (_) {}
        try { el.dispatchEvent(new view.MouseEvent('click', eventOptions)); } catch (_) {}
        try { el.click(); } catch (_) {}
        return true;
    }

    function makeBatchId() {
        return `batch_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    }

    /************************************************************
     * STOCKAGE, ETAT ET LOGS
     ************************************************************/

    function getQueue() {
        const queue = gmGetJson(BATCH_KEY_QUEUE, []);
        return Array.isArray(queue) ? queue : [];
    }

    function saveQueue(queue) {
        gmSetJson(BATCH_KEY_QUEUE, Array.isArray(queue) ? queue : []);
        refreshStateCounts();
        renderPanel();
    }

    function getState() {
        const state = gmGetJson(BATCH_KEY_STATE, null) || {};
        return Object.assign({
            batchId: '',
            status: 'idle',
            total: 0,
            pending: 0,
            running: 0,
            runningPatientId: null,
            success: 0,
            errors: 0,
            activeTotal: 0,
            activeRemaining: 0,
            resumeFromIndex: null,
            resumeFromPatientId: null,
            startedAt: null,
            updatedAt: nowMs(),
            finishedAt: null,
            pauseRequested: false,
            stopRequested: false
        }, state);
    }

    function countQueue(queue) {
        const counts = {
            total: queue.length,
            pending: 0,
            running: 0,
            success: 0,
            errors: 0,
            activeTotal: 0,
            activeRemaining: 0
        };

        for (const patient of queue) {
            if (!patient || !patient.status || patient.status === 'pending') counts.pending += 1;
            if (patient && patient.status === 'running') counts.running += 1;
            if (patient && patient.status === 'success') counts.success += 1;
            if (patient && (patient.status === 'error' || patient.status === 'timeout')) counts.errors += 1;

            if (patient && !patient.excludedByResume) {
                counts.activeTotal += 1;
                if (!PATIENT_TERMINAL_STATUSES.has(patient.status || 'pending')) {
                    counts.activeRemaining += 1;
                }
            }
        }

        return counts;
    }

    function setState(patch) {
        const queue = getQueue();
        const counts = countQueue(queue);
        const current = getState();
        const next = Object.assign({}, current, counts, patch || {}, { updatedAt: nowMs() });
        gmSetJson(BATCH_KEY_STATE, next);
        renderPanel();
        return next;
    }

    function refreshStateCounts() {
        const queue = getQueue();
        const counts = countQueue(queue);
        const state = getState();
        gmSetJson(BATCH_KEY_STATE, Object.assign({}, state, counts, { updatedAt: nowMs() }));
    }

    function getLogs() {
        const logs = gmGetJson(BATCH_KEY_LOG, []);
        return Array.isArray(logs) ? logs : [];
    }

    const USEFUL_BATCH_INFO_PHASES = new Set([
        'manual_diagnostic',
        'batch_start',
        'batch_finished',
        'patient_start',
        'worker_opened',
        'worker_start',
        'worker_patient_page_ready',
        'worker_antecedents_ready',
        'worker_coloriseur_started',
        'coloriseur_api_start',
        'coloriseur_direct_result',
        'coloriseur_direct_error',
        'coloriseur_finish_detected',
        'worker_foreground_keepalive',
        'worker_cim10_started',
        'worker_publish_result',
        'worker_outcome_received',
        'worker_outcome_bridge_direct',
        'worker_outcome_signal',
        'patient_outcome',
        'weda_worker_close_bridge_signal',
        'worker_source_close_signal',
        'controller_wake_result_found',
        'weda_import_silent_nudge',
        'stale_running_cleanup'
    ]);

    const NOISY_BATCH_INFO_PHASES = new Set([
        'controller_wake',
        'cim10_wait_status',
        'weda_navigation',
        'chain_handoff_controller_active',
        'chain_handoff_controller_active_but_attempted',
        'chain_handoff_scheduled',
        'logs'
    ]);

    function compactLogValue(value, depth = 0) {
        if (value === null || value === undefined) return value;
        if (typeof value === 'string') {
            if (/^https?:\/\//i.test(value)) return compactUrlForLog(value);
            return value.length > 260 ? value.slice(0, 260) + '...' : value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'function') return '[function]';
        if (depth > 2) return '[object]';

        try {
            if (typeof Element !== 'undefined' && value instanceof Element) {
                return {
                    tag: String(value.tagName || '').toLowerCase(),
                    id: value.id || '',
                    className: String(value.className || '').slice(0, 180),
                    text: limitText(getElementText(value), 260),
                    title: value.getAttribute ? limitText(value.getAttribute('title') || '', 180) : ''
                };
            }
        } catch (_) {}

        if (Array.isArray(value)) {
            return value.slice(0, 5).map(item => compactLogValue(item, depth + 1));
        }

        if (typeof value === 'object') {
            const out = {};
            Object.keys(value).slice(0, 16).forEach(key => {
                out[key] = compactLogValue(value[key], depth + 1);
            });
            return out;
        }

        return String(value);
    }

    function compactUrlForLog(url) {
        const raw = String(url || '');
        if (!raw) return '';
        if (!/^https?:\/\//i.test(raw) && /\.aspx/i.test(raw)) return limitText(raw, 120);

        try {
            const parsed = new URL(raw, window.location.href);
            const page = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname || raw;
            const patDk = parsed.searchParams.get('PatDk');
            const hashPatient = (parsed.hash || '').match(/[?&#]patient=([^&]+)/i);
            const patient = patDk || (hashPatient ? decodeURIComponent(hashPatient[1]) : '');
            return [page, patient ? `PatDk=${patient}` : ''].filter(Boolean).join(' ');
        } catch (_) {
            return raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
        }
    }

    function normalizeDetailsForLog(details) {
        if (details === null || details === undefined) return {};
        if (typeof details === 'object' && !Array.isArray(details)) return Object.assign({}, details);
        return { value: details };
    }

    function summarizePatientForLog(patient, index) {
        if (!patient) return null;
        const out = {
            id: patient.id || patient.patientId || '',
            patDk: patient.patDk || patient.id || '',
            name: patient.name || patient.patientName || '',
            status: patient.status || '',
            entryMode: patient.entryMode || '',
            excludedByResume: !!patient.excludedByResume
        };
        if (index !== undefined && index !== null) out.index = index;
        if (patient.startedAt) out.startedAt = patient.startedAt;
        if (patient.finishedAt) out.finishedAt = patient.finishedAt;
        if (patient.error) out.error = limitText(patient.error, 500);
        return out;
    }

    function getQueueProgressSnapshot(queueInput) {
        const queue = Array.isArray(queueInput) ? queueInput : getQueue();
        const counts = countQueue(queue);
        const nextPendingIndex = getNextPendingPatientIndex(queue);
        const runningIndex = queue.findIndex(patient => patient && patient.status === 'running');

        return Object.assign({}, counts, {
            nextPendingIndex,
            nextPending: nextPendingIndex >= 0 ? summarizePatientForLog(queue[nextPendingIndex], nextPendingIndex) : null,
            runningIndex,
            running: runningIndex >= 0 ? summarizePatientForLog(queue[runningIndex], runningIndex) : null,
            pendingPreview: queue
                .map((patient, index) => ({ patient, index }))
                .filter(entry => entry.patient && entry.patient.status === 'pending' && !entry.patient.excludedByResume)
                .slice(0, 8)
                .map(entry => summarizePatientForLog(entry.patient, entry.index)),
            excludedCount: queue.filter(patient => patient && patient.excludedByResume).length
        });
    }

    function valueAgeMs(value) {
        if (!value || typeof value !== 'object') return null;
        const candidates = [
            value.ts,
            value.updatedAt,
            value.openedAt,
            value.acquiredAt,
            value.startedAt
        ].filter(v => v !== null && v !== undefined && v !== '');

        for (const candidate of candidates) {
            const parsed = typeof candidate === 'number' ? candidate : Date.parse(candidate);
            if (Number.isFinite(parsed)) return Math.max(0, nowMs() - parsed);
        }

        return null;
    }

    function summarizeStoredPatientContext(value) {
        if (!value || typeof value !== 'object') return null;
        return {
            batchId: value.batchId || '',
            patientId: value.patientId || '',
            patientName: value.patientName || '',
            status: value.status || '',
            url: compactUrlForLog(value.url || ''),
            openSource: value.openSource || '',
            openedBy: value.openedBy || '',
            ageMs: valueAgeMs(value)
        };
    }

    function getBatchRuntimeSnapshot() {
        const state = getState();
        const queue = getQueue();
        const current = gmGetJson(BATCH_KEY_CURRENT, null);
        const heartbeat = gmGetJson(BATCH_KEY_WORKER_HEARTBEAT, null);
        const result = gmGetJson(BATCH_KEY_RESULT, null);
        const controllerLock = gmGetJson(BATCH_KEY_LOCK, null);
        const chainLock = gmGetJson(BATCH_KEY_CHAIN_LOCK, null);
        const workerInfo = getWorkerInfoFromHash();

        return {
            at: new Date().toISOString(),
            url: window.location.href,
            controllerId: CONTROLLER_ID,
            isBatchPanelPage: isBatchPanelPage(),
            isWorkerTab: !!workerInfo,
            workerInfo,
            state: {
                batchId: state.batchId || '',
                status: state.status || '',
                runningPatientId: state.runningPatientId || '',
                pauseRequested: !!state.pauseRequested,
                stopRequested: !!state.stopRequested,
                updatedAgeMs: state.updatedAt ? nowMs() - Number(state.updatedAt || 0) : null,
                resumeFromIndex: state.resumeFromIndex,
                resumeFromPatientId: state.resumeFromPatientId || ''
            },
            progress: getQueueProgressSnapshot(queue),
            current: summarizeStoredPatientContext(current),
            heartbeat: heartbeat ? {
                batchId: heartbeat.batchId || '',
                patientId: heartbeat.patientId || '',
                status: heartbeat.status || '',
                clickedAt: heartbeat.clickedAt || null,
                ageMs: valueAgeMs(heartbeat),
                url: compactUrlForLog(heartbeat.url || '')
            } : null,
            result: result ? {
                resultId: result.resultId || '',
                batchId: result.batchId || '',
                patientId: result.patientId || '',
                status: result.status || '',
                message: limitText(result.message || '', 500),
                ageMs: valueAgeMs(result),
                url: compactUrlForLog(result.url || '')
            } : null,
            controllerLock: controllerLock ? Object.assign({}, controllerLock, { ageMs: valueAgeMs(controllerLock) }) : null,
            chainLock: chainLock ? Object.assign({}, chainLock, { ageMs: valueAgeMs(chainLock) }) : null,
            runtime: {
                processing: !!runtime.processing,
                workerStatus: runtime.workerStatus || '',
                workerClickedAt: runtime.workerClickedAt || null,
                hasOutcomeWaiter: !!runtime.outcomeWaiter,
                outcomeWaiter: runtime.outcomeWaiter ? {
                    batchId: runtime.outcomeWaiter.batchId,
                    patientId: runtime.outcomeWaiter.patientId,
                    launchedAgeMs: nowMs() - Number(runtime.outcomeWaiter.launchedAt || 0)
                } : null
            }
        };
    }

    function buildBlockedBatchDiagnostic(reason, extra = {}) {
        return Object.assign({
            reason: reason || '',
            snapshot: getBatchRuntimeSnapshot()
        }, extra || {});
    }

    function summarizeProgressForLog(progress) {
        if (!progress || typeof progress !== 'object') return null;
        return {
            total: Number(progress.total || 0),
            pending: Number(progress.pending || 0),
            runningIndex: progress.runningIndex === undefined ? null : progress.runningIndex,
            running: summarizePatientForLog(progress.running || null),
            success: Number(progress.success || 0),
            errors: Number(progress.errors || 0),
            activeTotal: Number(progress.activeTotal || 0),
            activeRemaining: Number(progress.activeRemaining || 0),
            nextPendingIndex: progress.nextPendingIndex === undefined ? null : progress.nextPendingIndex,
            nextPending: summarizePatientForLog(progress.nextPending || null),
            excludedCount: Number(progress.excludedCount || 0)
        };
    }

    function summarizeLockForLog(lock) {
        if (!lock || typeof lock !== 'object') return null;
        return {
            controllerId: lock.controllerId || '',
            ownerId: lock.ownerId || '',
            tabId: lock.tabId || '',
            batchId: lock.batchId || '',
            jobId: lock.jobId || '',
            reason: lock.reason || '',
            ageMs: valueAgeMs(lock),
            expiresInMs: lock.expiresAt ? Math.max(0, Number(lock.expiresAt || 0) - nowMs()) : null
        };
    }

    function summarizeHeartbeatForLog(heartbeat) {
        if (!heartbeat || typeof heartbeat !== 'object') return null;
        return {
            batchId: heartbeat.batchId || '',
            patientId: heartbeat.patientId || '',
            status: heartbeat.status || '',
            clickedAt: heartbeat.clickedAt || null,
            ageMs: valueAgeMs(heartbeat),
            url: compactUrlForLog(heartbeat.url || '')
        };
    }

    function summarizeOutcomeForLog(result) {
        if (!result || typeof result !== 'object') return null;
        return {
            resultId: result.resultId || '',
            batchId: result.batchId || '',
            patientId: result.patientId || '',
            status: result.status || '',
            message: limitText(result.message || '', 400),
            ageMs: valueAgeMs(result),
            url: compactUrlForLog(result.url || ''),
            report: result.report ? summarizeReport(result.report) : null
        };
    }

    function summarizeRuntimeSnapshotForLog(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        return {
            at: snapshot.at || '',
            url: compactUrlForLog(snapshot.url || ''),
            controllerId: snapshot.controllerId || '',
            isBatchPanelPage: !!snapshot.isBatchPanelPage,
            isWorkerTab: !!snapshot.isWorkerTab,
            workerInfo: snapshot.workerInfo || null,
            state: snapshot.state || null,
            progress: summarizeProgressForLog(snapshot.progress),
            current: snapshot.current || null,
            heartbeat: summarizeHeartbeatForLog(snapshot.heartbeat),
            result: summarizeOutcomeForLog(snapshot.result),
            controllerLock: summarizeLockForLog(snapshot.controllerLock),
            chainLock: summarizeLockForLog(snapshot.chainLock),
            runtime: snapshot.runtime || null
        };
    }

    function summarizeDiagnosticForLog(diagnostic) {
        if (!diagnostic || typeof diagnostic !== 'object') return null;

        const out = {
            reason: diagnostic.reason || '',
            snapshot: summarizeRuntimeSnapshotForLog(diagnostic.snapshot)
        };

        [
            'phase',
            'batchId',
            'patientId',
            'status',
            'source',
            'clicked',
            'elapsedMs',
            'heartbeatAgeMs',
            'currentAge',
            'earlyStageBudget',
            'workerClosingAt',
            'bridgeUrl'
        ].forEach(key => {
            if (diagnostic[key] !== undefined) out[key] = compactLogValue(diagnostic[key]);
        });

        if (diagnostic.patient) out.patient = summarizePatientForLog(diagnostic.patient);
        if (diagnostic.lastHeartbeat) out.lastHeartbeat = summarizeHeartbeatForLog(diagnostic.lastHeartbeat);
        if (diagnostic.result) out.result = summarizeOutcomeForLog(diagnostic.result);
        if (diagnostic.report) out.report = summarizeReport(diagnostic.report);
        if (diagnostic.lock) out.lock = summarizeLockForLog(diagnostic.lock);
        if (diagnostic.freshness) out.freshness = compactLogValue(diagnostic.freshness);

        return out;
    }

    function sanitizeBatchLogDetails(details) {
        const raw = normalizeDetailsForLog(details);
        const out = {};

        [
            'phase',
            'reason',
            'batchId',
            'status',
            'source',
            'method',
            'stage',
            'url',
            'workerUrl',
            'entryMode',
            'elapsedMs',
            'stalledForMs',
            'delayMs',
            'clicked',
            'observedStarted',
            'observedStatusKey',
            'heartbeatAgeMs',
            'currentAge',
            'earlyStageBudget',
            'pendingCount',
            'nextIndex',
            'selectedIndex',
            'resumeFromIndex',
            'count',
            'rescueCount',
            'error'
        ].forEach(key => {
            if (raw[key] !== undefined) out[key] = compactLogValue(raw[key]);
        });

        if (raw.patient) out.patient = summarizePatientForLog(raw.patient);
        if (raw.patientDescriptor) out.patient = summarizePatientForLog(raw.patientDescriptor);
        if (raw.runningPatient) out.runningPatient = summarizePatientForLog(raw.runningPatient);
        if (raw.runningPatientId) out.runningPatientId = raw.runningPatientId;
        if (raw.nextPending) out.nextPending = summarizePatientForLog(raw.nextPending);
        if (raw.progress) out.progress = summarizeProgressForLog(raw.progress);
        if (raw.counts) out.progress = summarizeProgressForLog(raw.counts);
        if (raw.lastHeartbeat) out.lastHeartbeat = summarizeHeartbeatForLog(raw.lastHeartbeat);
        if (raw.heartbeat) out.heartbeat = summarizeHeartbeatForLog(raw.heartbeat);
        if (raw.result) out.result = summarizeOutcomeForLog(raw.result);
        if (raw.outcome) out.outcome = summarizeOutcomeForLog(raw.outcome);
        if (raw.report) out.report = summarizeReport(raw.report);
        if (raw.reports) out.reports = compactLogValue(summarizeReports(raw.reports));
        if (raw.lock) out.lock = summarizeLockForLog(raw.lock);
        if (raw.controllerLock) out.controllerLock = summarizeLockForLog(raw.controllerLock);
        if (raw.chainLock) out.chainLock = summarizeLockForLog(raw.chainLock);
        if (raw.diagnostic) out.diagnostic = summarizeDiagnosticForLog(raw.diagnostic);

        return out;
    }

    function isUsefulBatchLogEntry(level, phase, message, details = {}) {
        if (details && details.forceLog) return true;
        if (level === 'error' || level === 'warn' || level === 'warning') return true;
        if (level === 'success') return true;
        if (USEFUL_BATCH_INFO_PHASES.has(phase)) return true;
        if (NOISY_BATCH_INFO_PHASES.has(phase)) return false;

        const text = lowerText(message || '');
        if (/timeout|bloqu|erreur|impossible|securite|stale|retard|ferme/.test(text)) return true;
        return false;
    }

    function inferLogPhase(message) {
        const n = lowerText(message);
        if (n.includes('scan')) return 'scan';
        if (n.includes('reprise')) return 'resume';
        if (n.includes('relais') || n.includes('chaine')) return 'chain_handoff';
        if (n.includes('heartbeat') || n.includes('worker silencieux')) return 'worker_heartbeat';
        if (n.includes('worker')) return 'worker';
        if (n.includes('patient suivant') || n.includes('debut patient')) return 'queue';
        if (n.includes('cim') || n.includes('heidi')) return 'cim10';
        if (n.includes('antecedent')) return 'weda_navigation';
        if (n.includes('verrou')) return 'lock';
        return '';
    }

    function pruneDetails(details) {
        return compactLogValue(normalizeDetailsForLog(details));
    }

    function getLogStats() {
        const logs = getLogs();
        return {
            total: logs.length,
            errors: logs.filter(entry => entry && entry.level === 'error').length,
            warnings: logs.filter(entry => entry && (entry.level === 'warn' || entry.level === 'warning')).length,
            successes: logs.filter(entry => entry && entry.level === 'success').length
        };
    }

    function refreshBatchLogPanelIfOpen() {
        const panel = document.getElementById(LOG_PANEL_ID);
        if (panel) renderBatchLogPanelContent(panel);
    }

    function addLog(level, message, patient, details) {
        const normalizedLevel = String(level || 'info').toLowerCase() === 'warning'
            ? 'warn'
            : String(level || 'info').toLowerCase();
        const rawDetails = normalizeDetailsForLog(details);
        const phase = String(rawDetails.phase || inferLogPhase(message) || '');

        if (!isUsefulBatchLogEntry(normalizedLevel, phase, message, rawDetails)) {
            return null;
        }

        if (phase && !rawDetails.phase) rawDetails.phase = phase;
        if (
            (normalizedLevel === 'warn' || normalizedLevel === 'error') &&
            !rawDetails.diagnostic &&
            !rawDetails.skipDiagnostic
        ) {
            rawDetails.diagnostic = getBatchRuntimeSnapshot();
        }

        const entry = {
            ts: nowMs(),
            at: new Date().toISOString(),
            level: normalizedLevel,
            phase,
            url: compactUrlForLog(window.location.href),
            controllerId: CONTROLLER_ID,
            version: VERSION_BATCH,
            patientId: patient && patient.id ? String(patient.id) : '',
            patientName: patient && patient.name ? String(patient.name) : '',
            message: String(message || ''),
            details: sanitizeBatchLogDetails(rawDetails)
        };

        const logs = getLogs();
        logs.push(entry);
        gmSetJson(BATCH_KEY_LOG, logs.slice(-MAX_LOG_ENTRIES));

        const consoleArgs = [LOG_PREFIX, entry.level.toUpperCase(), entry.message];
        if (entry.phase) consoleArgs.push(`phase=${entry.phase}`);
        if (entry.patientId) consoleArgs.push(`PatDk=${entry.patientId}`);
        if (entry.details && Object.keys(entry.details).length) consoleArgs.push(entry.details);
        const method = entry.level === 'error' ? 'error' : (entry.level === 'warn' ? 'warn' : 'log');
        try {
            console[method](...consoleArgs);
        } catch (_) {
            console.log(...consoleArgs);
        }

        renderPanel();
        refreshBatchLogPanelIfOpen();
        return entry;
    }

    function setCommand(action, details) {
        gmSetJson(BATCH_KEY_COMMAND, {
            action,
            details: details || {},
            ts: nowMs(),
            controllerId: CONTROLLER_ID
        });
    }

    /************************************************************
     * SCAN PATIENTS
     ************************************************************/

    function extractPatDk(value) {
        const text = String(value || '');
        const match = text.match(/[?&]PatDk=([^&#]+)/i);
        if (!match) return '';
        try {
            return decodeURIComponent(match[1]).trim();
        } catch (_) {
            return match[1].trim();
        }
    }

    function buildPatientUrl(patientId) {
        return `https://${HOST_WEDA}/FolderMedical/PatientViewForm.aspx?PatDk=${encodeURIComponent(patientId)}`;
    }

    function decodeHtmlAttribute(value) {
        return String(value || '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&#39;/g, "'");
    }

    function getCurrentPageUrlWithoutHash() {
        return String(window.location.href || '').split('#')[0];
    }

    function cleanPatientName(text, patientId) {
        let name = normalizeText(text)
            .replace(/\bPatDk\s*=\s*\S+/ig, ' ')
            .replace(/\bPatientViewForm\.aspx\b/ig, ' ')
            .replace(/\bFolderMedical\b/ig, ' ')
            .replace(/\bjavascript:.*$/ig, ' ')
            .replace(/\bouvrir le dossier\b/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!name || name.length < 2 || /^(ouvrir|patient)$/i.test(name)) {
            name = `Patient ${patientId}`;
        }

        return limitText(name, 90);
    }

    function extractPatientNameFromLink(link, patientId) {
        const ownText = getElementText(link);
        if (ownText && ownText.length > 1) return cleanPatientName(ownText, patientId);

        const closest = findPatientRow(link);
        const closestText = closest ? getElementText(closest) : '';
        return cleanPatientName(closestText, patientId);
    }

    function findPatientRow(link) {
        if (!link || !link.closest) return null;
        return link.closest('tr, li, [role="row"], .row');
    }

    function findPatientNameInRow(link, patientId) {
        const row = findPatientRow(link);
        if (!row) return extractPatientNameFromLink(link, patientId);

        const nameLink = row.querySelector('[id*="LinkButtonPatientGetNomPrenom"], a[href*="LinkButtonPatientGetNomPrenom"], a[onclick*="LinkButtonPatientGetNomPrenom"]');
        if (nameLink) {
            const name = cleanPatientName(getElementText(nameLink), patientId);
            if (!/^Patient\s+/i.test(name)) return name;
        }

        return extractPatientNameFromLink(link, patientId);
    }

    function extractWindowOpenUrl(raw) {
        const text = decodeHtmlAttribute(raw);
        const match = text.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
        return match ? match[1] : '';
    }

    function normalizePatientOpenUrl(rawUrl, link) {
        const candidate = decodeHtmlAttribute(rawUrl);
        if (!candidate || /^javascript:/i.test(candidate)) return '';

        try {
            const base = link && link.ownerDocument && link.ownerDocument.location
                ? link.ownerDocument.location.href
                : window.location.href;
            const url = new URL(candidate, base);
            if (!/\/foldermedical\/patientviewform\.aspx/i.test(url.pathname)) return '';
            if (!extractPatDk(url.href)) return '';
            return url.href;
        } catch (_) {
            return '';
        }
    }

    function extractPatientOpenUrlFromLink(link) {
        if (!link) return '';

        const rawOnClick = link.getAttribute('onclick') || '';
        const openedUrl = extractWindowOpenUrl(rawOnClick);
        const normalizedOpenedUrl = normalizePatientOpenUrl(openedUrl, link);
        if (normalizedOpenedUrl) return normalizedOpenedUrl;

        const rawHref = link.getAttribute('href') || '';
        return normalizePatientOpenUrl(rawHref, link);
    }

    function parsePatientGotoPostBack(link) {
        if (!link) return null;
        return parsePostBackTarget(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`);
    }

    function looksLikePatientGotoLink(link) {
        if (!link) return false;

        const parsed = parsePatientGotoPostBack(link);
        const idName = lowerText(`${link.id || ''} ${link.name || ''}`);
        const target = lowerText(parsed && parsed.target);
        const raw = lowerText(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''} ${link.getAttribute('title') || ''} ${getElementText(link)}`);

        if (!extractPatientOpenUrlFromLink(link)) return false;

        if (idName.includes('patientsgrid') && idName.includes('linkbuttongridgotopatient')) return true;
        if (target.includes('patientsgrid') && target.includes('linkbuttongridgotopatient')) return true;
        if (raw.includes('linkbuttongridgotopatient')) return true;
        if (raw.includes('ouvrir le dossier') && lowerText(getElementText(link)) === 'patient') return true;

        return false;
    }

    function findPatientGotoLinkInRow(row, patientId) {
        if (!row) return null;

        const candidates = Array.from(row.querySelectorAll('a[href], a[onclick]'));
        const direct = candidates.find(link => {
            const url = extractPatientOpenUrlFromLink(link);
            return url && extractPatDk(url) === patientId && looksLikePatientGotoLink(link);
        });
        if (direct) return direct;

        return candidates.find(link => {
            const url = extractPatientOpenUrlFromLink(link);
            return url && extractPatDk(url) === patientId;
        }) || null;
    }

    function rowHasPatientOpenLink(link) {
        const row = findPatientRow(link);
        if (!row) return false;

        const candidates = row.querySelectorAll('a[href], a[onclick]');
        for (const candidate of candidates) {
            if (extractPatientOpenUrlFromLink(candidate)) return true;
        }

        return false;
    }

    function looksLikePatientPostBackLink(link, parsedPostBack) {
        if (!link || !parsedPostBack || !parsedPostBack.target) return false;

        const idName = lowerText(`${link.id || ''} ${link.name || ''}`);
        const target = lowerText(parsedPostBack.target);
        const raw = lowerText(`${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`);

        if (idName.includes('patientsgrid') && idName.includes('linkbuttonpatientgetnomprenom')) return true;
        if (target.includes('patientsgrid') && target.includes('linkbuttonpatientgetnomprenom')) return true;
        if (raw.includes('patientsgrid') && raw.includes('linkbuttonpatientgetnomprenom')) return true;

        return false;
    }

    function buildPostBackPatientId(parsedPostBack) {
        return `postback:${parsedPostBack.target}`;
    }

    function upsertScannedPatient(found, patient) {
        if (!patient || !patient.id) return;

        const existing = found.get(patient.id);
        if (!existing) {
            found.set(patient.id, patient);
            return;
        }

        const priority = {
            patient_link: 3,
            url: 2,
            postback: 1
        };

        if ((priority[patient.entryMode] || 0) >= (priority[existing.entryMode] || 0)) {
            found.set(patient.id, Object.assign({}, existing, patient, {
                status: existing.status || patient.status || 'pending',
                startedAt: existing.startedAt || patient.startedAt || null,
                finishedAt: existing.finishedAt || patient.finishedAt || null,
                error: existing.error || patient.error || null,
                report: existing.report || patient.report || null
            }));
        }
    }

    function scanPatientsFromPage() {
        const found = new Map();
        const links = queryAllDeep('a[href]');
        const sourceUrl = getCurrentPageUrlWithoutHash();

        for (const link of links) {
            if (!looksLikePatientGotoLink(link)) continue;

            const patientUrl = extractPatientOpenUrlFromLink(link);
            const patientId = extractPatDk(patientUrl);
            if (!patientId) continue;

            const parsed = parsePatientGotoPostBack(link) || {};
            upsertScannedPatient(found, {
                id: patientId,
                patDk: patientId,
                entryMode: 'patient_link',
                name: findPatientNameInRow(link, patientId),
                url: patientUrl,
                sourceUrl,
                patientUrl,
                gotoLinkId: link.id || '',
                gotoPostbackTarget: parsed.target || '',
                gotoPostbackArgument: parsed.argument || '',
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null
            });
        }

        for (const link of links) {
            const rawHref = link.getAttribute('href') || '';
            const patientOpenUrl = extractPatientOpenUrlFromLink(link);
            let absoluteHref = rawHref;
            try {
                absoluteHref = new URL(rawHref, link.ownerDocument.location.href).href;
            } catch (_) {}

            const patientId = extractPatDk(patientOpenUrl) || extractPatDk(rawHref) || extractPatDk(absoluteHref);
            if (!patientId) continue;

            const hrefText = lowerText(`${patientOpenUrl} ${rawHref} ${absoluteHref} ${link.getAttribute('onclick') || ''}`);
            const looksLikePatientUrl = hrefText.includes('patientviewform.aspx') || hrefText.includes('foldermedical') || hrefText.includes('patdk=');
            if (!looksLikePatientUrl) continue;

            upsertScannedPatient(found, {
                id: patientId,
                patDk: patientId,
                entryMode: patientOpenUrl ? 'patient_link' : 'url',
                name: findPatientNameInRow(link, patientId),
                url: patientOpenUrl || buildPatientUrl(patientId),
                sourceUrl: patientOpenUrl ? sourceUrl : '',
                patientUrl: patientOpenUrl || '',
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null
            });
        }

        for (const link of links) {
            const rawHref = link.getAttribute('href') || '';
            const rawOnClick = link.getAttribute('onclick') || '';
            const parsed = parsePostBackTarget(`${rawHref} ${rawOnClick}`);

            if (!looksLikePatientPostBackLink(link, parsed)) continue;
            if (rowHasPatientOpenLink(link)) continue;

            const patientId = buildPostBackPatientId(parsed);
            if (!patientId || found.has(patientId)) continue;

            found.set(patientId, {
                id: patientId,
                patDk: '',
                entryMode: 'postback',
                postbackTarget: parsed.target,
                postbackArgument: parsed.argument || '',
                name: extractPatientNameFromLink(link, patientId),
                url: sourceUrl,
                sourceUrl,
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null
            });
        }

        return Array.from(found.values());
    }

    function mergeScannedPatients(scannedPatients) {
        const previousById = new Map(getQueue().map(patient => [String(patient.id), patient]));
        return scannedPatients.map(patient => {
            const previous = previousById.get(String(patient.id));
            if (!previous) return patient;

            const preservedStatus = previous.status === 'running' ? 'pending' : (previous.status || 'pending');
            return Object.assign({}, patient, {
                status: preservedStatus,
                startedAt: previous.startedAt || null,
                finishedAt: previous.finishedAt || null,
                error: previous.error || null,
                report: previous.report || null
            });
        });
    }

    function scanAndStorePatients() {
        const state = getState();
        if (ACTIVE_STATUSES.has(state.status) && state.runningPatientId) {
            addLog('warn', 'Scan ignore : un batch est deja en cours.', null, { status: state.status });
            return getQueue();
        }

        addLog('info', 'Scan lance.');
        setState({ status: 'scanning' });

        const scanned = scanPatientsFromPage();
        const queue = mergeScannedPatients(scanned);
        saveQueue(queue);
        setState({
            status: queue.length ? 'ready' : 'idle',
            runningPatientId: null,
            resumeFromIndex: null,
            resumeFromPatientId: null,
            finishedAt: null,
            pauseRequested: false,
            stopRequested: false
        });

        addLog(queue.length ? 'success' : 'warn', `${queue.length} patient(s) detecte(s).`, null, {
            count: queue.length,
            patients: queue.slice(0, 12).map(patient => ({
                id: patient.id,
                name: patient.name,
                entryMode: patient.entryMode,
                url: patient.url,
                patientUrl: patient.patientUrl || ''
            }))
        });

        if (!queue.length) {
            alert('Aucun patient detecte sur cette page.');
        }

        return queue;
    }

    /************************************************************
     * PANNEAU VISUEL
     ************************************************************/

    function installPanel() {
        if (!isBatchPanelPage() || getWorkerInfoFromHash()) {
            removePanel();
            return;
        }
        if (document.getElementById(PANEL_ID)) {
            runtime.panelInstalled = true;
            renderPanel();
            return;
        }

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.position = 'fixed';
        panel.style.left = '14px';
        panel.style.bottom = '14px';
        panel.style.zIndex = '2147483647';
        panel.style.width = '230px';
        panel.style.boxSizing = 'border-box';
        panel.style.background = '#102f4e';
        panel.style.color = '#ffffff';
        panel.style.border = '1px solid rgba(255,255,255,0.22)';
        panel.style.borderRadius = '8px';
        panel.style.padding = '10px';
        panel.style.boxShadow = '0 8px 26px rgba(0,0,0,0.28)';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.fontSize = '12px';
        panel.style.lineHeight = '1.35';

        panel.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">',
            '<strong style="font-size:13px;">Coloriseur batch</strong>',
            `<span style="opacity:.78;font-size:10px;">v${VERSION_BATCH}</span>`,
            '</div>',
            '<div data-batch-field="detected"></div>',
            '<div data-batch-field="remaining"></div>',
            '<div data-batch-field="pending"></div>',
            '<div data-batch-field="current"></div>',
            '<div data-batch-field="success"></div>',
            '<div data-batch-field="errors"></div>',
            '<div data-batch-field="status" style="margin-bottom:8px;"></div>',
            '<select data-batch-control="resume-select" title="Patient de reprise" style="width:100%;box-sizing:border-box;margin:0 0 6px 0;padding:6px;border:0;border-radius:6px;font-size:12px;"></select>',
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">',
            '<button type="button" data-batch-action="scan">Scanner</button>',
            '<button type="button" data-batch-action="start">Lancer</button>',
            '<button type="button" data-batch-action="resume-from" style="grid-column:1 / -1;">Reprendre à</button>',
            '<button type="button" data-batch-action="pause">Pause</button>',
            '<button type="button" data-batch-action="stop">Stop</button>',
            '<button type="button" data-batch-action="log" style="grid-column:1 / -1;">Log</button>',
            '</div>'
        ].join('');

        const buttons = panel.querySelectorAll('button');
        for (const btn of buttons) {
            btn.style.border = '0';
            btn.style.borderRadius = '6px';
            btn.style.padding = '6px 7px';
            btn.style.background = '#ffffff';
            btn.style.color = '#102f4e';
            btn.style.fontWeight = '700';
            btn.style.fontSize = '12px';
            btn.style.cursor = 'pointer';
        }

        panel.addEventListener('click', event => {
            const action = event.target && event.target.getAttribute && event.target.getAttribute('data-batch-action');
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();

            if (action === 'scan') scanAndStorePatients();
            if (action === 'start') startBatch();
            if (action === 'resume-from') resumeFromSelectedPatient();
            if (action === 'pause') togglePauseResume();
            if (action === 'stop') stopBatch();
            if (action === 'log') showLogs();
        }, true);

        document.documentElement.appendChild(panel);
        runtime.panelInstalled = true;
        renderPanel();
    }

    function removePanel() {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
        runtime.panelInstalled = false;
    }

    function setPanelText(panel, field, text) {
        const el = panel.querySelector(`[data-batch-field="${field}"]`);
        if (el) el.textContent = text;
    }

    function renderPanel() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        const queue = getQueue();
        const state = getState();
        const counts = countQueue(queue);
        const runningPatient = queue.find(patient => patient && patient.id === state.runningPatientId)
            || queue.find(patient => patient && patient.status === 'running');
        const statusSuffix = state.pauseRequested ? ' (pause demandee)' : (state.stopRequested ? ' (stop demande)' : '');

        setPanelText(panel, 'detected', `Detectes : ${counts.total}`);
        setPanelText(panel, 'remaining', `Restants : ${counts.activeRemaining} / ${counts.activeTotal}`);
        setPanelText(panel, 'pending', `En attente : ${counts.pending}`);
        setPanelText(panel, 'current', `En cours : ${runningPatient ? `${runningPatient.name || 'Patient'} / ${runningPatient.id}` : '-'}`);
        setPanelText(panel, 'success', `Succes : ${counts.success}`);
        setPanelText(panel, 'errors', `Erreurs : ${counts.errors}`);
        setPanelText(panel, 'status', `Statut : ${state.status || 'idle'}${statusSuffix}`);

        const pauseButton = panel.querySelector('[data-batch-action="pause"]');
        if (pauseButton) {
            pauseButton.textContent = state.status === 'paused' ? 'Reprendre' : 'Pause';
        }

        const logButton = panel.querySelector('[data-batch-action="log"]');
        if (logButton) {
            const stats = getLogStats();
            logButton.textContent = stats.errors > 0
                ? `Logs (${stats.errors} err.)`
                : (stats.warnings > 0 ? `Logs (${stats.warnings} alert.)` : 'Logs');
        }

        renderResumeSelect(panel, queue);
    }

    function getPatientDisplayName(patient, index) {
        const rank = Number(index || 0) + 1;
        const name = patient && patient.name ? patient.name : 'Patient';
        const status = patient && patient.status ? patient.status : 'pending';
        return `${rank}. ${name} (${status})`;
    }

    function renderResumeSelect(panel, queue) {
        const select = panel.querySelector('[data-batch-control="resume-select"]');
        if (!select) return;

        const previous = select.value;
        const optionsSignature = queue.map((patient, index) => `${index}:${patient.id}:${patient.name}:${patient.status}`).join('|');
        if (select.getAttribute('data-options-signature') === optionsSignature) {
            return;
        }

        select.setAttribute('data-options-signature', optionsSignature);
        select.innerHTML = '';

        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = queue.length ? 'Choisir un patient...' : 'Scanner d\'abord';
        select.appendChild(empty);

        queue.forEach((patient, index) => {
            if (!patient || !patient.id) return;
            const option = document.createElement('option');
            option.value = patient.id;
            option.textContent = getPatientDisplayName(patient, index);
            select.appendChild(option);
        });

        if (previous && Array.from(select.options).some(option => option.value === previous)) {
            select.value = previous;
        }
    }

    function getSelectedResumePatientId() {
        const panel = document.getElementById(PANEL_ID);
        const select = panel && panel.querySelector('[data-batch-control="resume-select"]');
        return select ? select.value : '';
    }

    function formatBatchLogLine(entry) {
        const time = entry && (entry.at || (entry.ts ? new Date(entry.ts).toISOString() : '')) || '';
        const level = entry && entry.level ? String(entry.level).toUpperCase() : 'INFO';
        const phase = entry && entry.phase ? ` | ${entry.phase}` : '';
        const patient = entry && (entry.patientName || entry.patientId)
            ? ` | ${entry.patientName || entry.patientId}`
            : '';
        const message = entry && entry.message ? entry.message : '';
        return `${time} | ${level}${phase}${patient} | ${message}`;
    }

    function copyTextToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.documentElement.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            textarea.remove();
            return Promise.resolve(!!ok);
        } catch (_) {
            return Promise.resolve(false);
        }
    }

    function clearLogs() {
        gmSetJson(BATCH_KEY_LOG, []);
        refreshBatchLogPanelIfOpen();
        renderPanel();
        console.log(LOG_PREFIX, 'Journal batch efface.');
        return true;
    }

    function renderBatchLogPanelContent(panel) {
        if (!panel) return;

        const logs = getLogs();
        const stats = getLogStats();
        const rows = logs.length
            ? logs.slice().reverse().map(entry => {
                const level = String(entry.level || 'info').toLowerCase();
                const color = level === 'error' ? '#b3261e' : (level === 'warn' || level === 'warning' ? '#9a6700' : (level === 'success' ? '#116329' : '#185abc'));
                const patient = entry.patientName || entry.patientId || '';
                const detailsText = safePrettyJson(entry.details || {});

                return (
                    '<div style="border:1px solid #d0d7de;border-radius:8px;margin:8px 0;padding:10px;background:#fff">' +
                        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                            '<strong style="color:' + color + '">' + escapeHtml(level.toUpperCase()) + '</strong>' +
                            '<span style="font-family:Consolas,monospace;font-size:12px;color:#57606a">' + escapeHtml(entry.at || new Date(entry.ts || nowMs()).toISOString()) + '</span>' +
                            (entry.phase ? '<span style="font-weight:700">' + escapeHtml(entry.phase) + '</span>' : '') +
                            (patient ? '<span style="color:#57606a">' + escapeHtml(patient) + '</span>' : '') +
                        '</div>' +
                        '<div style="margin-top:6px">' + escapeHtml(entry.message || '') + '</div>' +
                        '<details style="margin-top:6px">' +
                            '<summary style="cursor:pointer;color:#185abc">Diagnostic technique</summary>' +
                            '<pre style="white-space:pre-wrap;background:#f6f8fa;padding:8px;border-radius:6px;max-height:280px;overflow:auto">' + escapeHtml(detailsText) + '</pre>' +
                        '</details>' +
                    '</div>'
                );
            }).join('')
            : '<div style="padding:12px;background:#f6f8fa;border-radius:8px">Aucun log batch pour le moment.</div>';

        panel.innerHTML =
            '<div style="position:sticky;top:0;background:#102f4e;color:#fff;padding:12px 14px;display:flex;gap:8px;align-items:center;z-index:1">' +
            '<strong style="flex:1">Journal batch coloriseur</strong>' +
                '<button type="button" data-log-action="copy" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Copier</button>' +
                '<button type="button" data-log-action="diag" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Diagnostic</button>' +
                '<button type="button" data-log-action="clear" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Effacer</button>' +
                '<button type="button" data-log-action="close" style="border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Fermer</button>' +
            '</div>' +
            '<div style="padding:14px">' +
                '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px">' +
                    '<div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:8px"><div style="color:#57606a">Total</div><strong>' + stats.total + '</strong></div>' +
                    '<div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:8px"><div style="color:#57606a">Erreurs</div><strong style="color:#b3261e">' + stats.errors + '</strong></div>' +
                    '<div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:8px"><div style="color:#57606a">Alertes</div><strong style="color:#9a6700">' + stats.warnings + '</strong></div>' +
                    '<div style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:8px"><div style="color:#57606a">Succès</div><strong style="color:#116329">' + stats.successes + '</strong></div>' +
                '</div>' +
                '<div style="font-size:12px;color:#57606a;margin-bottom:10px">Chaque alerte/erreur contient un instantané : file patients, onglet worker, heartbeat, résultat, verrous et état du contrôleur.</div>' +
                rows +
            '</div>';
    }

    function showLogs() {
        const logs = getLogs();
        try {
            console.table(logs.map(entry => ({
                time: entry.at || new Date(entry.ts).toLocaleTimeString(),
                level: entry.level,
                phase: entry.phase || '',
                patient: entry.patientName || entry.patientId,
                message: entry.message
            })));
        } catch (_) {
            console.log(LOG_PREFIX, logs);
        }

        let panel = document.getElementById(LOG_PANEL_ID);
        if (!panel) {
            panel = document.createElement('div');
            panel.id = LOG_PANEL_ID;
            panel.style.position = 'fixed';
            panel.style.inset = '22px 22px auto auto';
            panel.style.width = 'min(980px, calc(100vw - 44px))';
            panel.style.maxHeight = 'calc(100vh - 44px)';
            panel.style.overflow = 'auto';
            panel.style.zIndex = '2147483647';
            panel.style.background = '#ffffff';
            panel.style.color = '#1f2328';
            panel.style.border = '1px solid #d0d7de';
            panel.style.borderRadius = '10px';
            panel.style.boxShadow = '0 14px 42px rgba(0,0,0,0.28)';
            panel.style.font = '13px Arial, sans-serif';

            panel.addEventListener('click', async event => {
                const button = event.target && event.target.closest ? event.target.closest('button[data-log-action]') : null;
                if (!button) return;
                const action = button.getAttribute('data-log-action');

                if (action === 'close') {
                    panel.remove();
                    return;
                }

                if (action === 'clear') {
                    clearLogs();
                    return;
                }

                if (action === 'diag') {
                    addLog('info', 'Diagnostic manuel batch capture.', null, {
                        phase: 'manual_diagnostic',
                        diagnostic: getBatchRuntimeSnapshot()
                    });
                    return;
                }

                if (action === 'copy') {
                    const freshLogs = getLogs();
                    const text = JSON.stringify(freshLogs, null, 2) + '\n\n--- Resume lisible ---\n' + freshLogs.map(formatBatchLogLine).join('\n');
                    const ok = await copyTextToClipboard(text);
                    addLog(ok ? 'success' : 'warn', ok ? 'Journal batch copie.' : 'Copie du journal batch impossible.', null, { phase: 'logs' });
                }
            }, true);

            document.documentElement.appendChild(panel);
        }

        renderBatchLogPanelContent(panel);
        return logs;
    }

    /************************************************************
     * CONTROLEUR BATCH
     ************************************************************/

    function normalizeQueueBeforeStart(queue) {
        const seen = new Set();
        const clean = [];

        for (const patient of queue) {
            if (!patient || !patient.id) continue;
            const id = String(patient.id);
            if (seen.has(id)) continue;
            seen.add(id);

            const next = Object.assign({}, patient);
            if (next.status === 'running') next.status = 'pending';
            if (!next.status) next.status = 'pending';
            if (!next.url) {
                next.url = next.patientUrl
                    || (next.entryMode === 'postback' || next.entryMode === 'patient_link'
                    ? getCurrentPageUrlWithoutHash()
                    : buildPatientUrl(next.patDk || id));
            }
            clean.push(next);
        }

        return clean;
    }

    function hasPendingPatient(queue) {
        return queue.some(patient => patient && patient.id && patient.status === 'pending' && !patient.excludedByResume);
    }

    function getNextPendingPatientIndex(queue) {
        return (Array.isArray(queue) ? queue : [])
            .findIndex(patient => patient && patient.id && patient.status === 'pending' && !patient.excludedByResume);
    }

    function getRunningPatientOtherThan(queue, patientId) {
        return (Array.isArray(queue) ? queue : [])
            .find(patient => patient && patient.id && patient.id !== patientId && patient.status === 'running') || null;
    }

    function getRunningPatient(queue) {
        return (Array.isArray(queue) ? queue : [])
            .find(patient => patient && patient.id && patient.status === 'running') || null;
    }

    async function startBatch() {
        let queue = normalizeQueueBeforeStart(getQueue());

        if (!queue.length) {
            queue = scanAndStorePatients();
            queue = normalizeQueueBeforeStart(queue);
        }

        if (!queue.length) {
            alert('Aucun patient detecte sur cette page.');
            return [];
        }

        if (!hasPendingPatient(queue)) {
            alert('Aucun patient en attente. Les succes ne sont pas relances automatiquement.');
            addLog('warn', 'Demarrage ignore : aucun patient pending.');
            return queue;
        }

        const pendingCount = queue.filter(patient => patient && patient.status === 'pending' && !patient.excludedByResume).length;
        if (pendingCount > 10 && !confirm(`Lancer le coloriseur pour ${pendingCount} patients ?`)) {
            addLog('warn', 'Demarrage annule par utilisateur.', null, { pendingCount });
            return queue;
        }

        saveQueue(queue);

        const previousState = getState();
        const batchId = previousState.status === 'paused' && previousState.batchId
            ? previousState.batchId
            : makeBatchId();

        if (!acquireControllerLock(batchId)) {
            alert('Un batch semble deja pilote par un autre onglet.');
            addLog('warn', 'Demarrage bloque par le verrou controleur.', null, { batchId });
            return queue;
        }

        gmDelete(BATCH_KEY_RESULT);
        gmDelete(BATCH_KEY_CURRENT);
        gmDelete(BATCH_KEY_CHAIN_LOCK);
        setCommand('start', { batchId });

        setState({
            batchId,
            status: 'running',
            startedAt: previousState.startedAt || nowMs(),
            finishedAt: null,
            runningPatientId: null,
            pauseRequested: false,
            stopRequested: false
        });

        addLog('success', 'Batch lance.', null, { batchId, pendingCount });
        processNextPatient();
        return queue;
    }

    function acquireControllerLock(batchId) {
        const lock = gmGetJson(BATCH_KEY_LOCK, null);
        const now = nowMs();

        if (lock && lock.controllerId && lock.controllerId !== CONTROLLER_ID && Number(lock.expiresAt || 0) > now) {
            return false;
        }

        renewControllerLock(batchId);
        if (runtime.lockTimer) clearInterval(runtime.lockTimer);
        runtime.lockTimer = setInterval(() => renewControllerLock(batchId), Math.max(5000, CONTROLLER_LOCK_TTL_MS / 3));
        return true;
    }

    function renewControllerLock(batchId) {
        gmSetJson(BATCH_KEY_LOCK, {
            controllerId: CONTROLLER_ID,
            batchId,
            ts: nowMs(),
            expiresAt: nowMs() + CONTROLLER_LOCK_TTL_MS
        });
    }

    function releaseControllerLock() {
        if (runtime.lockTimer) {
            clearInterval(runtime.lockTimer);
            runtime.lockTimer = null;
        }

        const lock = gmGetJson(BATCH_KEY_LOCK, null);
        if (lock && lock.controllerId === CONTROLLER_ID) {
            gmDelete(BATCH_KEY_LOCK);
        }
    }

    function getLiveControllerLock(batchId) {
        const lock = gmGetJson(BATCH_KEY_LOCK, null);
        if (!lock || !lock.controllerId) return null;
        if (batchId && lock.batchId !== batchId) return null;
        if (Number(lock.expiresAt || 0) <= nowMs()) return null;
        return lock;
    }

    function acquireChainLock(batchId, reason = '') {
        const now = nowMs();
        const existing = gmGetJson(BATCH_KEY_CHAIN_LOCK, null);

        if (
            existing &&
            existing.batchId === batchId &&
            existing.ownerId &&
            existing.ownerId !== CONTROLLER_ID &&
            Number(existing.expiresAt || 0) > now
        ) {
            addLog('warn', 'Ouverture patient suivant bloquee par verrou chaine actif.', null, {
                phase: 'chain_lock_active',
                reason,
                lock: existing,
                controllerId: CONTROLLER_ID,
                lockAgeMs: valueAgeMs(existing),
                diagnostic: buildBlockedBatchDiagnostic('chain_lock_active', { reason })
            });
            return false;
        }

        const token = `${CONTROLLER_ID}_${now}_${Math.floor(Math.random() * 1000000)}`;
        gmSetJson(BATCH_KEY_CHAIN_LOCK, {
            batchId,
            ownerId: CONTROLLER_ID,
            token,
            reason,
            acquiredAt: now,
            expiresAt: now + CHAIN_LOCK_TTL_MS,
            url: window.location.href
        });

        const confirmed = gmGetJson(BATCH_KEY_CHAIN_LOCK, null);
        const ok = !!(
            confirmed &&
            confirmed.batchId === batchId &&
            confirmed.ownerId === CONTROLLER_ID &&
            confirmed.token === token
        );

        if (!ok) {
            addLog('warn', 'Verrou chaine non confirme.', null, {
                phase: 'chain_lock_unconfirmed',
                reason,
                confirmed,
                diagnostic: buildBlockedBatchDiagnostic('chain_lock_unconfirmed', { reason })
            });
        }

        return ok;
    }

    function releaseChainLock(batchId) {
        const lock = gmGetJson(BATCH_KEY_CHAIN_LOCK, null);
        if (lock && lock.batchId === batchId && lock.ownerId === CONTROLLER_ID) {
            gmDelete(BATCH_KEY_CHAIN_LOCK);
        }
    }

    async function processNextPatient() {
        if (runtime.processing) return;
        runtime.processing = true;
        addLog('info', 'Controleur batch actif : recherche du prochain patient.', null, {
            phase: 'controller_loop_start',
            diagnostic: getBatchRuntimeSnapshot()
        });

        try {
            while (true) {
                const state = getState();

                if (state.stopRequested || state.status === 'stopped') {
                    setState({ status: 'stopped', runningPatientId: null, finishedAt: nowMs() });
                    addLog('warn', 'Batch stoppe.');
                    break;
                }

                if (state.pauseRequested || state.status === 'paused') {
                    setState({ status: 'paused', runningPatientId: null });
                    addLog('info', 'Batch en pause.');
                    break;
                }

                let queue = getQueue();
                const runningPatient = getRunningPatient(queue);
                if (runningPatient) {
                    const pendingResult = gmGetJson(BATCH_KEY_RESULT, null);
                    const resultMatchesRunning = pendingResult &&
                        pendingResult.batchId === state.batchId &&
                        pendingResult.patientId === runningPatient.id;

                    if (resultMatchesRunning) {
                        addLog('info', 'Resultat en attente applique avant ouverture du patient suivant.', runningPatient, {
                            phase: 'controller_apply_pending_result',
                            result: pendingResult,
                            previousStatus: state.status,
                            diagnostic: getBatchRuntimeSnapshot()
                        });
                        applyPatientOutcomeToQueue(runningPatient.id, pendingResult, runningPatient);
                        gmDelete(BATCH_KEY_RESULT);
                        setState({ status: 'next_patient', runningPatientId: null });
                        continue;
                    }

                    addLog('warn', 'Patient deja en cours : ouverture du suivant bloquee.', runningPatient, {
                        phase: 'controller_running_guard',
                        runningPatientId: runningPatient.id,
                        stateRunningPatientId: state.runningPatientId || '',
                        previousStatus: state.status,
                        diagnostic: buildBlockedBatchDiagnostic('running_patient_guard_blocked_next_open', {
                            runningPatient: summarizePatientForLog(runningPatient)
                        })
                    });
                    break;
                }

                const runningElsewhere = getRunningPatientOtherThan(queue, state.runningPatientId);
                if (runningElsewhere) {
                    addLog('warn', 'Un autre onglet a deja lance un patient : controleur en attente.', runningElsewhere, {
                        runningPatientId: runningElsewhere.id,
                        previousStatus: state.status
                    });
                    break;
                }

                const nextIndex = getNextPendingPatientIndex(queue);

                if (nextIndex < 0) {
                    const counts = countQueue(queue);
                    setState({ status: 'finished', runningPatientId: null, finishedAt: nowMs() });
                    addLog('success', 'Batch termine.', null, counts);
                    alert(`Batch coloriseur termine.\nSucces : ${counts.success}\nErreurs : ${counts.errors}`);
                    break;
                }

                const patient = queue[nextIndex];
                const batchId = state.batchId || makeBatchId();
                const patientStart = nowMs();

                if (!acquireChainLock(batchId, 'controller_open_next')) {
                    addLog('warn', 'Controleur laisse le relais chaine ouvrir le patient suivant.', patient, {
                        phase: 'chain_lock_blocked',
                        batchId,
                        nextIndex,
                        diagnostic: buildBlockedBatchDiagnostic('controller_open_next_lock_blocked', {
                            patient: summarizePatientForLog(patient, nextIndex)
                        })
                    });
                    break;
                }

                queue[nextIndex] = Object.assign({}, patient, {
                    status: 'running',
                    startedAt: patientStart,
                    finishedAt: null,
                    error: null
                });
                saveQueue(queue);

                setState({
                    batchId,
                    status: 'opening_patient',
                    runningPatientId: patient.id
                });

                addLog('info', 'Debut patient.', patient, {
                    phase: 'patient_start',
                    batchId,
                    nextIndex,
                    progress: getQueueProgressSnapshot(getQueue())
                });

                let worker = null;
                let outcome = null;

                try {
                    worker = openPatientWorker(patient, batchId, { source: 'controller', setParent: true });
                    releaseChainLock(batchId);
                    outcome = await waitForWorkerOutcome(patient, batchId, worker, patientStart);
                } catch (e) {
                    releaseChainLock(batchId);
                    outcome = {
                        status: 'error',
                        message: e && e.message ? e.message : String(e),
                        ts: nowMs()
                    };
                }

                setState({ status: 'closing_worker', runningPatientId: patient.id });
                closeWorkerTab(worker);

                applyPatientOutcomeToQueue(patient.id, outcome, patient);
                const relayedRunning = getRunningPatientOtherThan(getQueue(), patient.id);
                if (relayedRunning) {
                    addLog('warn', 'Relais deja actif : le controleur ne relance pas de patient en double.', relayedRunning, {
                        phase: 'chain_handoff_duplicate_guard',
                        previousPatientId: patient.id,
                        runningPatientId: relayedRunning.id,
                        outcome,
                        diagnostic: buildBlockedBatchDiagnostic('relayed_running_after_outcome', {
                            previousPatient: summarizePatientForLog(patient),
                            relayedRunning: summarizePatientForLog(relayedRunning)
                        })
                    });
                    break;
                }

                setState({ status: 'next_patient', runningPatientId: null });
                addLog('info', 'Patient suivant.', patient, {
                    phase: 'next_patient',
                    progress: getQueueProgressSnapshot(getQueue())
                });
                await sleep(NEXT_PATIENT_AFTER_WORKER_CLOSE_DELAY_MS);
            }
        } finally {
            runtime.processing = false;
            releaseControllerLock();
            renderPanel();
        }
    }

    function normalizeOutcomeStatus(status) {
        if (status === 'success') return 'success';
        if (status === 'timeout') return 'timeout';
        if (status === 'skipped') return 'skipped';
        return 'error';
    }

    function applyPatientOutcomeToQueue(patientId, outcome, patientForLog = null) {
        if (!patientId || !outcome) return false;

        const queue = getQueue();
        const currentIndex = queue.findIndex(item => item && item.id === patientId);
        if (currentIndex < 0) return false;

        if (outcome.resultId && queue[currentIndex].batchResultId === outcome.resultId) {
            return false;
        }

        const patient = patientForLog || queue[currentIndex];
        queue[currentIndex] = Object.assign({}, queue[currentIndex], {
            status: normalizeOutcomeStatus(outcome.status),
            finishedAt: nowMs(),
            error: outcome.status === 'success' ? null : (outcome.message || 'Erreur inconnue'),
            report: outcome.report || null,
            batchResultId: outcome.resultId || queue[currentIndex].batchResultId || ''
        });
        saveQueue(queue);

        addLog(
            outcome.status === 'success' ? 'success' : (outcome.status === 'timeout' ? 'error' : 'error'),
            outcome.message || `Patient termine avec statut ${outcome.status}`,
            patient,
            {
                phase: 'patient_outcome',
                outcome,
                previousPatientStatus: patient && patient.status,
                progress: getQueueProgressSnapshot(queue)
            }
        );

        return true;
    }

    function buildWorkerUrl(patient, batchId) {
        const fallbackUrl = (patient.entryMode === 'postback' || patient.entryMode === 'patient_link')
            ? getCurrentPageUrlWithoutHash()
            : buildPatientUrl(patient.patDk || patient.id);
        const baseUrl = patient.patientUrl || patient.url || fallbackUrl;
        const base = String(baseUrl).split('#')[0];
        return `${base}#${WORKER_HASH_PREFIX}${encodeURIComponent(batchId)}&patient=${encodeURIComponent(patient.id)}`;
    }

    function openPatientWorker(patient, batchId, options = {}) {
        const url = buildWorkerUrl(patient, batchId);
        const source = options.source || 'controller';
        const setParent = options.setParent !== undefined ? !!options.setParent : true;
        const current = {
            batchId,
            patientId: patient.id,
            patientName: patient.name || '',
            url,
            patient,
            patientUrl: patient.patientUrl || '',
            openedAt: nowMs(),
            openedBy: CONTROLLER_ID,
            openSource: source
        };
        gmSetJson(BATCH_KEY_CURRENT, current);
        gmDelete(BATCH_KEY_RESULT);

        let tab = null;
        try {
            tab = GM_openInTab(url, { active: OPEN_WORKER_ACTIVE, insert: OPEN_WORKER_INSERT, setParent });
        } catch (e1) {
            try {
                tab = GM_openInTab(url, OPEN_WORKER_ACTIVE);
            } catch (e2) {
                addLog('error', 'Ouverture worker impossible.', patient, {
                    phase: 'worker_open_failed',
                    url,
                    source,
                    setParent,
                    error: String(e2 && e2.message ? e2.message : e2),
                    diagnostic: buildBlockedBatchDiagnostic('worker_open_failed', {
                        patient: summarizePatientForLog(patient)
                    })
                });
                throw e2;
            }
        }

        addLog('info', 'Ouverture worker.', patient, {
            phase: 'worker_opened',
            url,
            entryMode: patient.entryMode || '',
            patientUrl: patient.patientUrl || '',
            source,
            setParent,
            active: OPEN_WORKER_ACTIVE,
            insert: OPEN_WORKER_INSERT,
            current
        });
        return { tab, url, closed: false };
    }

    function continueBatchAfterWorkerResult(result, source = 'worker_handoff') {
        if (!result || !result.batchId || !result.patientId) return false;

        const state = getState();
        if (state.pauseRequested || state.stopRequested || ['paused', 'stopped', 'finished'].includes(state.status)) {
            addLog('info', 'Relais chaine ignore : batch en pause/stop/termine.', { id: result.patientId }, {
                phase: 'chain_handoff_ignored_state',
                source,
                status: state.status,
                pauseRequested: state.pauseRequested,
                stopRequested: state.stopRequested,
                result,
                diagnostic: getBatchRuntimeSnapshot()
            });
            return false;
        }

        let queue = getQueue();
        const resultPatient = queue.find(patient => patient && patient.id === result.patientId);
        const resultStillActive = !!(
            (state.runningPatientId && state.runningPatientId === result.patientId) ||
            (resultPatient && resultPatient.status === 'running')
        );

        if (!resultStillActive) {
            addLog('info', 'Relais chaine ignore : resultat deja pris en compte.', { id: result.patientId }, {
                phase: 'chain_handoff_ignored_result',
                source,
                status: state.status,
                runningPatientId: state.runningPatientId,
                patientStatus: resultPatient && resultPatient.status,
                result,
                diagnostic: getBatchRuntimeSnapshot()
            });
            return false;
        }

        if (!acquireChainLock(result.batchId, source)) {
            addLog('warn', 'Relais chaine impossible : verrou non acquis.', { id: result.patientId }, {
                phase: 'chain_handoff_lock_failed',
                source,
                result,
                diagnostic: buildBlockedBatchDiagnostic('chain_handoff_lock_failed')
            });
            return false;
        }

        try {
            addLog('info', 'Relais chaine prend en compte le resultat worker.', { id: result.patientId }, {
                phase: 'chain_handoff_apply_result',
                source,
                result,
                progressBefore: getQueueProgressSnapshot(queue)
            });
            applyPatientOutcomeToQueue(result.patientId, result, resultPatient || { id: result.patientId });
            gmDelete(BATCH_KEY_RESULT);

            queue = getQueue();
            const runningPatient = getRunningPatient(queue);
            if (runningPatient) {
                setState({
                    batchId: result.batchId,
                    status: 'waiting_patient_page',
                    runningPatientId: runningPatient.id,
                    finishedAt: null
                });
                addLog('warn', 'Relais chaine : patient deja en cours, ouverture suivante annulee.', runningPatient, {
                    phase: 'chain_handoff_running_guard',
                    source,
                    previousPatientId: result.patientId,
                    runningPatient: summarizePatientForLog(runningPatient),
                    progress: getQueueProgressSnapshot(queue),
                    diagnostic: buildBlockedBatchDiagnostic('chain_handoff_running_guard')
                });
                releaseChainLock(result.batchId);
                return true;
            }

            const nextIndex = getNextPendingPatientIndex(queue);

            if (nextIndex < 0) {
                const counts = countQueue(queue);
                gmDelete(BATCH_KEY_CURRENT);
                gmDelete(BATCH_KEY_WORKER_HEARTBEAT);
                setState({ status: 'finished', runningPatientId: null, finishedAt: nowMs() });
                addLog('success', 'Batch termine par relais automatique.', null, {
                    phase: 'chain_handoff_finished',
                    source,
                    counts
                });
                releaseChainLock(result.batchId);
                return true;
            }

            const nextPatient = queue[nextIndex];
            const patientStart = nowMs();
            queue[nextIndex] = Object.assign({}, nextPatient, {
                status: 'running',
                startedAt: patientStart,
                finishedAt: null,
                error: null
            });
            saveQueue(queue);

            setState({
                batchId: result.batchId,
                status: 'opening_patient',
                runningPatientId: nextPatient.id,
                finishedAt: null
            });

            addLog('warn', 'Relais automatique : ouverture du patient suivant sans attendre la liste.', nextPatient, {
                phase: 'chain_handoff_open_next',
                source,
                previousPatientId: result.patientId,
                nextIndex,
                remainingPending: getQueue().filter(patient => patient && patient.status === 'pending' && !patient.excludedByResume).length,
                progress: getQueueProgressSnapshot(getQueue())
            });

            openPatientWorker(nextPatient, result.batchId, { source, setParent: true });
            releaseChainLock(result.batchId);
            return true;
        } catch (e) {
            releaseChainLock(result.batchId);
            addLog('error', 'Relais automatique impossible.', { id: result.patientId }, {
                phase: 'chain_handoff_error',
                source,
                error: String(e && e.message ? e.message : e),
                state: getState(),
                current: gmGetJson(BATCH_KEY_CURRENT, null),
                chainLock: gmGetJson(BATCH_KEY_CHAIN_LOCK, null),
                diagnostic: buildBlockedBatchDiagnostic('chain_handoff_error')
            });
            return false;
        }
    }

    function scheduleWorkerHandoff(result) {
        if (!getWorkerInfoFromHash()) return false;
        if (!result || !result.batchId || !result.patientId) return false;
        if (!WORKER_CHAIN_HANDOFF_ENABLED) {
            addLog('info', 'Relais worker desactive : attente du controleur liste.', { id: result.patientId }, {
                phase: 'worker_handoff_deferred_to_controller',
                resultId: result.resultId || '',
                status: result.status,
                result,
                progress: getQueueProgressSnapshot(getQueue())
            });
            return false;
        }

        const controllerLock = getLiveControllerLock(result.batchId);
        if (controllerLock && controllerLock.controllerId !== CONTROLLER_ID) {
            addLog('info', 'Relais automatique tente malgre le controleur principal actif.', { id: result.patientId }, {
                phase: 'chain_handoff_controller_active_but_attempted',
                resultId: result.resultId || '',
                status: result.status,
                controllerLock,
                lockAgeMs: valueAgeMs(controllerLock)
            });
        }

        addLog('info', 'Relais automatique programme depuis le worker.', { id: result.patientId }, {
            phase: 'chain_handoff_scheduled',
            resultId: result.resultId || '',
            delayMs: WORKER_HANDOFF_DELAY_MS,
            status: result.status,
            result,
            progress: getQueueProgressSnapshot(getQueue())
        });

        setTimeout(() => {
            continueBatchAfterWorkerResult(result, 'worker_result_handoff');
        }, WORKER_HANDOFF_DELAY_MS);

        return true;
    }

    function closeWorkerTab(worker) {
        if (!worker || !worker.tab) return;
        try {
            if (typeof worker.tab.close === 'function') worker.tab.close();
        } catch (_) {}
        try {
            if (worker.tab && !worker.tab.closed && worker.tab.location) {
                worker.tab.location.replace('about:blank');
            }
        } catch (_) {
            try {
                if (worker.tab && !worker.tab.closed) worker.tab.location.href = 'about:blank';
            } catch (_) {}
        }
        try {
            if (typeof worker.tab.close === 'function') worker.tab.close();
        } catch (_) {}
        worker.closed = true;
    }

    function focusWorkerTab(worker, patient, reason = '', options = {}) {
        if (!worker || !worker.tab || worker.closed) return false;

        let focused = false;
        try {
            if (typeof worker.tab.focus === 'function') {
                worker.tab.focus();
                focused = true;
            }
        } catch (_) {}

        try {
            if (!focused && worker.tab.window && typeof worker.tab.window.focus === 'function') {
                worker.tab.window.focus();
                focused = true;
            }
        } catch (_) {}

        if (focused && !options.quiet) {
            addLog(options.level || 'warn', options.message || 'Worker WEDA remis au premier plan.', patient, {
                phase: options.phase || 'worker_focus_after_stale_heartbeat',
                reason,
                workerUrl: worker.url || '',
                skipDiagnostic: true
            });
        }

        return focused;
    }

    async function waitForLateTerminalOutcomeAfterWorkerClose(patient, batchId, launchedAt, clickTs) {
        const bridgeClickTs = Number(clickTs || 0) || launchedAt;
        return await waitFor(() => {
            const result = gmGetJson(BATCH_KEY_RESULT, null);
            if (
                result &&
                result.batchId === batchId &&
                result.patientId === patient.id &&
                Number(result.ts || 0) >= launchedAt - 1000
            ) {
                return result;
            }

            const bridgeOutcome = readLocalStorageBridgeReport(bridgeClickTs, {
                batchId,
                patientId: patient.id
            });
            if (!bridgeOutcome) return null;

            return {
                batchId,
                patientId: patient.id,
                status: bridgeOutcome.status,
                message: bridgeOutcome.message,
                report: bridgeOutcome.report,
                ts: nowMs()
            };
        }, 8000, 250);
    }

    async function waitForWorkerOutcome(patient, batchId, worker, launchedAt) {
        let tabClosed = false;
        let lastHeartbeat = null;
        let staleLogged = false;
        let staleAfterClickLogged = false;
        let outcomeWake = null;
        let lastBridgeProgressSignature = '';
        let lastBridgeProgressAt = launchedAt;
        let lastForegroundRescueAt = 0;
        let foregroundRescueCount = 0;
        let lastWorkerFocusAt = 0;
        let workerFocusCount = 0;
        let lastForegroundKeepAliveAt = 0;
        let foregroundKeepAliveLogged = false;
        let noHeartbeatFocused = false;
        let noHeartbeatReopened = false;

        try {
            if (worker && worker.tab && 'onclose' in worker.tab) {
                worker.tab.onclose = () => {
                    tabClosed = true;
                    if (worker) worker.closed = true;
                };
            }
        } catch (_) {}

        setState({ status: 'waiting_patient_page', runningPatientId: patient.id });
        addLog('info', 'Attente resultat worker.', patient, {
            phase: 'worker_outcome_wait',
            batchId,
            launchedAt,
            workerUrl: worker && worker.url || ''
        });

        while (nowMs() - launchedAt < PATIENT_TIMEOUT_MS) {
            const result = gmGetJson(BATCH_KEY_RESULT, null);
            if (result && result.batchId === batchId && result.patientId === patient.id && Number(result.ts || 0) >= launchedAt - 1000) {
                addLog('success', 'Resultat worker recu par lecture directe.', patient, {
                    phase: 'worker_outcome_received',
                    result,
                    elapsedMs: nowMs() - launchedAt
                });
                return result;
            }

            const directBridgeOutcome = readLocalStorageBridgeReport(
                lastHeartbeat && lastHeartbeat.clickedAt ? lastHeartbeat.clickedAt : launchedAt,
                { batchId, patientId: patient.id }
            );
            if (directBridgeOutcome) {
                const relayed = {
                    batchId,
                    patientId: patient.id,
                    status: directBridgeOutcome.status,
                    message: directBridgeOutcome.message,
                    report: directBridgeOutcome.report,
                    ts: nowMs()
                };
                addLog('success', 'Resultat coloriseur recu par pont localStorage.', patient, {
                    phase: 'worker_outcome_bridge_direct',
                    result: relayed,
                    elapsedMs: nowMs() - launchedAt
                });
                return relayed;
            }

            const rawBridgeReport = readRawLocalStorageBridgeReport({ batchId, patientId: patient.id }, launchedAt);
            if (rawBridgeReport) {
                const progressSignature = getBridgeProgressSignature(rawBridgeReport);
                if (progressSignature && progressSignature !== lastBridgeProgressSignature) {
                    lastBridgeProgressSignature = progressSignature;
                    lastBridgeProgressAt = nowMs();
                }

                const bridgeStalledForMs = nowMs() - lastBridgeProgressAt;
                if (
                    isActiveImportBridgeReport(rawBridgeReport) &&
                    bridgeStalledForMs >= WEDA_IMPORT_RESCUE_AFTER_MS &&
                    nowMs() - lastForegroundRescueAt >= WEDA_IMPORT_RESCUE_COOLDOWN_MS &&
                    foregroundRescueCount < MAX_WEDA_IMPORT_RESCUES_PER_PATIENT
                ) {
                    foregroundRescueCount += 1;
                    lastForegroundRescueAt = nowMs();
                    requestSilentCim10ImportNudge(
                        rawBridgeReport,
                        patient,
                        'controller_bridge_import_stalled',
                        foregroundRescueCount
                    );
                }

                if (
                    isActiveImportBridgeReport(rawBridgeReport) &&
                    nowMs() - lastBridgeProgressAt >= WEDA_IMPORT_TERMINAL_STALL_MS &&
                    foregroundRescueCount >= MAX_WEDA_IMPORT_RESCUES_PER_PATIENT
                ) {
                    const stalledForMs = nowMs() - lastBridgeProgressAt;
                    const report = summarizeReport(rawBridgeReport);
                    addLog('error', 'Import WEDA bloqué sans progression après plusieurs réveils : patient marqué en erreur.', patient, {
                        phase: 'weda_import_stalled_after_rescues',
                        batchId,
                        elapsedMs: nowMs() - launchedAt,
                        stalledForMs,
                        rescueCount: foregroundRescueCount,
                        report,
                        skipDiagnostic: true
                    });
                    return {
                        batchId,
                        patientId: patient.id,
                        status: 'error',
                        message: 'Import WEDA bloqué sans progression après plusieurs réveils.',
                        ts: nowMs(),
                        report: {
                            reason: 'weda_import_stalled_after_rescues',
                            stalledForMs,
                            rescueCount: foregroundRescueCount,
                            bridgeReport: report
                        }
                    };
                }
            }

            const heartbeat = gmGetJson(BATCH_KEY_WORKER_HEARTBEAT, null);
            if (heartbeat && heartbeat.batchId === batchId && heartbeat.patientId === patient.id && Number(heartbeat.ts || 0) >= launchedAt - 1000) {
                lastHeartbeat = heartbeat;
                mirrorWorkerStatusToState(heartbeat.status, patient.id);
            }

            const clicked = !!(lastHeartbeat && (lastHeartbeat.clickedAt || isAfterCim10ClickStatus(lastHeartbeat.status)));

            if (
                clicked &&
                KEEP_COLORISEUR_WORKER_FOREGROUND &&
                nowMs() - lastForegroundKeepAliveAt >= COLORISEUR_WORKER_FOREGROUND_INTERVAL_MS
            ) {
                lastForegroundKeepAliveAt = nowMs();
                const focused = focusWorkerTab(worker, patient, 'coloriseur_keepalive', {
                    level: 'info',
                    phase: 'worker_foreground_keepalive',
                    message: 'Onglet coloriseur maintenu actif pendant le traitement.',
                    quiet: foregroundKeepAliveLogged
                });
                if (focused) foregroundKeepAliveLogged = true;
            }

            if (!lastHeartbeat) {
                const silentForMs = nowMs() - launchedAt;

                if (!noHeartbeatFocused && silentForMs >= WORKER_NO_HEARTBEAT_FOCUS_MS) {
                    noHeartbeatFocused = true;
                    focusWorkerTab(worker, patient, 'no_heartbeat_after_open');
                    addLog('warn', 'Worker WEDA ouvert mais aucun demarrage detecte : remise au premier plan.', patient, {
                        phase: 'worker_no_heartbeat_focus',
                        batchId,
                        elapsedMs: silentForMs,
                        workerUrl: worker && worker.url || '',
                        current: gmGetJson(BATCH_KEY_CURRENT, null),
                        skipDiagnostic: true
                    });
                }

                if (!noHeartbeatReopened && silentForMs >= WORKER_NO_HEARTBEAT_REOPEN_MS) {
                    noHeartbeatReopened = true;
                    addLog('warn', 'Worker WEDA toujours silencieux : fermeture puis reouverture du worker.', patient, {
                        phase: 'worker_no_heartbeat_reopen',
                        batchId,
                        elapsedMs: silentForMs,
                        workerUrl: worker && worker.url || '',
                        current: gmGetJson(BATCH_KEY_CURRENT, null),
                        diagnostic: buildBlockedBatchDiagnostic('worker_opened_without_start_reopen', {
                            patient: summarizePatientForLog(patient),
                            batchId
                        })
                    });
                    closeWorkerTab(worker);
                    worker = openPatientWorker(patient, batchId, { source: 'controller_no_heartbeat_reopen', setParent: true });
                    launchedAt = nowMs();
                    lastBridgeProgressAt = launchedAt;
                    noHeartbeatFocused = false;
                    continue;
                }

                if (silentForMs >= WORKER_NO_HEARTBEAT_TIMEOUT_MS) {
                    addLog('error', 'Timeout : worker WEDA ouvert mais script worker jamais demarre.', patient, {
                        phase: 'worker_no_heartbeat_timeout',
                        batchId,
                        elapsedMs: silentForMs,
                        workerUrl: worker && worker.url || '',
                        current: gmGetJson(BATCH_KEY_CURRENT, null),
                        diagnostic: buildBlockedBatchDiagnostic('worker_opened_without_start_timeout', {
                            patient: summarizePatientForLog(patient),
                            batchId
                        })
                    });
                    return {
                        batchId,
                        patientId: patient.id,
                        status: 'timeout',
                        message: 'Timeout : worker WEDA ouvert mais le script worker ne demarre pas.',
                        ts: nowMs(),
                        report: {
                            reason: 'worker_no_heartbeat_timeout',
                            current: gmGetJson(BATCH_KEY_CURRENT, null)
                        }
                    };
                }
            }

            if (tabClosed) {
                if (clicked) {
                    const lateOutcome = await waitForLateTerminalOutcomeAfterWorkerClose(
                        patient,
                        batchId,
                        launchedAt,
                        lastHeartbeat && lastHeartbeat.clickedAt
                    );
                    if (lateOutcome) {
                        addLog('success', 'Resultat terminal recupere apres fermeture worker.', patient, {
                            phase: 'worker_tab_closed_late_result',
                            result: lateOutcome,
                            elapsedMs: nowMs() - launchedAt,
                            lastHeartbeat
                        });
                        return lateOutcome;
                    }

                    addLog('error', 'Onglet worker ferme avant statut terminal coloriseur.', patient, {
                        phase: 'worker_tab_closed',
                        clicked,
                        elapsedMs: nowMs() - launchedAt,
                        lastHeartbeat,
                        diagnostic: buildBlockedBatchDiagnostic('worker_ferme_avant_statut_terminal_cim10', {
                            patient: summarizePatientForLog(patient),
                            batchId,
                            lastHeartbeat
                        })
                    });
                    return {
                        batchId,
                        patientId: patient.id,
                        status: 'error',
                        message: 'Onglet worker ferme avant statut terminal coloriseur.',
                        ts: nowMs(),
                        report: { reason: 'worker_closed_before_terminal_cim10_status', lastHeartbeat }
                    };
                }

                addLog('error', 'Onglet worker ferme avant lancement coloriseur.', patient, {
                    phase: 'worker_tab_closed',
                    clicked,
                    elapsedMs: nowMs() - launchedAt,
                    lastHeartbeat
                });
                return {
                    batchId,
                    patientId: patient.id,
                    status: 'error',
                    message: 'Worker ferme avant lancement coloriseur.',
                    ts: nowMs()
                };
            }

            if (lastHeartbeat && nowMs() - Number(lastHeartbeat.ts || 0) > HEARTBEAT_STALE_MS) {
                if (clicked) {
                    if (
                        workerFocusCount < MAX_WORKER_STALE_FOCUS_ATTEMPTS &&
                        nowMs() - lastWorkerFocusAt >= WORKER_STALE_FOCUS_COOLDOWN_MS
                    ) {
                        workerFocusCount += 1;
                        lastWorkerFocusAt = nowMs();
                        focusWorkerTab(worker, patient, `heartbeat_stale_after_click_${workerFocusCount}`);
                    }

                    if (!staleAfterClickLogged) {
                        staleAfterClickLogged = true;
                        addLog('warn', 'Heartbeat worker en retard apres lancement coloriseur : attente du statut terminal.', patient, {
                            phase: 'worker_heartbeat_stale_after_click',
                            elapsedMs: nowMs() - launchedAt,
                            heartbeatAgeMs: nowMs() - Number(lastHeartbeat.ts || 0),
                            lastHeartbeat,
                            workerFocusCount,
                            skipDiagnostic: true
                        });
                    }
                }
                else if (!staleLogged) {
                    staleLogged = true;
                    addLog('warn', 'Heartbeat worker en retard.', patient, {
                        phase: 'worker_heartbeat_stale',
                        elapsedMs: nowMs() - launchedAt,
                        heartbeatAgeMs: nowMs() - Number(lastHeartbeat.ts || 0),
                        clicked,
                        lastHeartbeat,
                        diagnostic: buildBlockedBatchDiagnostic('heartbeat_worker_en_retard', {
                            patient: summarizePatientForLog(patient),
                            batchId
                        })
                    });
                }

                if (!clicked) {
                    const earlyStageBudget = PAGE_LOAD_TIMEOUT_MS + ANTECEDENTS_NAV_TIMEOUT_MS + COLORISEUR_LAUNCH_TIMEOUT_MS;
                    if (nowMs() - launchedAt > earlyStageBudget) {
                        addLog('error', 'Timeout : worker silencieux avant lancement coloriseur.', patient, {
                            phase: 'worker_heartbeat_timeout',
                            elapsedMs: nowMs() - launchedAt,
                            earlyStageBudget,
                            lastHeartbeat,
                            diagnostic: buildBlockedBatchDiagnostic('worker_silencieux_avant_clic_cim10', {
                                patient: summarizePatientForLog(patient),
                                batchId
                            })
                        });
                        return {
                            batchId,
                            patientId: patient.id,
                            status: 'timeout',
                            message: 'Timeout : worker silencieux avant lancement coloriseur.',
                            ts: nowMs(),
                            report: { lastHeartbeat }
                        };
                    }
                }
            }

            outcomeWake = waitForWorkerOutcomeSignal(batchId, patient.id, launchedAt, 1000);
            const signaledResult = await outcomeWake;
            outcomeWake = null;
            if (signaledResult) {
                addLog('success', 'Resultat worker recu par signal inter-onglets.', patient, {
                    phase: 'worker_outcome_signal',
                    result: signaledResult,
                    elapsedMs: nowMs() - launchedAt
                });
                return signaledResult;
            }
        }

        addLog('error', `Timeout patient apres ${Math.round(PATIENT_TIMEOUT_MS / 60000)} minutes.`, patient, {
            phase: 'worker_outcome_timeout',
            elapsedMs: nowMs() - launchedAt,
            lastHeartbeat,
            diagnostic: buildBlockedBatchDiagnostic('timeout_patient_global', {
                patient: summarizePatientForLog(patient),
                batchId
            })
        });
        return {
            batchId,
            patientId: patient.id,
            status: 'timeout',
            message: `Timeout patient apres ${Math.round(PATIENT_TIMEOUT_MS / 60000)} minutes.`,
            ts: nowMs(),
            report: { lastHeartbeat }
        };
    }

    function waitForWorkerOutcomeSignal(batchId, patientId, launchedAt, timeoutMs) {
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                if (runtime.outcomeWaiter && runtime.outcomeWaiter.resolve === finish) {
                    runtime.outcomeWaiter = null;
                }
                resolve(null);
            }, timeoutMs);

            function finish(result) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (runtime.outcomeWaiter && runtime.outcomeWaiter.resolve === finish) {
                    runtime.outcomeWaiter = null;
                }
                resolve(result || null);
            }

            runtime.outcomeWaiter = {
                batchId,
                patientId,
                launchedAt,
                resolve: finish
            };
        });
    }

    function signalWorkerOutcomeIfWaiting(result) {
        const waiter = runtime.outcomeWaiter;
        if (!waiter || !result) return false;

        if (
            result.batchId === waiter.batchId &&
            result.patientId === waiter.patientId &&
            Number(result.ts || 0) >= waiter.launchedAt - 1000
        ) {
            waiter.resolve(result);
            return true;
        }

        if (result.batchId === waiter.batchId) {
            addLog('warn', 'Signal resultat worker ignore : patient ou date ne correspond pas a l attente courante.', { id: result.patientId }, {
                phase: 'worker_outcome_signal_mismatch',
                waiter: {
                    batchId: waiter.batchId,
                    patientId: waiter.patientId,
                    launchedAt: waiter.launchedAt,
                    launchedAgeMs: nowMs() - Number(waiter.launchedAt || 0)
                },
                result
            });
        }

        return false;
    }

    function mirrorWorkerStatusToState(workerStatus, patientId) {
        if (!workerStatus) return;
        const allowed = new Set([
            'waiting_patient_page',
            'going_to_antecedents',
            'clicking_coloriseur',
            'waiting_coloriseur_done'
        ]);
        if (allowed.has(workerStatus)) {
            setState({ status: workerStatus, runningPatientId: patientId });
        }
    }

    function isAfterCim10ClickStatus(status) {
        return status === 'clicking_coloriseur' || status === 'waiting_coloriseur_done';
    }

    function pauseBatch() {
        const state = getState();
        setCommand('pause');
        const hasCurrent = !!state.runningPatientId || ACTIVE_STATUSES.has(state.status);
        setState(hasCurrent
            ? { pauseRequested: true }
            : { status: 'paused', pauseRequested: true, runningPatientId: null });
        addLog('info', 'Pause demandee.');
        return getState();
    }

    function resumeBatch() {
        const state = getState();
        if (!state.batchId) {
            return startBatch();
        }

        setCommand('resume');
        if (!acquireControllerLock(state.batchId)) {
            alert('Un batch semble deja pilote par un autre onglet.');
            return getState();
        }

        setState({
            status: 'running',
            pauseRequested: false,
            stopRequested: false,
            finishedAt: null
        });
        addLog('info', 'Batch repris.');
        processNextPatient();
        return getState();
    }

    function togglePauseResume() {
        const state = getState();
        if (state.status === 'paused') return resumeBatch();
        return pauseBatch();
    }

    function stopBatch() {
        const state = getState();
        setCommand('stop');
        const hasCurrent = !!state.runningPatientId || ACTIVE_STATUSES.has(state.status);
        setState(hasCurrent
            ? { stopRequested: true }
            : { status: 'stopped', stopRequested: true, runningPatientId: null, finishedAt: nowMs() });
        addLog('warn', hasCurrent ? 'Stop demande apres le patient courant.' : 'Batch stoppe.');
        return getState();
    }

    function getCurrentWorkerFreshness(state) {
        const heartbeat = gmGetJson(BATCH_KEY_WORKER_HEARTBEAT, null);
        const current = gmGetJson(BATCH_KEY_CURRENT, null);
        const runningPatientId = state && state.runningPatientId;
        const batchId = state && state.batchId;

        const heartbeatMatches = heartbeat
            && (!batchId || heartbeat.batchId === batchId)
            && (!runningPatientId || heartbeat.patientId === runningPatientId);

        const heartbeatAge = heartbeatMatches ? nowMs() - Number(heartbeat.ts || 0) : Infinity;
        const currentAge = current && current.openedAt ? nowMs() - Number(current.openedAt || 0) : Infinity;

        return {
            heartbeat,
            current,
            heartbeatMatches: !!heartbeatMatches,
            heartbeatAge,
            currentAge,
            fresh: !!heartbeatMatches && heartbeatAge <= HEARTBEAT_STALE_MS * 2
        };
    }

    function shouldAutoFailStaleRunningPatient(state, freshness) {
        if (!state || !state.runningPatientId) return false;
        if (!ACTIVE_STATUSES.has(state.status)) return false;
        if (!freshness || freshness.fresh) return false;

        const heartbeat = freshness.heartbeat || null;
        const clicked = isAfterCim10ClickStatus(state.status) || !!(heartbeat && (heartbeat.clickedAt || isAfterCim10ClickStatus(heartbeat.status)));
        if (Number(freshness.currentAge || Infinity) >= PATIENT_TIMEOUT_MS) return true;
        if (clicked && Number(freshness.heartbeatAge || Infinity) >= STALE_ACTIVE_WORKER_RECOVER_MS) return true;

        return false;
    }

    function failStaleRunningPatientAndContinue(state, freshness, reason = '') {
        if (!state || !state.batchId || !state.runningPatientId) return false;

        const outcome = {
            batchId: state.batchId,
            patientId: state.runningPatientId,
            status: 'timeout',
            message: 'Worker WEDA silencieux ou Tampermonkey interrompu : patient marqué en erreur et passage au suivant.',
            ts: nowMs(),
            report: {
                reason: reason || 'stale_worker_auto_continue',
                previousStatus: state.status || '',
                heartbeatAge: freshness && freshness.heartbeatAge,
                currentAge: freshness && freshness.currentAge,
                lastHeartbeat: summarizeHeartbeatForLog(freshness && freshness.heartbeat)
            }
        };

        applyPatientOutcomeToQueue(state.runningPatientId, outcome);
        gmDelete(BATCH_KEY_CURRENT);
        gmDelete(BATCH_KEY_WORKER_HEARTBEAT);
        gmDelete(BATCH_KEY_RESULT);
        setState({ status: 'next_patient', runningPatientId: null });

        addLog('error', outcome.message, { id: state.runningPatientId }, {
            phase: 'stale_worker_auto_continue',
            reason,
            outcome,
            heartbeatAge: freshness && freshness.heartbeatAge,
            currentAge: freshness && freshness.currentAge,
            previousStatus: state.status,
            skipDiagnostic: true
        });

        return true;
    }

    function clearStaleRunningState(reason) {
        const state = getState();
        const freshness = getCurrentWorkerFreshness(state);
        const hasActive = !!state.runningPatientId || ACTIVE_STATUSES.has(state.status);

        if (!hasActive || freshness.fresh) {
            return false;
        }

        let queue = getQueue();
        if (state.runningPatientId) {
            queue = queue.map(patient => {
                if (!patient || patient.id !== state.runningPatientId) return patient;

                return Object.assign({}, patient, {
                    status: patient.status === 'success' ? 'success' : 'timeout',
                    finishedAt: patient.finishedAt || nowMs(),
                    error: patient.error || `Worker batch silencieux : ${reason || 'etat stale'}`,
                    report: patient.report || {
                        staleCleared: true,
                        reason,
                        heartbeatAge: freshness.heartbeatAge,
                        lastHeartbeat: freshness.heartbeat || null
                    }
                });
            });
            saveQueue(queue);
        }

        gmDelete(BATCH_KEY_CURRENT);
        gmDelete(BATCH_KEY_WORKER_HEARTBEAT);
        gmDelete(BATCH_KEY_RESULT);
        releaseControllerLock();
        setState({
            status: 'stopped',
            runningPatientId: null,
            stopRequested: true,
            pauseRequested: false,
            finishedAt: nowMs()
        });

        addLog('warn', 'Etat batch bloque nettoye : worker silencieux.', null, {
            phase: 'stale_running_cleanup',
            reason,
            heartbeatAge: freshness.heartbeatAge,
            currentAge: freshness.currentAge,
            previousStatus: state.status,
            runningPatientId: state.runningPatientId,
            diagnostic: buildBlockedBatchDiagnostic('stale_running_cleanup', { freshness })
        });

        return true;
    }

    function resumeFromSelectedPatient() {
        let patientId = getSelectedResumePatientId();

        if (!patientId && !getQueue().length) {
            scanAndStorePatients();
            patientId = getSelectedResumePatientId();
        }

        if (!patientId) {
            alert('Choisis un patient dans la liste de reprise.');
            return getState();
        }

        return resumeFromPatient(patientId, { autoStart: true });
    }

    function findPatientIndexForResume(selector, queue) {
        if (selector === null || selector === undefined || selector === '') return -1;

        if (typeof selector === 'number' && Number.isFinite(selector)) {
            if (selector >= 1 && selector <= queue.length) return selector - 1;
            if (selector >= 0 && selector < queue.length) return selector;
            return -1;
        }

        const needle = lowerText(selector);
        if (!needle) return -1;

        let index = queue.findIndex(patient => lowerText(patient && patient.id) === needle);
        if (index >= 0) return index;

        index = queue.findIndex(patient => lowerText(patient && patient.patDk) === needle);
        if (index >= 0) return index;

        index = queue.findIndex(patient => lowerText(patient && patient.name) === needle);
        if (index >= 0) return index;

        return queue.findIndex(patient => lowerText(patient && patient.name).includes(needle));
    }

    function resetPatientForResume(patient, index, selectedIndex) {
        const next = Object.assign({}, patient);

        if (index < selectedIndex) {
            next.excludedByResume = true;
            next.resumeExcludedAt = nowMs();
            next.resumeExcludedReason = 'Avant le point de reprise choisi.';
            if (!PATIENT_TERMINAL_STATUSES.has(next.status || 'pending')) next.status = 'skipped';
            if (!next.finishedAt) next.finishedAt = nowMs();
            if (!next.error) next.error = 'Ignore par reprise a un patient ulterieur.';
            return next;
        }

        next.excludedByResume = false;
        next.resumeExcludedAt = null;
        next.resumeExcludedReason = null;

        next.status = 'pending';
        next.startedAt = null;
        next.finishedAt = null;
        next.error = null;
        next.report = null;
        return next;
    }

    function resumeFromPatient(selector, options) {
        const state = getState();
        if (state.runningPatientId || ACTIVE_STATUSES.has(state.status)) {
            const cleared = clearStaleRunningState('reprise demandee');
            if (!cleared) {
                alert('Un patient est deja en cours. Mets le batch en pause/stop, ou attends la fin du patient courant, puis relance la reprise.');
                addLog('warn', 'Reprise a un patient refusee : patient en cours.', null, {
                    phase: 'resume_blocked_running_patient',
                    selector,
                    status: state.status,
                    runningPatientId: state.runningPatientId,
                    freshness: getCurrentWorkerFreshness(state),
                    diagnostic: buildBlockedBatchDiagnostic('resume_blocked_running_patient', { selector })
                });
                return getState();
            }
        }

        const opts = Object.assign({ autoStart: true }, typeof options === 'boolean' ? { autoStart: options } : (options || {}));
        let queue = normalizeQueueBeforeStart(getQueue());

        if (!queue.length) {
            queue = normalizeQueueBeforeStart(scanAndStorePatients());
        }

        if (!queue.length) {
            alert('Aucun patient detecte sur cette page.');
            return [];
        }

        const selectedIndex = findPatientIndexForResume(selector, queue);
        if (selectedIndex < 0) {
            alert('Patient de reprise introuvable dans la file.');
            addLog('warn', 'Patient de reprise introuvable.', null, { selector });
            return queue;
        }

        const selectedPatient = queue[selectedIndex];

        queue = queue.map((patient, index) => resetPatientForResume(patient, index, selectedIndex));

        if (!hasPendingPatient(queue)) {
            alert('Aucun patient a traiter depuis ce point de reprise.');
            addLog('warn', 'Reprise preparee mais aucun patient pending.', selectedPatient, { selectedIndex });
            saveQueue(queue);
            return queue;
        }

        saveQueue(queue);
        setState({
            batchId: makeBatchId(),
            status: 'ready',
            runningPatientId: null,
            resumeFromIndex: selectedIndex,
            resumeFromPatientId: selectedPatient.id,
            startedAt: null,
            finishedAt: null,
            pauseRequested: false,
            stopRequested: false
        });

        addLog('info', 'Reprise preparee a partir du patient choisi.', selectedPatient, {
            phase: 'resume_prepared',
            selectedIndex,
            selectedRank: selectedIndex + 1,
            activeTotal: countQueue(queue).activeTotal,
            activeRemaining: countQueue(queue).activeRemaining,
            autoStart: !!opts.autoStart,
            resumedPatientsReset: queue.filter((patient, index) => patient && index >= selectedIndex && patient.status === 'pending').length
        });

        return opts.autoStart ? startBatch() : queue;
    }

    function retryErrors() {
        const queue = getQueue();
        const retryQueue = queue
            .filter(patient => patient && (patient.status === 'error' || patient.status === 'timeout'))
            .map(patient => Object.assign({}, patient, {
                status: 'pending',
                startedAt: null,
                finishedAt: null,
                error: null,
                report: null,
                excludedByResume: false,
                resumeExcludedAt: null,
                resumeExcludedReason: null
            }));

        if (!retryQueue.length) {
            alert('Aucun patient en erreur ou timeout a relancer.');
            addLog('warn', 'Retry errors ignore : aucun patient eligible.');
            return [];
        }

        saveQueue(retryQueue);
        setState({
            batchId: makeBatchId(),
            status: 'ready',
            runningPatientId: null,
            resumeFromIndex: null,
            resumeFromPatientId: null,
            startedAt: null,
            finishedAt: null,
            pauseRequested: false,
            stopRequested: false
        });
        addLog('info', 'Nouvelle file creee avec les erreurs/timeouts.', null, { count: retryQueue.length });
        return retryQueue;
    }

    function clearBatchData() {
        [
            BATCH_KEY_QUEUE,
            BATCH_KEY_STATE,
            BATCH_KEY_LOG,
            BATCH_KEY_CURRENT,
            BATCH_KEY_COMMAND,
            BATCH_KEY_WORKER_HEARTBEAT,
            BATCH_KEY_RESULT,
            BATCH_KEY_LOCK,
            BATCH_KEY_CHAIN_LOCK
        ].forEach(gmDelete);
        releaseControllerLock();
        renderPanel();
        console.log(LOG_PREFIX, 'Donnees batch effacees.');
        return true;
    }

    /************************************************************
     * MODE WORKER
     ************************************************************/

    function parseWorkerInfoFromHash() {
        const hash = String(window.location.hash || '').replace(/^#/, '');
        if (!hash || !hash.includes(WORKER_HASH_PREFIX)) return null;

        const batchMatch = hash.match(/(?:^|&)AUTO_ATCD_COLOR_BATCH_WORKER=([^&]+)/);
        const patientMatch = hash.match(/(?:^|&)patient=([^&]+)/);
        if (!batchMatch) return null;

        return {
            batchId: decodeURIComponent(batchMatch[1] || ''),
            patientId: patientMatch ? decodeURIComponent(patientMatch[1] || '') : '',
            hash
        };
    }

    function rememberWorkerInfo(info) {
        if (!info || !info.batchId || !info.patientId) return info || null;

        try {
            sessionStorage.setItem(SESSION_BATCH_WORKER_INFO, JSON.stringify({
                batchId: info.batchId,
                patientId: info.patientId,
                rememberedAt: nowMs()
            }));
        } catch (_) {}

        return info;
    }

    function readRememberedWorkerInfo() {
        try {
            const raw = sessionStorage.getItem(SESSION_BATCH_WORKER_INFO);
            const info = parseMaybeJson(raw, null);
            if (!info || !info.batchId || !info.patientId) return null;

            const state = getState();
            const current = gmGetJson(BATCH_KEY_CURRENT, null);
            const currentMatches = current
                && current.batchId === info.batchId
                && current.patientId === info.patientId;
            const stateMatches = state
                && state.batchId === info.batchId
                && state.runningPatientId === info.patientId;

            if (!currentMatches && !stateMatches) return null;

            return Object.assign({}, info, { remembered: true });
        } catch (_) {
            return null;
        }
    }

    function getWorkerInfoFromHash() {
        const fromHash = parseWorkerInfoFromHash();
        if (fromHash) return rememberWorkerInfo(fromHash);
        return readRememberedWorkerInfo();
    }

    function clearRememberedWorkerInfo() {
        try { sessionStorage.removeItem(SESSION_BATCH_WORKER_INFO); } catch (_) {}
    }

    function getAntecedentsReloadRetry() {
        try {
            return parseMaybeJson(sessionStorage.getItem(SESSION_BATCH_ANTECEDENTS_RELOAD_RETRY), null) || null;
        } catch (_) {
            return null;
        }
    }

    function markAntecedentsReloadRetry(info, reason) {
        if (!info || !info.batchId || !info.patientId) return false;

        try {
            sessionStorage.setItem(SESSION_BATCH_ANTECEDENTS_RELOAD_RETRY, JSON.stringify({
                batchId: info.batchId,
                patientId: info.patientId,
                reason: reason || '',
                ts: nowMs()
            }));
            return true;
        } catch (_) {
            return false;
        }
    }

    function antecedentsReloadRetryAlreadyUsed(info) {
        const retry = getAntecedentsReloadRetry();
        return !!(
            retry &&
            info &&
            retry.batchId === info.batchId &&
            retry.patientId === info.patientId
        );
    }

    function clearAntecedentsReloadRetry() {
        try { sessionStorage.removeItem(SESSION_BATCH_ANTECEDENTS_RELOAD_RETRY); } catch (_) {}
    }

    function getPersistedCim10Launch(info) {
        if (!info || !info.batchId || !info.patientId) return null;

        try {
            const saved = parseMaybeJson(sessionStorage.getItem(SESSION_BATCH_CIM10_LAUNCH), null);
            if (!saved || saved.batchId !== info.batchId || saved.patientId !== info.patientId) return null;

            const ts = Number(saved.ts || 0);
            if (!ts || nowMs() - ts > PATIENT_TIMEOUT_MS) {
                sessionStorage.removeItem(SESSION_BATCH_CIM10_LAUNCH);
                return null;
            }

            return saved;
        } catch (_) {
            return null;
        }
    }

    function markPersistedCim10Launch(info, launch, patientForLog, reason = '') {
        if (!info || !info.batchId || !info.patientId || !launch) return null;

        const saved = {
            batchId: info.batchId,
            patientId: info.patientId,
            patientName: patientForLog && patientForLog.name ? patientForLog.name : '',
            ts: Number(launch.ts || 0) || nowMs(),
            method: launch.method || '',
            observedStarted: !!launch.observedStarted,
            reason: reason || '',
            url: window.location.href,
            savedAt: nowMs()
        };

        try {
            sessionStorage.setItem(SESSION_BATCH_CIM10_LAUNCH, JSON.stringify(saved));
        } catch (_) {}

        return saved;
    }

    function clearPersistedCim10Launch(info) {
        try {
            if (!info || !info.batchId || !info.patientId) {
                sessionStorage.removeItem(SESSION_BATCH_CIM10_LAUNCH);
                return true;
            }

            const saved = parseMaybeJson(sessionStorage.getItem(SESSION_BATCH_CIM10_LAUNCH), null);
            if (!saved || (saved.batchId === info.batchId && saved.patientId === info.patientId)) {
                sessionStorage.removeItem(SESSION_BATCH_CIM10_LAUNCH);
                return true;
            }
        } catch (_) {}

        return false;
    }

    function setWorkerStatus(status) {
        runtime.workerStatus = status || runtime.workerStatus;
        publishWorkerHeartbeat();
    }

    function publishWorkerHeartbeat() {
        const info = getWorkerInfoFromHash();
        if (!info) return;

        gmSetJson(BATCH_KEY_WORKER_HEARTBEAT, {
            batchId: info.batchId,
            patientId: info.patientId,
            url: window.location.href,
            status: runtime.workerStatus,
            clickedAt: runtime.workerClickedAt,
            ts: nowMs()
        });
    }

    function publishWorkerResult(status, message, report) {
        const info = getWorkerInfoFromHash();
        if (!info) return null;

        if (runtime.workerResultPublishedAt && runtime.workerResult) {
            addLog('info', 'Resultat worker deja publie : publication ignoree.', { id: info.patientId }, {
                phase: 'worker_publish_result_duplicate_guard',
                existingResult: runtime.workerResult,
                ignored: { status, message, report: report || null }
            });
            return runtime.workerResult;
        }

        const result = {
            resultId: `result_${nowMs()}_${Math.floor(Math.random() * 1000000)}`,
            batchId: info.batchId,
            patientId: info.patientId,
            status,
            message,
            report: report || null,
            url: window.location.href,
            ts: nowMs()
        };

        runtime.workerResultPublishedAt = nowMs();
        runtime.workerResult = result;
        gmSetJson(BATCH_KEY_RESULT, result);
        addLog(status === 'success' ? 'success' : (status === 'timeout' ? 'error' : 'error'), message, { id: info.patientId }, {
            phase: 'worker_publish_result',
            result,
            report: report || null,
            skipDiagnostic: true
        });
        scheduleWorkerHandoff(result);
        return result;
    }

    function getWorkerPatientDescriptor(info) {
        const current = gmGetJson(BATCH_KEY_CURRENT, null);
        if (current && current.batchId === info.batchId && current.patientId === info.patientId) {
            if (current.patient && current.patient.id) return current.patient;
            return current;
        }

        const queue = getQueue();
        const found = queue.find(patient => patient && patient.id === info.patientId);
        if (found) return found;

        return {
            id: info.patientId,
            patDk: info.patientId,
            entryMode: 'url',
            name: '',
            url: buildPatientUrl(info.patientId)
        };
    }

    async function runWorker() {
        const info = getWorkerInfoFromHash();
        if (!info || !info.batchId || !info.patientId) return;

        if (window.__AUTO_ATCD_COLOR_BATCH_WORKER_RUNNING__) return;
        window.__AUTO_ATCD_COLOR_BATCH_WORKER_RUNNING__ = true;

        runtime.workerStatus = 'waiting_patient_page';
        runtime.workerClickedAt = null;
        runtime.coloriseurLaunchCommandId = '';
        runtime.coloriseurDirectResult = null;
        runtime.coloriseurDirectError = null;
        runtime.coloriseurDirectSettledAt = null;
        publishWorkerHeartbeat();
        runtime.workerHeartbeatTimer = setInterval(publishWorkerHeartbeat, HEARTBEAT_INTERVAL_MS);

        const patientDescriptor = getWorkerPatientDescriptor(info);
        const patientForLog = {
            id: info.patientId,
            name: patientDescriptor.name || ''
        };
        const workerStartedAt = nowMs();

        try {
            addLog('info', 'Worker batch demarre.', patientForLog, {
                phase: 'worker_start',
                batchId: info.batchId,
                url: window.location.href,
                patientDescriptor
            });

            setWorkerStatus('waiting_patient_page');
            const alreadyOnAntecedents = await waitFor(() => isBatchAntecedentsPageReady(), 2500, 250);

            if (alreadyOnAntecedents) {
                addLog('info', 'Page antecedents deja chargee apres reprise worker.', patientForLog, {
                    phase: 'worker_already_on_antecedents',
                    url: window.location.href
                });
            } else {
                const selected = await ensureWorkerPatientSelected(patientDescriptor, patientForLog);
                if (!selected) {
                    publishWorkerResult('timeout', 'Timeout : selection du patient impossible depuis la liste.', {
                        stage: 'selecting_patient',
                        url: window.location.href,
                        patient: patientDescriptor
                    });
                    return closeCurrentWorkerSoon();
                }

                const expectedPatDk = getExpectedWorkerPatientId(patientDescriptor, info.patientId);
                const patientPageReady = await waitFor(() => isPatientPageReady(expectedPatDk), PAGE_LOAD_TIMEOUT_MS, 500);
                if (!patientPageReady) {
                    publishWorkerResult('timeout', 'Timeout : page patient non chargee.', {
                        stage: 'waiting_patient_page',
                        url: window.location.href
                    });
                    return closeCurrentWorkerSoon();
                }
            }
            addLog('info', 'Page patient chargee.', patientForLog, {
                phase: 'worker_patient_page_ready',
                url: window.location.href,
                elapsedMs: nowMs() - workerStartedAt
            });

            setWorkerStatus('going_to_antecedents');
            const antecedentsReady = await ensureAntecedentsPage();
            if (!antecedentsReady) {
                publishWorkerResult('timeout', 'Timeout : page antecedents non atteinte.', {
                    stage: 'going_to_antecedents',
                    url: window.location.href
                });
                return closeCurrentWorkerSoon();
            }
            addLog('info', 'Navigation antecedents terminee.', patientForLog, {
                phase: 'worker_antecedents_ready',
                url: window.location.href,
                elapsedMs: nowMs() - workerStartedAt
            });

            const currentAntecedentPatDk = extractPatDk(window.location.href);
            if (!currentAntecedentPatDk || !samePatDk(info.patientId, currentAntecedentPatDk)) {
                publishWorkerResult('error', 'Sécurité patient : lancement coloriseur bloqué, onglet Antécédents sur un autre patient.', {
                    stage: 'patient_identity_guard_before_coloriseur',
                    expectedPatientId: info.patientId,
                    currentPatDk: currentAntecedentPatDk || '',
                    url: window.location.href,
                    patient: patientDescriptor
                });
                return closeCurrentWorkerSoon();
            }

            setWorkerStatus('clicking_coloriseur');
            const launchAttempt = await triggerColoriseurLaunch(info, patientDescriptor, patientForLog);
            if (!launchAttempt || !launchAttempt.observedStarted) {
                publishWorkerResult('timeout', 'Timeout : lancement du coloriseur non confirme.', {
                    stage: 'launching_coloriseur',
                    url: window.location.href,
                    launchAttempt
                });
                return closeCurrentWorkerSoon();
            }

            runtime.workerClickedAt = launchAttempt.ts;
            publishWorkerHeartbeat();
            addLog('info', `Coloriseur lance pour ${patientDescriptor.patDk ? 'PatDk=' + patientDescriptor.patDk : 'patient=' + patientDescriptor.name + ' (' + info.patientId + ')'}.`, patientForLog, {
                phase: 'worker_coloriseur_started',
                method: launchAttempt.method,
                commandId: launchAttempt.commandId,
                elapsedMs: nowMs() - workerStartedAt
            });

            setWorkerStatus('waiting_coloriseur_done');
            const remainingTimeout = Math.max(30000, PATIENT_TIMEOUT_MS - (nowMs() - workerStartedAt));
            const outcome = await waitForColoriseurDone(launchAttempt, remainingTimeout, {
                batchId: info.batchId,
                patientId: info.patientId
            });

            publishWorkerResult(outcome.status, outcome.message, outcome.report);
            closeCurrentWorkerSoon();
        } catch (e) {
            publishWorkerResult('error', `Erreur worker : ${e && e.message ? e.message : String(e)}`, {
                stage: runtime.workerStatus,
                url: window.location.href
            });
            closeCurrentWorkerSoon();
        } finally {
            if (runtime.workerHeartbeatTimer) {
                clearInterval(runtime.workerHeartbeatTimer);
                runtime.workerHeartbeatTimer = null;
            }
            publishWorkerHeartbeat();
        }
    }

    function getColoriseurApiFunction(name) {
        try {
            if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow[name] === 'function') {
                return unsafeWindow[name];
            }
        } catch (_) {}

        try {
            if (typeof window[name] === 'function') return window[name];
        } catch (_) {}

        return null;
    }

    function buildColoriseurCommand(info, patientDescriptor, patientForLog) {
        return {
            id: `color_batch_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
            action: 'start',
            source: 'scrollpatients_coloriseur',
            batchId: info && info.batchId || '',
            patientId: info && info.patientId || '',
            patientName: patientDescriptor && patientDescriptor.name || patientForLog && patientForLog.name || '',
            ts: nowMs()
        };
    }

    function normalizeDirectColoriseurReport(report, command) {
        const now = nowMs();
        const fallback = {
            id: command.id,
            version: '',
            source: command.source,
            batchId: command.batchId,
            patientId: command.patientId,
            patientName: command.patientName,
            status: 'success',
            message: 'Coloriseur termine.',
            startedAt: command.ts,
            finishedAt: now,
            updatedAt: now,
            url: window.location.href,
            attempts: []
        };

        if (!report || typeof report !== 'object') {
            return fallback;
        }

        return Object.assign({}, report, {
            id: report.id || command.id,
            source: report.source || command.source,
            batchId: report.batchId || command.batchId,
            patientId: report.patientId || command.patientId,
            patientName: report.patientName || command.patientName,
            status: report.status || 'success',
            message: report.message || fallback.message,
            startedAt: report.startedAt || command.ts,
            finishedAt: report.finishedAt || now,
            updatedAt: report.updatedAt || now,
            url: report.url || window.location.href
        });
    }

    function storeDirectColoriseurReport(command, report, patientForLog) {
        if (runtime.coloriseurLaunchCommandId && runtime.coloriseurLaunchCommandId !== command.id) return;

        const normalized = normalizeDirectColoriseurReport(report, command);
        runtime.coloriseurDirectResult = normalized;
        runtime.coloriseurDirectError = null;
        runtime.coloriseurDirectSettledAt = nowMs();
        gmSetJson(COLORISEUR_RESULT_KEY, normalized);

        const outcome = classifyColoriseurReport(normalized);
        addLog(outcome && outcome.status === 'success' ? 'success' : 'warn', 'Fin coloriseur recue par API directe.', patientForLog, {
            phase: 'coloriseur_direct_result',
            commandId: command.id,
            status: normalized.status || '',
            report: summarizeReport(normalized, 'coloriseur_api')
        });
    }

    function storeDirectColoriseurError(command, error, patientForLog) {
        if (runtime.coloriseurLaunchCommandId && runtime.coloriseurLaunchCommandId !== command.id) return;

        const message = String(error && error.message ? error.message : error || 'Erreur inconnue.');
        const report = normalizeDirectColoriseurReport({
            id: command.id,
            source: command.source,
            batchId: command.batchId,
            patientId: command.patientId,
            patientName: command.patientName,
            status: 'error',
            message: 'Promesse coloriseur rejetee : ' + message,
            error: message
        }, command);

        runtime.coloriseurDirectResult = null;
        runtime.coloriseurDirectError = report;
        runtime.coloriseurDirectSettledAt = nowMs();
        gmSetJson(COLORISEUR_RESULT_KEY, report);

        addLog('warn', 'Promesse coloriseur rejetee.', patientForLog, {
            phase: 'coloriseur_direct_error',
            commandId: command.id,
            error: message
        });
    }

    async function triggerColoriseurLaunch(info, patientDescriptor, patientForLog) {
        const command = buildColoriseurCommand(info, patientDescriptor, patientForLog);
        const directOptions = {
            source: command.source,
            commandId: command.id,
            batchId: command.batchId,
            patientId: command.patientId,
            patientName: command.patientName
        };

        runtime.coloriseurLaunchCommandId = command.id;
        runtime.coloriseurDirectResult = null;
        runtime.coloriseurDirectError = null;
        runtime.coloriseurDirectSettledAt = null;
        gmDelete(COLORISEUR_RESULT_KEY);

        const directFn = getColoriseurApiFunction('AUTO_ATCD_CIM10_COLOR_START')
            || getColoriseurApiFunction('AUTO_ATCD_CIM10_COLOR_OPEN_AND_START')
            || getColoriseurApiFunction('AUTO_ATCD_NON_CIM10_CLEAN_START')
            || getColoriseurApiFunction('AUTO_ATCD_NON_CIM10_CLEAN_OPEN_AND_START');

        if (directFn) {
            try {
                const maybePromise = directFn(directOptions);
                addLog('info', 'Coloriseur lance par API exposee.', patientForLog, {
                    phase: 'coloriseur_api_start',
                    commandId: command.id
                });
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise
                        .then(report => storeDirectColoriseurReport(command, report, patientForLog))
                        .catch(error => storeDirectColoriseurError(command, error, patientForLog));
                } else if (maybePromise && typeof maybePromise === 'object') {
                    storeDirectColoriseurReport(command, maybePromise, patientForLog);
                }
                return { method: 'api_direct', ts: command.ts, commandId: command.id, observedStarted: true };
            } catch (e) {
                addLog('warn', 'Lancement coloriseur par API impossible, fallback commande.', patientForLog, {
                    phase: 'coloriseur_api_start_failed',
                    commandId: command.id,
                    error: String(e && e.message ? e.message : e)
                });
            }
        }

        gmSetJson(COLORISEUR_COMMAND_KEY, command);
        addLog('info', 'Commande coloriseur envoyee.', patientForLog, {
            phase: 'coloriseur_command_sent',
            command
        });

        const started = await waitFor(() => {
            const report = gmGetJson(COLORISEUR_RESULT_KEY, null);
            return report && report.id === command.id ? report : null;
        }, 5000, 300);

        return {
            method: started ? 'command_result_seen' : 'gm_command',
            ts: command.ts,
            commandId: command.id,
            observedStarted: true
        };
    }

    function coloriseurReportMatchesLaunch(report, launch, expectedContext = {}) {
        if (!report || typeof report !== 'object' || !launch) return false;
        const commandId = String(launch.commandId || '');
        const reportId = String(report.id || '');
        const commandMatches = !!(commandId && reportId && reportId === commandId);
        const batchMatches = !!(expectedContext.batchId && report.batchId && report.batchId === expectedContext.batchId);
        const patientMatches = !!(expectedContext.patientId && report.patientId && report.patientId === expectedContext.patientId);
        const contextMatches = batchMatches || patientMatches;
        const reportTs = Number(report.updatedAt || report.finishedAt || report.startedAt || 0);

        if (commandId && reportId && reportId !== commandId && !contextMatches) return false;
        if (commandId && !reportId && !contextMatches) return false;
        if (reportTs && reportTs < Number(launch.ts || 0) - 1000) return false;
        if (!reportTs && !commandMatches) return false;
        if (expectedContext.batchId && report.batchId && report.batchId !== expectedContext.batchId) return false;
        if (expectedContext.patientId && report.patientId && report.patientId !== expectedContext.patientId) return false;
        return true;
    }

    function classifyColoriseurReport(report) {
        if (!report || typeof report !== 'object') return null;
        const status = lowerText(report.status || '');
        if (status === 'running') return null;

        if (status === 'success') {
            return {
                status: 'success',
                message: report.message || 'Colorisation terminee.',
                report: summarizeReport(report, 'coloriseur')
            };
        }

        if (status === 'timeout') {
            return {
                status: 'timeout',
                message: report.message || 'Timeout coloriseur.',
                report: summarizeReport(report, 'coloriseur')
            };
        }

        if (status === 'error' || status === 'stopped' || Number(report.failedColorCount || 0) > 0) {
            return {
                status: 'error',
                message: report.message || 'Erreur coloriseur signalee.',
                report: summarizeReport(report, 'coloriseur')
            };
        }

        return null;
    }

    function readDirectColoriseurOutcome(launch) {
        if (!launch || !launch.commandId) return null;
        if (runtime.coloriseurLaunchCommandId && runtime.coloriseurLaunchCommandId !== launch.commandId) return null;

        const report = runtime.coloriseurDirectResult || runtime.coloriseurDirectError;
        if (!report) return null;

        return classifyColoriseurReport(report);
    }

    function logColoriseurFinishDetected(outcome, launch, expectedContext, source) {
        if (!outcome) return;
        addLog(outcome.status === 'success' ? 'success' : 'error', 'Fin coloriseur detectee.', { id: expectedContext && expectedContext.patientId || '' }, {
            phase: 'coloriseur_finish_detected',
            source,
            commandId: launch && launch.commandId || '',
            status: outcome.status,
            message: outcome.message || ''
        });
    }

    async function waitForColoriseurDone(launch, timeoutMs, expectedContext = {}) {
        const start = nowMs();
        let lastReport = null;

        while (nowMs() - start < timeoutMs) {
            const directOutcome = readDirectColoriseurOutcome(launch);
            if (directOutcome) {
                logColoriseurFinishDetected(directOutcome, launch, expectedContext, runtime.coloriseurDirectError ? 'api_direct_error' : 'api_direct');
                return directOutcome;
            }

            const report = gmGetJson(COLORISEUR_RESULT_KEY, null);
            if (coloriseurReportMatchesLaunch(report, launch, expectedContext)) {
                lastReport = report;
                const outcome = classifyColoriseurReport(report);
                if (outcome) {
                    logColoriseurFinishDetected(outcome, launch, expectedContext, 'gm_result');
                    return outcome;
                }
            }

            await sleep(1200);
        }

        return {
            status: 'timeout',
            message: 'Timeout : fin du coloriseur non detectee.',
            report: {
                stage: 'waiting_coloriseur_done',
                commandId: launch && launch.commandId || '',
                lastReport: lastReport ? summarizeReport(lastReport, 'coloriseur') : null
            }
        };
    }

    function closeCurrentWorkerSoon(delayMs = 250) {
        const info = getWorkerInfoFromHash();
        const fallbackInfo = info || gmGetJson(BATCH_KEY_CURRENT, null) || {};

        setTimeout(() => {
            try {
                const openerWindow = FOCUS_OPENER_BEFORE_WORKER_CLOSE
                    ? (window.opener || (typeof unsafeWindow !== 'undefined' && unsafeWindow.opener))
                    : null;
                if (openerWindow && !openerWindow.closed && typeof openerWindow.focus === 'function') {
                    openerWindow.focus();
                    addLog('info', 'Retour onglet controleur avant fermeture worker.', { id: fallbackInfo.patientId || '' }, {
                        phase: 'worker_focus_controller_before_close',
                        batchId: fallbackInfo.batchId || ''
                    });
                }
            } catch (_) {}

            clearRememberedWorkerInfo();
            clearAntecedentsReloadRetry();
            try { window.close(); } catch (_) {}
            try {
                if (typeof unsafeWindow !== 'undefined') unsafeWindow.close();
            } catch (_) {}

            setTimeout(() => {
                try {
                    const targetUrl = `https://${HOST_WEDA}/FolderMedical/StatistiqueForm.aspx`;
                    addLog('warn', 'Fermeture worker non confirmee : retour automatique vers la liste patients.', { id: fallbackInfo.patientId || '' }, {
                        phase: 'worker_close_fallback_to_patient_list',
                        batchId: fallbackInfo.batchId || '',
                        targetUrl
                    });
                    window.location.replace(targetUrl);
                } catch (_) {
                    try {
                        window.location.href = `https://${HOST_WEDA}/FolderMedical/StatistiqueForm.aspx`;
                    } catch (_) {}
                }
            }, 1200);
        }, Math.max(0, Number(delayMs || 0)));
    }

    function buildWorkerUrlForPatientUrl(patientUrl, batchId, patientId) {
        const base = String(patientUrl || '').split('#')[0];
        return `${base}#${WORKER_HASH_PREFIX}${encodeURIComponent(batchId)}&patient=${encodeURIComponent(patientId)}`;
    }

    function samePatDk(expected, actual) {
        if (!expected) return true;
        if (!actual) return false;

        const left = String(expected);
        const right = String(actual);
        if (left === right) return true;

        return left.split('|')[0] === right.split('|')[0];
    }

    function currentPageMatchesExpectedPatDk(expectedPatientId) {
        const expected = String(expectedPatientId || '');
        const currentPatDk = extractPatDk(window.location.href);
        return !!expected && !!currentPatDk && samePatDk(expected, currentPatDk);
    }

    function getExpectedWorkerPatientId(patient, fallbackPatientId = '') {
        return patient && (patient.patDk || patient.id) || fallbackPatientId || '';
    }

    async function ensureWorkerPatientSelected(patient, patientForLog) {
        if (isBatchAntecedentsPageReady()) {
            const expectedPatDk = getExpectedWorkerPatientId(patient);
            return currentPageMatchesExpectedPatDk(expectedPatDk);
        }

        if (patient && patient.entryMode === 'patient_link') {
            return ensureWorkerPatientSelectedFromGotoLink(patient, patientForLog);
        }

        if (!patient || patient.entryMode !== 'postback' || !patient.postbackTarget) {
            return true;
        }

        const expectedPatDk = getExpectedWorkerPatientId(patient);

        if (isPatientPageReady(expectedPatDk)) {
            return true;
        }

        addLog('info', 'Selection patient par postback WEDA.', patientForLog, {
            target: patient.postbackTarget,
            name: patient.name || ''
        });

        const clickable = await waitFor(() => findPatientPostBackElement(patient), PAGE_LOAD_TIMEOUT_MS, 500);
        if (clickable) {
            clickElement(clickable);
        } else {
            const postback = getDoPostBack();
            if (!postback) return false;

            try {
                postback(patient.postbackTarget, patient.postbackArgument || '');
            } catch (e) {
                addLog('warn', 'Postback patient impossible.', patientForLog, {
                    target: patient.postbackTarget,
                    error: String(e && e.message ? e.message : e)
                });
                return false;
            }
        }

        return !!(await waitFor(() => isPatientPageReady(expectedPatDk), PAGE_LOAD_TIMEOUT_MS, 500));
    }

    async function ensureWorkerPatientSelectedFromGotoLink(patient, patientForLog) {
        if (!patient) return false;
        const expectedPatDk = getExpectedWorkerPatientId(patient);
        if (isBatchAntecedentsPageReady()) return currentPageMatchesExpectedPatDk(expectedPatDk);
        if (isPatientPageReady(expectedPatDk)) return true;

        const info = getWorkerInfoFromHash();
        if (!info) return false;

        addLog('info', 'Recherche du lien Patient de la ligne WEDA.', patientForLog, {
            name: patient.name || '',
            patDk: patient.patDk || '',
            gotoLinkId: patient.gotoLinkId || '',
            gotoPostbackTarget: patient.gotoPostbackTarget || ''
        });

        const link = await waitFor(() => findPatientGotoElement(patient), PAGE_LOAD_TIMEOUT_MS, 500);
        const livePatientUrl = link ? extractPatientOpenUrlFromLink(link) : '';
        const targetUrl = livePatientUrl || patient.patientUrl || '';

        if (!targetUrl) {
            addLog('warn', 'Lien Patient introuvable dans la page worker.', patientForLog, {
                patient
            });
            return false;
        }

        const targetPatDk = extractPatDk(targetUrl);
        if (expectedPatDk && targetPatDk && !samePatDk(expectedPatDk, targetPatDk)) {
            addLog('warn', 'URL Patient trouvee mais PatDk inattendu.', patientForLog, {
                expected: expectedPatDk,
                found: targetPatDk,
                targetUrl
            });
            return false;
        }

        const redirect = installPatientWindowOpenRedirect(patient, info, patientForLog);

        addLog('info', 'Clic sur le lien Patient de la ligne WEDA.', patientForLog, {
            targetUrl,
            linkId: link && link.id ? link.id : '',
            text: link ? getElementText(link) : ''
        });

        try {
            clickPatientGotoLink(link);
        } catch (e) {
            addLog('warn', 'Clic lien Patient impossible, tentative de navigation directe.', patientForLog, {
                error: String(e && e.message ? e.message : e)
            });
        }

        let ready = !!(await waitFor(() => isPatientPageReady(expectedPatDk || targetPatDk), PAGE_LOAD_TIMEOUT_MS, 500));

        if (!ready && !redirect.handled) {
            const workerPatientUrl = buildWorkerUrlForPatientUrl(targetUrl, info.batchId, info.patientId);
            addLog('warn', 'Le clic Patient n a pas declenche window.open intercepte, navigation directe de secours.', patientForLog, {
                workerPatientUrl
            });

            try {
                window.location.href = workerPatientUrl;
            } catch (_) {
                try { unsafeWindow.location.href = workerPatientUrl; } catch (_) {}
            }

            ready = !!(await waitFor(() => isPatientPageReady(expectedPatDk || targetPatDk), PAGE_LOAD_TIMEOUT_MS, 500));
        }

        redirect.restore();
        return ready;
    }

    function clickPatientGotoLink(link) {
        if (!link) return false;

        try {
            link.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (_) {}

        const doc = link.ownerDocument || document;
        const view = doc.defaultView || window;

        const cancelDefaultPostBack = event => {
            try { event.preventDefault(); } catch (_) {}
        };

        try {
            link.addEventListener('click', cancelDefaultPostBack, true);
            link.dispatchEvent(new view.MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view
            }));
        } finally {
            try { link.removeEventListener('click', cancelDefaultPostBack, true); } catch (_) {}
        }

        return true;
    }

    function installPatientWindowOpenRedirect(patient, info, patientForLog) {
        const state = {
            handled: false,
            restored: false,
            lastUrl: '',
            restore: () => {}
        };

        let originalWindowOpen = null;
        let originalUnsafeWindowOpen = null;
        let canRestoreWindow = false;
        let canRestoreUnsafeWindow = false;

        function redirectOpen(url, target, features) {
            const normalizedUrl = normalizePatientOpenUrl(url, { ownerDocument: document });
            const openedPatDk = extractPatDk(normalizedUrl);

            if (normalizedUrl && samePatDk(patient.patDk || patient.id, openedPatDk)) {
                const workerPatientUrl = buildWorkerUrlForPatientUrl(normalizedUrl, info.batchId, info.patientId);
                state.handled = true;
                state.lastUrl = normalizedUrl;

                addLog('info', 'window.open WEDA intercepte apres clic Patient.', patientForLog, {
                    openedUrl: normalizedUrl,
                    workerPatientUrl,
                    target: target || ''
                });

                setTimeout(() => {
                    try {
                        window.location.href = workerPatientUrl;
                    } catch (_) {
                        try { unsafeWindow.location.href = workerPatientUrl; } catch (_) {}
                    }
                }, 0);

                return {
                    closed: false,
                    close: function () {
                        this.closed = true;
                    },
                    focus: function () {}
                };
            }

            if (typeof originalUnsafeWindowOpen === 'function') {
                return originalUnsafeWindowOpen.call(unsafeWindow, url, target, features);
            }

            if (typeof originalWindowOpen === 'function') {
                return originalWindowOpen.call(window, url, target, features);
            }

            return null;
        }

        try {
            originalWindowOpen = window.open;
            window.open = redirectOpen;
            canRestoreWindow = true;
        } catch (_) {}

        try {
            if (typeof unsafeWindow !== 'undefined') {
                originalUnsafeWindowOpen = unsafeWindow.open;
                unsafeWindow.open = redirectOpen;
                canRestoreUnsafeWindow = true;
            }
        } catch (_) {}

        state.restore = () => {
            if (state.restored) return;
            state.restored = true;

            try {
                if (canRestoreWindow) window.open = originalWindowOpen;
            } catch (_) {}

            try {
                if (canRestoreUnsafeWindow && typeof unsafeWindow !== 'undefined') unsafeWindow.open = originalUnsafeWindowOpen;
            } catch (_) {}
        };

        setTimeout(() => state.restore(), 15000);
        return state;
    }

    function findPatientGotoElement(patient) {
        if (!patient) return null;

        if (patient.gotoLinkId) {
            for (const doc of getAccessibleDocuments()) {
                try {
                    const byId = doc.getElementById(patient.gotoLinkId);
                    if (byId && isVisible(byId)) return byId;
                } catch (_) {}
            }
        }

        const elements = queryAllDeep('a[href], a[onclick]');
        for (const el of elements) {
            if (!isVisible(el)) continue;

            const url = extractPatientOpenUrlFromLink(el);
            if (!url) continue;
            const patDk = extractPatDk(url);
            if (!samePatDk(patient.patDk || patient.id, patDk)) continue;

            if (looksLikePatientGotoLink(el)) return el;
        }

        for (const el of elements) {
            if (!isVisible(el)) continue;

            const parsed = parsePatientGotoPostBack(el);
            if (!parsed || !patient.gotoPostbackTarget || parsed.target !== patient.gotoPostbackTarget) continue;
            if (extractPatientOpenUrlFromLink(el)) return el;
        }

        return null;
    }

    function findPatientPostBackElement(patient) {
        if (!patient || !patient.postbackTarget) return null;

        const elements = queryAllDeep('a[href], button, input[type="button"], input[type="submit"], span[onclick], div[onclick]');
        for (const el of elements) {
            const raw = `${el.getAttribute('href') || ''} ${el.getAttribute('onclick') || ''}`;
            const parsed = parsePostBackTarget(raw);
            if (!parsed || parsed.target !== patient.postbackTarget) continue;
            if (!isVisible(el)) continue;
            return el;
        }

        return null;
    }

    function isPatientPageReady(expectedPatientId) {
        if (!isWeda()) return false;
        if (isBatchAntecedentsPageReady()) return currentPageMatchesExpectedPatDk(expectedPatientId);
        const bodyReady = !!(document.body && normalizeText(document.body.innerText || document.body.textContent).length > 0);
        const urlReady = /\/foldermedical\/patientviewform\.aspx/i.test(window.location.pathname);
        return bodyReady && urlReady && currentPageMatchesExpectedPatDk(expectedPatientId);
    }

    function isBatchAntecedentsPageReady() {
        return !!(findExistingCim10Button() || isStrongAntecedentsPage());
    }

    async function ensureAntecedentsPage() {
        if (findExistingCim10Button()) return true;
        if (isStrongAntecedentsPage()) return true;

        await waitFor(() => findWedaAntecedentsSummaryTrigger() || getDoPostBack(), 10000, 500);

        addLog('info', 'Navigation vers antecedents : methode WEDA directe.');
        const directClicked = clickWedaGotoAntecedentsDirect();
        if (directClicked) {
            const foundAfterDirect = await waitFor(() => findExistingCim10Button() || isStrongAntecedentsPage(), ANTECEDENTS_NAV_TIMEOUT_MS, 500);
            if (foundAfterDirect) return true;
        }

        addLog('info', 'Navigation vers antecedents : recherche bouton/lien.');
        const clicked = clickBestAntecedentsCandidate();
        if (clicked) {
            const foundAfterClick = await waitFor(() => findExistingCim10Button() || isStrongAntecedentsPage(), 12000, 500);
            if (foundAfterClick) return true;
        }

        addLog('info', 'Navigation vers antecedents : recherche postback.');
        const postbackDone = callBestAntecedentsPostBack();
        if (postbackDone) {
            const foundAfterPostback = await waitFor(() => findExistingCim10Button() || isStrongAntecedentsPage(), ANTECEDENTS_NAV_TIMEOUT_MS, 500);
            if (foundAfterPostback) return true;
        }

        return !!(await waitFor(() => findExistingCim10Button() || isStrongAntecedentsPage() || looksLikeAntecedentsPage(), 5000, 500));
    }

    function clickWedaGotoAntecedentsDirect() {
        const summaryTrigger = findWedaAntecedentsSummaryTrigger();
        if (summaryTrigger) {
            addLog('info', 'Clic bloc resume antecedents WEDA.', null, {
                id: summaryTrigger.id || '',
                className: summaryTrigger.className || '',
                text: limitText(getElementText(summaryTrigger), 180),
                onclick: limitText(summaryTrigger.getAttribute && summaryTrigger.getAttribute('onclick'), 300)
            });

            const parsed = parsePostBackTarget(summaryTrigger.getAttribute && summaryTrigger.getAttribute('onclick'));
            const clicked = clickElement(summaryTrigger);

            if (parsed && parsed.target) {
                setTimeout(() => callSpecificPostBack(parsed.target, parsed.argument || ''), 250);
            }

            return clicked || !!(parsed && parsed.target);
        }

        const directSelectors = [
            '[onclick*="ButtonGotoAntecedent"]',
            '[href*="ButtonGotoAntecedent"]',
            '[id*="ButtonGotoAntecedent"]',
            '[name*="ButtonGotoAntecedent"]'
        ];

        for (const selector of directSelectors) {
            const candidate = queryAllDeep(selector).find(el => !isInsideBatchPanel(el) && isVisible(el));
            if (candidate) {
                addLog('info', 'Clic direct ButtonGotoAntecedent.', null, {
                    selector,
                    id: candidate.id || '',
                    name: candidate.name || '',
                    text: getElementText(candidate),
                    onclick: limitText(candidate.getAttribute && candidate.getAttribute('onclick'), 300)
                });
                clickElement(candidate);
                return true;
            }
        }

        const postbackDone = callSpecificPostBack('ctl00$ContentPlaceHolder1$ButtonGotoAntecedent', '');
        if (postbackDone) {
            addLog('info', 'Postback direct ButtonGotoAntecedent lance.');
            return true;
        }

        return false;
    }

    function findWedaAntecedentsSummaryTrigger() {
        const candidates = queryAllDeep('div.sc[onclick*="ButtonGotoAntecedent"], [onclick*="ButtonGotoAntecedent"]');

        return candidates.find(el => {
            if (!el || isInsideBatchPanel(el) || !isVisible(el)) return false;

            const onclick = lowerText(el.getAttribute && el.getAttribute('onclick'));
            if (!onclick.includes('buttongotoantecedent')) return false;

            const text = lowerText(getElementText(el));
            const title = lowerText(el.getAttribute && el.getAttribute('title'));
            const className = lowerText(el.className || '');

            return className.includes('sc')
                || title.includes('volet medical')
                || text.includes('antecedents medicaux')
                || text.includes('allergies');
        }) || null;
    }

    function isStrongAntecedentsPage() {
        if (findExistingCim10Button()) return true;

        const strongSelectors = [
            '#ContentPlaceHolder1_UpdatePanelAntecedent',
            '#ContentPlaceHolder1_TextBoxAntecedentCommentaire',
            '[id$="_UpdatePanelAntecedent"]',
            '[id$="_TextBoxAntecedentCommentaire"]'
        ];

        for (const selector of strongSelectors) {
            const found = queryAllDeep(selector).find(el => !isInsideBatchPanel(el) && isVisible(el));
            if (found) return true;
        }

        const cleanUrl = String(window.location.href || '').split('#')[0];
        return /antecedent/i.test(cleanUrl);
    }

    function looksLikeAntecedentsPage() {
        if (findExistingCim10Button()) return true;

        const antecedentSelectors = [
            '#ContentPlaceHolder1_UpdatePanelAntecedent',
            '[id*="Antecedent"]',
            '[name*="Antecedent"]',
            '[id*="ATCD"]',
            '[name*="ATCD"]'
        ];

        for (const selector of antecedentSelectors) {
            const found = queryAllDeep(selector).find(el => !isInsideBatchPanel(el) && isVisible(el));
            if (found) return true;
        }

        const docs = getAccessibleDocuments();
        for (const doc of docs) {
            const text = lowerText(doc.body && (doc.body.innerText || doc.body.textContent));
            if (text.includes('antecedents') || text.includes('atcd')) return true;
        }

        const cleanUrl = String(window.location.href || '').split('#')[0];
        return /antecedent/i.test(cleanUrl);
    }

    function findExistingCim10Button() {
        const exact = queryAllDeep('#auto-atcd-cim10-launcher')
            .find(el => el && !isInsideBatchPanel(el) && isVisible(el));
        if (exact) return exact;

        const candidates = queryAllDeep('button, a, div, span, input[type="button"], input[type="submit"]');

        return candidates.find(el => {
            if (!el || isInsideBatchPanel(el) || !isVisible(el)) return false;
            const txt = lowerText(getElementText(el));
            if (!txt) return false;

            const hasAtcd = txt.includes('atcd') || txt.includes('antecedent');
            const hasHeidi = txt.includes('heidi');
            const hasCim10 = /cim\s*-?\s*10/.test(txt) || txt.includes('cim10');
            const hasCodage = txt.includes('codage') || txt.includes('coder');

            return (hasAtcd && hasHeidi && hasCim10) || (hasHeidi && hasCim10 && hasCodage);
        }) || null;
    }

    function clickCim10LauncherButton(button) {
        if (!button) return false;

        if (button.id === 'auto-atcd-cim10-launcher') {
            try { button.focus(); } catch (_) {}
        }

        try { button.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}

        try {
            button.click();
            return true;
        } catch (_) {}

        return false;
    }

    function getCim10ApiFunction(name) {
        try {
            if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow[name] === 'function') {
                return unsafeWindow[name];
            }
        } catch (_) {}

        try {
            if (typeof window[name] === 'function') return window[name];
        } catch (_) {}

        return null;
    }

    function readCim10CurrentJobFromPage() {
        const fn = getCim10ApiFunction('AUTO_ATCD_CIM10_CURRENT_JOB');
        if (!fn) return null;

        try {
            return fn();
        } catch (_) {
            return null;
        }
    }

    function getCim10JobPatientIds(job) {
        if (!job || typeof job !== 'object') return [];

        const ids = [
            job.expectedPatientId,
            job.patientId,
            job.batchPatientId,
            job.sourcePatientId,
            job.currentPatientId,
            job.currentTabPatientId
        ]
            .map(value => String(value || '').trim())
            .filter(Boolean);

        return Array.from(new Set(ids));
    }

    function cim10JobMatchesPatient(job, expectedPatientId) {
        const expected = String(expectedPatientId || '').trim();
        if (!job || !expected) return false;

        const ids = getCim10JobPatientIds(job);
        if (!ids.length) return false;

        return ids.some(id => samePatDk(expected, id));
    }

    function getCim10JobTimestamp(job) {
        if (!job || typeof job !== 'object') return nowMs();

        const values = [
            job.batchClickTs,
            job.startedAt,
            job.createdAt,
            job.updatedAt,
            job.heidiStartedAt,
            job.extractedAt,
            job.ts
        ].filter(Boolean);

        for (const value of values) {
            const parsed = typeof value === 'number' ? value : Date.parse(value);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }

        return nowMs();
    }

    function cim10JobAgeMs(job) {
        const ts = getCim10JobTimestamp(job);
        return Number.isFinite(ts) ? Math.max(0, nowMs() - ts) : Number.POSITIVE_INFINITY;
    }

    function cim10JobMatchesBatchContext(job, context = {}) {
        if (!job || !context) return false;
        if (context.batchId && job.batchId && job.batchId !== context.batchId) return false;
        if (context.patientId && !cim10JobMatchesPatient(job, context.patientId)) return false;
        return true;
    }

    function hasLiveHeidiEvidence(job) {
        if (!job || typeof job !== 'object') return false;

        if (job.heidiRunnerTabId && Number(job.heidiRunnerExpiresAt || 0) > nowMs()) {
            return true;
        }

        const openedAtMs = Date.parse(job.heidiWorkerOpenedAt || '');
        return !!(
            job.heidiWorkerJobId === job.id &&
            Number.isFinite(openedAtMs) &&
            nowMs() - openedAtMs < 30000
        );
    }

    function shouldWaitForExistingCim10Job(job, context = {}) {
        if (!job || !job.id) return false;
        if (!cim10JobMatchesBatchContext(job, context)) return false;

        const status = normalizeCim10Status(job.status || '');

        if (status === 'running_heidi') {
            return hasLiveHeidiEvidence(job);
        }

        if (status === 'import_weda') {
            return cim10JobAgeMs(job) < CIM10_EXISTING_JOB_WAIT_MAX_AGE_MS;
        }

        if (status === 'pending_heidi') {
            return hasLiveHeidiEvidence(job);
        }

        return cim10JobAgeMs(job) < CIM10_EXISTING_JOB_WAIT_MAX_AGE_MS;
    }

    function getActiveCim10JobForPatient(expectedPatientId, context = {}) {
        const job = readCim10CurrentJobFromPage();
        if (!job || !job.id) return null;
        if (!isNonTerminalCim10Status(job.status || '')) return null;
        if (!cim10JobMatchesPatient(job, expectedPatientId)) return null;
        if (!shouldWaitForExistingCim10Job(job, context)) return null;
        return job;
    }

    function cim10JobStartedSince(beforeJob, ts) {
        const job = readCim10CurrentJobFromPage();
        if (!job || !job.id) return false;

        if (!beforeJob || !beforeJob.id) return true;
        if (job.id !== beforeJob.id) return true;

        const updatedAtMs = Date.parse(job.updatedAt || job.createdAt || '');
        if (updatedAtMs && updatedAtMs >= ts - 1000) return true;

        return false;
    }

    function startCim10ViaExposedApi() {
        const fn = getCim10ApiFunction('AUTO_ATCD_CIM10_START');
        if (!fn) return false;

        try {
            fn();
            return true;
        } catch (_) {
            return false;
        }
    }

    function reloadAntecedentsPageForCim10Retry(patientForLog, reason) {
        const info = getWorkerInfoFromHash();
        if (!info || !isStrongAntecedentsPage()) return false;
        if (antecedentsReloadRetryAlreadyUsed(info)) return false;

        markAntecedentsReloadRetry(info, reason);
        setWorkerStatus('waiting_cim10_button');
        addLog('warn', 'Lancement CIM-10 non confirme : rechargement automatique de la page antecedents puis nouvelle tentative.', patientForLog, {
            phase: 'cim10_retry_reload_antecedents',
            reason,
            url: window.location.href,
            diagnostic: buildBlockedBatchDiagnostic('cim10_retry_reload_antecedents', { reason })
        });

        setTimeout(() => {
            try { window.location.reload(); } catch (_) {}
        }, 800);

        return true;
    }

    async function triggerCim10Launch(button, baselineReports, patientForLog) {
        const baselineSignature = safeJsonStringify(summarizeReports(baselineReports));
        const firstTs = nowMs();
        const beforeJob = readCim10CurrentJobFromPage();

        publishCim10BatchClickContext(patientForLog, firstTs);
        if (button) {
            clickCim10LauncherButton(button);
            addLog('info', 'Clic bouton CIM-10.', patientForLog, {
                phase: 'cim10_button_click',
                id: button && button.id ? button.id : '',
                text: getElementText(button)
            });

            if (await waitFor(() => cim10JobStartedSince(beforeJob, firstTs) || hasCim10StartedSince(baselineSignature, firstTs), 6000, 300)) {
                return { method: 'button_click', ts: firstTs, observedStarted: true };
            }
        } else {
            addLog('warn', 'Déclenchement CIM-10 sans bouton visible : API exposee uniquement.', patientForLog, {
                phase: 'cim10_api_without_button',
                hasApi: !!getCim10ApiFunction('AUTO_ATCD_CIM10_START')
            });
        }

        addLog('warn', 'Clic bouton CIM-10 non confirme : fallback unique via API exposee 4.20.', patientForLog, {
            phase: 'cim10_click_unconfirmed_fallback',
            hadCurrentJobBeforeClick: !!(beforeJob && beforeJob.id)
        });

        const fallbackTs = nowMs();
        const fallbackStarted = startCim10ViaExposedApi();
        if (
            fallbackStarted &&
            await waitFor(() => cim10JobStartedSince(beforeJob, fallbackTs) || hasCim10StartedSince(baselineSignature, fallbackTs), 6000, 300)
        ) {
            return { method: 'button_click_api_fallback', ts: fallbackTs, observedStarted: true };
        }

        addLog('warn', 'Demarrage CIM-10 non confirme apres clic et fallback.', patientForLog, {
            phase: 'cim10_launch_unconfirmed',
            fallbackStarted,
            beforeJob,
            reports: summarizeReports(readCim10Reports()),
            diagnostic: buildBlockedBatchDiagnostic('cim10_launch_unconfirmed')
        });
        return { method: fallbackStarted ? 'button_click_api_fallback_unconfirmed' : 'button_click_unconfirmed', ts: firstTs, observedStarted: false };
    }

    function publishCim10BatchClickContext(patientForLog, ts) {
        const info = getWorkerInfoFromHash() || {};
        const state = getState();
        const context = {
            batchId: info.batchId || state.batchId || '',
            patientId: info.patientId || (patientForLog && patientForLog.id) || '',
            patientName: patientForLog && patientForLog.name ? patientForLog.name : '',
            url: window.location.href,
            ts: ts || nowMs()
        };

        try {
            localStorage.setItem(LOCALSTORAGE_CIM10_BATCH_CLICK_CONTEXT, JSON.stringify(context));
        } catch (_) {}

        return context;
    }

    function hasCim10StartedSince(baselineSignature, ts) {
        const reports = readCim10Reports();
        if (!reports.length) return false;

        const signature = safeJsonStringify(summarizeReports(reports));
        if (signature === baselineSignature) return false;

        return reports.some(item => {
            const report = item && item.value;
            if (!report) return false;
            if (!isReportFreshEnough(report, ts)) return false;

            const status = lowerText(report.status || '');
            const fullText = lowerText(safeJsonStringify(report));
            return status
                || fullText.includes('pending_heidi')
                || fullText.includes('waiting_weda_antecedent_page')
                || fullText.includes('extract_weda')
                || fullText.includes('extracting_weda')
                || fullText.includes('import_weda')
                || fullText.includes('job');
        });
    }

    function dispatchHomeKeyShortcut(preferredView) {
        const preferredDoc = preferredView && preferredView.document ? preferredView.document : null;
        const targets = [
            preferredView,
            preferredDoc,
            preferredDoc && preferredDoc.body,
            preferredDoc && preferredDoc.documentElement,
            window,
            document,
            document.body,
            document.documentElement
        ].filter(Boolean);
        const eventInit = {
            key: 'Home',
            code: 'Home',
            keyCode: 36,
            which: 36,
            bubbles: true,
            cancelable: true
        };

        for (const target of targets) {
            try {
                const view = (target.document && target) || (target.defaultView) || preferredView || window;
                const KeyboardCtor = view.KeyboardEvent || KeyboardEvent;
                target.dispatchEvent(new KeyboardCtor('keydown', eventInit));
            } catch (_) {}
        }
    }

    function clickBestAntecedentsCandidate() {
        const candidates = queryAllDeep('a, button, input[type="button"], input[type="submit"], div[onclick], span[onclick]');
        const scored = [];
        const cim10Button = findExistingCim10Button();

        for (const el of candidates) {
            if (!el || isInsideBatchPanel(el) || !isVisible(el)) continue;
            if (cim10Button === el) continue;

            const txt = lowerText(getElementText(el));
            const onclick = lowerText(el.getAttribute && el.getAttribute('onclick'));
            const idName = lowerText(`${el.id || ''} ${el.name || ''}`);
            const combined = `${txt} ${onclick} ${idName}`;

            let score = 0;
            if (combined.includes('antecedent')) score += 6;
            if (combined.includes('atcd')) score += 5;
            if (combined.includes('buttongotoantecedent')) score += 10;
            if (onclick.includes('__dopostback')) score += 2;
            if (/^antecedents?$/.test(txt)) score += 3;

            if (score > 0) scored.push({ el, score, txt, onclick });
        }

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (!best) return false;

        addLog('info', 'Clic candidat antecedents.', null, {
            score: best.score,
            text: best.txt,
            onclick: best.onclick
        });
        return clickElement(best.el);
    }

    function callBestAntecedentsPostBack() {
        const postback = getDoPostBack();
        if (!postback) return false;

        const targets = findAntecedentsPostBackTargets();
        for (const target of targets) {
            try {
                addLog('info', 'Appel postback antecedents.', null, target);
                postback(target.target, target.argument || '');
                return true;
            } catch (e) {
                addLog('warn', 'Postback antecedents impossible.', null, {
                    target: target.target,
                    error: String(e && e.message ? e.message : e)
                });
            }
        }

        const fallbackTarget = 'ctl00$ContentPlaceHolder1$ButtonGotoAntecedent';
        try {
            addLog('warn', 'Appel fallback postback WEDA antecedents.', null, { target: fallbackTarget });
            postback(fallbackTarget, '');
            return true;
        } catch (_) {
            return false;
        }
    }

    function callSpecificPostBack(target, argument) {
        const postback = getDoPostBack();
        if (!postback) return false;

        try {
            postback(target, argument || '');
            return true;
        } catch (e) {
            addLog('warn', 'Postback specifique impossible.', null, {
                target,
                error: String(e && e.message ? e.message : e)
            });
            return false;
        }
    }

    function getDoPostBack() {
        try {
            if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.__doPostBack === 'function') {
                return unsafeWindow.__doPostBack.bind(unsafeWindow);
            }
        } catch (_) {}

        try {
            if (typeof window.__doPostBack === 'function') return window.__doPostBack.bind(window);
        } catch (_) {}

        return null;
    }

    function findAntecedentsPostBackTargets() {
        const targets = [];
        const seen = new Set();
        const elements = queryAllDeep('[onclick], a[href^="javascript:"]');

        for (const el of elements) {
            const raw = `${el.getAttribute('onclick') || ''} ${el.getAttribute('href') || ''}`;
            const haystack = lowerText(`${raw} ${getElementText(el)} ${el.id || ''} ${el.name || ''}`);
            if (!haystack.includes('antecedent') && !haystack.includes('atcd') && !haystack.includes('buttongotoantecedent')) {
                continue;
            }

            const parsed = parsePostBackTarget(raw);
            if (!parsed || !parsed.target) continue;
            const key = `${parsed.target}::${parsed.argument || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            targets.push(parsed);
        }

        return targets;
    }

    function parsePostBackTarget(raw) {
        const text = decodeHtmlAttribute(raw);
        let match = text.match(/__doPostBack\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
        if (match) return { target: match[1], argument: match[2] || '' };

        match = text.match(/WebForm_PostBackOptions\s*\(\s*['"]([^'"]+)['"]/i);
        if (match) return { target: match[1], argument: '' };

        match = text.match(/WebForm_DoPostBackWithOptions\s*\(\s*new\s+WebForm_PostBackOptions\s*\(\s*['"]([^'"]+)['"]/i);
        if (match) return { target: match[1], argument: '' };

        return null;
    }

    function getWedaNavigationDiagnostics() {
        const antecedentCandidates = queryAllDeep('a[href], button, input[type="button"], input[type="submit"], div[onclick], span[onclick], [onclick]')
            .filter(el => !isInsideBatchPanel(el))
            .map(el => {
                const text = getElementText(el);
                const onclick = el.getAttribute ? (el.getAttribute('onclick') || '') : '';
                const href = el.getAttribute ? (el.getAttribute('href') || '') : '';
                const idName = `${el.id || ''} ${el.name || ''}`;
                const haystack = lowerText(`${text} ${onclick} ${href} ${idName}`);
                if (!haystack.includes('antecedent') && !haystack.includes('atcd') && !haystack.includes('buttongotoantecedent')) {
                    return null;
                }

                return {
                    tag: el.tagName || '',
                    id: el.id || '',
                    name: el.name || '',
                    visible: isVisible(el),
                    text: limitText(text, 120),
                    href: limitText(href, 180),
                    onclick: limitText(onclick, 260),
                    postback: parsePostBackTarget(`${href} ${onclick}`)
                };
            })
            .filter(Boolean)
            .slice(0, 30);

        const diag = {
            url: window.location.href,
            patDk: extractPatDk(window.location.href),
            isPatientPageReady: isPatientPageReady(''),
            isStrongAntecedentsPage: isStrongAntecedentsPage(),
            hasExistingCim10Button: !!findExistingCim10Button(),
            hasDoPostBack: !!getDoPostBack(),
            antecedentCandidates
        };

        console.log(LOG_PREFIX, 'WEDA_NAV_DIAG', diag);
        return diag;
    }

    /************************************************************
     * DETECTION FIN CIM-10
     ************************************************************/

    async function waitForCim10Done(clickTs, baselineReports, timeoutMs, expectedContext = {}) {
        const baselineSignature = safeJsonStringify(summarizeReports(baselineReports));
        const start = nowMs();
        let lastNonTerminalReport = null;
        let lastObservedStatusKey = '';

        while (nowMs() - start < timeoutMs) {
            const bridge = readLocalStorageBridgeReport(clickTs, expectedContext);
            if (bridge) return bridge;

            const reports = readCim10Reports();
            const observedStatusKey = getObservedCim10StatusKey(reports);
            if (observedStatusKey && observedStatusKey !== lastObservedStatusKey) {
                lastObservedStatusKey = observedStatusKey;
                addLog('info', 'Etat CIM-10 observe, attente du statut terminal.', null, {
                    phase: 'cim10_wait_status',
                    observedStatusKey,
                    elapsedMs: nowMs() - start,
                    reports: summarizeReports(reports)
                });
            }

            const reportClassification = classifyReports(reports, baselineSignature, clickTs);
            if (reportClassification) return reportClassification;
            if (reports.length) lastNonTerminalReport = summarizeReports(reports);

            await sleep(1500);
        }

        return {
            status: 'timeout',
            message: 'Timeout : fin CIM-10 non detectee.',
            report: {
                stage: 'waiting_cim10_done',
                lastReport: lastNonTerminalReport
            }
        };
    }

    function classifyLocalStorageBridgeReport(report, clickTs, expectedContext = {}) {
        if (!report || typeof report !== 'object') return null;
        if (Number(report.ts || 0) < clickTs - 1000) return null;

        if (
            expectedContext &&
            expectedContext.batchId &&
            report.batchId &&
            report.batchId !== expectedContext.batchId
        ) {
            return null;
        }

        if (
            expectedContext &&
            expectedContext.patientId &&
            report.patientId &&
            report.patientId !== expectedContext.patientId
        ) {
            return null;
        }

        const status = lowerText(report.status);
        if (isNonTerminalCim10Status(status)) return null;

        if (isErrorStatus(status)) {
            return {
                status: status.includes('timeout') ? 'timeout' : 'error',
                message: report.message || 'Erreur CIM-10 signalee.',
                report: summarizeReport(report)
            };
        }

        if (isSuccessStatus(status)) {
            return {
                status: 'success',
                message: report.message || 'Colorisation termine.',
                report: summarizeReport(report)
            };
        }

        if (Number(report.errorCount || 0) > 0) {
            return {
                status: 'error',
                message: report.message || 'Erreur CIM-10 signalee.',
                report: summarizeReport(report)
            };
        }

        return null;
    }

    function readLocalStorageBridgeReport(clickTs, expectedContext = {}) {
        try {
            const raw = localStorage.getItem(LOCALSTORAGE_BATCH_REPORT_KEY);
            return classifyLocalStorageBridgeReport(parseMaybeJson(raw, null), clickTs, expectedContext);
        } catch (_) {
            return null;
        }
    }

    function readRawLocalStorageBridgeReport(expectedContext = {}, minTs = 0) {
        try {
            const report = parseMaybeJson(localStorage.getItem(LOCALSTORAGE_BATCH_REPORT_KEY), null);
            if (!report || typeof report !== 'object') return null;
            if (Number(report.ts || 0) < Number(minTs || 0) - 1000) return null;

            if (
                expectedContext &&
                expectedContext.batchId &&
                report.batchId &&
                report.batchId !== expectedContext.batchId
            ) {
                return null;
            }

            if (
                expectedContext &&
                expectedContext.patientId &&
                report.patientId &&
                report.patientId !== expectedContext.patientId
            ) {
                return null;
            }

            return report;
        } catch (_) {
            return null;
        }
    }

    function getBridgeProgressSignature(report) {
        if (!report || typeof report !== 'object') return '';
        return [
            report.id || '',
            report.status || '',
            report.importIndex === undefined ? '' : String(report.importIndex),
            Number(report.importedCount || 0),
            Number(report.errorCount || 0),
            report.currentItemStartedAt || '',
            report.doneAt || ''
        ].join('|');
    }

    function isActiveImportBridgeReport(report) {
        return !!(
            report &&
            report.bridgeSource === 'antecedents-cim10-weda-heidi' &&
            report.id &&
            normalizeCim10Status(report.status || '') === 'import_weda'
        );
    }

    function requestSilentCim10ImportNudge(report, patient, reason, rescueCount) {
        if (!report || !report.id) return false;

        gmSetJson(CIM10_IMPORT_WAKE_KEY, {
            jobId: report.id,
            status: report.status || 'IMPORT_WEDA',
            batchId: report.batchId || '',
            patientId: report.patientId || '',
            reason,
            from: 'batch_controller',
            controllerId: CONTROLLER_ID,
            ts: nowMs()
        });

        if (rescueCount === 1 || rescueCount >= MAX_WEDA_IMPORT_RESCUES_PER_PATIENT) {
            addLog('warn', 'Import WEDA sans progression : réveil silencieux du worker CIM-10.', patient, {
                phase: 'weda_import_silent_nudge',
                reason,
                rescueCount,
                report: summarizeReport(report),
                skipDiagnostic: true
            });
        }

        return true;
    }

    function handleBatchSourceCloseSignal(signal) {
        try {
            const info = getWorkerInfoFromHash();
            if (!info || !info.batchId || !info.patientId) return false;
            if (!signal || signal.batchId !== info.batchId || signal.patientId !== info.patientId) return false;

            addLog('info', 'Signal fermeture worker source recu.', { id: info.patientId }, {
                phase: 'worker_source_close_signal',
                signal
            });

            if (!runtime.workerResultPublishedAt && runtime.workerClickedAt) {
                const outcome = readLocalStorageBridgeReport(runtime.workerClickedAt, {
                    batchId: info.batchId,
                    patientId: info.patientId
                });

                if (outcome) {
                    publishWorkerResult(outcome.status, outcome.message, outcome.report);
                }
            }

            closeCurrentWorkerSoon(150);
            return true;
        } catch (e) {
            addLog('warn', 'Signal fermeture worker source ignore : traitement impossible.', null, {
                phase: 'worker_source_close_signal_error',
                error: String(e && e.message ? e.message : e)
            });
            return false;
        }
    }

    function shouldWaitForWedaWorkerClosingSignal(report) {
        if (!report || typeof report !== 'object') return false;
        if (report.wedaWorkerClosingAt) return false;
        if (!report.wedaWorkerTabId) return false;

        const status = normalizeCim10Status(report.status || '');
        return status === 'done_import' || status === 'done_no_import';
    }

    function installLocalStorageBridgeListener() {
        if (window.__AUTO_ATCD_BATCH_LOCALSTORAGE_BRIDGE_LISTENER__) return;
        window.__AUTO_ATCD_BATCH_LOCALSTORAGE_BRIDGE_LISTENER__ = true;

        window.addEventListener('storage', event => {
            try {
                if (!event) return;

                if (event.key === LOCALSTORAGE_BATCH_SOURCE_CLOSE_KEY) {
                    handleBatchSourceCloseSignal(parseMaybeJson(event.newValue, null));
                    return;
                }

                if (event.key !== LOCALSTORAGE_BATCH_REPORT_KEY) return;

                const info = getWorkerInfoFromHash();
                if (!info || !info.batchId || !info.patientId) return;
                if (!runtime.workerClickedAt || runtime.workerResultPublishedAt) return;

                const report = parseMaybeJson(event.newValue, null);
                if (shouldWaitForWedaWorkerClosingSignal(report)) return;

                const outcome = classifyLocalStorageBridgeReport(report, runtime.workerClickedAt, {
                    batchId: info.batchId,
                    patientId: info.patientId
                });
                if (!outcome) return;

                addLog('success', 'Signal final recu du worker WEDA : relais immediat.', { id: info.patientId }, {
                    phase: 'weda_worker_close_bridge_signal',
                    outcome,
                    report: summarizeReport(report),
                    workerClosingAt: report && report.wedaWorkerClosingAt || '',
                    bridgeUrl: report && report.bridgeUrl || ''
                });

                publishWorkerResult(outcome.status, outcome.message, outcome.report);
                closeCurrentWorkerSoon(150);
            } catch (e) {
                addLog('warn', 'Signal final worker WEDA ignore : lecture impossible.', null, {
                    phase: 'weda_worker_close_bridge_signal_error',
                    error: String(e && e.message ? e.message : e)
                });
            }
        }, false);
    }

    function getAccessibleWindows() {
        const wins = [];
        const seen = new Set();

        function addWin(win) {
            if (!win || seen.has(win)) return;
            seen.add(win);
            wins.push(win);
        }

        try { addWin(window); } catch (_) {}
        try { if (typeof unsafeWindow !== 'undefined') addWin(unsafeWindow); } catch (_) {}

        for (const doc of getAccessibleDocuments()) {
            try { addWin(doc.defaultView); } catch (_) {}
        }

        return wins;
    }

    function getCim10Function(name, preferredView) {
        try {
            if (preferredView && typeof preferredView[name] === 'function') return preferredView[name].bind(preferredView);
        } catch (_) {}

        try {
            if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow[name] === 'function') return unsafeWindow[name];
        } catch (_) {}

        try {
            if (typeof window[name] === 'function') return window[name];
        } catch (_) {}

        for (const win of getAccessibleWindows()) {
            try {
                if (win && typeof win[name] === 'function') return win[name].bind(win);
            } catch (_) {}
        }

        return null;
    }

    function readCim10Reports() {
        const reports = [];
        const functionNames = [
            'AUTO_ATCD_CIM10_LAST',
            'AUTO_ATCD_CIM10_CURRENT_JOB'
        ];

        for (const name of functionNames) {
            const fns = [];
            const seenFns = new Set();

            const direct = getCim10Function(name);
            if (direct) {
                fns.push(direct);
                seenFns.add(direct);
            }

            for (const win of getAccessibleWindows()) {
                try {
                    const fn = win && win[name];
                    if (typeof fn === 'function' && !seenFns.has(fn)) {
                        fns.push(fn.bind(win));
                        seenFns.add(fn);
                    }
                } catch (_) {}
            }

            for (const fn of fns) {
                try {
                    const report = fn();
                    if (report) reports.push({ source: name, value: report });
                } catch (e) {
                    reports.push({
                        source: name,
                        value: {
                            status: 'read_error',
                            message: String(e && e.message ? e.message : e)
                        }
                    });
                }
            }
        }

        return reports;
    }

    function classifyReports(reports, baselineSignature, clickTs) {
        if (!Array.isArray(reports) || !reports.length) return null;

        const summarized = summarizeReports(reports);
        const signature = safeJsonStringify(summarized);
        if (signature === baselineSignature) return null;

        for (const item of reports) {
            const report = item && item.value;
            if (!report || !isReportFreshEnough(report, clickTs)) continue;

            const status = lowerText(report.status || '');
            const fullText = lowerText(safeJsonStringify(report));

            if (isNonTerminalCim10Status(status)) continue;

            if (isErrorStatus(status)) {
                return {
                    status: status.includes('timeout') ? 'timeout' : 'error',
                    message: extractReportMessage(report) || 'Erreur CIM-10 detectee.',
                    report: summarizeReport(report, item.source)
                };
            }

            if (isSuccessStatus(status) || hasSuccessText(fullText)) {
                return {
                    status: 'success',
                    message: 'Colorisation termine.',
                    report: summarizeReport(report, item.source)
                };
            }

            if (hasErrorText(fullText)) {
                return {
                    status: 'error',
                    message: extractReportMessage(report) || 'Erreur CIM-10 detectee.',
                    report: summarizeReport(report, item.source)
                };
            }
        }

        return null;
    }

    function isReportFreshEnough(report, clickTs) {
        const possibleDates = [
            report.ts,
            report.updatedAt,
            report.finishedAt,
            report.heidiResultAt,
            report.startedAt,
            report.createdAt
        ].filter(Boolean);

        if (!possibleDates.length) return true;

        return possibleDates.some(value => {
            const parsed = typeof value === 'number' ? value : Date.parse(value);
            return Number.isFinite(parsed) && parsed >= clickTs - 10000;
        });
    }

    function normalizeCim10Status(status) {
        return lowerText(status || '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function isNonTerminalCim10Status(status) {
        const s = normalizeCim10Status(status);
        return [
            'waiting_weda_antecedent_page',
            'extract_weda',
            'pending_heidi',
            'running_heidi',
            'import_weda',
            'waiting_heidi',
            'extracting_weda'
        ].includes(s);
    }

    function getObservedCim10StatusKey(reports) {
        const parts = [];
        for (const item of reports || []) {
            const report = item && item.value;
            if (!report || !report.status) continue;
            const summary = summarizeReport(report, item.source);
            parts.push([
                item.source || '',
                normalizeCim10Status(report.status),
                summary.id || '',
                summary.itemCount || 0,
                summary.parsedCount || 0,
                summary.importedCount || 0,
                summary.importIndex || 0
            ].join(':'));
        }
        return parts.join('|');
    }

    function isSuccessStatus(status) {
        const s = normalizeCim10Status(status);
        return [
            'done_import',
            'done_no_import',
            'done_no_items',
            'done',
            'finished',
            'success',
            'termine'
        ].includes(s);
    }

    function isErrorStatus(status) {
        const s = normalizeCim10Status(status);
        if (s === 'done_import_with_errors') return true;
        return [
            'error',
            'failed',
            'timeout',
            'echec'
        ].some(token => s === token || s.startsWith(token + '_') || s.endsWith('_' + token));
    }

    function hasSuccessText(text) {
        return [
            'import cim10 termine',
            'codage cim-10 termine',
            'codage cim10 termine',
            'tache terminee',
            'aucun antecedent non code',
            'aucun antecedent cim10 a importer',
            'aucun antecedent non code cim10 exploitable'
        ].some(token => text.includes(token));
    }

    function hasErrorText(text) {
        return [
            'heidi introuvable',
            'import impossible',
            'erreur inattendue',
            'timeout',
            'failed',
            'echec'
        ].some(token => text.includes(token));
    }

    function hasDomSuccessText(text) {
        return [
            'import cim10 termine',
            'import cim-10 termine',
            'codage cim-10 termine',
            'codage cim10 termine',
            'aucun antecedent non code cim10 exploitable',
            'aucun antecedent cim10 a importer'
        ].some(token => text.includes(token));
    }

    function hasDomErrorText(text) {
        return [
            'heidi introuvable',
            'import impossible',
            'import interrompu par une erreur inattendue',
            'erreur cim-10 detectee',
            'timeout : fin cim-10 non detectee'
        ].some(token => text.includes(token));
    }

    function extractReportMessage(report) {
        if (!report) return '';
        if (report.message) return String(report.message);
        if (Array.isArray(report.errors) && report.errors.length) {
            const last = report.errors[report.errors.length - 1];
            return String(last && (last.message || last.phase) ? (last.message || last.phase) : safeJsonStringify(last));
        }
        return '';
    }

    function classifyDomCompletion() {
        // Intentionnellement desactive pour la decision automatique :
        // le DOM WEDA peut contenir d'anciens textes "termine" dans le panneau
        // de logs ou dans les badges. Le batch doit s'appuyer sur les statuts
        // structures du script antecedents.
        return null;
    }

    function summarizeReports(reports) {
        return (reports || []).map(item => ({
            source: item.source || '',
            value: summarizeReport(item.value)
        }));
    }

    function parseReportError(error) {
        let value = error;

        for (let i = 0; i < 2; i++) {
            if (typeof value !== 'string') break;
            const trimmed = value.trim();
            const parsed = parseMaybeJson(trimmed, null);
            if (parsed === null) break;
            value = parsed;
        }

        return value;
    }

    function summarizeAtcdItemForLog(item) {
        if (!item || typeof item !== 'object') return null;
        return {
            section: item.section || '',
            familyMember: item.familyMember || '',
            description: limitText(item.description || item.comment || '', 120),
            code: item.code || '',
            date: item.date || ''
        };
    }

    function summarizeReportError(error) {
        const parsed = parseReportError(error);
        if (parsed && typeof parsed === 'object') {
            return {
                at: parsed.at || '',
                phase: parsed.phase || '',
                message: limitText(parsed.message || parsed.error || '', 220),
                item: summarizeAtcdItemForLog(parsed.item)
            };
        }

        return {
            message: limitText(String(error || ''), 220)
        };
    }

    function summarizeReport(report, source) {
        if (!report || typeof report !== 'object') {
            return { source: source || '', value: limitText(String(report || ''), 500) };
        }

        const errors = Array.isArray(report.errors)
            ? report.errors.slice(-3).map(summarizeReportError)
            : [];

        return {
            source: source || report.source || '',
            id: report.id || report.jobId || '',
            status: report.status || '',
            updatedAt: report.updatedAt || report.ts || '',
            itemCount: report.itemCount || 0,
            importIndex: report.importIndex || 0,
            parsedCount: Array.isArray(report.parsedAtcd) ? report.parsedAtcd.length : Number(report.parsedCount || 0),
            importedCount: Array.isArray(report.imported) ? report.imported.length : Number(report.importedCount || 0),
            errorCount: Array.isArray(report.errors) ? report.errors.length : Number(report.errorCount || 0),
            message: limitText(report.message || '', 500),
            errors
        };
    }

    /************************************************************
     * FONCTIONS CONSOLE
     ************************************************************/

    function exposeConsoleFunctions() {
        const api = {
            AUTO_ATCD_COLOR_BATCH_SCAN: () => scanAndStorePatients(),
            AUTO_ATCD_COLOR_BATCH_START: () => startBatch(),
            AUTO_ATCD_COLOR_BATCH_PAUSE: () => pauseBatch(),
            AUTO_ATCD_COLOR_BATCH_RESUME: () => resumeBatch(),
            AUTO_ATCD_COLOR_BATCH_RESUME_FROM: (selector, options) => resumeFromPatient(selector, options),
            AUTO_ATCD_COLOR_BATCH_STOP: () => stopBatch(),
            AUTO_ATCD_COLOR_BATCH_UNLOCK_STALE: () => clearStaleRunningState('console'),
            AUTO_ATCD_COLOR_BATCH_DIAG_WEDA_NAV: () => getWedaNavigationDiagnostics(),
            AUTO_ATCD_COLOR_BATCH_DIAG: (reason) => {
                const diagnostic = buildBlockedBatchDiagnostic(reason || 'console_diagnostic');
                console.log(LOG_PREFIX, 'DIAG', diagnostic);
                return diagnostic;
            },
            AUTO_ATCD_COLOR_BATCH_STATUS: () => {
                const status = getBatchRuntimeSnapshot();
                console.log(LOG_PREFIX, 'STATUS', status);
                return status;
            },
            AUTO_ATCD_COLOR_BATCH_LOG: () => showLogs(),
            AUTO_ATCD_COLOR_BATCH_LOGS: () => getLogs(),
            AUTO_ATCD_COLOR_BATCH_LOG_CLEAR: () => clearLogs(),
            AUTO_ATCD_COLOR_BATCH_CLEAR: () => clearBatchData(),
            AUTO_ATCD_COLOR_BATCH_RETRY_ERRORS: () => retryErrors()
        };

        try {
            Object.assign(window, api);
            if (typeof unsafeWindow !== 'undefined') Object.assign(unsafeWindow, api);
        } catch (_) {}
    }

    function installValueListeners() {
        if (typeof GM_addValueChangeListener !== 'function') return;

        [BATCH_KEY_QUEUE, BATCH_KEY_STATE, BATCH_KEY_LOG, BATCH_KEY_RESULT, BATCH_KEY_WORKER_HEARTBEAT].forEach(key => {
            try {
                GM_addValueChangeListener(key, (name, oldValue, newValue) => {
                    if (name === BATCH_KEY_RESULT) {
                        signalWorkerOutcomeIfWaiting(parseMaybeJson(newValue, null));
                    }

                    if (name === BATCH_KEY_WORKER_HEARTBEAT) {
                        const heartbeat = parseMaybeJson(newValue, null);
                        const state = getState();
                        if (
                            heartbeat &&
                            heartbeat.batchId === state.batchId &&
                            heartbeat.patientId === state.runningPatientId
                        ) {
                            mirrorWorkerStatusToState(heartbeat.status, heartbeat.patientId);
                        }
                    }

                    renderPanel();
                    if (name === BATCH_KEY_RESULT || name === BATCH_KEY_WORKER_HEARTBEAT || name === BATCH_KEY_STATE) {
                        wakeControllerIfNeeded('value_listener_' + name);
                    }
                });
            } catch (_) {}
        });
    }

    function logWakeDecision(level, message, reason, details, throttleMs = 30000) {
        const key = `${level}|${message}|${reason}|${details && details.status || ''}|${details && details.runningPatientId || ''}`;
        const lastAt = Number(runtime.wakeDecisionLogAt[key] || 0);
        if (nowMs() - lastAt < throttleMs) return false;
        runtime.wakeDecisionLogAt[key] = nowMs();
        addLog(level, message, null, Object.assign({
            phase: 'controller_wake',
            reason
        }, details || {}));
        return true;
    }

    function wakeControllerIfNeeded(reason = '') {
        if (getWorkerInfoFromHash()) return false;
        if (!isBatchPanelPage()) return false;
        if (runtime.processing) {
            logWakeDecision('info', 'Reveil controleur ignore : boucle deja active.', reason, {
                processing: runtime.processing,
                status: getState().status
            }, 45000);
            return false;
        }

        const state = getState();
        if (!state.batchId) return false;
        if (state.pauseRequested || state.stopRequested) return false;
        if (state.status === 'paused' || state.status === 'stopped' || state.status === 'finished') return false;
        if (state.status === 'ready') {
            logWakeDecision('info', 'Reveil controleur ignore : batch pret mais lancement explicite attendu.', reason, {
                status: state.status,
                pending: countQueue(getQueue()).pending
            }, 45000);
            return false;
        }

        const hasWork = getQueue().some(patient => patient && patient.id && patient.status === 'pending' && !patient.excludedByResume);
        const hasActive = !!state.runningPatientId || ACTIVE_STATUSES.has(state.status);
        if (!hasWork && !hasActive) return false;

        let wakeDelayMs = 0;

        if (state.runningPatientId) {
            const result = gmGetJson(BATCH_KEY_RESULT, null);
            const resultMatches = result &&
                result.batchId === state.batchId &&
                result.patientId === state.runningPatientId;

            if (resultMatches) {
                addLog('info', 'Controleur reveille : resultat en attente trouve pour le patient courant.', { id: state.runningPatientId }, {
                    phase: 'controller_wake_result_found',
                    reason,
                    result,
                    diagnostic: getBatchRuntimeSnapshot()
                });
                applyPatientOutcomeToQueue(state.runningPatientId, result);
                gmDelete(BATCH_KEY_RESULT);
                setState({ status: 'next_patient', runningPatientId: null });
                wakeDelayMs = NEXT_PATIENT_AFTER_WORKER_CLOSE_DELAY_MS;
            } else if (ACTIVE_STATUSES.has(state.status)) {
                const freshness = getCurrentWorkerFreshness(state);
                const stale = !freshness.fresh && (
                    freshness.heartbeatAge !== Infinity ||
                    freshness.currentAge > HEARTBEAT_STALE_MS * 2
                );
                if (stale && shouldAutoFailStaleRunningPatient(state, freshness)) {
                    failStaleRunningPatientAndContinue(state, freshness, reason || 'controller_wake_stale_active');
                    wakeDelayMs = NEXT_PATIENT_AFTER_WORKER_CLOSE_DELAY_MS;
                } else {
                    logWakeDecision(stale ? 'warn' : 'info', 'Reveil controleur ignore : patient actif sans resultat worker.', reason, {
                        status: state.status,
                        runningPatientId: state.runningPatientId,
                        heartbeatAge: freshness.heartbeatAge,
                        currentAge: freshness.currentAge,
                        heartbeatMatches: freshness.heartbeatMatches,
                        stale,
                        skipDiagnostic: true
                    }, stale ? 20000 : 60000);
                    return false;
                }
            }
        }

        const lock = gmGetJson(BATCH_KEY_LOCK, null);
        const lockOwnedOrStale = !lock || lock.controllerId === CONTROLLER_ID || Number(lock.expiresAt || 0) <= nowMs();
        if (!lockOwnedOrStale) {
            logWakeDecision('warn', 'Reveil controleur bloque par verrou controleur actif.', reason, {
                status: state.status,
                runningPatientId: state.runningPatientId,
                lock,
                lockAgeMs: valueAgeMs(lock),
                diagnostic: buildBlockedBatchDiagnostic('wake_controller_lock_active', { lock })
            }, 20000);
            return false;
        }

        addLog('info', 'Controleur batch reveille automatiquement.', null, {
            phase: 'controller_wake_start',
            reason,
            status: state.status,
            skipDiagnostic: true
        });
        acquireControllerLock(state.batchId);
        setTimeout(() => processNextPatient(), wakeDelayMs);
        return true;
    }

    /************************************************************
     * INITIALISATION
     ************************************************************/

    function init() {
        if (!isWeda()) return;

        exposeConsoleFunctions();
        installValueListeners();

        const workerInfo = getWorkerInfoFromHash();
        if (workerInfo) {
            runWorker();
            return;
        }

        if (!isBatchPanelPage()) {
            removePanel();
            return;
        }

        installPanel();
        wakeControllerIfNeeded('init');
        setInterval(() => {
            try {
                if (!isBatchPanelPage() || getWorkerInfoFromHash()) {
                    removePanel();
                    return;
                }
                installPanel();
                renderPanel();
                wakeControllerIfNeeded('panel_interval');
            } catch (_) {}
        }, 2000);
    }

    init();
})();

