// ============================================================================
// FEL CTU BRUTE Deadline Manager - Background Worker (v1.28)
// ============================================================================
// 1. On install or update (e.g. 1.27 -> 1.28), removes ONLY obsolete pre-1.28
//    storage keys (b_meta, b_c_*, bruteTasks, etc.) without writing any keys
//    to storage.sync — ensuring a second browser updating days later never
//    overwrites b128_* data synced from the first browser.
// 2. Also listens to storage.onChanged so if an un-updated 1.27 device briefly
//    writes b_meta / b_c_0 to cloud sync, those obsolete keys are immediately
//    cleaned up.
// 3. Opens the v1.28 Permissions Migration & Tutorial page (onboarding.html)
//    strictly ONCE per browser and never again.
// ============================================================================

if (typeof importScripts === 'function' && typeof BruteSyncStorage === 'undefined') {
    try {
        importScripts('storage.js');
    } catch (e) {}
}

const isFirefoxEnv = (typeof browser !== 'undefined' && Boolean(browser.runtime));
const runtime = isFirefoxEnv ? browser.runtime : (typeof chrome !== 'undefined' ? chrome.runtime : null);
const storageNs = isFirefoxEnv ? browser.storage : (typeof chrome !== 'undefined' ? chrome.storage : null);
const tabsApi = isFirefoxEnv ? browser.tabs : (typeof chrome !== 'undefined' ? chrome.tabs : null);

const KEY_PREFIX = 'b128_';
const ONBOARDING_LOCAL_KEY = 'b128_onboarding_shown_v1';

function areaGet(area, keys) {
    if (!area) return Promise.resolve({});
    if (isFirefoxEnv) {
        return area.get(keys).then(res => res || {}).catch(() => ({}));
    }
    return new Promise((resolve) => {
        try {
            area.get(keys, (res) => resolve(res || {}));
        } catch {
            resolve({});
        }
    });
}

function areaSet(area, items) {
    if (!area || !items || Object.keys(items).length === 0) return Promise.resolve();
    if (isFirefoxEnv) {
        return area.set(items).catch(() => {});
    }
    return new Promise((resolve) => {
        try {
            area.set(items, () => resolve());
        } catch {
            resolve();
        }
    });
}

function areaRemove(area, keys) {
    if (!area || !keys || (Array.isArray(keys) && keys.length === 0)) return Promise.resolve();
    if (isFirefoxEnv) {
        return area.remove(keys).catch(() => {});
    }
    return new Promise((resolve) => {
        try {
            area.remove(keys, () => resolve());
        } catch {
            resolve();
        }
    });
}

// Removes ONLY pre-1.28 keys (never writes to storage.sync on install/update,
// so a browser updating days later cannot clobber existing cloud b128_* keys!)
async function purgePre128ObsoleteKeys() {
    if (!storageNs) return;
    const syncArea = storageNs.sync || storageNs.local;
    const localArea = storageNs.local;

    const [syncRaw, localRaw] = await Promise.all([
        areaGet(syncArea, null),
        localArea && localArea !== syncArea ? areaGet(localArea, null) : Promise.resolve({})
    ]);

    const obsoleteSyncKeys = Object.keys(syncRaw || {}).filter(k => !k.startsWith(KEY_PREFIX));
    const obsoleteLocalKeys = Object.keys(localRaw || {}).filter(k => !k.startsWith(KEY_PREFIX));

    const tasks = [];
    if (obsoleteSyncKeys.length > 0) {
        tasks.push(areaRemove(syncArea, obsoleteSyncKeys));
    }
    if (obsoleteLocalKeys.length > 0 && localArea && localArea !== syncArea) {
        tasks.push(areaRemove(localArea, obsoleteLocalKeys));
    }

    await Promise.all(tasks);
}

async function openOnboardingPageOnce() {
    if (!storageNs || !runtime || !tabsApi) return;
    const localArea = storageNs.local || storageNs.sync;

    const localData = await areaGet(localArea, [ONBOARDING_LOCAL_KEY]);
    if (localData && localData[ONBOARDING_LOCAL_KEY] === true) {
        return;
    }

    // Persist flag BEFORE opening tab so it can never open a second time
    await areaSet(localArea, { [ONBOARDING_LOCAL_KEY]: true });

    const onboardingUrl = runtime.getURL('onboarding/onboarding.html');
    try {
        if (isFirefoxEnv) {
            await tabsApi.create({ url: onboardingUrl, active: true });
        } else {
            tabsApi.create({ url: onboardingUrl, active: true });
        }
    } catch (err) {
        console.error('[BRUTE Ext] Failed to open onboarding tab:', err);
    }
}

if (runtime && runtime.onInstalled) {
    runtime.onInstalled.addListener((details) => {
        (async () => {
            await purgePre128ObsoleteKeys();
            if (details && (details.reason === 'install' || details.reason === 'update')) {
                await openOnboardingPageOnce();
            }
        })();
    });
}

// If an older 1.27 browser comes online days later and briefly syncs b_meta/b_c_0
// before updating itself, immediately strip those obsolete keys from storage.sync
if (storageNs && storageNs.onChanged) {
    storageNs.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const addedObsoleteKeys = Object.keys(changes || {}).filter(
            k => !k.startsWith(KEY_PREFIX) && changes[k] && changes[k].newValue !== undefined
        );
        if (addedObsoleteKeys.length > 0 && storageNs.sync) {
            areaRemove(storageNs.sync, addedObsoleteKeys);
        }
    });
}

if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.action === 'BRUTE_OPEN_ONBOARDING') {
            const onboardingUrl = runtime.getURL('onboarding/onboarding.html');
            if (tabsApi && tabsApi.create) {
                tabsApi.create({ url: onboardingUrl, active: true });
            }
            if (typeof sendResponse === 'function') {
                sendResponse({ ok: true });
            }
            return false;
        }
        return false;
    });
}
