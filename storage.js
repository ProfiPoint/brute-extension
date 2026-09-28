// ============================================================================
// FEL CTU BRUTE Deadline Manager - Synced Multi-Key Storage Engine (v1.29)
// ============================================================================
// Architecture designed for reliable native Chrome Sync & Firefox Sync,
// including staggered multi-device updates and pre-sync offline edits:
// 1. Clean-slate v1.28+ namespace (b128_*): removes obsolete pre-1.28 keys
//    without writing blank state to storage.sync on install/update.
// 2. Per-Course Sync Keys (b128_c_<COURSE>): each course's tasks are isolated
//    in their own storage.sync key so editing Course A on an un-synced device
//    never touches Course B, C, or D in the cloud.
// 3. Local Shadow Backup Auto-Heal (b128_local_shadow in storage.local):
//    every device keeps a local per-task timestamp journal in storage.local.
//    If a freshly installed Firefox device overwrites a sync key before
//    Firefox Sync finishes its initial pull, the other device automatically
//    merges its local shadow backup with the cloud tasks by timestamp.
// 4. Tombstones (0~<ts>) & Global Reset Timestamp (b128_meta.r):
//    distinguishes intentional task resets / "Delete All Data" from pre-sync
//    overwrites so deleted tasks are never accidentally resurrected.
// ============================================================================

(function (globalScope) {
    'use strict';

    const isFirefox = (typeof browser !== 'undefined' && Boolean(browser.storage));
    const storageNamespace = isFirefox
        ? browser.storage
        : (typeof chrome !== 'undefined' && chrome.storage ? chrome.storage : null);

    const syncArea = storageNamespace ? (storageNamespace.sync || storageNamespace.local) : null;
    const localArea = storageNamespace ? storageNamespace.local : null;

    const DB_VERSION = '1.29';
    const KEY_PREFIX = 'b128_';
    const META_KEY = 'b128_meta';
    const SETTINGS_KEY = 'b128_settings';
    const PLAGIAT_KEY = 'b128_plagiat';
    const COURSE_KEY_PREFIX = 'b128_c_';
    const TASK_CHUNK_PREFIX = 'b128_t_';
    const SEEN_CHUNK_PREFIX = 'b128_s_';
    const ONBOARDING_LOCAL_KEY = 'b128_onboarding_shown_v1';
    const LOCAL_SHADOW_KEY = 'b128_local_shadow';

    const MAX_CHUNK_CHARS = 6500;

    const LEGACY_LS_KEYS = [
        'brute_seen_tasks_v1',
        'brute_last_reset_id_v1'
    ];

    const SETTING_KEYS = [
        'classicUiStyle',
        'courseSummaryToBottom',
        'autoDetectCompletion',
        'autoCompleteRemovedX',
        'showCompletionToast',
        'showGreenCheckmarks',
        'hideNewTaskBadge',
        'hidePlagiatBanner',
        'enablePartyMode',
        'partyModeOnMinScore'
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

    function purgeLegacyLocalStorage() {
        try {
            if (typeof window === 'undefined' || !window.localStorage) return;
            LEGACY_LS_KEYS.forEach(k => window.localStorage.removeItem(k));
        } catch (e) {}
    }

    purgeLegacyLocalStorage();

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

    function getCourseGroupKey(normKey) {
        const m = String(normKey || '').match(COURSE_PATH_REGEX);
        if (m && m[1] && m[2] && m[1] !== '_') {
            return encodeToken(m[1]);
        }
        return '_';
    }

    function packTaskCode(state, autoSource, dangerX, partyDone) {
        const sIdx = Object.prototype.hasOwnProperty.call(STATE_TO_IDX, state) ? STATE_TO_IDX[state] : 0;
        const normalizedAuto = (autoSource === true) ? 'summary' : (autoSource || '');
        const aIdx = Object.prototype.hasOwnProperty.call(AUTO_TO_IDX, normalizedAuto) ? AUTO_TO_IDX[normalizedAuto] : 0;
        const dBit = dangerX ? 1 : 0;
        const pBit = partyDone ? 1 : 0;
        return sIdx + (5 * aIdx) + (15 * dBit) + (30 * pBit);
    }

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

    function nowEpochSec() {
        return Math.floor(Date.now() / 1000);
    }

    const taskTimestamps = new Map();

    // Returns a Map<groupKey, serializedGroupString> where each value is "<groupKey>=<slug>:<code36>~<ts36>,..."
    function serializeActiveTasksByCourse(tasksMap, autoMap, partyMap, timestampsMap) {
        const tasks = (tasksMap && typeof tasksMap === 'object') ? tasksMap : {};
        const auto = (autoMap && typeof autoMap === 'object') ? autoMap : {};
        const party = (partyMap && typeof partyMap === 'object') ? partyMap : {};
        const tsLookup = timestampsMap instanceof Map ? timestampsMap : taskTimestamps;

        const unified = new Map();
        const ensureEntry = (rawKey) => {
            const norm = normalizeTaskKey(rawKey);
            if (!norm) return null;
            let entry = unified.get(norm);
            if (!entry) {
                entry = {
                    state: 'default',
                    autoSource: '',
                    partyDone: false,
                    ts: tsLookup.get(norm) || 0
                };
                unified.set(norm, entry);
            }
            return entry;
        };

        for (const [k, v] of Object.entries(tasks)) {
            if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(STATE_TO_IDX, v)) continue;
            const norm = normalizeTaskKey(k);
            if (!norm) continue;
            const hasTs = (tsLookup.get(norm) || 0) > 0;
            if (v === 'default' && !hasTs && !auto[k] && !auto[norm] && !party[k] && !party[norm]) {
                continue;
            }
            const entry = ensureEntry(norm);
            if (entry) {
                entry.state = v;
            }
        }

        for (const [k, v] of Object.entries(auto)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) {
                entry.autoSource = (v === true) ? 'summary' : String(v);
            }
        }

        for (const [k, v] of Object.entries(party)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) {
                entry.partyDone = true;
            }
        }

        // Also include tombstones (state === 'default' with ts > 0) from tsLookup
        if (tsLookup instanceof Map) {
            for (const [rawKey, tsVal] of tsLookup.entries()) {
                if (tsVal > 0) {
                    ensureEntry(rawKey);
                }
            }
        }

        const groups = new Map();
        const sortedKeys = Array.from(unified.keys()).sort();

        for (const normKey of sortedKeys) {
            const info = unified.get(normKey);
            const code = packTaskCode(info.state, info.autoSource, false, info.partyDone);
            if (code === 0 && !info.ts) continue;

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

            const tsPart = info.ts > 0 ? `~${info.ts.toString(36)}` : '';
            const itemToken = `${slug}:${encodeBase62(code)}${tsPart}`;

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(itemToken);
        }

        const courseMap = new Map();
        for (const [groupKey, itemTokens] of groups.entries()) {
            courseMap.set(groupKey, `${groupKey}=${itemTokens.join(',')}`);
        }
        return courseMap;
    }

    function serializeActiveTasks(tasksMap, autoMap, partyMap, timestampsMap) {
        const courseMap = serializeActiveTasksByCourse(tasksMap, autoMap, partyMap, timestampsMap);
        return Array.from(courseMap.values()).join('|');
    }

    function deserializeActiveTasks(serialized) {
        const bruteTasks = {};
        const bruteAutoCompleted = {};
        const brutePartyTriggered = {};
        const timestamps = new Map();

        if (!serialized || typeof serialized !== 'string') {
            return { bruteTasks, bruteAutoCompleted, brutePartyTriggered, timestamps };
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

                let tokenBody = itemToken;
                let ts = 0;
                const tildeIdx = itemToken.lastIndexOf('~');
                if (tildeIdx > 0) {
                    tokenBody = itemToken.slice(0, tildeIdx);
                    const parsedTs = parseInt(itemToken.slice(tildeIdx + 1), 36);
                    if (!Number.isNaN(parsedTs) && parsedTs > 0) {
                        ts = parsedTs;
                    }
                }

                const colonIdx = tokenBody.lastIndexOf(':');
                let rawSlug = tokenBody;
                let code = 0;
                if (colonIdx > 0) {
                    rawSlug = tokenBody.slice(0, colonIdx);
                    code = decodeBase62(tokenBody.slice(colonIdx + 1));
                }

                const slug = decodeToken(rawSlug);
                if (!slug) continue;

                const fullKey = isFallbackGroup ? slug : `/brute/student/course/${courseId}/${slug}`;
                const { state, autoSource, partyDone } = unpackTaskCode(code);

                const existingTs = timestamps.get(fullKey) || 0;
                if (existingTs > 0 && ts > 0 && ts < existingTs) {
                    continue;
                }

                bruteTasks[fullKey] = state;
                if (autoSource) {
                    bruteAutoCompleted[fullKey] = autoSource;
                } else {
                    delete bruteAutoCompleted[fullKey];
                }
                if (partyDone) {
                    brutePartyTriggered[fullKey] = true;
                } else {
                    delete brutePartyTriggered[fullKey];
                }
                if (ts > 0) {
                    timestamps.set(fullKey, ts);
                }
            }
        }

        return { bruteTasks, bruteAutoCompleted, brutePartyTriggered, timestamps };
    }

    function serializeSeenAndDanger(seenMap, dangerMap, activeTasksMap) {
        const seen = (seenMap && typeof seenMap === 'object') ? seenMap : {};
        const danger = (dangerMap && typeof dangerMap === 'object') ? dangerMap : {};
        const active = (activeTasksMap && typeof activeTasksMap === 'object') ? activeTasksMap : {};

        const allSeen = new Map();
        const addSeen = (rawKey, isDanger) => {
            const norm = normalizeTaskKey(rawKey);
            if (!norm) return;
            const prev = allSeen.get(norm) || false;
            allSeen.set(norm, Boolean(prev || isDanger));
        };

        for (const [k, v] of Object.entries(seen)) {
            if (v) addSeen(k, false);
        }
        for (const [k, v] of Object.entries(active)) {
            if (v) addSeen(k, false);
        }
        for (const [k, v] of Object.entries(danger)) {
            if (v) addSeen(k, true);
        }

        const groups = new Map();
        const sortedKeys = Array.from(allSeen.keys()).sort();

        for (const normKey of sortedKeys) {
            const isDanger = allSeen.get(normKey);
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

            const token = isDanger ? `${slug}!` : slug;
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(token);
        }

        const groupStrings = [];
        for (const [groupKey, tokens] of groups.entries()) {
            groupStrings.push(`${groupKey}=${tokens.join(',')}`);
        }
        return groupStrings.join('|');
    }

    function deserializeSeenAndDanger(serialized) {
        const bruteSeenTasks = {};
        const bruteDangerTasks = {};

        if (!serialized || typeof serialized !== 'string') {
            return { bruteSeenTasks, bruteDangerTasks };
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
                const isDanger = itemToken.endsWith('!');
                const rawSlug = isDanger ? itemToken.slice(0, -1) : itemToken;
                const slug = decodeToken(rawSlug);
                if (!slug) continue;

                const fullKey = isFallbackGroup ? slug : `/brute/student/course/${courseId}/${slug}`;
                bruteSeenTasks[fullKey] = 1;
                if (isDanger) {
                    bruteDangerTasks[fullKey] = true;
                }
            }
        }

        return { bruteSeenTasks, bruteDangerTasks };
    }

    function serializeTaskMaps(tasksMap, seenMap, autoMap, dangerMap, partyMap) {
        const tasks = (tasksMap && typeof tasksMap === 'object') ? tasksMap : {};
        const seen = (seenMap && typeof seenMap === 'object') ? seenMap : {};
        const auto = (autoMap && typeof autoMap === 'object') ? autoMap : {};
        const danger = (dangerMap && typeof dangerMap === 'object') ? dangerMap : {};
        const party = (partyMap && typeof partyMap === 'object') ? partyMap : {};

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
            if (entry) entry.autoSource = (v === true) ? 'summary' : String(v);
        }
        for (const [k, v] of Object.entries(danger)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) entry.dangerX = true;
        }
        for (const [k, v] of Object.entries(party)) {
            if (!v) continue;
            const entry = ensureEntry(k);
            if (entry) entry.partyDone = true;
        }

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
                    const possibleCode = itemToken.slice(colonIdx + 1);
                    if (possibleCode.length === 1 && BASE62_CHARS.indexOf(possibleCode) >= 0) {
                        rawSlug = itemToken.slice(0, colonIdx);
                        code = decodeBase62(possibleCode);
                    }
                }

                const slug = decodeToken(rawSlug);
                if (!slug) continue;

                const fullKey = isFallbackGroup ? slug : `/brute/student/course/${courseId}/${slug}`;
                const { state, autoSource, dangerX, partyDone } = unpackTaskCode(code);

                bruteSeenTasks[fullKey] = 1;
                bruteTasks[fullKey] = state;
                if (autoSource) bruteAutoCompleted[fullKey] = autoSource;
                if (dangerX) bruteDangerTasks[fullKey] = true;
                if (partyDone) brutePartyTriggered[fullKey] = true;
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
        if (!plagiat || typeof plagiat !== 'object' || !plagiat.hasIncident) {
            return null;
        }
        return {
            hasIncident: true,
            title: String(plagiat.title || 'Plagiat incident detected').slice(0, 120),
            text: String(plagiat.text || '').slice(0, 200),
            url: String(plagiat.url || '').slice(0, 200),
            lastDetectedAt: String(plagiat.lastDetectedAt || '').slice(0, 40),
            historyCount: Number(plagiat.historyCount) || 0
        };
    }

    function getSortedChunkString(raw, prefix) {
        const matching = [];
        for (const k of Object.keys(raw)) {
            if (k.startsWith(prefix)) {
                const idx = parseInt(k.slice(prefix.length), 10);
                if (!Number.isNaN(idx) && idx >= 0 && typeof raw[k] === 'string') {
                    matching.push({ idx, val: raw[k] });
                }
            }
        }
        matching.sort((a, b) => a.idx - b.idx);
        return matching.map(m => m.val).join('');
    }

    function getCombinedActiveTaskString(raw) {
        const parts = [];
        const legacyChunkStr = getSortedChunkString(raw, TASK_CHUNK_PREFIX);
        if (legacyChunkStr) {
            parts.push(legacyChunkStr);
        }
        const courseKeys = Object.keys(raw).filter(k => k.startsWith(COURSE_KEY_PREFIX)).sort();
        for (const k of courseKeys) {
            const val = raw[k];
            if (typeof val === 'string' && val.trim()) {
                const groupKey = k.slice(COURSE_KEY_PREFIX.length);
                parts.push(val.includes('=') ? val : `${groupKey}=${val}`);
            }
        }
        return parts.join('|');
    }

    function decodeSyncItems(syncItems) {
        const raw = (syncItems && typeof syncItems === 'object') ? syncItems : {};
        const metaResetAt = (raw[META_KEY] && Number(raw[META_KEY].r)) || 0;

        const combinedTaskStr = getCombinedActiveTaskString(raw);
        const combinedSeenStr = getSortedChunkString(raw, SEEN_CHUNK_PREFIX);

        const {
            bruteTasks: activeTasks,
            bruteAutoCompleted,
            brutePartyTriggered,
            timestamps
        } = deserializeActiveTasks(combinedTaskStr);

        const {
            bruteSeenTasks,
            bruteDangerTasks
        } = deserializeSeenAndDanger(combinedSeenStr);

        // Enforce global reset timestamp (b128_meta.r) if present
        if (metaResetAt > 0) {
            for (const [k, ts] of Array.from(timestamps.entries())) {
                if (ts <= metaResetAt) {
                    delete activeTasks[k];
                    delete bruteAutoCompleted[k];
                    delete brutePartyTriggered[k];
                    timestamps.delete(k);
                }
            }
        }

        for (const [k, ts] of timestamps.entries()) {
            const cur = taskTimestamps.get(k) || 0;
            if (ts > cur) taskTimestamps.set(k, ts);
        }

        for (const k of Object.keys(activeTasks)) {
            bruteSeenTasks[k] = 1;
        }

        const bruteTasks = { ...activeTasks };
        for (const k of Object.keys(bruteSeenTasks)) {
            if (!Object.prototype.hasOwnProperty.call(bruteTasks, k)) {
                bruteTasks[k] = 'default';
            }
        }

        const settings = (raw[SETTINGS_KEY] && typeof raw[SETTINGS_KEY] === 'object') ? raw[SETTINGS_KEY] : {};
        const plagiat = (raw[PLAGIAT_KEY] && typeof raw[PLAGIAT_KEY] === 'object') ? raw[PLAGIAT_KEY] : null;

        return {
            bruteTasks,
            bruteSeenTasks,
            bruteAutoCompleted,
            bruteDangerTasks,
            brutePartyTriggered,
            plagiatIncident: plagiat,
            classicUiStyle: typeof settings.classicUiStyle === 'boolean' ? settings.classicUiStyle : SETTING_DEFAULTS.classicUiStyle,
            courseSummaryToBottom: typeof settings.courseSummaryToBottom === 'boolean' ? settings.courseSummaryToBottom : SETTING_DEFAULTS.courseSummaryToBottom,
            autoDetectCompletion: typeof settings.autoDetectCompletion === 'boolean' ? settings.autoDetectCompletion : SETTING_DEFAULTS.autoDetectCompletion,
            autoCompleteRemovedX: typeof settings.autoCompleteRemovedX === 'boolean' ? settings.autoCompleteRemovedX : SETTING_DEFAULTS.autoCompleteRemovedX,
            showCompletionToast: typeof settings.showCompletionToast === 'boolean' ? settings.showCompletionToast : SETTING_DEFAULTS.showCompletionToast,
            showGreenCheckmarks: typeof settings.showGreenCheckmarks === 'boolean' ? settings.showGreenCheckmarks : SETTING_DEFAULTS.showGreenCheckmarks,
            hideNewTaskBadge: typeof settings.hideNewTaskBadge === 'boolean' ? settings.hideNewTaskBadge : SETTING_DEFAULTS.hideNewTaskBadge,
            hidePlagiatBanner: typeof settings.hidePlagiatBanner === 'boolean' ? settings.hidePlagiatBanner : SETTING_DEFAULTS.hidePlagiatBanner,
            enablePartyMode: typeof settings.enablePartyMode === 'boolean' ? settings.enablePartyMode : SETTING_DEFAULTS.enablePartyMode,
            partyModeOnMinScore: typeof settings.partyModeOnMinScore === 'boolean' ? settings.partyModeOnMinScore : SETTING_DEFAULTS.partyModeOnMinScore,
            _timestamps: timestamps,
            _resetAt: metaResetAt
        };
    }

    function stripInternalFields(state) {
        if (!state || typeof state !== 'object') return state;
        const copy = { ...state };
        delete copy._timestamps;
        delete copy._resetAt;
        return copy;
    }

    function cloneState(state) {
        if (!state) return null;
        return JSON.parse(JSON.stringify(stripInternalFields(state)));
    }

    // Removes ONLY pre-1.28 keys (never writes to storage.sync during purge)
    function purgePre128Storage() {
        purgeLegacyLocalStorage();

        return Promise.all([
            rawGet(syncArea, null),
            localArea && localArea !== syncArea ? rawGet(localArea, null) : Promise.resolve({})
        ]).then(([syncRaw, localRaw]) => {
            const obsoleteSyncKeys = Object.keys(syncRaw || {}).filter(k => !k.startsWith(KEY_PREFIX));
            const obsoleteLocalKeys = Object.keys(localRaw || {}).filter(k => !k.startsWith(KEY_PREFIX));

            const ops = [];
            if (obsoleteSyncKeys.length > 0) {
                ops.push(rawRemove(syncArea, obsoleteSyncKeys));
            }
            if (obsoleteLocalKeys.length > 0 && localArea && localArea !== syncArea) {
                ops.push(rawRemove(localArea, obsoleteLocalKeys));
            }
            return Promise.all(ops).then(() => rawGet(syncArea, null));
        });
    }

    let cachedLogicalState = null;
    let purgeChecked = false;
    let opQueue = Promise.resolve();

    function enqueueOp(fn) {
        opQueue = opQueue.then(fn, fn);
        return opQueue;
    }

    function ensureCleanV128AndLoadRaw() {
        return rawGet(syncArea, null).then((syncRaw) => {
            const hasObsoleteSync = Object.keys(syncRaw || {}).some(k => !k.startsWith(KEY_PREFIX));
            if (!purgeChecked || hasObsoleteSync) {
                purgeChecked = true;
                return purgePre128Storage();
            }
            return syncRaw;
        });
    }

    // Persists modified domains to storage.sync AND updates b128_local_shadow in storage.local
    function persistDomainsToSync(syncRaw, nextState, mergedTimestamps, dirtyDomains) {
        const raw = syncRaw || {};
        const candidatePayload = {};
        const keysToRemove = [];

        const currentMeta = (raw[META_KEY] && typeof raw[META_KEY] === 'object') ? raw[META_KEY] : null;
        const desiredResetAt = Number(nextState._resetAt || (currentMeta && currentMeta.r) || 0);
        const desiredMeta = desiredResetAt > 0
            ? { v: DB_VERSION, r: desiredResetAt }
            : { v: DB_VERSION };

        if (!currentMeta || currentMeta.v !== desiredMeta.v || (currentMeta.r || 0) !== (desiredMeta.r || 0)) {
            candidatePayload[META_KEY] = desiredMeta;
        }

        // Domain 1: Active Tasks — stored per course (b128_c_<COURSE>) + clean up legacy b128_t_0
        if (dirtyDomains.tasks) {
            const courseMap = serializeActiveTasksByCourse(
                nextState.bruteTasks,
                nextState.bruteAutoCompleted,
                nextState.brutePartyTriggered,
                mergedTimestamps
            );
            const targetCourses = dirtyDomains.courses instanceof Set ? dirtyDomains.courses : null;

            for (const [groupKey, serializedCourse] of courseMap.entries()) {
                if (!targetCourses || targetCourses.has(groupKey)) {
                    candidatePayload[`${COURSE_KEY_PREFIX}${groupKey}`] = serializedCourse;
                }
            }

            // Remove empty course keys or legacy b128_t_* chunks
            for (const k of Object.keys(raw)) {
                if (k.startsWith(COURSE_KEY_PREFIX)) {
                    const groupKey = k.slice(COURSE_KEY_PREFIX.length);
                    if ((!targetCourses || targetCourses.has(groupKey)) && !courseMap.has(groupKey)) {
                        keysToRemove.push(k);
                    }
                } else if (k.startsWith(TASK_CHUNK_PREFIX) && !targetCourses) {
                    keysToRemove.push(k);
                }
            }

            // Also keep b128_t_0 updated when writing full task sets (or migrating from 1.28)
            const serializedAllTasks = Array.from(courseMap.values()).join('|');
            const taskChunks = splitIntoChunks(serializedAllTasks);
            taskChunks.forEach((chunk, idx) => {
                candidatePayload[`${TASK_CHUNK_PREFIX}${idx}`] = chunk;
            });
            for (const k of Object.keys(raw)) {
                if (k.startsWith(TASK_CHUNK_PREFIX)) {
                    const idx = parseInt(k.slice(TASK_CHUNK_PREFIX.length), 10);
                    if (!Number.isNaN(idx) && idx >= taskChunks.length) {
                        keysToRemove.push(k);
                    }
                }
            }
        }

        // Domain 2: Seen & Danger Badges (b128_s_0..N)
        if (dirtyDomains.seen) {
            const serializedSeen = serializeSeenAndDanger(
                nextState.bruteSeenTasks,
                nextState.bruteDangerTasks,
                nextState.bruteTasks
            );
            const seenChunks = splitIntoChunks(serializedSeen);
            seenChunks.forEach((chunk, idx) => {
                candidatePayload[`${SEEN_CHUNK_PREFIX}${idx}`] = chunk;
            });

            for (const k of Object.keys(raw)) {
                if (k.startsWith(SEEN_CHUNK_PREFIX)) {
                    const idx = parseInt(k.slice(SEEN_CHUNK_PREFIX.length), 10);
                    if (!Number.isNaN(idx) && idx >= seenChunks.length) {
                        keysToRemove.push(k);
                    }
                }
            }
        }

        // Domain 3: User Settings (b128_settings)
        if (dirtyDomains.settings) {
            candidatePayload[SETTINGS_KEY] = {
                classicUiStyle: Boolean(nextState.classicUiStyle),
                courseSummaryToBottom: Boolean(nextState.courseSummaryToBottom),
                autoDetectCompletion: nextState.autoDetectCompletion !== false,
                autoCompleteRemovedX: nextState.autoCompleteRemovedX !== false,
                showCompletionToast: nextState.showCompletionToast !== false,
                showGreenCheckmarks: nextState.showGreenCheckmarks !== false,
                hideNewTaskBadge: Boolean(nextState.hideNewTaskBadge),
                hidePlagiatBanner: nextState.hidePlagiatBanner !== false,
                enablePartyMode: nextState.enablePartyMode !== false,
                partyModeOnMinScore: Boolean(nextState.partyModeOnMinScore)
            };
        }

        // Domain 4: Plagiat Monitor (b128_plagiat)
        if (dirtyDomains.plagiat) {
            const desiredPlagiat = sanitizePlagiat(nextState.plagiatIncident);
            if (desiredPlagiat) {
                candidatePayload[PLAGIAT_KEY] = desiredPlagiat;
            } else if (Object.prototype.hasOwnProperty.call(raw, PLAGIAT_KEY)) {
                keysToRemove.push(PLAGIAT_KEY);
            }
        }

        // Compute exact byte-for-byte diff against syncRaw
        const keysToWrite = {};
        for (const [k, val] of Object.entries(candidatePayload)) {
            if (JSON.stringify(raw[k]) !== JSON.stringify(val)) {
                keysToWrite[k] = val;
            }
        }

        const uniqueKeysToRemove = Array.from(new Set(keysToRemove)).filter(
            k => !Object.prototype.hasOwnProperty.call(candidatePayload, k)
        );

        const writePromise = Object.keys(keysToWrite).length > 0
            ? rawSet(syncArea, keysToWrite)
            : Promise.resolve();

        return writePromise.then(() => {
            if (uniqueKeysToRemove.length > 0) {
                return rawRemove(syncArea, uniqueKeysToRemove);
            }
        }).then(() => {
            return saveLocalShadow(nextState, mergedTimestamps, desiredResetAt);
        });
    }

    function saveLocalShadow(state, timestampsMap, resetAtVal) {
        if (!localArea || localArea === syncArea) return Promise.resolve();
        const tsLookup = timestampsMap instanceof Map ? timestampsMap : taskTimestamps;
        const resetAt = Number(resetAtVal || state._resetAt || 0);

        return rawGet(localArea, [LOCAL_SHADOW_KEY]).then((localRaw) => {
            const existing = (localRaw && localRaw[LOCAL_SHADOW_KEY] && typeof localRaw[LOCAL_SHADOW_KEY] === 'object')
                ? localRaw[LOCAL_SHADOW_KEY]
                : { tasks: {}, seen: {}, resetAt: 0 };

            const nextShadowTasks = {};
            if (existing.tasks && typeof existing.tasks === 'object') {
                for (const [k, entry] of Object.entries(existing.tasks)) {
                    if (entry && (Number(entry.t) || 0) > resetAt) {
                        nextShadowTasks[k] = entry;
                    }
                }
            }

            const allTaskKeys = new Set([
                ...Object.keys(state.bruteTasks || {}),
                ...Array.from(tsLookup.keys())
            ]);

            for (const rawKey of allTaskKeys) {
                const norm = normalizeTaskKey(rawKey);
                if (!norm) continue;
                const ts = tsLookup.get(norm) || 0;
                const st = (state.bruteTasks && state.bruteTasks[norm]) || 'default';
                const au = (state.bruteAutoCompleted && state.bruteAutoCompleted[norm]) || '';
                const pa = Boolean(state.brutePartyTriggered && state.brutePartyTriggered[norm]);

                if (st === 'default' && !ts && !au && !pa) continue;
                const effectiveTs = ts > 0 ? ts : Math.max(resetAt + 1, 1);
                if (effectiveTs <= resetAt) continue;

                const prevEntry = nextShadowTasks[norm];
                if (!prevEntry || effectiveTs >= (Number(prevEntry.t) || 0)) {
                    nextShadowTasks[norm] = {
                        s: st,
                        a: au,
                        p: pa ? 1 : 0,
                        t: effectiveTs
                    };
                }
            }

            const nextShadowSeen = (resetAt > (Number(existing.resetAt) || 0))
                ? {}
                : { ...(existing.seen || {}) };
            for (const [k, v] of Object.entries(state.bruteSeenTasks || {})) {
                if (v) nextShadowSeen[normalizeTaskKey(k)] = 1;
            }

            const nextShadow = {
                tasks: nextShadowTasks,
                seen: nextShadowSeen,
                resetAt: Math.max(resetAt, Number(existing.resetAt) || 0)
            };

            if (JSON.stringify(existing) === JSON.stringify(nextShadow)) {
                return;
            }
            return rawSet(localArea, { [LOCAL_SHADOW_KEY]: nextShadow });
        });
    }

    // Reconciles storage.sync with storage.local shadow backup (Auto-Heal)
    function loadAndReconcileState() {
        return Promise.all([
            ensureCleanV128AndLoadRaw(),
            localArea && localArea !== syncArea ? rawGet(localArea, [LOCAL_SHADOW_KEY]) : Promise.resolve({})
        ]).then(([syncRaw, localRaw]) => {
            const decoded = decodeSyncItems(syncRaw);
            if (!localArea || localArea === syncArea) {
                return { syncRaw, fullState: decoded };
            }

            const shadow = (localRaw && localRaw[LOCAL_SHADOW_KEY] && typeof localRaw[LOCAL_SHADOW_KEY] === 'object')
                ? localRaw[LOCAL_SHADOW_KEY]
                : null;

            if (!shadow || (!shadow.tasks && !shadow.seen)) {
                // Seed initial local shadow from current sync state
                return saveLocalShadow(decoded, decoded._timestamps, decoded._resetAt).then(() => ({
                    syncRaw,
                    fullState: decoded
                }));
            }

            const syncResetAt = Number(decoded._resetAt || 0);
            const shadowResetAt = Number(shadow.resetAt || 0);
            const effectiveResetAt = Math.max(syncResetAt, shadowResetAt);
            decoded._resetAt = effectiveResetAt;

            if (effectiveResetAt > 0) {
                for (const [k, ts] of Array.from(taskTimestamps.entries())) {
                    if (ts <= effectiveResetAt) {
                        taskTimestamps.delete(k);
                    }
                }
            }

            const healedCourses = new Set();
            let healedAnyTask = false;

            const shadowTasks = (shadow.tasks && typeof shadow.tasks === 'object') ? shadow.tasks : {};
            for (const [rawKey, entry] of Object.entries(shadowTasks)) {
                const norm = normalizeTaskKey(rawKey);
                if (!norm || !entry || typeof entry !== 'object') continue;
                const shadowTs = Number(entry.t) || 0;
                if (shadowTs <= effectiveResetAt) continue;

                const syncTs = decoded._timestamps.get(norm) || 0;
                // If local shadow has a strictly newer timestamp (or task was wiped from sync by an un-synced device)
                if (shadowTs > syncTs) {
                    const restoredState = (typeof entry.s === 'string' && Object.prototype.hasOwnProperty.call(STATE_TO_IDX, entry.s))
                        ? entry.s
                        : 'default';
                    decoded.bruteTasks[norm] = restoredState;
                    if (entry.a) {
                        decoded.bruteAutoCompleted[norm] = String(entry.a);
                    } else {
                        delete decoded.bruteAutoCompleted[norm];
                    }
                    if (entry.p) {
                        decoded.brutePartyTriggered[norm] = true;
                    } else {
                        delete decoded.brutePartyTriggered[norm];
                    }
                    decoded._timestamps.set(norm, shadowTs);
                    taskTimestamps.set(norm, shadowTs);
                    decoded.bruteSeenTasks[norm] = 1;
                    healedCourses.add(getCourseGroupKey(norm));
                    healedAnyTask = true;
                }
            }

            // Merge seen tasks from shadow if not reset
            if (syncResetAt <= shadowResetAt && shadow.seen && typeof shadow.seen === 'object') {
                for (const [k, v] of Object.entries(shadow.seen)) {
                    if (!v) continue;
                    const norm = normalizeTaskKey(k);
                    if (norm && !decoded.bruteSeenTasks[norm]) {
                        decoded.bruteSeenTasks[norm] = 1;
                        if (!Object.prototype.hasOwnProperty.call(decoded.bruteTasks, norm)) {
                            decoded.bruteTasks[norm] = 'default';
                        }
                    }
                }
            }

            if (healedAnyTask) {
                return persistDomainsToSync(
                    syncRaw,
                    decoded,
                    decoded._timestamps,
                    { tasks: true, courses: healedCourses, seen: false, settings: false, plagiat: false }
                ).then(() => rawGet(syncArea, null)).then((updatedSyncRaw) => ({
                    syncRaw: updatedSyncRaw,
                    fullState: decoded
                }));
            }

            return saveLocalShadow(decoded, decoded._timestamps, effectiveResetAt).then(() => ({
                syncRaw,
                fullState: decoded
            }));
        });
    }

    function readStorage(keys) {
        return enqueueOp(() => {
            return loadAndReconcileState().then(({ fullState }) => {
                cachedLogicalState = cloneState(fullState);

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

    function writeStorage(partialData) {
        if (!partialData || typeof partialData !== 'object') return Promise.resolve();
        return enqueueOp(() => {
            return loadAndReconcileState().then(({ syncRaw, fullState: currentState }) => {
                const mergedTimestamps = new Map(currentState._timestamps || []);
                const minAllowedTs = Number(currentState._resetAt || 0) + 1;
                const nowSec = Math.max(nowEpochSec(), minAllowedTs);
                const modifiedCourses = new Set();

                const dirtyDomains = {
                    tasks: Boolean(partialData.bruteTasks || partialData.bruteAutoCompleted || partialData.brutePartyTriggered),
                    courses: modifiedCourses,
                    seen: Boolean(partialData.bruteSeenTasks || partialData.bruteDangerTasks),
                    settings: SETTING_KEYS.some(k => Object.prototype.hasOwnProperty.call(partialData, k)),
                    plagiat: Object.prototype.hasOwnProperty.call(partialData, 'plagiatIncident')
                };

                const mergedTasks = { ...currentState.bruteTasks };
                if (partialData.bruteTasks && typeof partialData.bruteTasks === 'object') {
                    for (const [rawKey, nextVal] of Object.entries(partialData.bruteTasks)) {
                        const norm = normalizeTaskKey(rawKey);
                        if (!norm || typeof nextVal !== 'string') continue;

                        const prevVal = currentState.bruteTasks[norm] || 'default';
                        const prevTs = mergedTimestamps.get(norm) || 0;
                        const wasManualUserState = (prevVal !== 'default' && !currentState.bruteAutoCompleted[norm]);
                        const isIncomingAutoComplete = Boolean(
                            partialData.bruteAutoCompleted && partialData.bruteAutoCompleted[norm]
                        );

                        // Never let an automatic page-load completion overwrite a manual user state
                        if (wasManualUserState && isIncomingAutoComplete) {
                            continue;
                        }

                        if (nextVal !== prevVal) {
                            mergedTasks[norm] = nextVal;
                            const nextTs = Math.max(nowSec, prevTs + 1);
                            mergedTimestamps.set(norm, nextTs);
                            taskTimestamps.set(norm, nextTs);
                            modifiedCourses.add(getCourseGroupKey(norm));
                        }
                    }
                }

                // Merge seen tasks additively (union)
                const mergedSeen = { ...currentState.bruteSeenTasks };
                if (partialData.bruteSeenTasks && typeof partialData.bruteSeenTasks === 'object') {
                    for (const [rawKey, val] of Object.entries(partialData.bruteSeenTasks)) {
                        if (!val) continue;
                        const norm = normalizeTaskKey(rawKey);
                        if (norm) mergedSeen[norm] = 1;
                    }
                }
                for (const k of Object.keys(mergedTasks)) {
                    mergedSeen[k] = 1;
                }

                // Merge autoCompleted additively while respecting manual user states
                const mergedAuto = { ...currentState.bruteAutoCompleted };
                if (partialData.bruteAutoCompleted && typeof partialData.bruteAutoCompleted === 'object') {
                    for (const [rawKey, val] of Object.entries(partialData.bruteAutoCompleted)) {
                        const norm = normalizeTaskKey(rawKey);
                        if (!norm) continue;
                        if (!val) {
                            delete mergedAuto[norm];
                            modifiedCourses.add(getCourseGroupKey(norm));
                            continue;
                        }
                        const prevVal = currentState.bruteTasks[norm] || 'default';
                        const wasManualUserState = (prevVal !== 'default' && !currentState.bruteAutoCompleted[norm]);
                        if (wasManualUserState) {
                            continue;
                        }
                        mergedAuto[norm] = (val === true) ? 'summary' : String(val);
                        if (!mergedTimestamps.get(norm)) {
                            mergedTimestamps.set(norm, nowSec);
                            taskTimestamps.set(norm, nowSec);
                        }
                        modifiedCourses.add(getCourseGroupKey(norm));
                    }
                }

                // Merge dangerTasks
                let mergedDanger = { ...currentState.bruteDangerTasks };
                if (partialData.bruteDangerTasks && typeof partialData.bruteDangerTasks === 'object') {
                    mergedDanger = { ...currentState.bruteDangerTasks };
                    for (const [rawKey, val] of Object.entries(partialData.bruteDangerTasks)) {
                        const norm = normalizeTaskKey(rawKey);
                        if (!norm) continue;
                        if (val) {
                            mergedDanger[norm] = true;
                        } else {
                            delete mergedDanger[norm];
                        }
                    }
                }

                // Merge partyTriggered additively (union)
                const mergedParty = { ...currentState.brutePartyTriggered };
                if (partialData.brutePartyTriggered && typeof partialData.brutePartyTriggered === 'object') {
                    for (const [rawKey, val] of Object.entries(partialData.brutePartyTriggered)) {
                        if (!val) continue;
                        const norm = normalizeTaskKey(rawKey);
                        if (norm) {
                            mergedParty[norm] = true;
                            if (!mergedTimestamps.get(norm)) {
                                mergedTimestamps.set(norm, nowSec);
                                taskTimestamps.set(norm, nowSec);
                            }
                            modifiedCourses.add(getCourseGroupKey(norm));
                        }
                    }
                }

                const nextState = {
                    ...currentState,
                    ...partialData,
                    bruteTasks: mergedTasks,
                    bruteSeenTasks: mergedSeen,
                    bruteAutoCompleted: mergedAuto,
                    bruteDangerTasks: mergedDanger,
                    brutePartyTriggered: mergedParty
                };

                return persistDomainsToSync(syncRaw, nextState, mergedTimestamps, dirtyDomains).then(() => {
                    cachedLogicalState = cloneState(nextState);
                });
            });
        });
    }

    function updateSingleTaskState(rawTaskKey, nextStateValue) {
        const norm = normalizeTaskKey(rawTaskKey);
        if (!norm) return Promise.resolve();
        return enqueueOp(() => {
            return loadAndReconcileState().then(({ syncRaw, fullState: currentState }) => {
                const mergedTimestamps = new Map(currentState._timestamps || []);
                const minAllowedTs = Number(currentState._resetAt || 0) + 1;
                const nowSec = Math.max(nowEpochSec(), minAllowedTs);
                const prevTs = mergedTimestamps.get(norm) || 0;
                const newTs = Math.max(nowSec, prevTs + 1);

                mergedTimestamps.set(norm, newTs);
                taskTimestamps.set(norm, newTs);

                const nextTasks = {
                    ...currentState.bruteTasks,
                    [norm]: nextStateValue
                };
                const nextAuto = { ...currentState.bruteAutoCompleted };
                delete nextAuto[norm];

                const nextSeen = {
                    ...currentState.bruteSeenTasks,
                    [norm]: 1
                };

                const nextState = {
                    ...currentState,
                    bruteTasks: nextTasks,
                    bruteAutoCompleted: nextAuto,
                    bruteSeenTasks: nextSeen
                };

                const targetCourses = new Set([getCourseGroupKey(norm)]);

                return persistDomainsToSync(
                    syncRaw,
                    nextState,
                    mergedTimestamps,
                    { tasks: true, courses: targetCourses, seen: false, settings: false, plagiat: false }
                ).then(() => {
                    cachedLogicalState = cloneState(nextState);
                });
            });
        });
    }

    function clearAllStorage() {
        return enqueueOp(() => {
            return Promise.all([
                rawGet(syncArea, null),
                localArea && localArea !== syncArea ? rawGet(localArea, null) : Promise.resolve({})
            ]).then(([syncRaw, localRaw]) => {
                const decodedBeforeClear = decodeSyncItems(syncRaw);
                const shadowBeforeClear = (localRaw && localRaw[LOCAL_SHADOW_KEY] && localRaw[LOCAL_SHADOW_KEY].tasks)
                    ? Object.values(localRaw[LOCAL_SHADOW_KEY].tasks).map(e => Number(e && e.t) || 0)
                    : [];
                const maxExistingTs = Math.max(
                    nowEpochSec(),
                    ...Array.from(taskTimestamps.values()),
                    ...Array.from((decodedBeforeClear._timestamps || new Map()).values()),
                    ...shadowBeforeClear,
                    Number((syncRaw && syncRaw[META_KEY] && syncRaw[META_KEY].r) || 0)
                );
                const resetTimestamp = maxExistingTs + 1;

                const syncKeysToRemove = Object.keys(syncRaw || {}).filter(k => k !== META_KEY);
                const localKeysToRemove = Object.keys(localRaw || {}).filter(
                    k => k !== ONBOARDING_LOCAL_KEY && k !== LOCAL_SHADOW_KEY
                );

                taskTimestamps.clear();
                purgeLegacyLocalStorage();

                const emptyState = {
                    bruteTasks: {},
                    bruteSeenTasks: {},
                    bruteAutoCompleted: {},
                    bruteDangerTasks: {},
                    brutePartyTriggered: {},
                    plagiatIncident: null,
                    ...SETTING_DEFAULTS,
                    _resetAt: resetTimestamp
                };

                const resetShadow = {
                    tasks: {},
                    seen: {},
                    resetAt: resetTimestamp
                };

                // 1. Write resetAt to local shadow and sync b128_meta FIRST so no listener
                //    ever sees an empty sync store without the resetAt marker!
                return Promise.all([
                    localArea && localArea !== syncArea
                        ? rawSet(localArea, { [LOCAL_SHADOW_KEY]: resetShadow })
                        : Promise.resolve(),
                    rawSet(syncArea, {
                        [META_KEY]: { v: DB_VERSION, r: resetTimestamp },
                        [SETTINGS_KEY]: { ...SETTING_DEFAULTS }
                    })
                ]).then(() => {
                    const keysToClean = syncKeysToRemove.filter(k => k !== SETTINGS_KEY);
                    return Promise.all([
                        keysToClean.length > 0 ? rawRemove(syncArea, keysToClean) : Promise.resolve(),
                        localKeysToRemove.length > 0 && localArea && localArea !== syncArea
                            ? rawRemove(localArea, localKeysToRemove)
                            : Promise.resolve()
                    ]);
                }).then(() => {
                    cachedLogicalState = cloneState(emptyState);
                });
            });
        });
    }

    const changeListeners = [];

    function diffStates(prevState, nextState) {
        const prev = stripInternalFields(prevState) || {};
        const next = stripInternalFields(nextState) || {};
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
            if (area !== 'sync') return;

            const incomingObsolete = Object.keys(rawChanges || {}).filter(
                k => !k.startsWith(KEY_PREFIX) && rawChanges[k] && rawChanges[k].newValue !== undefined
            );
            if (incomingObsolete.length > 0) {
                rawRemove(syncArea, incomingObsolete);
            }

            const relevant = Object.keys(rawChanges || {}).some(k => k.startsWith(KEY_PREFIX));
            if (!relevant) return;

            const prevSnapshot = cloneState(cachedLogicalState);
            enqueueOp(() => {
                return loadAndReconcileState().then(({ fullState: nextSnapshot }) => {
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
        });
    }

    function subscribeStorageChanges(listener) {
        if (typeof listener === 'function') {
            changeListeners.push(listener);
        }
    }

    globalScope.BruteSyncStorage = {
        DB_VERSION,
        ONBOARDING_LOCAL_KEY,
        LOCAL_SHADOW_KEY,
        readStorage,
        writeStorage,
        updateSingleTaskState,
        clearAllStorage,
        purgePre128Storage,
        subscribeStorageChanges,
        normalizeTaskKey,
        _internal: {
            serializeTaskMaps,
            deserializeTaskMaps,
            serializeActiveTasks,
            serializeActiveTasksByCourse,
            deserializeActiveTasks,
            serializeSeenAndDanger,
            deserializeSeenAndDanger,
            splitIntoChunks,
            packTaskCode,
            unpackTaskCode,
            decodeSyncItems,
            META_KEY,
            SETTINGS_KEY,
            PLAGIAT_KEY,
            COURSE_KEY_PREFIX,
            TASK_CHUNK_PREFIX,
            SEEN_CHUNK_PREFIX,
            MAX_CHUNK_CHARS
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
