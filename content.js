console.log("[BRUTE Ext] Script started.");

// 1. ADDED 'highlight' to the modes array
const MODES = ['default', 'done', 'todo', 'cancel', 'highlight'];

// 2. ADDED the highlight styling mapping
const STATE_STYLES = {
    'default': { class: '', icon: '⚙️' },
    'done': { class: 'brute-item-done', icon: '✅' },
    'todo': { class: 'brute-item-todo', icon: '⭐' },
    'cancel': { class: 'brute-item-cancel', icon: '❌' },
    'highlight': { class: 'brute-item-highlight', icon: '🔎' }
};

const PANEL_SELECTOR = '.panel, .panel-warning, .panel-danger, .panel-info, .panel-primary, .panel-default, .card, .card-warning, .card-danger, .card-info, .card-primary, .card-default';
const HEADING_SELECTOR = '.panel-heading, .card-header';
const ITEM_SELECTOR = '.panel-body a.list-group-item, .card-body a.list-group-item, .list-group a.list-group-item, a.list-group-item';

const storage = (typeof BruteSyncStorage !== 'undefined') ? BruteSyncStorage : null;

function readStorage(keys) {
    if (!storage) return Promise.resolve({});
    return storage.readStorage(keys);
}

function writeStorage(data) {
    if (!storage) return Promise.resolve();
    return storage.writeStorage(data);
}

// -------------------------------------------------------------
// 0. CLASSIC BRUTE UI (OLD STYLE & ELEMENT LOCATIONS) MODE
// -------------------------------------------------------------
function applyClassicUiStyle(enabled) {
    const isClassic = Boolean(enabled);
    if (document.documentElement) {
        document.documentElement.classList.toggle('brute-classic-ui', isClassic);
    }
    if (document.body) {
        document.body.classList.toggle('brute-classic-ui', isClassic);
    }
}

function initClassicUiStyle() {
    readStorage(['classicUiStyle']).then((result) => {
        applyClassicUiStyle(result.classicUiStyle);
    });
}

initClassicUiStyle();

// -------------------------------------------------------------
// 0.5 FOOTER YEAR & BRUTE++ BRANDING UPDATE
// -------------------------------------------------------------
function updateFooterBranding() {
    const footers = document.querySelectorAll('footer, .footer');
    if (footers.length === 0) return;

    const currentYear = new Date().getFullYear();

    footers.forEach(footer => {
        const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();

        while (textNode) {
            const text = textNode.nodeValue;
            if (text) {
                const updated = text
                    .replace(/©\s*\d{4}/g, `© ${currentYear}`)
                    .replace(
                        /\bBRUTE(?:\+\+)?\s*-\s*Bundle for Reservation, Uploading, Testing and Evaluation/g,
                        'BRUTE++ Bundle for Reservation, Uploading, Testing and Evaluation'
                    )
                    .replace(/^(\s*)BRUTE(\s*(?:\|\s*)?)$/, '$1BRUTE++$2');

                if (updated !== text) {
                    textNode.nodeValue = updated;
                }
            }
            textNode = walker.nextNode();
        }

        footer.dataset.bruteFooterProcessed = 'true';
    });
}

updateFooterBranding();

// -------------------------------------------------------------
// 0.6 COURSE SUMMARY TO BOTTOM SWAP (COURSE PAGE)
// -------------------------------------------------------------
let currentCourseSummaryToBottom = false;

function findCourseSummaryAndTasks() {
    let summaryWrapper = document.querySelector('div[style*="margin-top: 20px"][style*="width: max-content"]');

    if (!summaryWrapper) {
        const headers = document.querySelectorAll('.card-header, .panel-heading');
        for (const header of headers) {
            if (/course\s+summary/i.test((header.textContent || '').trim())) {
                const card = header.closest('.card, .panel');
                if (card) {
                    summaryWrapper = (card.parentElement && card.parentElement.tagName === 'DIV' && !card.parentElement.classList.contains('col-md-9'))
                        ? card.parentElement
                        : card;
                }
                break;
            }
        }
    }

    if (!summaryWrapper || !summaryWrapper.parentElement) return null;

    const parent = summaryWrapper.parentElement;
    const assignmentList = document.getElementById('assignment_list');
    let tasksRow = assignmentList ? assignmentList.closest('div.row') : null;

    if (!tasksRow || tasksRow.parentElement !== parent) {
        tasksRow = parent.querySelector(':scope > div.row[style*="margin-top: 10px"], :scope > div.row');
    }

    if (!tasksRow || tasksRow.parentElement !== parent || tasksRow === summaryWrapper) {
        return null;
    }

    return {
        parent,
        summaryEl: summaryWrapper,
        tasksEl: tasksRow
    };
}

function applyCourseSummaryPosition(toBottom) {
    currentCourseSummaryToBottom = Boolean(toBottom);
    const found = findCourseSummaryAndTasks();
    if (!found) return;

    const { parent, summaryEl, tasksEl } = found;

    // DOCUMENT_POSITION_FOLLOWING (4) means tasksEl is currently after summaryEl
    const isSummaryBeforeTasks = Boolean(
        summaryEl.compareDocumentPosition(tasksEl) & Node.DOCUMENT_POSITION_FOLLOWING
    );

    if (currentCourseSummaryToBottom && isSummaryBeforeTasks) {
        // Swap: place tasks row before Course summary so Course summary is at the bottom
        parent.insertBefore(tasksEl, summaryEl);
    } else if (!currentCourseSummaryToBottom && !isSummaryBeforeTasks) {
        // Restore original order: place Course summary before tasks row
        parent.insertBefore(summaryEl, tasksEl);
    }
}

function initCourseSummaryPosition() {
    readStorage(['courseSummaryToBottom']).then((result) => {
        applyCourseSummaryPosition(result.courseSummaryToBottom);
    });
}

initCourseSummaryPosition();

// -------------------------------------------------------------
// 1. PLAGIAT INCIDENT DETECTION & DOM REMOVAL
// -------------------------------------------------------------
const PLAGIAT_REGEX = /(?:plagi[aá]t|plagiarism)/i;

function findPlagiatElements() {
    const candidates = [];

    // 1. Direct modal target / href selector (Bootstrap 3 data-target & Bootstrap 5 data-bs-target)
    const directTargets = document.querySelectorAll(
        'a[data-target="#plagiatModal"], a[data-target*="plagiat" i], ' +
        'a[data-bs-target="#plagiatModal"], a[data-bs-target*="plagiat" i], ' +
        'a[href*="#plagiatModal"], ' +
        '[data-toggle="modal"][data-target*="plagiat" i], ' +
        '[data-bs-toggle="modal"][data-bs-target*="plagiat" i]'
    );
    directTargets.forEach(el => {
        if (!candidates.includes(el)) candidates.push(el);
    });

    // 2. Navbar items with Czech / English text or title matching Plagiat
    const navbarElements = document.querySelectorAll(
        '.navbar a, .navbar-brand, nav a, .nav a, .navbar-nav > li > a, .navbar-nav .nav-item > a, .navbar-nav .nav-link'
    );
    navbarElements.forEach(link => {
        const text = (link.textContent || '').trim();
        const title = link.getAttribute('title') || '';
        const ariaLabel = link.getAttribute('aria-label') || '';
        const style = link.getAttribute('style') || '';
        const isModalTrigger = link.getAttribute('data-toggle') === 'modal' || link.getAttribute('data-bs-toggle') === 'modal';

        if (PLAGIAT_REGEX.test(text) || PLAGIAT_REGEX.test(title) || PLAGIAT_REGEX.test(ariaLabel)) {
            if (!candidates.includes(link)) candidates.push(link);
        } else if (
            (style.includes('yellow') || link.classList.contains('text-warning') || link.classList.contains('text-bg-warning')) &&
            isModalTrigger
        ) {
            if (!candidates.includes(link)) candidates.push(link);
        }
    });

    return candidates;
}

function setPlagiatBannerVisibility(banner, shouldHide) {
    if (!banner) return;
    banner.dataset.brutePlagiatProcessed = 'true';
    const targetEl = (banner.parentElement && banner.parentElement.tagName === 'LI' && banner.parentElement.children.length === 1)
        ? banner.parentElement
        : banner;
    targetEl.classList.toggle('brute-plagiat-hidden', Boolean(shouldHide));
}

function processPlagiatDetection() {
    const plagiatBanners = findPlagiatElements();
    const plagiatModal = document.querySelector('#plagiatModal, [id*="plagiat" i]');

    if (plagiatBanners.length === 0 && !plagiatModal) {
        return;
    }

    console.log(`[BRUTE Ext] Plagiat indicator detected (${plagiatBanners.length} banners, modal found: ${!!plagiatModal})`);

    let incidentTitle = 'Plagiat incident';
    let incidentDetails = '';

    if (plagiatBanners.length > 0) {
        const banner = plagiatBanners[0];
        incidentTitle = banner.getAttribute('title') || banner.textContent.trim() || 'Plagiat incident';
    }

    if (plagiatModal) {
        plagiatModal.dataset.brutePlagiatProcessed = 'true';
        const modalTitle = plagiatModal.querySelector('.modal-title, .modal-header');
        const modalBody = plagiatModal.querySelector('.modal-body');
        if (modalTitle && modalTitle.textContent.trim()) {
            incidentTitle = modalTitle.textContent.trim();
        }
        if (modalBody && modalBody.innerText.trim()) {
            incidentDetails = modalBody.innerText.trim();
        }
    }

    if (storage) {
        readStorage(['plagiatIncident', 'hidePlagiatBanner']).then(result => {
            const existing = result.plagiatIncident || {};
            const shouldHide = result.hidePlagiatBanner !== false; // Default: true (auto-hide)

            const incidentData = {
                hasIncident: true,
                title: incidentTitle,
                details: incidentDetails || existing.details || 'Plagiat warning banner detected on BRUTE navbar.',
                courseUrl: window.location.href,
                pageTitle: document.title || 'BRUTE',
                lastDetectedAt: new Date().toISOString(),
                historyCount: (existing.historyCount || 0) + (existing.hasIncident ? 0 : 1)
            };
            writeStorage({ plagiatIncident: incidentData });

            plagiatBanners.forEach(banner => {
                setPlagiatBannerVisibility(banner, shouldHide);
            });
        }).catch(err => {
            console.error("[BRUTE Ext] Failed to record plagiat incident in storage:", err);
        });
    } else {
        plagiatBanners.forEach(banner => {
            setPlagiatBannerVisibility(banner, true);
        });
    }
}

// Initial detection
processPlagiatDetection();

// Dynamic DOM observation for dynamically inserted elements, panels & cards
let lastDangerBadgeCount = -1;

function countCourseDangerBadges() {
    return document.querySelectorAll(
        'a.list-group-item .badge.text-bg-danger, a.list-group-item .label-danger'
    ).length;
}

const pageObserver = new MutationObserver(() => {
    const hasUnprocessedFooter = Array.from(document.querySelectorAll('footer, .footer'))
        .some(el => !el.dataset.bruteFooterProcessed);
    if (hasUnprocessedFooter) {
        updateFooterBranding();
    }

    if (currentCourseSummaryToBottom) {
        applyCourseSummaryPosition(true);
    }

    const hasUnprocessedPlagiat = findPlagiatElements().some(el => !el.dataset.brutePlagiatProcessed);
    if (hasUnprocessedPlagiat) {
        processPlagiatDetection();
    }

    const summaryTable = findCourseSummaryTable();
    const summaryChanged = Boolean(
        summaryTable &&
        summaryTable.dataset.bruteSummarySnapshot !== (summaryTable.textContent || '').trim()
    );

    const currentDangerCount = countCourseDangerBadges();
    const dangerBadgesChanged = (lastDangerBadgeCount !== -1 && currentDangerCount !== lastDangerBadgeCount);

    const uninitializedPanels = Array.from(document.querySelectorAll(PANEL_SELECTOR))
        .some(p => p.querySelector(HEADING_SELECTOR) && p.querySelector('a.list-group-item') && !p.querySelector('.brute-master-toggle-btn'));
    if (uninitializedPanels || summaryChanged || dangerBadgesChanged) {
        initTaskPanels();
    }
});

if (document.body) {
    applyClassicUiStyle(document.documentElement.classList.contains('brute-classic-ui'));
    pageObserver.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        initClassicUiStyle();
        initCourseSummaryPosition();
        updateFooterBranding();
        processPlagiatDetection();
        initTaskPanels();
        if (document.body) {
            pageObserver.observe(document.body, { childList: true, subtree: true });
        }
    });
}

// -------------------------------------------------------------
// 2. DEADLINE TASK MANAGEMENT & COURSE SUMMARY AUTO-COMPLETION
// -------------------------------------------------------------

let cachedShowGreenCheckmarks = true;
let cachedAutoDetectCompletion = true;
let cachedAutoCompleteRemovedX = true;
let cachedShowCompletionToast = true;
let cachedHideNewTaskBadge = false;
let cachedEnablePartyMode = true;
let cachedPartyModeOnMinScore = false;

// Tracks tasks that were newly discovered for the very first time during this page visit.
// On the next refresh or next visit to BRUTE, they will already be saved in bruteTasks, so NEW disappears.
const newlyDiscoveredTaskKeys = new Set();

function getToastContainer() {
    if (!document.body) return null;
    let container = document.getElementById('brute-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'brute-toast-container';
        container.className = 'brute-toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function showCompletionToast(taskLabel, isParty = false, scoreText = '') {
    if (!cachedShowCompletionToast) return;
    if (!taskLabel) return;
    const container = getToastContainer();
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = isParty ? 'brute-toast-item brute-toast-party' : 'brute-toast-item';
    toast.textContent = isParty
        ? `🎉🎉🎉 [${taskLabel}] ${scoreText ? `— ${scoreText} ` : ''} COMPLETED! 🎉🎉🎉`
        : `[${taskLabel}] - COMPLETED ✅`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('brute-toast-visible');
    });

    const duration = isParty ? 8500 : 4000;
    setTimeout(() => {
        toast.classList.remove('brute-toast-visible');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

function showNewTaskToast(taskLabel, isSummary = false) {
    if (!cachedShowCompletionToast) return;
    if (!taskLabel) return;
    const container = getToastContainer();
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'brute-toast-item brute-toast-new';
    toast.textContent = isSummary
        ? `🆕 ${taskLabel}`
        : `[${taskLabel}] - NEW TASK 🆕`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('brute-toast-visible');
    });

    setTimeout(() => {
        toast.classList.remove('brute-toast-visible');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4500);
}

function formatNewTaskLabel(item, taskKey, fallbackLabel = '') {
    const label = item ? getCourseItemCleanTitle(item) : (fallbackLabel || '');
    const m = (taskKey || '').match(/\/brute\/student\/course\/([^/]+)\/([^/]+)$/i);
    if (!label && m) {
        return `${m[1]} - ${m[2]}`;
    }
    if (label && m && !label.toUpperCase().includes(m[1].toUpperCase())) {
        return `${m[1]} - ${label}`;
    }
    return label || taskKey;
}

// -------------------------------------------------------------
// 2.1 PARTY MODE: DISCO LIGHTS & 60FPS CANVAS PARTICLE ENGINE
// -------------------------------------------------------------
const PARTY_MODE_DURATION_MS = 8500; // 8.5 seconds (8s +- 1s)
let activePartyCleanupTimer = null;
let activePartyAnimFrame = null;

function launchPartyParticles(originElements = []) {
    if (!document.body) return;

    const existingCanvas = document.getElementById('brute-party-canvas');
    if (existingCanvas) existingCanvas.remove();
    if (activePartyAnimFrame) cancelAnimationFrame(activePartyAnimFrame);

    const canvas = document.createElement('canvas');
    canvas.id = 'brute-party-canvas';
    canvas.style.cssText = [
        'position: fixed !important',
        'top: 0 !important',
        'left: 0 !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'pointer-events: none !important',
        'z-index: 2147483646 !important'
    ].join(';');
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resizeCanvas() {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();

    const palette = [
        '#ff007f', '#00f5d4', '#ffea00', '#7928ca',
        '#00d2ff', '#00e676', '#ff4d00', '#ff85a1', '#ffffff'
    ];

    const particles = [];

    function createParticle(x, y, vx, vy, shape) {
        return {
            x,
            y,
            vx,
            vy,
            gravity: 0.16 + Math.random() * 0.12,
            drag: 0.986,
            size: 6 + Math.random() * 7,
            color: palette[Math.floor(Math.random() * palette.length)],
            shape: shape || (Math.random() < 0.55 ? 'ribbon' : (Math.random() < 0.5 ? 'orb' : 'star')),
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.22,
            tilt: Math.random() * Math.PI * 2,
            tiltSpeed: 0.08 + Math.random() * 0.14,
            alpha: 1,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.05 + Math.random() * 0.08
        };
    }

    function spawnCannonAndOriginBurst(countPerCannon = 65, countPerOrigin = 40) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 1. Left & right bottom disco cannons
        for (let i = 0; i < countPerCannon; i++) {
            const speedL = 11 + Math.random() * 14;
            const angleL = -Math.PI * (0.25 + Math.random() * 0.22);
            particles.push(createParticle(
                20 + Math.random() * 40,
                vh - 10,
                Math.cos(angleL) * speedL,
                Math.sin(angleL) * speedL
            ));

            const speedR = 11 + Math.random() * 14;
            const angleR = -Math.PI * (0.53 + Math.random() * 0.22);
            particles.push(createParticle(
                vw - 20 - Math.random() * 40,
                vh - 10,
                Math.cos(angleR) * speedR,
                Math.sin(angleR) * speedR
            ));
        }

        // 2. Radial burst directly from the Upcoming Deadlines / Course Summary target elements
        originElements.forEach((el) => {
            if (!el || typeof el.getBoundingClientRect !== 'function') return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            for (let i = 0; i < countPerOrigin; i++) {
                const ang = Math.random() * Math.PI * 2;
                const spd = 4 + Math.random() * 10;
                particles.push(createParticle(
                    cx + (Math.random() - 0.5) * Math.min(rect.width, 160),
                    cy,
                    Math.cos(ang) * spd,
                    Math.sin(ang) * spd - 3
                ));
            }
        });
    }

    spawnCannonAndOriginBurst(65, 40);

    const startTime = performance.now();
    const totalDuration = PARTY_MODE_DURATION_MS; // 8.5 seconds
    let secondWaveFired = false;

    function drawStar(cx, cy, spikes, outerR, innerR) {
        let rot = (Math.PI / 2) * 3;
        const step = Math.PI / spikes;
        ctx.beginPath();
        ctx.moveTo(cx, cy - outerR);
        for (let i = 0; i < spikes; i++) {
            ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
            rot += step;
            ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
            rot += step;
        }
        ctx.closePath();
        ctx.fill();
    }

    function animate(now) {
        const elapsed = now - startTime;
        if (elapsed >= totalDuration) {
            canvas.remove();
            activePartyAnimFrame = null;
            return;
        }

        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        // Fire a second celebratory wave of bottom cannons + target radial burst at 3.3s
        if (!secondWaveFired && elapsed >= 3300) {
            secondWaveFired = true;
            spawnCannonAndOriginBurst(45, 28);
        }

        // Spawn continuous top disco rain during the first 7.0 seconds
        if (elapsed < 7000 && particles.length < 300 && Math.random() < 0.65) {
            for (let k = 0; k < 3; k++) {
                particles.push(createParticle(
                    Math.random() * window.innerWidth,
                    -15,
                    (Math.random() - 0.5) * 4,
                    2 + Math.random() * 4.5
                ));
            }
        }

        const globalFade = elapsed > 7200 ? Math.max(0, 1 - (elapsed - 7200) / 1300) : 1;

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.vx *= p.drag;
            p.vy = p.vy * p.drag + p.gravity;
            p.wobble += p.wobbleSpeed;
            p.x += p.vx + Math.sin(p.wobble) * 1.1;
            p.y += p.vy;
            p.angle += p.spin;
            p.tilt += p.tiltSpeed;

            if (p.y > window.innerHeight + 60) {
                particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = p.alpha * globalFade;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);

            if (p.shape === 'orb') {
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 12;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.shape === 'star') {
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 10;
                ctx.fillStyle = p.color;
                drawStar(0, 0, 4, p.size * 0.85, p.size * 0.35);
            } else {
                const scaleY = Math.cos(p.tilt);
                ctx.scale(1, scaleY);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
            }

            ctx.restore();
        }

        activePartyAnimFrame = requestAnimationFrame(animate);
    }

    activePartyAnimFrame = requestAnimationFrame(animate);
}

function triggerPartyMode(taskKey, taskLabel, numericScore, maxScore, extraElements = []) {
    if (!cachedEnablePartyMode) return;

    const discoTargets = new Set(extraElements.filter(Boolean));

    // Find matching task items in Upcoming deadlines, Missed deadlines, and course cards
    document.querySelectorAll('a.list-group-item').forEach((item) => {
        const key = getTaskKey(item);
        if (key && taskKey && key.toLowerCase() === taskKey.toLowerCase()) {
            discoTargets.add(item);
        }
    });

    // Also highlight matching accordion header button if on course page
    const shortCode = taskKey ? taskKey.split('/').pop() : '';
    if (shortCode) {
        const buttons = document.querySelectorAll(
            '#assignment_list button.accordion-button, #assignment_list .panel-heading a, #assignment_list .accordion-toggle'
        );
        buttons.forEach((btn) => {
            const cleanText = (btn.dataset.bruteOriginalText || btn.textContent || '').replace(/^\s*✅\s*/, '').trim();
            const code = extractTaskCodeFromTitle(cleanText);
            if (code && code.toLowerCase() === shortCode.toLowerCase()) {
                discoTargets.add(btn);
            }
        });
    }

    const targetArray = Array.from(discoTargets);
    targetArray.forEach((el) => {
        el.classList.add('brute-party-disco-item');
    });

    // Scroll the Upcoming Deadlines item into view smoothly if off-screen
    const upcomingItem = targetArray.find(el => el.matches && el.matches('a.list-group-item'));
    if (upcomingItem && typeof upcomingItem.getBoundingClientRect === 'function') {
        const r = upcomingItem.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) {
            upcomingItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    const scoreDisplay = (typeof numericScore === 'number' && typeof maxScore === 'number' && maxScore > 0)
        ? `${numericScore}/${maxScore} pts`
        : '';
    showCompletionToast(taskLabel || shortCode || taskKey, true, scoreDisplay);
    launchPartyParticles(targetArray);

    if (activePartyCleanupTimer) {
        clearTimeout(activePartyCleanupTimer);
    }
    activePartyCleanupTimer = setTimeout(() => {
        document.querySelectorAll('.brute-party-disco-item').forEach((el) => {
            el.classList.remove('brute-party-disco-item');
        });
        activePartyCleanupTimer = null;
    }, PARTY_MODE_DURATION_MS);
}

// Score is valid/completed when it is NOT empty, NOT "XX", has NO "!!", and is NOT "0"
function isCourseSummaryScoreCompleted(scoreText) {
    const raw = (scoreText || '').trim();
    if (!raw) return false;
    if (/xx/i.test(raw)) return false;
    if (raw.includes('!!')) return false;
    if (/^[+-]?0+(?:[.,]0+)?$/.test(raw)) return false;
    return true;
}

// Evaluates exact Party Mode threshold rules:
// - Never triggers if maxScore <= 0 (e.g. <0, 0> even if user gets 3 points)
// - Must be completed (no XX, no !!, score > 0)
// - If partyModeOnMinScore is enabled: numericScore >= minScore
// - Otherwise: numericScore >= maxScore (e.g. 35 on <18, 35>, or 7 or 10 on <2, 7>)
function doesTaskQualifyForParty(detail, partyModeOnMinScore) {
    if (!detail || !detail.isCompleted) return false;
    if (typeof detail.maxScore !== 'number' || detail.maxScore <= 0) return false;
    if (typeof detail.numericScore !== 'number' || Number.isNaN(detail.numericScore) || detail.numericScore <= 0) return false;

    if (partyModeOnMinScore) {
        return detail.numericScore >= detail.minScore;
    }
    return detail.numericScore >= detail.maxScore;
}

function findCourseSummaryTable() {
    const headers = document.querySelectorAll('.card-header, .panel-heading');
    for (const header of headers) {
        if (/course\s+summary/i.test((header.textContent || '').trim())) {
            const card = header.closest('.card, .panel');
            if (card) {
                const table = card.querySelector('table');
                if (table) return table;
            }
        }
    }
    const wrapper = document.querySelector('div[style*="margin-top: 20px"][style*="width: max-content"]');
    return wrapper ? wrapper.querySelector('table') : null;
}

function getCourseIdentifiersOnPage() {
    const identifiers = [];

    // 1. Header h3: e.g. "B6B36PCC - Programování v C/C++"
    const headerH3 = document.querySelector('header h3, .col-md-9 h3, .col-md-8 h3');
    if (headerH3) {
        const m = (headerH3.textContent || '').trim().match(/^([^\s-]+)\s*-/);
        if (m && m[1]) {
            identifiers.push(m[1].trim());
        }
    }

    // 2. URL pathname: e.g. /brute/student/course/B6B36PCC or /brute/student/course/B6B36PCC/INIT_B
    const pathMatch = (window.location.pathname || '').match(/\/brute\/student\/course\/([^/?#]+)/i);
    if (pathMatch && pathMatch[1] && !identifiers.includes(pathMatch[1])) {
        identifiers.push(pathMatch[1]);
    }

    // 3. Hidden course ID input inside #assignment_list: e.g. <input type="HIDDEN" name="id" value="1916">
    const hiddenIdInput = document.querySelector('#assignment_list input[name="id"], form[action*="course.php"] input[name="id"]');
    if (hiddenIdInput && hiddenIdInput.value && !identifiers.includes(hiddenIdInput.value.trim())) {
        identifiers.push(hiddenIdInput.value.trim());
    }

    return {
        primaryCode: identifiers[0] || '',
        identifiers
    };
}

function parseCourseSummary() {
    const table = findCourseSummaryTable();
    if (!table) return null;

    table.dataset.bruteSummarySnapshot = (table.textContent || '').trim();

    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    const bodyRow = table.querySelector('tbody tr') || table.querySelectorAll('tr')[1];
    if (!headerRow || !bodyRow) return null;

    const headerCells = Array.from(headerRow.children);
    const bodyCells = Array.from(bodyRow.children);
    const tasks = {};
    const taskDetails = {};

    const count = Math.min(headerCells.length, bodyCells.length);
    for (let i = 0; i < count; i++) {
        const hCell = headerCells[i];
        const bCell = bodyCells[i];
        if (!hCell || !bCell) continue;
        if (hCell.tagName === 'TH' || bCell.tagName === 'TH') continue;

        const boldSpan = hCell.querySelector('span[style*="bold"], strong, b') || hCell.querySelector('span');
        const taskCode = (boldSpan ? boldSpan.textContent : (hCell.textContent || '').split('\n')[0]).trim();
        if (!taskCode || /^sum$/i.test(taskCode)) continue;

        const rangeMatch = (hCell.textContent || '').match(/<\s*([+-]?\d+(?:[.,]\d+)?)\s*,\s*([+-]?\d+(?:[.,]\d+)?)\s*>/);
        const minScore = rangeMatch ? parseFloat(rangeMatch[1].replace(',', '.')) : 0;
        const maxScore = rangeMatch ? parseFloat(rangeMatch[2].replace(',', '.')) : 0;

        const scoreText = (bCell.textContent || '').trim();
        const hasValidScore = isCourseSummaryScoreCompleted(scoreText);
        const numMatch = scoreText.match(/[+-]?\d+(?:[.,]\d+)?/);
        const numericScore = (hasValidScore && numMatch) ? parseFloat(numMatch[0].replace(',', '.')) : null;

        const detail = {
            taskCode,
            isCompleted: hasValidScore,
            scoreText,
            numericScore: (numericScore !== null && !Number.isNaN(numericScore)) ? numericScore : null,
            minScore: Number.isNaN(minScore) ? 0 : minScore,
            maxScore: Number.isNaN(maxScore) ? 0 : maxScore,
            headerCell: hCell,
            bodyCell: bCell
        };
        const qualifies = doesTaskQualifyForParty(detail, cachedPartyModeOnMinScore);
        detail.qualifies = qualifies;

        tasks[taskCode] = qualifies;
        taskDetails[taskCode] = detail;
    }

    const courseInfo = getCourseIdentifiersOnPage();
    return {
        table,
        tasks,
        taskDetails,
        primaryCode: courseInfo.primaryCode,
        identifiers: courseInfo.identifiers
    };
}

function extractTaskCodeFromTitle(cleanText) {
    if (!cleanText) return '';
    const trimmed = cleanText.replace(/^\s*✅\s*/, '').trim();
    const dashMatch = trimmed.match(/^(.+?)\s+-\s+/);
    if (dashMatch && dashMatch[1]) {
        return dashMatch[1].trim();
    }
    return trimmed.split(/\s+/)[0].trim();
}

function getAccordionTaskFullTitle(taskCode, fallbackCourseCode) {
    const buttons = document.querySelectorAll(
        '#assignment_list button.accordion-button, #assignment_list .panel-heading a, #assignment_list .accordion-toggle'
    );
    for (const btn of buttons) {
        const cleanText = (btn.dataset.bruteOriginalText || btn.textContent || '').replace(/^\s*✅\s*/, '').trim();
        const code = extractTaskCodeFromTitle(cleanText);
        if (code && code.toLowerCase() === taskCode.toLowerCase()) {
            return cleanText;
        }
    }
    return fallbackCourseCode ? `${fallbackCourseCode} - ${taskCode}` : taskCode;
}

function resolveCourseTaskKey(taskCode, courseInfo, existingTasks) {
    if (!taskCode) return '';
    const escapedTask = taskCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const endRegex = new RegExp(`/${escapedTask}$`, 'i');

    // 1. Check any a.list-group-item on the page matching this course & task
    const pageItems = document.querySelectorAll('a.list-group-item');
    for (const item of pageItems) {
        const key = getTaskKey(item);
        if (!key || !endRegex.test(key)) continue;
        if (courseInfo && courseInfo.identifiers.length > 0) {
            const matchesCourse = courseInfo.identifiers.some(id => key.includes(`/${id}/`));
            if (matchesCourse) return key;
        } else {
            return key;
        }
    }

    // 2. Check existing keys in bruteTasks
    if (existingTasks && courseInfo && courseInfo.identifiers.length > 0) {
        for (const id of courseInfo.identifiers) {
            const candidate = `/brute/student/course/${id}/${taskCode}`;
            if (existingTasks[candidate]) return candidate;
        }
    }

    // 3. Default canonical path
    const code = (courseInfo && courseInfo.primaryCode) ? courseInfo.primaryCode : '';
    return code ? `/brute/student/course/${code}/${taskCode}` : '';
}

function updateAssignmentAccordionCheckmarks(summaryData, tasksMap, showGreenCheckmarks, autoDetectCompletion) {
    const buttons = document.querySelectorAll(
        '#assignment_list button.accordion-button, #assignment_list .panel-heading a, #assignment_list .accordion-toggle'
    );
    if (buttons.length === 0) return;

    const courseInfo = summaryData || getCourseIdentifiersOnPage();
    const map = tasksMap || {};

    buttons.forEach(btn => {
        if (typeof btn.dataset.bruteOriginalText !== 'string') {
            btn.dataset.bruteOriginalText = (btn.textContent || '').replace(/^\s*✅\s*/, '').trim();
        }
        const cleanText = btn.dataset.bruteOriginalText;
        const taskCode = extractTaskCodeFromTitle(cleanText);
        if (!taskCode) return;

        const taskKey = resolveCourseTaskKey(taskCode, courseInfo, map);
        const isDoneInTasks = Boolean(taskKey && map[taskKey] === 'done');
        const isDoneInSummary = Boolean(summaryData && summaryData.tasks && summaryData.tasks[taskCode] === true);

        const isCompleted = isDoneInTasks || (Boolean(autoDetectCompletion) && isDoneInSummary);
        const shouldShow = Boolean(showGreenCheckmarks && isCompleted);
        const desiredText = shouldShow ? `✅ ${cleanText}` : cleanText;

        if ((btn.textContent || '').trim() !== desiredText) {
            btn.textContent = desiredText;
        }
    });
}

// Identifies course card task rows on index.php (excluding Upcoming/Missed deadlines sidebar items)
function isCourseCardTaskItem(item) {
    if (!item) return false;
    if (item.closest('.tab-pane')) return true;
    if (item.closest('.card-warning, .panel-warning, .card-danger, .panel-danger')) return false;
    if (item.querySelector(':scope > span.d-md-none, :scope > span.d-lg-none, :scope > span.hidden-md, :scope > span.visible-md')) return false;
    return true;
}

function getCourseItemCleanTitle(item) {
    if (!item) return '';
    const textNodes = Array.from(item.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (textNodes) return textNodes;
    const firstSpan = item.querySelector('span > span');
    return firstSpan ? (firstSpan.textContent || '').trim() : (item.textContent || '').trim();
}

function applyState(item, state) {
    item.classList.remove('brute-item-done', 'brute-item-todo', 'brute-item-cancel', 'brute-item-highlight');
    if (STATE_STYLES[state] && STATE_STYLES[state].class) {
        item.classList.add(STATE_STYLES[state].class);
    }
}

// Extract canonical task key (e.g. pathname) so tasks shared across panels (Upcoming vs Missed vs Course card) sync together
function getTaskKey(item) {
    if (!item) return '';
    const rawHref = item.getAttribute('href') || '';
    if (!rawHref) return '';

    try {
        if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
            const parsed = new URL(rawHref);
            return parsed.pathname;
        }
    } catch (e) {}

    if (item.href) {
        try {
            const parsed = new URL(item.href);
            return parsed.pathname;
        } catch (e) {}
    }

    return rawHref;
}

function isTaskAlreadySeen(tasks, seenTasks, item, taskKey) {
    const rawHref = item ? (item.getAttribute('href') || '') : '';
    const canonicalKey = taskKey || (item ? getTaskKey(item) : '');
    const fullHref = item ? (item.href || '') : '';

    const inMap = (map) => {
        if (!map || typeof map !== 'object') return false;
        return Boolean(
            (canonicalKey && Object.prototype.hasOwnProperty.call(map, canonicalKey)) ||
            (fullHref && Object.prototype.hasOwnProperty.call(map, fullHref)) ||
            (rawHref && Object.prototype.hasOwnProperty.call(map, rawHref))
        );
    };

    return inMap(seenTasks) || inMap(tasks);
}

// Find existing state with fallbacks for backwards compatibility
function resolveTaskState(tasks, item) {
    if (!tasks || !item) return { key: '', state: 'default' };
    const rawHref = item.getAttribute('href') || '';
    const canonicalKey = getTaskKey(item);
    const fullHref = item.href || '';

    // 1. Check canonical pathname
    if (canonicalKey && tasks[canonicalKey]) {
        return { key: canonicalKey, state: tasks[canonicalKey] };
    }
    // 2. Check full URL
    if (fullHref && tasks[fullHref]) {
        return { key: canonicalKey || fullHref, state: tasks[fullHref] };
    }
    // 3. Check raw href attribute
    if (rawHref && tasks[rawHref]) {
        return { key: canonicalKey || rawHref, state: tasks[rawHref] };
    }

    return { key: canonicalKey || rawHref, state: 'default' };
}

function getItemWrappers(item) {
    const wrappers = Array.from(
        item.querySelectorAll(':scope > span.hidden-md, :scope > span.visible-md, :scope > span.d-md-none, :scope > span.d-lg-none')
    );
    return wrappers.length > 0 ? wrappers : [item];
}

function syncNewBadgeForItem(item, taskKey) {
    const isNew = Boolean(taskKey && newlyDiscoveredTaskKeys.has(taskKey));
    const wrappers = getItemWrappers(item);

    wrappers.forEach(wrapper => {
        let newBadge = wrapper.querySelector('.brute-new-badge');
        if (isNew) {
            if (!newBadge) {
                newBadge = document.createElement('span');
                newBadge.className = 'badge brute-new-badge';
                newBadge.textContent = 'NEW';
                newBadge.title = 'Newly discovered task';

                const refEl = wrapper.querySelector('.brute-state-btn, .badge:not(.brute-new-badge), .label');
                if (refEl && refEl.parentElement) {
                    refEl.parentElement.insertBefore(newBadge, refEl);
                } else {
                    wrapper.appendChild(newBadge);
                }
            }
            newBadge.classList.toggle('brute-hidden', Boolean(cachedHideNewTaskBadge));
        } else if (newBadge) {
            newBadge.remove();
        }
    });
}

function syncAllTaskItemsOnPage(tasks) {
    const taskMap = tasks || {};
    document.querySelectorAll('a.list-group-item').forEach(item => {
        const { key, state } = resolveTaskState(taskMap, item);
        if (!key) return;
        applyState(item, state);
        item.querySelectorAll('.brute-state-btn').forEach(b => {
            b.textContent = (STATE_STYLES[state] || STATE_STYLES['default']).icon;
        });
        syncNewBadgeForItem(item, key);
    });

    const summaryData = parseCourseSummary();
    updateAssignmentAccordionCheckmarks(summaryData, taskMap, cachedShowGreenCheckmarks, cachedAutoDetectCompletion);
}

// Tracks tasks evaluated during this page load so re-runs of initTaskPanels on the same page don't alter NEW status
const processedTaskKeysThisVisit = new Set();
const sessionPartyTriggeredKeys = new Set();

function initTaskPanels() {
    if (!storage) return;

    lastDangerBadgeCount = countCourseDangerBadges();

    // Find all Bootstrap 3 panels and Bootstrap 5 cards on page
    const panels = Array.from(document.querySelectorAll(PANEL_SELECTOR))
        .filter((panel, index, self) => self.indexOf(panel) === index);

    readStorage([
        'bruteTasks',
        'bruteSeenTasks',
        'bruteAutoCompleted',
        'bruteDangerTasks',
        'brutePartyTriggered',
        'autoDetectCompletion',
        'autoCompleteRemovedX',
        'showCompletionToast',
        'showGreenCheckmarks',
        'hideNewTaskBadge',
        'enablePartyMode',
        'partyModeOnMinScore'
    ]).then((result) => {
        let tasks = result.bruteTasks || {};
        let updatedTasks = { ...tasks };
        let seenTasks = { ...(result.bruteSeenTasks || {}) };
        let autoCompleted = { ...(result.bruteAutoCompleted || {}) };
        let dangerTasks = { ...(result.bruteDangerTasks || {}) };
        let partyTriggered = { ...(result.brutePartyTriggered || {}) };
        let hasChanges = false;
        let seenTasksChanged = false;
        let autoCompletedChanged = false;
        let dangerTasksChanged = false;
        let partyTriggeredChanged = false;

        cachedAutoDetectCompletion = result.autoDetectCompletion !== false;
        cachedAutoCompleteRemovedX = result.autoCompleteRemovedX !== false;
        cachedShowCompletionToast = result.showCompletionToast !== false;
        cachedShowGreenCheckmarks = result.showGreenCheckmarks !== false;
        cachedHideNewTaskBadge = Boolean(result.hideNewTaskBadge);
        cachedEnablePartyMode = result.enablePartyMode !== false;
        cachedPartyModeOnMinScore = Boolean(result.partyModeOnMinScore);

        const courseCardItemsByKey = new Map();
        const newlyDiscoveredThisRun = new Map();

        panels.forEach((panel, panelIndex) => {
            const heading = panel.querySelector(HEADING_SELECTOR);
            const items = panel.querySelectorAll(ITEM_SELECTOR);

            if (!heading || items.length === 0) {
                return;
            }

            console.log(`[BRUTE Ext] Processing Container ${panelIndex}: '${heading.innerText.trim()}' with ${items.length} items.`);

            // Add master toggle button to panel/card header if not present
            if (!heading.querySelector('.brute-master-toggle-btn')) {
                const masterBtn = document.createElement('button');
                masterBtn.type = 'button';
                masterBtn.className = 'brute-master-toggle-btn';
                masterBtn.innerText = '⚙️';
                masterBtn.title = 'Toggle Deadline State Controls';

                masterBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const stateBtns = panel.querySelectorAll('.brute-state-btn');

                    let isCurrentlyHidden = false;
                    stateBtns.forEach((btn, index) => {
                        if (index === 0) isCurrentlyHidden = btn.classList.contains('brute-hidden');
                        btn.classList.toggle('brute-hidden');
                    });

                    masterBtn.innerText = isCurrentlyHidden ? '✅ Done Editing' : '⚙️';
                });

                heading.appendChild(masterBtn);
            }

            items.forEach((item) => {
                const rawHref = item.getAttribute('href');
                if (!rawHref) return;

                const { key: taskKey, state: currentState } = resolveTaskState(updatedTasks, item);
                if (!taskKey) return;

                // Detect if this task was not in synced storage before this page visit (only once per page load)
                if (!processedTaskKeysThisVisit.has(taskKey)) {
                    processedTaskKeysThisVisit.add(taskKey);
                    if (!isTaskAlreadySeen(tasks, seenTasks, item, taskKey)) {
                        newlyDiscoveredTaskKeys.add(taskKey);
                        newlyDiscoveredThisRun.set(taskKey, formatNewTaskLabel(item, taskKey));
                    }
                }

                if (!seenTasks[taskKey]) {
                    seenTasks[taskKey] = 1;
                    seenTasksChanged = true;
                }

                if (!updatedTasks[taskKey]) {
                    updatedTasks[taskKey] = currentState;
                    hasChanges = true;
                }

                // Track red X badge (.badge.text-bg-danger.label-right) on course card task rows
                if (isCourseCardTaskItem(item)) {
                    const hasDangerBadge = Boolean(
                        item.querySelector('.badge.text-bg-danger.label-right, .badge.text-bg-danger, .label-danger[title*="Not accepted" i]')
                    );
                    const prevEntry = courseCardItemsByKey.get(taskKey);
                    courseCardItemsByKey.set(taskKey, {
                        hasDangerBadge: Boolean((prevEntry && prevEntry.hasDangerBadge) || hasDangerBadge),
                        title: (prevEntry && prevEntry.title) || getCourseItemCleanTitle(item)
                    });
                }

                applyState(item, currentState);

                const wrappers = getItemWrappers(item);

                wrappers.forEach(wrapper => {
                    if (wrapper.querySelector('.brute-state-btn')) return;

                    const badge = wrapper.querySelector('.badge:not(.brute-new-badge), .label');

                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'brute-state-btn brute-hidden';
                    btn.textContent = (STATE_STYLES[currentState] || STATE_STYLES['default']).icon;
                    btn.title = 'Change State';

                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        readStorage(['bruteTasks']).then((res) => {
                            let currentTasks = res.bruteTasks || {};
                            const { key: targetKey, state: curState } = resolveTaskState(currentTasks, item);
                            let nextIndex = (MODES.indexOf(curState) + 1) % MODES.length;
                            let nextState = MODES[nextIndex];

                            currentTasks[targetKey] = nextState;

                            // Clean up legacy alternative keys if present
                            const raw = item.getAttribute('href');
                            if (raw && raw !== targetKey && currentTasks[raw]) delete currentTasks[raw];
                            if (item.href && item.href !== targetKey && currentTasks[item.href]) delete currentTasks[item.href];

                            // Synchronize all matching items across all panels/cards on this page
                            syncAllTaskItemsOnPage(currentTasks);

                            writeStorage({ bruteTasks: currentTasks });
                        });
                    });

                    if (badge && badge.parentElement) {
                        badge.parentElement.insertBefore(btn, badge);
                    } else {
                        wrapper.appendChild(btn);
                    }
                });
            });
        });

        // 1. Process red X badge (.badge.text-bg-danger.label-right) tracking & auto-completion on index.php
        for (const [taskKey, info] of courseCardItemsByKey.entries()) {
            if (info.hasDangerBadge) {
                if (!dangerTasks[taskKey]) {
                    dangerTasks[taskKey] = true;
                    dangerTasksChanged = true;
                }
                if (autoCompleted[taskKey] === 'x') {
                    if (updatedTasks[taskKey] === 'done') {
                        updatedTasks[taskKey] = 'default';
                        hasChanges = true;
                    }
                    delete autoCompleted[taskKey];
                    autoCompletedChanged = true;
                }
            } else if (dangerTasks[taskKey]) {
                // Task previously had .badge.text-bg-danger.label-right and it disappeared!
                if (cachedAutoCompleteRemovedX) {
                    delete dangerTasks[taskKey];
                    dangerTasksChanged = true;

                    if (updatedTasks[taskKey] !== 'done') {
                        updatedTasks[taskKey] = 'done';
                        autoCompleted[taskKey] = 'x';
                        hasChanges = true;
                        autoCompletedChanged = true;
                        showCompletionToast(info.title || taskKey);
                    }
                }
            }
        }

        if (!cachedAutoCompleteRemovedX) {
            for (const [taskKey, source] of Object.entries(autoCompleted)) {
                if (source === 'x') {
                    if (updatedTasks[taskKey] === 'done') {
                        updatedTasks[taskKey] = 'default';
                        hasChanges = true;
                    }
                    delete autoCompleted[taskKey];
                    autoCompletedChanged = true;
                }
            }
        }

        // 2. Parse Course summary table (if on a course/task page) and apply automatic completion, checkmarks & Party Mode
        const summaryData = parseCourseSummary();
        const pendingPartyCelebrations = [];

        if (summaryData) {
            for (const [taskCode, isCompleted] of Object.entries(summaryData.tasks)) {
                const detail = summaryData.taskDetails ? summaryData.taskDetails[taskCode] : null;
                const taskKey = resolveCourseTaskKey(taskCode, summaryData, updatedTasks);
                if (!taskKey) continue;

                if (!processedTaskKeysThisVisit.has(taskKey)) {
                    processedTaskKeysThisVisit.add(taskKey);
                    if (!isTaskAlreadySeen(tasks, seenTasks, null, taskKey)) {
                        newlyDiscoveredTaskKeys.add(taskKey);
                        const fullTitle = getAccordionTaskFullTitle(taskCode, summaryData.primaryCode);
                        newlyDiscoveredThisRun.set(taskKey, formatNewTaskLabel(null, taskKey, fullTitle));
                    }
                }

                if (!seenTasks[taskKey]) {
                    seenTasks[taskKey] = 1;
                    seenTasksChanged = true;
                }

                if (!updatedTasks[taskKey]) {
                    updatedTasks[taskKey] = 'default';
                    hasChanges = true;
                }

                const qualifiesForParty = doesTaskQualifyForParty(detail, cachedPartyModeOnMinScore);
                const willTriggerPartyNow = Boolean(
                    cachedAutoDetectCompletion &&
                    cachedEnablePartyMode &&
                    qualifiesForParty &&
                    !partyTriggered[taskKey] &&
                    !sessionPartyTriggeredKeys.has(taskKey)
                );

                if (willTriggerPartyNow) {
                    partyTriggered[taskKey] = true;
                    sessionPartyTriggeredKeys.add(taskKey);
                    partyTriggeredChanged = true;
                    const fullTitle = getAccordionTaskFullTitle(taskCode, summaryData.primaryCode);
                    pendingPartyCelebrations.push({
                        taskKey,
                        fullTitle,
                        numericScore: detail.numericScore,
                        maxScore: detail.maxScore,
                        cells: [detail.headerCell, detail.bodyCell]
                    });
                }

                if (cachedAutoDetectCompletion && isCompleted) {
                    if (updatedTasks[taskKey] === 'default') {
                        updatedTasks[taskKey] = 'done';
                        autoCompleted[taskKey] = 'summary';
                        hasChanges = true;
                        autoCompletedChanged = true;
                        if (!willTriggerPartyNow || !cachedEnablePartyMode) {
                            const fullTitle = getAccordionTaskFullTitle(taskCode, summaryData.primaryCode);
                            showCompletionToast(fullTitle);
                        }
                    }
                } else if ((!cachedAutoDetectCompletion || !isCompleted) && (autoCompleted[taskKey] === 'summary' || autoCompleted[taskKey] === true)) {
                    if (updatedTasks[taskKey] === 'done') {
                        updatedTasks[taskKey] = 'default';
                        hasChanges = true;
                    }
                    delete autoCompleted[taskKey];
                    autoCompletedChanged = true;
                }
            }
        } else if (!cachedAutoDetectCompletion) {
            for (const [taskKey, source] of Object.entries(autoCompleted)) {
                if (source === 'summary' || source === true) {
                    if (updatedTasks[taskKey] === 'done') {
                        updatedTasks[taskKey] = 'default';
                        hasChanges = true;
                    }
                    delete autoCompleted[taskKey];
                    autoCompletedChanged = true;
                }
            }
        }

        // 3. Show toast notifications for newly discovered tasks
        if (newlyDiscoveredThisRun.size > 0) {
            const newLabels = Array.from(newlyDiscoveredThisRun.values());
            if (newLabels.length <= 4) {
                newLabels.forEach(lbl => showNewTaskToast(lbl));
            } else {
                newLabels.slice(0, 3).forEach(lbl => showNewTaskToast(lbl));
                showNewTaskToast(`+${newLabels.length - 3} more new tasks discovered!`, true);
            }
        }

        // Sync all deadline/task items, NEW badges, and #assignment_list accordion buttons on the page
        syncAllTaskItemsOnPage(updatedTasks);

        // Launch Party Mode celebrations after DOM states are synced
        if (cachedEnablePartyMode && pendingPartyCelebrations.length > 0) {
            pendingPartyCelebrations.forEach((p) => {
                triggerPartyMode(p.taskKey, p.fullTitle, p.numericScore, p.maxScore, p.cells);
            });
        }

        if (hasChanges || seenTasksChanged || autoCompletedChanged || dangerTasksChanged || partyTriggeredChanged) {
            const payload = {};
            if (hasChanges) payload.bruteTasks = updatedTasks;
            if (seenTasksChanged) payload.bruteSeenTasks = seenTasks;
            if (autoCompletedChanged) payload.bruteAutoCompleted = autoCompleted;
            if (dangerTasksChanged) payload.bruteDangerTasks = dangerTasks;
            if (partyTriggeredChanged) payload.brutePartyTriggered = partyTriggered;
            writeStorage(payload);
        }

        console.log("[BRUTE Ext] Task injection complete.");
    }).catch(err => {
        console.error("[BRUTE Ext] Storage error:", err);
    });
}

// -------------------------------------------------------------
// 3. DEBUG SIMULATOR: SWITCH RANDOM TASK XX -> MAX & PARTY MODE
// -------------------------------------------------------------
function simulateRandomTaskPartyMode() {
    const summaryData = parseCourseSummary();
    if (summaryData && summaryData.taskDetails) {
        const allDetails = Object.values(summaryData.taskDetails).filter(d => d.maxScore > 0);
        const xxCandidates = allDetails.filter(d => !d.isCompleted);
        const pool = xxCandidates.length > 0 ? xxCandidates : allDetails;

        if (pool.length === 0) {
            return { ok: false, reason: 'no-scorable-task' };
        }

        const chosen = pool[Math.floor(Math.random() * pool.length)];
        const taskKey = resolveCourseTaskKey(chosen.taskCode, summaryData, {});

        // Reset partyTriggered and task state for this simulated task so the real pipeline runs authentically
        readStorage(['bruteTasks', 'brutePartyTriggered', 'bruteAutoCompleted']).then((res) => {
            const tasks = { ...(res.bruteTasks || {}) };
            const party = { ...(res.brutePartyTriggered || {}) };
            const auto = { ...(res.bruteAutoCompleted || {}) };

            if (taskKey) {
                tasks[taskKey] = 'default';
                delete party[taskKey];
                delete auto[taskKey];
                sessionPartyTriggeredKeys.delete(taskKey);
            }

            return writeStorage({
                bruteTasks: tasks,
                brutePartyTriggered: party,
                bruteAutoCompleted: auto
            });
        }).then(() => {
            // Switch the DOM cell from XX / XX !! to maxScore -> triggers real detection & Party Mode!
            if (chosen.bodyCell) {
                chosen.bodyCell.textContent = String(chosen.maxScore);
            }
            if (summaryData.table) {
                summaryData.table.dataset.bruteSummarySnapshot = (summaryData.table.textContent || '').trim();
            }
            initTaskPanels();
        });
        return { ok: true, taskCode: chosen.taskCode, simulatedTask: chosen.taskCode, maxScore: chosen.maxScore };
    }

    // Fallback when on index.php (no Course summary table): pick a random Upcoming Deadlines item
    const deadlineItems = Array.from(
        document.querySelectorAll('.card-warning a.list-group-item, .panel-warning a.list-group-item, a.list-group-item')
    );
    if (deadlineItems.length > 0) {
        const randomItem = deadlineItems[Math.floor(Math.random() * deadlineItems.length)];
        const taskKey = getTaskKey(randomItem);
        const title = getCourseItemCleanTitle(randomItem) || taskKey;
        applyState(randomItem, 'done');
        const prevEnable = cachedEnablePartyMode;
        cachedEnablePartyMode = true;
        triggerPartyMode(taskKey, title, 35, 35, [randomItem]);
        cachedEnablePartyMode = prevEnable;
        return { ok: true, taskCode: title, simulatedTask: title, maxScore: 35 };
    }

    return { ok: false, reason: 'no-summary' };
}

const runtimeApi = (typeof browser !== 'undefined' && browser.runtime)
    ? browser.runtime
    : (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null);

if (runtimeApi && runtimeApi.onMessage) {
    runtimeApi.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.action === 'BRUTE_SIMULATE_PARTY_MODE') {
            const result = simulateRandomTaskPartyMode();
            if (typeof sendResponse === 'function') {
                sendResponse(result);
            }
            return Promise.resolve(result);
        }
        return false;
    });
}

// Listen for real-time setting & task changes from the popup or synced devices
if (storage && typeof storage.subscribeStorageChanges === 'function') {
    storage.subscribeStorageChanges((changes) => {
        if (changes.classicUiStyle) {
            applyClassicUiStyle(changes.classicUiStyle.newValue);
        }

        if (changes.courseSummaryToBottom) {
            applyCourseSummaryPosition(changes.courseSummaryToBottom.newValue);
        }

        if (changes.showCompletionToast) {
            cachedShowCompletionToast = changes.showCompletionToast.newValue !== false;
            if (!cachedShowCompletionToast) {
                const container = document.getElementById('brute-toast-container');
                if (container) container.innerHTML = '';
            }
        }

        if (changes.hideNewTaskBadge) {
            cachedHideNewTaskBadge = Boolean(changes.hideNewTaskBadge.newValue);
            document.querySelectorAll('.brute-new-badge').forEach(badge => {
                badge.classList.toggle('brute-hidden', cachedHideNewTaskBadge);
            });
        }

        if (changes.enablePartyMode) {
            cachedEnablePartyMode = changes.enablePartyMode.newValue !== false;
        }

        if (changes.partyModeOnMinScore) {
            cachedPartyModeOnMinScore = Boolean(changes.partyModeOnMinScore.newValue);
            initTaskPanels();
        }

        if (changes.autoDetectCompletion || changes.autoCompleteRemovedX || changes.showGreenCheckmarks) {
            initTaskPanels();
        }

        if (changes.hidePlagiatBanner) {
            const shouldHide = changes.hidePlagiatBanner.newValue !== false;
            findPlagiatElements().forEach(banner => {
                setPlagiatBannerVisibility(banner, shouldHide);
            });
        }

        if (changes.bruteTasks) {
            const nextTasks = changes.bruteTasks.newValue || {};
            if (Object.keys(nextTasks).length === 0) {
                newlyDiscoveredTaskKeys.clear();
                processedTaskKeysThisVisit.clear();
                sessionPartyTriggeredKeys.clear();
            }
            syncAllTaskItemsOnPage(nextTasks);
        }
    });
}

// Initial task panel injection
initTaskPanels();