// ============================================================================
// FEL CTU BRUTE Deadline Manager - Synced Chunked & Compressed Storage (v2)
// ============================================================================
// Stores 100% of extension data in browser.storage.sync / chrome.storage.sync:
// - Course-prefix deduplication (/brute/student/course/<courseId>/<taskSlug>)
// - Unified bit-packed task state (seen + state + autoCompleteSource + dangerX)
// - Automatic multi-key chunking (b_meta + b_c_0 .. b_c_N, max 6,500 bytes/item)
// - Automatic backwards-compatible migration & purge of legacy sync/local data
// ============================================================================

(function (globalScope) {
    'use strict';

    const isFirefox = (typeof browser !== 'undefined' && Boolean(browser.storage));
    const storageNamespace = isFirefox
        ? browser.storage
        : (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage : null);

    const syncArea = storageNamespace ? (storageNamespace.sync || storageNamespace.local) : null;
    const localArea = storageNamespace ? storageNamespace.local : null;

    const META_KEY = 'b_meta';
    const CHUNK_PREFIX = 'b_c_';
    const MAX_CHUNK_CHARS = 6500; // Pure ASCII -> 6,500 bytes (well below 8,192 QUOTA_BYTES_PER_ITEM)
    const SCHEMA_VERSION = 2;

    const LEGACY_KEYS = [
        'bruteTasks',
        'bruteSeenTasks',
        'bruteAutoCompleted',
        'bruteDangerTasks',
        'bruteLastResetId',
        'plagiatIncident',
        'hidePlagiatBanner',
        'classicUiStyle',
        'courseSummaryToBottom',
        'autoDetectCompletion',
        'autoCompleteRemovedX',
        'showCompletionToast',
        'showGreenCheckmarks',
        'hideNewTaskBadge',
        'enablePartyMode',
        'partyModeOnMinScore',
        'brutePartyTriggered'
    ];

    const LEGACY_LS_KEYS = [
        'brute_seen_tasks_v1',
        'brute_last_reset_id_v1'
    ];

    const SETTING_DEFAULTS = {
        classicUiStyle: false,
        courseSummaryToBottom: false,
        autoDetectCompletion: true,
        autoCompleteRemovedX: true,
        showCompletionToast: true,
        showGreenCheckmarks: true,
        hideNewTaskBadge: false,
        hidePlagiatBanner: true,
        enablePartyMode: true,
        partyModeOnMinScore: false
    };

    const BASE62_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const STATE_LIST = ['default', 'done', 'todo', 'cancel', 'highlight'];
    const STATE_TO_IDX = {
        'default': 0,
        'done': 1,
        'todo': 2,
        'cancel': 3,
        'highlight': 4
    };

    const AUTO_LIST = ['', 'summary', 'x'];
    const AUTO_TO_IDX = {
        '': 0,
        'summary': 1,
        'x': 2
    };

    const COURSE_PATH_REGEX = /^\/brute\/student\/course\/([^/]+)\/([^/]+)$/i;

    // Raw area helpers (Promise-based across Firefox & Chrome)
    function rawGet(area, keys) {
        if (!area) return Promise.resolve({});
        if (isFirefox) {
            return area.get(keys).then(res => res || {}).catch(() => ({}));
        }
        return new Promise((resolve) => {
            try {
                area.get(keys, (res) => resolve(res || {}));
            } catch (e) {
                resolve({});
            }
        });
    }

    function rawSet(area, items) {
        if (!area || !items || Object.keys(items).length === 0) return Promise.resolve();
        if (isFirefox) {
            return area.set(items);
        }
        return new Promise((resolve, reject) => {
            try {
                area.set(items, () => {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function rawRemove(area, keys) {
        if (!area || !keys || (Array.isArray(keys) && keys.length === 0)) return Promise.resolve();
        if (isFirefox) {
            return area.remove(keys).catch(() => {});
        }
        return new Promise((resolve) => {
            try {
                area.remove(keys, () => resolve());
            } catch (e) {
                resolve();
            }
        });
    }

    function rawClear(area) {
        if (!area) return Promise.resolve();
        if (isFirefox) {
            return area.clear().catch(() => {});
        }
        return new Promise((resolve) => {
            try {
                area.clear(() => resolve());
            } catch (e) {
                resolve();
            }
        });
    }

    // Normalize any task URL or path into canonical pathname
    function normalizeTaskKey(rawKey) {
        if (!rawKey || typeof rawKey !== 'string') return '';
        let trimmed = rawKey.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            try {
                trimmed = new URL(trimmed).pathname;
            } catch (e) {}
        }
        if (trimmed.length > 1) {
            trimmed = trimmed.replace(/\/+$/, '');
        }
        return trimmed;
    }

    function encodeToken(str) {
        return encodeURIComponent(String(str || ''));
    }

    function decodeToken(str) {
        try {
            return decodeURIComponent(String(str || ''));
        } catch (e) {
            return String(str || '');
        }
    }

    // Pack (state, autoSource, dangerX, partyDone) -> integer 0..59 (1 char in Base62)
    function packTaskCode(state, autoSource, dangerX, partyDone) {
        const sIdx = Object.prototype.hasOwnProperty.call(STATE_TO_IDX, state) ? STATE_TO_IDX[state] : 0;
        const normalizedAuto = (autoSource === true) ? 'summary' : (autoSource || '');
        const aIdx = Object.prototype.hasOwnProperty.call(AUTO_TO_IDX, normalizedAuto) ? AUTO_TO_IDX[normalizedAuto] : 0;
        const dBit = dangerX ? 1 : 0;
        const pBit = partyDone ? 1 : 0;
        return sIdx + (5 * aIdx) + (15 * dBit) + (30 * pBit);
    }

    // Unpack integer 0..59 -> { state, autoSource, dangerX, partyDone }
    function unpackTaskCode(code) {
        const num = (typeof code === 'number' && !Number.isNaN(code) && code >= 0 && code < 60) ? code : 0;
        const sIdx = num % 5;
        const aIdx = Math.floor(num / 5) % 3;
        const dBit = Math.floor(num / 15) % 2;
        const pBit = Math.floor(num / 30) % 2;
        return {
            state: STATE_LIST[sIdx] || 'default',
            autoSource: AUTO_LIST[aIdx] || '',
            dangerX: dBit === 1,
            partyDone: pBit === 1
        };
    }

    function encodeBase62(num) {
        if (typeof num !== 'number' || num <= 0 || num >= BASE62_CHARS.length) return '0';
        return BASE62_CHARS[num];
    }

    function decodeBase62(str) {
        if (!str || typeof str !== 'string') return 0;
        if (str.length === 1) {
            const idx = BASE62_CHARS.indexOf(str);
            return idx >= 0 ? idx : 0;
        }
        const parsed = parseInt(str, 36);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    // Encode all 5 task maps into a compact course-grouped ASCII string
    function serializeTaskMaps(tasksMap, seenMap, autoMap, dangerMap, partyMap) {
        const tasks = (tasksMap && typeof tasksMap === 'object') ? tasksMap : {};
        const seen = (seenMap && typeof seenMap === 'object') ? seenMap : {};
        const auto = (autoMap && typeof autoMap === 'object') ? autoMap : {};
        const danger = (dangerMap && typeof dangerMap === 'object') ? dangerMap : {};
        const party = (partyMap && typeof partyMap === 'object') ? partyMap : {};

        // Collect all unique normalized task keys across all maps
        const unified = new Map();

        const ensureEntry = (rawKey) => {
            const norm = normalizeTaskKey(rawKey);
            if (!norm) return null;
            let entry = unified.get(norm);
            if (!entry) {
                entry = { state: 'default', autoSource: '', dangerX: false, partyDone: false };
                unified.set(norm, entry);
            }
            return entry;
        };

        for (const k of Object.keys(seen)) {
            if (seen[k]) ensureEntry(k);
        }
        for (const [k, v] of Object.entries(tasks)) {
            const entry = ensureEntry(k);
            if (entry && typeof v === 'string' && Object.prototype.hasOwnProperty.call(STATE_TO_IDX, v)) {
                if (entry.state === 'default' || v !== 'default') {
                    entry.state = v;
                }
            }
        }
        for (const [k, v] of Object.entries(auto)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) {
                entry.autoSource = (v === true) ? 'summary' : String(v);
            }
        }
        for (const [k, v] of Object.entries(danger)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) {
                entry.dangerX = true;
            }
        }
        for (const [k, v] of Object.entries(party)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) {
                entry.partyDone = true;
            }
        }

        // Group by courseId
        const groups = new Map();
        for (const [normKey, info] of unified.entries()) {
            const m = normKey.match(COURSE_PATH_REGEX);
            let groupKey = '_';
            let slug = '';
            if (m && m[1] && m[2] && m[1] !== '_') {
                groupKey = encodeToken(m[1]);
                slug = encodeToken(m[2]);
            } else {
                groupKey = '_';
                slug = encodeToken(normKey);
            }

            const code = packTaskCode(info.state, info.autoSource, info.dangerX, info.partyDone);
            const itemToken = code === 0 ? slug : `${slug}:${encodeBase62(code)}`;

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(itemToken);
        }

        const groupStrings = [];
        for (const [groupKey, itemTokens] of groups.entries()) {
            groupStrings.push(`${groupKey}=${itemTokens.join(',')}`);
        }
        return groupStrings.join('|');
    }

    // Decode compact course-grouped ASCII string back into the 5 task maps
    function deserializeTaskMaps(serialized) {
        const bruteTasks = {};
        const bruteSeenTasks = {};
        const bruteAutoCompleted = {};
        const bruteDangerTasks = {};
        const brutePartyTriggered = {};

        if (!serialized || typeof serialized !== 'string') {
            return { bruteTasks, bruteSeenTasks, bruteAutoCompleted, bruteDangerTasks, brutePartyTriggered };
        }

        const groups = serialized.split('|');
        for (const groupPart of groups) {
            if (!groupPart) continue;
            const eqIdx = groupPart.indexOf('=');
            if (eqIdx <= 0) continue;

            const rawGroupKey = groupPart.slice(0, eqIdx);
            const itemsPart = groupPart.slice(eqIdx + 1);
            if (!itemsPart) continue;

            const isFallbackGroup = (rawGroupKey === '_');
            const courseId = isFallbackGroup ? '_' : decodeToken(rawGroupKey);

            const items = itemsPart.split(',');
            for (const itemToken of items) {
                if (!itemToken) continue;
                const colonIdx = itemToken.lastIndexOf(':');
                let rawSlug = itemToken;
                let code = 0;

                if (colonIdx > 0) {
                    rawSlug = itemToken.slice(0, colonIdx);
                    code = decodeBase62(itemToken.slice(colonIdx + 1));
                }

                const slug = decodeToken(rawSlug);
                if (!slug) continue;

                const fullKey = isFallbackGroup ? slug : `/brute/student/course/${courseId}/${slug}`;
                const { state, autoSource, dangerX, partyDone } = unpackTaskCode(code);

                bruteTasks[fullKey] = state;
                bruteSeenTasks[fullKey] = 1;
                if (autoSource) {
                    bruteAutoCompleted[fullKey] = autoSource;
                }
                if (dangerX) {
                    bruteDangerTasks[fullKey] = true;
                }
                if (partyDone) {
                    brutePartyTriggered[fullKey] = true;
                }
            }
        }

        return { bruteTasks, bruteSeenTasks, bruteAutoCompleted, bruteDangerTasks, brutePartyTriggered };
    }

    function splitIntoChunks(str) {
        if (!str) return [];
        const chunks = [];
        for (let i = 0; i < str.length; i += MAX_CHUNK_CHARS) {
            chunks.push(str.slice(i, i + MAX_CHUNK_CHARS));
        }
        return chunks;
    }

    function sanitizePlagiat(plagiat) {
        if (!plagiat || typeof plagiat !== 'object') return null;
        return {
            hasIncident: Boolean(plagiat.hasIncident),
            title: String(plagiat.title || '').slice(0, 200),
            details: String(plagiat.details || '').slice(0, 500),
            courseUrl: String(plagiat.courseUrl || '').slice(0, 200),
            pageTitle: String(plagiat.pageTitle || '').slice(0, 120),
            lastDetectedAt: String(plagiat.lastDetectedAt || '').slice(0, 40),
            historyCount: Number(plagiat.historyCount) || 0
        };
    }

    // Decode full logical state from raw sync storage items
    function decodeSyncItems(syncItems) {
        const raw = (syncItems && typeof syncItems === 'object') ? syncItems : {};
        const meta = (raw[META_KEY] && typeof raw[META_KEY] === 'object') ? raw[META_KEY] : null;

        let combinedChunkStr = '';
        if (meta && typeof meta.n === 'number' && meta.n > 0) {
            for (let i = 0; i < meta.n; i++) {
                const part = raw[`${CHUNK_PREFIX}${i}`];
                if (typeof part === 'string') {
                    combinedChunkStr += part;
                }
            }
        }

        const {
            bruteTasks,
            bruteSeenTasks,
            bruteAutoCompleted,
            bruteDangerTasks,
            brutePartyTriggered
        } = deserializeTaskMaps(combinedChunkStr);

        const settings = (meta && meta.s && typeof meta.s === 'object') ? meta.s : {};

        return {
            bruteTasks,
            bruteSeenTasks,
            bruteAutoCompleted,
            bruteDangerTasks,
            brutePartyTriggered,
            plagiatIncident: (meta && meta.p) ? meta.p : null,
            classicUiStyle: typeof settings.classicUiStyle === 'boolean' ? settings.classicUiStyle : SETTING_DEFAULTS.classicUiStyle,
            courseSummaryToBottom: typeof settings.courseSummaryToBottom === 'boolean' ? settings.courseSummaryToBottom : SETTING_DEFAULTS.courseSummaryToBottom,
            autoDetectCompletion: typeof settings.autoDetectCompletion === 'boolean' ? settings.autoDetectCompletion : SETTING_DEFAULTS.autoDetectCompletion,
            autoCompleteRemovedX: typeof settings.autoCompleteRemovedX === 'boolean' ? settings.autoCompleteRemovedX : SETTING_DEFAULTS.autoCompleteRemovedX,
            showCompletionToast: typeof settings.showCompletionToast === 'boolean' ? settings.showCompletionToast : SETTING_DEFAULTS.showCompletionToast,
            showGreenCheckmarks: typeof settings.showGreenCheckmarks === 'boolean' ? settings.showGreenCheckmarks : SETTING_DEFAULTS.showGreenCheckmarks,
            hideNewTaskBadge: typeof settings.hideNewTaskBadge === 'boolean' ? settings.hideNewTaskBadge : SETTING_DEFAULTS.hideNewTaskBadge,
            hidePlagiatBanner: typeof settings.hidePlagiatBanner === 'boolean' ? settings.hidePlagiatBanner : SETTING_DEFAULTS.hidePlagiatBanner,
            enablePartyMode: typeof settings.enablePartyMode === 'boolean' ? settings.enablePartyMode : SETTING_DEFAULTS.enablePartyMode,
            partyModeOnMinScore: typeof settings.partyModeOnMinScore === 'boolean' ? settings.partyModeOnMinScore : SETTING_DEFAULTS.partyModeOnMinScore
        };
    }

    // Write full logical state into storage.sync using b_meta + b_c_0..N and remove excess chunks
    function persistFullStateToSync(fullState, previousChunkCount) {
        const serializedTasks = serializeTaskMaps(
            fullState.bruteTasks,
            fullState.bruteSeenTasks,
            fullState.bruteAutoCompleted,
            fullState.bruteDangerTasks,
            fullState.brutePartyTriggered
        );
        const chunks = splitIntoChunks(serializedTasks);

        const meta = {
            v: SCHEMA_VERSION,
            n: chunks.length,
            s: {
                classicUiStyle: Boolean(fullState.classicUiStyle),
                courseSummaryToBottom: Boolean(fullState.courseSummaryToBottom),
                autoDetectCompletion: fullState.autoDetectCompletion !== false,
                autoCompleteRemovedX: fullState.autoCompleteRemovedX !== false,
                showCompletionToast: fullState.showCompletionToast !== false,
                showGreenCheckmarks: fullState.showGreenCheckmarks !== false,
                hideNewTaskBadge: Boolean(fullState.hideNewTaskBadge),
                hidePlagiatBanner: fullState.hidePlagiatBanner !== false,
                enablePartyMode: fullState.enablePartyMode !== false,
                partyModeOnMinScore: Boolean(fullState.partyModeOnMinScore)
            },
            p: sanitizePlagiat(fullState.plagiatIncident)
        };

        const payload = { [META_KEY]: meta };
        chunks.forEach((chunkStr, idx) => {
            payload[`${CHUNK_PREFIX}${idx}`] = chunkStr;
        });

        const staleChunkKeys = [];
        const maxOld = (typeof previousChunkCount === 'number' && previousChunkCount > chunks.length)
            ? previousChunkCount
            : 0;
        for (let i = chunks.length; i < maxOld; i++) {
            staleChunkKeys.push(`${CHUNK_PREFIX}${i}`);
        }

        return rawSet(syncArea, payload).then(() => {
            if (staleChunkKeys.length > 0) {
                return rawRemove(syncArea, staleChunkKeys);
            }
        });
    }

    function readLegacyLocalStorageSeen() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return null;
            const raw = window.localStorage.getItem('brute_seen_tasks_v1');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function purgeLegacyLocalStorage() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            LEGACY_LS_KEYS.forEach(k => window.localStorage.removeItem(k));
        } catch (e) {}
    }

    function hasAnyLegacyKeys(obj) {
        if (!obj || typeof obj !== 'object') return false;
        return LEGACY_KEYS.some(k => Object.prototype.hasOwnProperty.call(obj, k));
    }

    let cachedLogicalState = null;
    let migrationDone = false;
    let opQueue = Promise.resolve();

    function enqueueOp(fn) {
        opQueue = opQueue.then(fn, fn);
        return opQueue;
    }

    // Perform one-time backwards-compatible migration & purge if any legacy keys exist
    function ensureMigratedAndLoadRaw() {
        return Promise.all([
            rawGet(syncArea, null),
            localArea && localArea !== syncArea ? rawGet(localArea, null) : Promise.resolve({})
        ]).then(([syncRaw, localRaw]) => {
            const legacySeenFromLS = readLegacyLocalStorageSeen();
            const hasSyncLegacy = hasAnyLegacyKeys(syncRaw);
            const hasLocalData = Boolean(localRaw && Object.keys(localRaw).length > 0);
            const hasLSData = Boolean(legacySeenFromLS && Object.keys(legacySeenFromLS).length > 0);

            const baseState = decodeSyncItems(syncRaw);

            if (!migrationDone && (hasSyncLegacy || hasLocalData || hasLSData)) {
                migrationDone = true;

                // Merge legacy sources (sync legacy -> local legacy -> localStorage -> existing v2 sync)
                const mergedTasks = {
                    ...(syncRaw.bruteTasks || {}),
                    ...(localRaw.bruteTasks || {}),
                    ...baseState.bruteTasks
                };
                const mergedSeen = {
                    ...(syncRaw.bruteSeenTasks || {}),
                    ...(localRaw.bruteSeenTasks || {}),
                    ...(legacySeenFromLS || {}),
                    ...baseState.bruteSeenTasks
                };
                // Any task in legacy bruteTasks was already seen
                for (const k of Object.keys(mergedTasks)) {
                    mergedSeen[k] = 1;
                }

                const mergedAuto = {
                    ...(syncRaw.bruteAutoCompleted || {}),
                    ...(localRaw.bruteAutoCompleted || {}),
                    ...baseState.bruteAutoCompleted
                };
                const mergedDanger = {
                    ...(syncRaw.bruteDangerTasks || {}),
                    ...(localRaw.bruteDangerTasks || {}),
                    ...baseState.bruteDangerTasks
                };
                const mergedParty = {
                    ...(syncRaw.brutePartyTriggered || {}),
                    ...(localRaw.brutePartyTriggered || {}),
                    ...baseState.brutePartyTriggered
                };

                const pickSetting = (key) => {
                    if (syncRaw[META_KEY] && syncRaw[META_KEY].s && typeof syncRaw[META_KEY].s[key] === 'boolean') {
                        return syncRaw[META_KEY].s[key];
                    }
                    if (typeof localRaw[key] === 'boolean') return localRaw[key];
                    if (typeof syncRaw[key] === 'boolean') return syncRaw[key];
                    return SETTING_DEFAULTS[key];
                };

                const migratedState = {
                    bruteTasks: mergedTasks,
                    bruteSeenTasks: mergedSeen,
                    bruteAutoCompleted: mergedAuto,
                    bruteDangerTasks: mergedDanger,
                    brutePartyTriggered: mergedParty,
                    plagiatIncident: baseState.plagiatIncident || localRaw.plagiatIncident || syncRaw.plagiatIncident || null,
                    classicUiStyle: pickSetting('classicUiStyle'),
                    courseSummaryToBottom: pickSetting('courseSummaryToBottom'),
                    autoDetectCompletion: pickSetting('autoDetectCompletion'),
                    autoCompleteRemovedX: pickSetting('autoCompleteRemovedX'),
                    showCompletionToast: pickSetting('showCompletionToast'),
                    showGreenCheckmarks: pickSetting('showGreenCheckmarks'),
                    hideNewTaskBadge: pickSetting('hideNewTaskBadge'),
                    hidePlagiatBanner: pickSetting('hidePlagiatBanner'),
                    enablePartyMode: pickSetting('enablePartyMode'),
                    partyModeOnMinScore: pickSetting('partyModeOnMinScore')
                };

                const prevChunks = (syncRaw[META_KEY] && typeof syncRaw[META_KEY].n === 'number') ? syncRaw[META_KEY].n : 0;

                return persistFullStateToSync(migratedState, prevChunks)
                    .then(() => {
                        const cleanupPromises = [];
                        if (hasSyncLegacy) {
                            cleanupPromises.push(rawRemove(syncArea, LEGACY_KEYS));
                        }
                        if (hasLocalData && localArea && localArea !== syncArea) {
                            cleanupPromises.push(rawClear(localArea));
                        }
                        purgeLegacyLocalStorage();
                        return Promise.all(cleanupPromises);
                    })
                    .then(() => rawGet(syncArea, null))
                    .then((freshSyncRaw) => {
                        const decoded = decodeSyncItems(freshSyncRaw);
                        cachedLogicalState = cloneState(decoded);
                        return decoded;
                    });
            }

            migrationDone = true;
            purgeLegacyLocalStorage();
            cachedLogicalState = cloneState(baseState);
            return baseState;
        });
    }

    function cloneState(state) {
        if (!state) return null;
        return JSON.parse(JSON.stringify(state));
    }

    // Public API: Read logical keys from synced storage
    function readStorage(keys) {
        return enqueueOp(() => {
            return ensureMigratedAndLoadRaw().then((fullState) => {
                if (!keys) return cloneState(fullState);
                const keyList = Array.isArray(keys) ? keys : [keys];
                const result = {};
                for (const k of keyList) {
                    if (Object.prototype.hasOwnProperty.call(fullState, k)) {
                        result[k] = fullState[k];
                    }
                }
                return cloneState(result);
            });
        });
    }

    // Public API: Write partial or full logical keys into chunked storage.sync
    function writeStorage(partialData) {
        if (!partialData || typeof partialData !== 'object') return Promise.resolve();
        return enqueueOp(() => {
            return rawGet(syncArea, null).then((syncRaw) => {
                const currentState = decodeSyncItems(syncRaw);
                const prevChunks = (syncRaw[META_KEY] && typeof syncRaw[META_KEY].n === 'number') ? syncRaw[META_KEY].n : 0;

                const nextState = {
                    ...currentState,
                    ...partialData
                };

                // Ensure any task present in bruteTasks is also marked seen in bruteSeenTasks
                if (partialData.bruteTasks && !partialData.bruteSeenTasks) {
                    const nextSeen = { ...(currentState.bruteSeenTasks || {}) };
                    for (const k of Object.keys(partialData.bruteTasks)) {
                        const norm = normalizeTaskKey(k);
                        if (norm) nextSeen[norm] = 1;
                    }
                    nextState.bruteSeenTasks = nextSeen;
                }

                return persistFullStateToSync(nextState, prevChunks).then(() => {
                    cachedLogicalState = cloneState(decodeSyncItemsForCache(nextState));
                });
            });
        });
    }

    function decodeSyncItemsForCache(state) {
        const serialized = serializeTaskMaps(
            state.bruteTasks,
            state.bruteSeenTasks,
            state.bruteAutoCompleted,
            state.bruteDangerTasks,
            state.brutePartyTriggered
        );
        const maps = deserializeTaskMaps(serialized);
        return {
            ...state,
            ...maps,
            plagiatIncident: sanitizePlagiat(state.plagiatIncident)
        };
    }

    // Public API: Reset / Delete all extension data from storage.sync (and any residual local storage)
    function clearAllStorage() {
        return enqueueOp(() => {
            return rawGet(syncArea, null).then((syncRaw) => {
                const allSyncKeys = Object.keys(syncRaw || {});
                const emptyState = {
                    bruteTasks: {},
                    bruteSeenTasks: {},
                    bruteAutoCompleted: {},
                    bruteDangerTasks: {},
                    brutePartyTriggered: {},
                    plagiatIncident: null,
                    ...SETTING_DEFAULTS
                };
                purgeLegacyLocalStorage();
                return Promise.all([
                    allSyncKeys.length > 0 ? rawRemove(syncArea, allSyncKeys) : Promise.resolve(),
                    localArea && localArea !== syncArea ? rawClear(localArea) : Promise.resolve()
                ]).then(() => {
                    return persistFullStateToSync(emptyState, 0);
                }).then(() => {
                    cachedLogicalState = cloneState(emptyState);
                });
            });
        });
    }

    // Public API: Subscribe to decoded logical changes when storage.sync updates
    const changeListeners = [];

    function diffStates(prevState, nextState) {
        const prev = prevState || {};
        const next = nextState || {};
        const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        const changes = {};

        for (const key of allKeys) {
            const oldVal = prev[key];
            const newVal = next[key];
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                changes[key] = {
                    oldValue: oldVal,
                    newValue: newVal
                };
            }
        }
        return changes;
    }

    if (storageNamespace && storageNamespace.onChanged) {
        storageNamespace.onChanged.addListener((rawChanges, area) => {
            if (area !== 'sync' && area !== 'local') return;
            const relevant = Object.keys(rawChanges || {}).some(
                k => k === META_KEY || k.startsWith(CHUNK_PREFIX)
            );
            if (!relevant) return;

            const prevSnapshot = cloneState(cachedLogicalState);
            rawGet(syncArea, null).then((syncRaw) => {
                const nextSnapshot = decodeSyncItems(syncRaw);
                cachedLogicalState = cloneState(nextSnapshot);
                const logicalChanges = diffStates(prevSnapshot, nextSnapshot);
                if (Object.keys(logicalChanges).length > 0) {
                    changeListeners.forEach((listener) => {
                        try {
                            listener(logicalChanges, 'sync');
                        } catch (e) {
                            console.error('[BRUTE Ext] Error in storage change listener:', e);
                        }
                    });
                }
            });
        });
    }

    function subscribeStorageChanges(listener) {
        if (typeof listener === 'function') {
            changeListeners.push(listener);
        }
    }

    globalScope.BruteSyncStorage = {
        readStorage,
        writeStorage,
        clearAllStorage,
        subscribeStorageChanges,
        normalizeTaskKey,
        // Exposed for automated quota & round-trip verification tests
        _internal: {
            serializeTaskMaps,
            deserializeTaskMaps,
            splitIntoChunks,
            packTaskCode,
            unpackTaskCode,
            decodeSyncItems,
            META_KEY,
            CHUNK_PREFIX,
            MAX_CHUNK_CHARS
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
