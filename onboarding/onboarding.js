// ============================================================================
// FEL CTU BRUTE Deadline Manager v1.28 — Compact Onboarding & Permissions
// ============================================================================

const BRUTE_ORIGINS = [
  'https://brute.fel.cvut.cz/*',
  'https://cw.felk.cvut.cz/*',
  'https://cw.fel.cvut.cz/*',
  'https://brute.felk.cvut.cz/*'
];

const extApi = (typeof browser !== 'undefined' && browser.runtime)
  ? browser
  : (typeof chrome !== 'undefined' ? chrome : null);

const isFirefoxBrowser = (
  (extApi && extApi.runtime && typeof extApi.runtime.getURL === 'function' && extApi.runtime.getURL('').startsWith('moz-extension://')) ||
  /Firefox\//i.test(navigator.userAgent || '')
);

function getEl(id) {
  return document.getElementById(id);
}

function checkPermissionsGranted() {
  if (!extApi || !extApi.permissions || typeof extApi.permissions.contains !== 'function') {
    return Promise.resolve(false);
  }
  if (typeof browser !== 'undefined' && browser.permissions) {
    return browser.permissions.contains({ origins: BRUTE_ORIGINS }).catch(() => false);
  }
  return new Promise((resolve) => {
    try {
      extApi.permissions.contains({ origins: BRUTE_ORIGINS }, (granted) => {
        resolve(Boolean(granted));
      });
    } catch {
      resolve(false);
    }
  });
}

function requestBrutePermissions() {
  if (!extApi || !extApi.permissions || typeof extApi.permissions.request !== 'function') {
    return Promise.resolve(false);
  }
  if (typeof browser !== 'undefined' && browser.permissions) {
    return browser.permissions.request({ origins: BRUTE_ORIGINS }).catch(() => false);
  }
  return new Promise((resolve) => {
    try {
      extApi.permissions.request({ origins: BRUTE_ORIGINS }, (granted) => {
        resolve(Boolean(granted));
      });
    } catch {
      resolve(false);
    }
  });
}

function updatePermissionUi(isGranted) {
  const box = getEl('quick-grant-box');
  const badge = getEl('perm-badge');
  const titleEl = getEl('perm-status-title');
  const btnGrant = getEl('btn-grant-permissions');

  if (!box || !titleEl || !btnGrant) return;

  if (isGranted) {
    box.classList.add('granted');
    if (badge) {
      badge.className = 'status-badge status-ok';
      badge.textContent = '✅ All 4 Domains Active';
    }
    titleEl.textContent = '✅ Permissions Active (All 4 BRUTE domains allowed)';
    btnGrant.className = 'btn btn-grant-done';
    btnGrant.textContent = '✅ Granted';
  } else {
    box.classList.remove('granted');
    if (badge) {
      badge.className = 'status-badge status-pending';
      badge.textContent = '⚠️ PERMISSIONS REQUIRED';
    }
    titleEl.textContent = '⚠️ ACTION REQUIRED: Enable BRUTE Site Permissions!';
    btnGrant.className = 'btn btn-grant-urgent';
    btnGrant.textContent = '⚠️ Grant Permissions';
  }
}

function openExtensionSettingsTab() {
  if (!extApi || !extApi.tabs || typeof extApi.tabs.create !== 'function') return;

  if (!isFirefoxBrowser && extApi.runtime && extApi.runtime.id) {
    // Chrome / Edge / Brave: opens the exact extension details page in a new tab
    extApi.tabs.create({ url: `chrome://extensions/?id=${extApi.runtime.id}` });
    return;
  }

  // Firefox: trigger native permissions prompt directly, and attempt opening about:addons
  requestBrutePermissions().then((granted) => {
    updatePermissionUi(granted);
  });
  try {
    const p = extApi.tabs.create({ url: 'about:addons' });
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  } catch {}
}

function initOnboarding() {
  // 1. Version label
  try {
    const versionEl = getEl('onboarding-version');
    if (versionEl && extApi && extApi.runtime && typeof extApi.runtime.getManifest === 'function') {
      const manifest = extApi.runtime.getManifest();
      if (manifest && manifest.version) {
        versionEl.textContent = `v${manifest.version}`;
      }
    }
  } catch {}

  // 2. Show ONLY Firefox guide on Firefox, otherwise ONLY Chrome guide
  const chromeGuide = getEl('guide-chrome');
  const firefoxGuide = getEl('guide-firefox');
  if (isFirefoxBrowser) {
    if (chromeGuide) chromeGuide.style.display = 'none';
    if (firefoxGuide) firefoxGuide.style.display = 'flex';
  } else {
    if (chromeGuide) chromeGuide.style.display = 'flex';
    if (firefoxGuide) firefoxGuide.style.display = 'none';
  }

  // 3. Check & wire permissions (plus live refresh when returning from settings tab)
  const refreshPermStatus = () => checkPermissionsGranted().then(updatePermissionUi);
  refreshPermStatus();
  window.addEventListener('focus', refreshPermStatus);
  if (extApi && extApi.permissions) {
    if (extApi.permissions.onAdded && typeof extApi.permissions.onAdded.addListener === 'function') {
      extApi.permissions.onAdded.addListener(refreshPermStatus);
    }
    if (extApi.permissions.onRemoved && typeof extApi.permissions.onRemoved.addListener === 'function') {
      extApi.permissions.onRemoved.addListener(refreshPermStatus);
    }
  }

  const btnGrant = getEl('btn-grant-permissions');
  if (btnGrant) {
    btnGrant.addEventListener('click', () => {
      requestBrutePermissions().then(updatePermissionUi);
    });
  }

  const btnOpenExtTab = getEl('btn-open-ext-tab');
  if (btnOpenExtTab) {
    btnOpenExtTab.addEventListener('click', openExtensionSettingsTab);
  }

  // 4. Close button
  const btnClose = getEl('btn-close-tab');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      window.close();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnboarding);
} else {
  initOnboarding();
}
