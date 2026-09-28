const storage = (typeof BruteSyncStorage !== 'undefined') ? BruteSyncStorage : null;

function getEl(id) {
  return document.getElementById(id);
}

function storageGet(keys) {
  if (!storage) return Promise.resolve({});
  return storage.readStorage(keys);
}

function storageSet(data) {
  if (!storage) return Promise.resolve();
  return storage.writeStorage(data);
}

function storageClearAll() {
  if (!storage) return Promise.resolve();
  return storage.clearAllStorage();
}

// Render Plagiat Section safely
function renderPlagiat(plagiatData) {
  const plagiatBadgeEl = getEl('plagiat-badge');
  const plagiatCleanView = getEl('plagiat-clean-view');
  const plagiatIncidentView = getEl('plagiat-incident-view');
  const plagiatTitleEl = getEl('plagiat-title');

  const hasIncident = Boolean(plagiatData && typeof plagiatData === 'object' && plagiatData.hasIncident);

  if (hasIncident) {
    if (plagiatBadgeEl) {
      plagiatBadgeEl.textContent = 'Incident Detected';
      plagiatBadgeEl.className = 'badge badge-warning';
    }
    if (plagiatCleanView) plagiatCleanView.classList.add('hidden');
    if (plagiatIncidentView) plagiatIncidentView.classList.remove('hidden');

    if (plagiatTitleEl) {
      const titleText = (plagiatData && typeof plagiatData.title === 'string' && plagiatData.title.trim())
        ? plagiatData.title.trim()
        : 'Plagiat incident detected';
      plagiatTitleEl.textContent = titleText;
    }
  } else {
    if (plagiatBadgeEl) {
      plagiatBadgeEl.textContent = 'Clean';
      plagiatBadgeEl.className = 'badge badge-clean';
    }
    if (plagiatCleanView) plagiatCleanView.classList.remove('hidden');
    if (plagiatIncidentView) plagiatIncidentView.classList.add('hidden');
  }
}

// Render Statistics Section (excluding untriaged default tasks)
function renderStats(tasks) {
  const taskMap = (tasks && typeof tasks === 'object') ? tasks : {};
  const entries = Object.values(taskMap);

  let doneCount = 0;
  let todoCount = 0;
  let highlightCount = 0;
  let cancelCount = 0;

  entries.forEach(state => {
    switch (state) {
      case 'done':
        doneCount++;
        break;
      case 'todo':
        todoCount++;
        break;
      case 'highlight':
        highlightCount++;
        break;
      case 'cancel':
        cancelCount++;
        break;
      case 'default':
      default:
        // Do not track/count untriaged default tasks
        break;
    }
  });

  const statDone = getEl('stat-done');
  const statTodo = getEl('stat-todo');
  const statHighlight = getEl('stat-highlight');
  const statCancel = getEl('stat-cancel');
  const totalTasksBadge = getEl('total-tasks-badge');

  if (statDone) statDone.textContent = doneCount;
  if (statTodo) statTodo.textContent = todoCount;
  if (statHighlight) statHighlight.textContent = highlightCount;
  if (statCancel) statCancel.textContent = cancelCount;

  const totalTracked = doneCount + todoCount + highlightCount + cancelCount;
  if (totalTasksBadge) totalTasksBadge.textContent = `${totalTracked} tracked`;
}

// Load all data from storage
function loadData() {
  if (!storage) return;

  storageGet([
    'bruteTasks',
    'plagiatIncident',
    'hidePlagiatBanner',
    'classicUiStyle',
    'courseSummaryToBottom',
    'autoDetectCompletion',
    'autoCompleteRemovedX',
    'showCompletionToast',
    'enablePartyMode',
    'partyModeOnMinScore',
    'showGreenCheckmarks',
    'hideNewTaskBadge'
  ]).then((result) => {
    const data = result || {};
    renderStats(data.bruteTasks);
    renderPlagiat(data.plagiatIncident);

    // Classic UI style toggle (default false)
    const toggleClassicUi = getEl('toggle-classic-ui');
    if (toggleClassicUi) {
      toggleClassicUi.checked = Boolean(data.classicUiStyle);
    }

    // Course summary to bottom toggle (default false)
    const toggleSummaryBottom = getEl('toggle-summary-bottom');
    if (toggleSummaryBottom) {
      toggleSummaryBottom.checked = Boolean(data.courseSummaryToBottom);
    }

    // Automatic completion detection toggle (default true)
    const toggleAutoComplete = getEl('toggle-auto-complete');
    if (toggleAutoComplete) {
      toggleAutoComplete.checked = data.autoDetectCompletion !== false;
    }

    // Detect & auto-complete X's toggle (default true)
    const toggleAutoCompleteX = getEl('toggle-auto-complete-x');
    if (toggleAutoCompleteX) {
      toggleAutoCompleteX.checked = data.autoCompleteRemovedX !== false;
    }

    // Completion notification toast toggle (default true)
    const toggleCompletionToast = getEl('toggle-completion-toast');
    if (toggleCompletionToast) {
      toggleCompletionToast.checked = data.showCompletionToast !== false;
    }

    // Party mode celebration toggle (default true)
    const togglePartyMode = getEl('toggle-party-mode');
    if (togglePartyMode) {
      togglePartyMode.checked = data.enablePartyMode !== false;
    }

    // Party mode on minimum accepted score toggle (default false)
    const togglePartyMinScore = getEl('toggle-party-min-score');
    if (togglePartyMinScore) {
      togglePartyMinScore.checked = Boolean(data.partyModeOnMinScore);
    }

    // Green checkmarks in lists toggle (default true)
    const toggleGreenCheckmarks = getEl('toggle-green-checkmarks');
    if (toggleGreenCheckmarks) {
      toggleGreenCheckmarks.checked = data.showGreenCheckmarks !== false;
    }

    // Hide NEW badge toggle (default false)
    const toggleHideNew = getEl('toggle-hide-new');
    if (toggleHideNew) {
      toggleHideNew.checked = Boolean(data.hideNewTaskBadge);
    }

    // Plagiat auto-hide toggle (default true)
    const toggleHidePlagiat = getEl('toggle-hide-plagiat');
    if (toggleHidePlagiat) {
      toggleHidePlagiat.checked = data.hidePlagiatBanner !== false;
    }
  }).catch((err) => {
    console.error('Error reading storage in popup:', err);
    renderStats({});
    renderPlagiat(null);
  });
}

// Show feedback message
function showFeedback(msg, isSuccess = true) {
  const actionFeedback = getEl('action-feedback');
  if (!actionFeedback) return;
  actionFeedback.textContent = msg;
  actionFeedback.className = `action-feedback ${isSuccess ? 'success' : 'error'}`;
  actionFeedback.classList.remove('hidden');
  setTimeout(() => {
    actionFeedback.classList.add('hidden');
  }, 3000);
}

// Send debug Party Mode simulation message to active BRUTE tab
function sendSimulatePartyMessage() {
  const handleResponse = (res) => {
    if (res && res.ok) {
      showFeedback(`🎉 Simulated ${res.taskCode}: XX → ${res.maxScore} pts!`);
    } else if (res && res.reason === 'no-summary') {
      showFeedback('Open a BRUTE course/task page with Course summary first.', false);
    } else if (res && res.reason === 'no-scorable-task') {
      showFeedback('No tasks with max score > 0 found in Course summary.', false);
    } else {
      showFeedback('Open a BRUTE course/task page first.', false);
    }
  };

  try {
    if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.query) {
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (!tabs || !tabs[0] || tabs[0].id == null) {
          showFeedback('No active tab found.', false);
          return;
        }
        return browser.tabs.sendMessage(tabs[0].id, { action: 'BRUTE_SIMULATE_PARTY_MODE' });
      }).then(handleResponse).catch(() => {
        showFeedback('Open a BRUTE course/task page first.', false);
      });
    } else if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0] || tabs[0].id == null) {
          showFeedback('No active tab found.', false);
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'BRUTE_SIMULATE_PARTY_MODE' }, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            showFeedback('Open a BRUTE course/task page first.', false);
            return;
          }
          handleResponse(res);
        });
      });
    } else {
      showFeedback('Tabs API unavailable in this context.', false);
    }
  } catch (err) {
    showFeedback('Could not trigger simulation on this tab.', false);
  }
}

// Initialize popup UI and listeners
function initPopup() {
  // Version display
  try {
    const extVersionEl = getEl('ext-version');
    const manifest = (typeof browser !== 'undefined' && browser.runtime) 
      ? browser.runtime.getManifest() 
      : (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getManifest() : null);
    if (extVersionEl && manifest && manifest.version) {
      extVersionEl.textContent = `v${manifest.version}`;
    }
  } catch (e) {
    console.warn('Could not read manifest version:', e);
  }

  // Toggle Classic BRUTE UI (Old Style)
  const toggleClassicUi = getEl('toggle-classic-ui');
  if (toggleClassicUi) {
    toggleClassicUi.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleClassicUi.checked;
      storageSet({ classicUiStyle: isChecked });
      showFeedback(isChecked ? 'Classic BRUTE UI style enabled' : 'Modern BRUTE UI style restored');
    });
  }

  // Toggle Course Summary to Bottom
  const toggleSummaryBottom = getEl('toggle-summary-bottom');
  if (toggleSummaryBottom) {
    toggleSummaryBottom.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleSummaryBottom.checked;
      storageSet({ courseSummaryToBottom: isChecked });
      showFeedback(isChecked ? 'Course summary moved to bottom' : 'Course summary restored to top');
    });
  }

  // Toggle Automatic Completion Detection
  const toggleAutoComplete = getEl('toggle-auto-complete');
  if (toggleAutoComplete) {
    toggleAutoComplete.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleAutoComplete.checked;
      storageSet({ autoDetectCompletion: isChecked });
      showFeedback(isChecked ? 'Automatic completion detection enabled' : 'Automatic completion detection disabled');
    });
  }

  // Toggle Detect & Auto-Complete Removed X's
  const toggleAutoCompleteX = getEl('toggle-auto-complete-x');
  if (toggleAutoCompleteX) {
    toggleAutoCompleteX.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleAutoCompleteX.checked;
      storageSet({ autoCompleteRemovedX: isChecked });
      showFeedback(isChecked ? 'X badge auto-completion enabled' : 'X badge auto-completion disabled');
    });
  }

  // Toggle Toast Notifications (Popups)
  const toggleCompletionToast = getEl('toggle-completion-toast');
  if (toggleCompletionToast) {
    toggleCompletionToast.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleCompletionToast.checked;
      storageSet({ showCompletionToast: isChecked });
      showFeedback(isChecked ? 'Toast notifications enabled' : 'Toast notifications disabled');
    });
  }

  // Toggle Party Mode Celebration (Max score)
  const togglePartyMode = getEl('toggle-party-mode');
  if (togglePartyMode) {
    togglePartyMode.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = togglePartyMode.checked;
      storageSet({ enablePartyMode: isChecked });
      showFeedback(isChecked ? 'Party mode celebration enabled' : 'Party mode celebration disabled');
    });
  }

  // Toggle Party Mode on Minimum Accepted Score
  const togglePartyMinScore = getEl('toggle-party-min-score');
  if (togglePartyMinScore) {
    togglePartyMinScore.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = togglePartyMinScore.checked;
      storageSet({ partyModeOnMinScore: isChecked });
      showFeedback(isChecked ? 'Party mode on minimum score enabled' : 'Party mode only on maximum score');
    });
  }

  // Toggle Green Checkmarks in Lists
  const toggleGreenCheckmarks = getEl('toggle-green-checkmarks');
  if (toggleGreenCheckmarks) {
    toggleGreenCheckmarks.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleGreenCheckmarks.checked;
      storageSet({ showGreenCheckmarks: isChecked });
      showFeedback(isChecked ? 'Green checkmarks in lists enabled' : 'Green checkmarks in lists disabled');
    });
  }

  // Toggle Hide NEW Task Badges
  const toggleHideNew = getEl('toggle-hide-new');
  if (toggleHideNew) {
    toggleHideNew.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleHideNew.checked;
      storageSet({ hideNewTaskBadge: isChecked });
      showFeedback(isChecked ? 'NEW task badges hidden' : 'NEW task badges will be shown');
    });
  }

  // Toggle Auto-Hide Plagiat Banner
  const toggleHidePlagiat = getEl('toggle-hide-plagiat');
  if (toggleHidePlagiat) {
    toggleHidePlagiat.addEventListener('change', () => {
      if (!storage) return;
      const isChecked = toggleHidePlagiat.checked;
      storageSet({ hidePlagiatBanner: isChecked });
      showFeedback(isChecked ? 'Plagiat banner auto-hide enabled' : 'Plagiat banner will be shown on page');
    });
  }

  // Debug Simulate Party Mode Button
  const btnSimulateParty = getEl('btn-simulate-party');
  if (btnSimulateParty) {
    btnSimulateParty.addEventListener('click', () => {
      sendSimulatePartyMessage();
    });
  }

  // Open Onboarding / Permissions & Tutorial Guide Button
  const openOnboardingPage = () => {
    const runtime = (typeof browser !== 'undefined' && browser.runtime)
      ? browser.runtime
      : (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null);
    const tabs = (typeof browser !== 'undefined' && browser.tabs)
      ? browser.tabs
      : (typeof chrome !== 'undefined' && chrome.tabs ? chrome.tabs : null);
    const url = runtime && runtime.getURL ? runtime.getURL('onboarding/onboarding.html') : '../onboarding/onboarding.html';
    if (tabs && tabs.create) {
      tabs.create({ url, active: true });
    } else {
      window.open(url, '_blank');
    }
  };

  const btnOpenGuide = getEl('btn-open-guide');
  if (btnOpenGuide) {
    btnOpenGuide.addEventListener('click', openOnboardingPage);
  }

  // Delete Confirmation Flow
  const btnDeleteAllInit = getEl('btn-delete-all-init');
  const deleteInitialView = getEl('delete-initial-view');
  const deleteConfirmView = getEl('delete-confirm-view');
  const btnDeleteCancel = getEl('btn-delete-cancel');
  const btnDeleteConfirm = getEl('btn-delete-confirm');

  if (btnDeleteAllInit) {
    btnDeleteAllInit.addEventListener('click', () => {
      if (deleteInitialView) deleteInitialView.classList.add('hidden');
      if (deleteConfirmView) deleteConfirmView.classList.remove('hidden');
    });
  }

  if (btnDeleteCancel) {
    btnDeleteCancel.addEventListener('click', () => {
      if (deleteConfirmView) deleteConfirmView.classList.add('hidden');
      if (deleteInitialView) deleteInitialView.classList.remove('hidden');
    });
  }

  if (btnDeleteConfirm) {
    btnDeleteConfirm.addEventListener('click', () => {
      if (!storage) return;

      storageClearAll().then(() => {
        if (deleteConfirmView) deleteConfirmView.classList.add('hidden');
        if (deleteInitialView) deleteInitialView.classList.remove('hidden');
        renderStats({});
        renderPlagiat(null);
        if (toggleClassicUi) toggleClassicUi.checked = false;
        if (toggleSummaryBottom) toggleSummaryBottom.checked = false;
        if (toggleAutoComplete) toggleAutoComplete.checked = true;
        if (toggleAutoCompleteX) toggleAutoCompleteX.checked = true;
        if (toggleCompletionToast) toggleCompletionToast.checked = true;
        if (togglePartyMode) togglePartyMode.checked = true;
        if (togglePartyMinScore) togglePartyMinScore.checked = false;
        if (toggleGreenCheckmarks) toggleGreenCheckmarks.checked = true;
        if (toggleHideNew) toggleHideNew.checked = false;
        if (toggleHidePlagiat) toggleHidePlagiat.checked = true;
        showFeedback('All extension data deleted successfully.');
      }).catch((err) => {
        console.error('Failed to delete data:', err);
      });
    });
  }

  // Real-time update listener from synced storage
  if (storage && typeof storage.subscribeStorageChanges === 'function') {
    storage.subscribeStorageChanges((changes) => {
      if (changes && changes.bruteTasks) {
        renderStats(changes.bruteTasks.newValue);
      }
      if (changes && changes.plagiatIncident) {
        renderPlagiat(changes.plagiatIncident.newValue);
      }
      if (changes && changes.classicUiStyle && toggleClassicUi) {
        toggleClassicUi.checked = Boolean(changes.classicUiStyle.newValue);
      }
      if (changes && changes.courseSummaryToBottom && toggleSummaryBottom) {
        toggleSummaryBottom.checked = Boolean(changes.courseSummaryToBottom.newValue);
      }
      if (changes && changes.autoDetectCompletion && toggleAutoComplete) {
        toggleAutoComplete.checked = changes.autoDetectCompletion.newValue !== false;
      }
      if (changes && changes.autoCompleteRemovedX && toggleAutoCompleteX) {
        toggleAutoCompleteX.checked = changes.autoCompleteRemovedX.newValue !== false;
      }
      if (changes && changes.showCompletionToast && toggleCompletionToast) {
        toggleCompletionToast.checked = changes.showCompletionToast.newValue !== false;
      }
      if (changes && changes.enablePartyMode && togglePartyMode) {
        togglePartyMode.checked = changes.enablePartyMode.newValue !== false;
      }
      if (changes && changes.partyModeOnMinScore && togglePartyMinScore) {
        togglePartyMinScore.checked = Boolean(changes.partyModeOnMinScore.newValue);
      }
      if (changes && changes.showGreenCheckmarks && toggleGreenCheckmarks) {
        toggleGreenCheckmarks.checked = changes.showGreenCheckmarks.newValue !== false;
      }
      if (changes && changes.hideNewTaskBadge && toggleHideNew) {
        toggleHideNew.checked = Boolean(changes.hideNewTaskBadge.newValue);
      }
      if (changes && changes.hidePlagiatBanner && toggleHidePlagiat) {
        toggleHidePlagiat.checked = changes.hidePlagiatBanner.newValue !== false;
      }
    });
  }

  // Load initial data
  loadData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
