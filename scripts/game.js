// ==========================================
// Quantum Channels — interactive weekly game
// ==========================================

const $ = (id) => document.getElementById(id);

// ---- DOM ----
const authPanel = $('game-auth');
const dashboardPanel = $('game-dashboard');
const tabLogin = $('tab-login');
const tabRegister = $('tab-register');
const loginForm = $('login-form');
const registerForm = $('register-form');
const loginBtn = $('login-btn');
const registerBtn = $('register-btn');
const loginUser = $('login-username');
const loginPass = $('login-password');
const registerUser = $('register-username');
const registerPass = $('register-password');
const loginError = $('login-error');
const registerError = $('register-error');
const logoutBtn = $('logout-btn');
const playerNameDisplay = $('player-name');
const opponentNameDisplay = $('opponent-name');
const heatmap = $('qc-heatmap');
const pointsLeftDisplay = $('points-left');
const submitPointsBtn = $('submit-points-btn');
const submissionMessage = $('submission-message');
const leaderboardList = $('leaderboard-list');
const lockoutMessage = $('lockout-message');
const activeGameArea = $('active-game-area');
const statusBanner = $('game-status-banner');
const superposeBtn = $('qc-superpose');
const resolutionPanel = $('qc-resolution');
const rulePanel = $('qc-rule-panel');
const schedulePanel = $('qc-schedule-panel');

// ---- Constants ----
const N = 10;
const TOTAL = 100;
const BOT_NAMES = ['Schrödinger', 'Heisenberg', 'Feynman', 'Dirac', 'Pauli', 'Bohr', 'Born', 'Aspect'];

// Weekly cycle: lockout Wed 9 AM, results + new week Wed 7 PM
const LOCKOUT_HOUR = 9;
const RESOLVE_HOUR = 19;
const RESOLVE_DAY = 3;  // Wednesday

// Epoch: the first Wednesday 7 PM at or before the current server time is the
// week 0 anchor. We derive it on demand from getNow() so a wrong device clock
// at first visit can't permanently poison the cached value. (Pre-sync, this
// falls back to the device clock; once syncServerTime() lands, every subsequent
// call uses the corrected time.)
function getWeekAnchor() {
    const now = getNow();
    const offset = (now.getDay() - RESOLVE_DAY + 7) % 7;
    const anchor = new Date(now);
    anchor.setDate(anchor.getDate() - offset);
    anchor.setHours(RESOLVE_HOUR, 0, 0, 0);
    if (anchor > now) anchor.setDate(anchor.getDate() - 7);
    return anchor;
}

// ---- Weekly rules ----
const RULES = [
    {
        id: 'tallest_collapse',
        name: 'Quantum measurement',
        short: 'Your tallest channel collapses to 0.',
        long: 'The act of measuring a quantum state changes it. Each player\'s channel with the most quanta gets reduced to zero when the week resolves — the universe takes back your boldest bet.',
        physics: 'Measurement back-action — observing a quantum system disturbs it.',
    },
    {
        id: 'pauli_exclusion',
        name: 'Pauli exclusion',
        short: 'If both players land on the same channel, both stacks vanish.',
        long: 'Two identical fermions can\'t share a quantum state. If you AND your opponent both put quanta in the same channel, BOTH of your stacks in that channel are set to 0 — the channel rejects you both. Predict where your opponent will bet and avoid them.',
        physics: 'Pauli\'s exclusion principle — no two identical fermions can occupy the same quantum state.',
    },
    {
        id: 'tunneling',
        name: 'Quantum tunneling',
        short: 'Each channel has a 25% chance to shift its quanta one step right.',
        long: 'Particles can leak through barriers they shouldn\'t classically cross. After submission, every channel rolls a 25% chance to MOVE all its quanta into the next channel to its right (10 wraps to 1). The original channel ends up empty — your quanta tunneled away.',
        physics: 'Quantum tunneling — particles have a non-zero probability of crossing energy barriers.',
    },
    {
        id: 'uncertainty',
        name: 'Heisenberg uncertainty',
        short: 'One random channel per player shifts by ±15 quanta.',
        long: 'You can\'t know everything precisely. After submission, one randomly-chosen channel from each player gets a random shift between −15 and +15 quanta added to its value (clamped to 0 if it would go negative). Points per channel won are unchanged — still 1 point each.',
        physics: 'Uncertainty principle — complementary properties cannot both be known exactly.',
    },
];

// ---- Game state ----
let currentUser = null;
let amplitudes = new Array(N).fill(0);
let superposedIndex = -1;
let hasSubmittedThisWeek = false;
let timeInterval;
let lastSeenWeek = -1;

// ---- Time source ----
// We anchor against a trusted server clock instead of the OS clock, so changing
// the device's date/time can't let a player submit during lockout or skip weeks.
// On page load we fetch the real time from a public time API and store the
// offset (in ms) between server time and the local clock. From then on, getNow()
// returns Date.now() + serverOffsetMs — immune to the user editing their system
// clock at runtime. The debug panel can layer an additional preview offset on
// top for UI testing only; once Supabase is wired up the real schedule will be
// enforced by the server-side Edge Function regardless of what the client shows.
let serverOffsetMs = 0;
let debugOffsetMs = 0;
let serverTimeSynced = false;

async function syncServerTime() {
    const sources = [
        async () => {
            const r = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { cache: 'no-store' });
            const j = await r.json();
            return new Date(j.utc_datetime).getTime();
        },
        async () => {
            // Fallback: take the Date response header from any reliable CORS-friendly origin.
            const r = await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/package.json',
                { cache: 'no-store', method: 'HEAD' });
            return new Date(r.headers.get('date')).getTime();
        },
    ];
    for (const fetcher of sources) {
        try {
            const t0 = Date.now();
            const serverNow = await fetcher();
            const elapsed = Date.now() - t0;
            serverOffsetMs = serverNow - Date.now() + Math.floor(elapsed / 2);
            serverTimeSynced = true;
            return;
        } catch (_) { /* try next */ }
    }
    console.warn('[QC] Could not sync server time; using device clock as fallback.');
}

function getNow() {
    return new Date(Date.now() + serverOffsetMs + debugOffsetMs);
}

function startClock() {
    if (timeInterval) clearInterval(timeInterval);
    timeInterval = setInterval(() => {
        const now = getNow();
        const disp = $('current-time-display');
        if (disp) {
            const prefix = debugOffsetMs !== 0 ? 'simulated' : (serverTimeSynced ? 'server' : 'local');
            disp.textContent = `${prefix} · ${now.toLocaleString()}`;
        }
        checkGameState();
    }, 1000);
}

(async () => {
    await syncServerTime();
    startClock();
})();

function getWeekNumber() {
    const anchor = getWeekAnchor().getTime();
    const now = getNow().getTime();
    const elapsed = now - anchor;
    return Math.max(0, Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000)));
}

function getCurrentRule() {
    return RULES[getWeekNumber() % RULES.length];
}

function getNextResolution() {
    const now = getNow();
    const d = new Date(now);
    const day = d.getDay();
    const offset = (RESOLVE_DAY - day + 7) % 7;
    d.setDate(d.getDate() + offset);
    d.setHours(RESOLVE_HOUR, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 7);
    return d;
}
function getNextLockout() {
    const now = getNow();
    const d = new Date(now);
    const day = d.getDay();
    const offset = (RESOLVE_DAY - day + 7) % 7;
    d.setDate(d.getDate() + offset);
    d.setHours(LOCKOUT_HOUR, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 7);
    return d;
}

// ---- Debug panel ----
const safeBind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };

function setDebugTo(target) {
    debugOffsetMs = target.getTime() - (Date.now() + serverOffsetMs);
    checkGameState();
}
function clearDebug() {
    debugOffsetMs = 0;
    checkGameState();
}

safeBind('debug-apply', () => {
    const input = $('debug-datetime');
    if (!input || !input.value) return;
    setDebugTo(new Date(input.value));
});
safeBind('debug-wed-lock', () => {
    const d = getNow();
    d.setDate(d.getDate() + (3 + 7 - d.getDay()) % 7);
    d.setHours(9, 5, 0, 0);
    setDebugTo(d);
});
safeBind('debug-wed-resolve', () => {
    const d = getNow();
    d.setDate(d.getDate() + (3 + 7 - d.getDay()) % 7);
    d.setHours(19, 5, 0, 0);
    setDebugTo(d);
});
safeBind('debug-reset', clearDebug);
safeBind('debug-close', () => {
    const panel = $('debug-panel');
    if (panel) panel.style.display = 'none';
});

// Pre-fill the debug datetime input with the current effective time so the user
// can tweak it directly instead of typing the whole timestamp from scratch.
function refreshDebugInput() {
    const input = $('debug-datetime');
    if (!input) return;
    const d = getNow();
    const pad = (n) => String(n).padStart(2, '0');
    input.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
setInterval(refreshDebugInput, 5000);
setTimeout(refreshDebugInput, 200);

// ---- Storage ----
function initDB() {
    if (!localStorage.getItem('qc_Leaderboard')) localStorage.setItem('qc_Leaderboard', JSON.stringify({}));
    if (!localStorage.getItem('qc_Auth'))        localStorage.setItem('qc_Auth', JSON.stringify({}));
    if (!localStorage.getItem('qc_Submissions')) localStorage.setItem('qc_Submissions', JSON.stringify({}));
    if (!localStorage.getItem('qc_Opponents'))   localStorage.setItem('qc_Opponents', JSON.stringify({}));
    if (!localStorage.getItem('qc_LastResult'))  localStorage.setItem('qc_LastResult', JSON.stringify({}));
}
initDB();
// Clean up the legacy locally-cached week anchor (we now derive it dynamically
// from server-anchored time, so a wrong device clock at first visit can't
// permanently poison the week numbers).
localStorage.removeItem('qc_WeekAnchor');

// ---- Login persistence (cookie + localStorage redundancy) ----
const SESSION_COOKIE = 'qc_user';
const SESSION_MAX_AGE = 365 * 24 * 60 * 60; // one year
function rememberUser(username) {
    localStorage.setItem('qc_CurrentUser', username);
    document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(username)}; max-age=${SESSION_MAX_AGE}; path=/; samesite=lax`;
}
function forgetUser() {
    localStorage.removeItem('qc_CurrentUser');
    document.cookie = `${SESSION_COOKIE}=; max-age=0; path=/`;
}
function recallUser() {
    const m = document.cookie.match(new RegExp('(?:^|; )' + SESSION_COOKIE + '=([^;]*)'));
    if (m) return decodeURIComponent(m[1]);
    return localStorage.getItem('qc_CurrentUser');
}

// ---- Heatmap ----
function colorForAmplitude(a) {
    const t = Math.min(1, Math.max(0, a / 60));
    const h = 155 + (168 - 155) * t;
    const s = 24 + (60 - 24) * t;
    const l = 88 + (28 - 88) * t;
    return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}
function textColorForAmplitude(a) {
    return a >= 35 ? '#f7f6f0' : 'var(--text-primary)';
}

function buildHeatmap() {
    heatmap.innerHTML = '';
    for (let i = 0; i < N; i++) {
        const cell = document.createElement('div');
        cell.className = 'qc-channel';
        cell.dataset.idx = String(i);
        cell.innerHTML = `
            <div class="qc-channel-label">CH${i + 1}</div>
            <div class="qc-channel-value">0</div>
            <input type="range" min="0" max="100" value="0" class="qc-channel-slider" aria-label="Channel ${i + 1}">
        `;
        const slider = cell.querySelector('.qc-channel-slider');
        slider.addEventListener('input', (e) => onSliderChange(i, parseInt(e.target.value, 10)));
        cell.addEventListener('click', (e) => {
            if (e.target === slider) return;
            toggleSuperposition(i);
        });
        heatmap.appendChild(cell);
    }
    paintHeatmap();
}

function onSliderChange(idx, newVal) {
    const others = amplitudes.reduce((s, v, j) => s + (j === idx ? 0 : v), 0);
    const maxAllowed = Math.max(0, TOTAL - others);
    amplitudes[idx] = Math.min(newVal, maxAllowed);
    paintHeatmap();
    updatePointsCounter();
}

function paintHeatmap() {
    const cells = heatmap.querySelectorAll('.qc-channel');
    cells.forEach((cell, i) => {
        const v = amplitudes[i];
        cell.style.background = colorForAmplitude(v);
        cell.querySelector('.qc-channel-value').textContent = v;
        cell.querySelector('.qc-channel-value').style.color = textColorForAmplitude(v);
        cell.querySelector('.qc-channel-label').style.color = v >= 35 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';
        cell.querySelector('.qc-channel-slider').value = String(v);
        cell.classList.toggle('qc-superposed', i === superposedIndex);
    });
}

function updatePointsCounter() {
    const total = amplitudes.reduce((s, v) => s + v, 0);
    const left = TOTAL - total;
    pointsLeftDisplay.textContent = left;
    pointsLeftDisplay.style.color = left < 0 ? '#a8324a' : '';
    submitPointsBtn.disabled = (left < 0) || allZero();
}

function allZero() { return amplitudes.every(v => v === 0); }

function toggleSuperposition(idx) {
    superposedIndex = (superposedIndex === idx) ? -1 : idx;
    paintHeatmap();
    updateTokenButton();
}

function updateTokenButton() {
    const pressed = superposedIndex !== -1;
    superposeBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    const stateEl = superposeBtn.querySelector('.qc-token-state');
    if (pressed) stateEl.textContent = `on CH${superposedIndex + 1}`;
    else stateEl.textContent = 'tap a channel';
}

superposeBtn.addEventListener('click', () => {
    if (superposedIndex !== -1) {
        superposedIndex = -1;
        paintHeatmap();
        updateTokenButton();
    } else {
        const hint = $('qc-hint');
        if (hint) {
            hint.textContent = 'Tap any channel cell to place your token there.';
            hint.style.color = 'var(--qc-amp)';
            setTimeout(() => {
                hint.textContent = 'Drag a slider to assign quanta. Tap a channel to place your superposition token — at resolution it gambles between +0 and +3 bonus points (50/50).';
                hint.style.color = '';
            }, 4000);
        }
    }
});

// ---- Rule application ----
function collapseTallest(amps) {
    const out = amps.slice();
    const max = Math.max(...out);
    if (max > 0) out[out.indexOf(max)] = 0;
    return out;
}

function pauliExclusion(my, opp) {
    const m = my.slice(), o = opp.slice();
    for (let i = 0; i < N; i++) {
        if (m[i] > 0 && o[i] > 0) {
            // Both fermions get evicted — channel can't hold either of them.
            m[i] = 0;
            o[i] = 0;
        }
    }
    return { my: m, opp: o };
}

function tunnel(amps) {
    // Each channel independently rolls 25%. Those that tunnel move ALL their
    // quanta one step to the right (channel 10 wraps to channel 1). Decisions
    // are made first, then applied simultaneously so we don't cascade.
    const out = amps.slice();
    const willTunnel = amps.map(() => Math.random() < 0.25);
    const incoming = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
        if (willTunnel[i]) {
            incoming[(i + 1) % N] += out[i];
            out[i] = 0;
        }
    }
    for (let i = 0; i < N; i++) out[i] += incoming[i];
    return out;
}

function addUncertainty(amps) {
    const out = amps.slice();
    const i = Math.floor(Math.random() * N);
    const shift = Math.floor(Math.random() * 31) - 15; // integer in [-15, +15]
    out[i] = Math.max(0, out[i] + shift);
    return out;
}

function applyRule(ruleId, my, opp) {
    switch (ruleId) {
        case 'tallest_collapse':
            return { my: collapseTallest(my), opp: collapseTallest(opp) };
        case 'pauli_exclusion':
            return pauliExclusion(my, opp);
        case 'tunneling':
            return { my: tunnel(my), opp: tunnel(opp) };
        case 'uncertainty':
            return { my: addUncertainty(my), opp: addUncertainty(opp) };
        default:
            return { my, opp };
    }
}

// Token is a pure gamble: if armed (tokenIdx >= 0), 50/50 chance to grant 0 or 3 bonus points.
// Channel placement is purely visual/symbolic — the gamble outcome doesn't depend on the channel.
function rollTokenBonus(tokenIdx) {
    if (tokenIdx < 0 || tokenIdx >= N) return 0;
    return Math.random() < 0.5 ? 3 : 0;
}

// ---- Phase ----
function isLockoutNow() {
    const d = getNow();
    return d.getDay() === RESOLVE_DAY && d.getHours() >= LOCKOUT_HOUR && d.getHours() < RESOLVE_HOUR;
}

function checkGameState() {
    const wk = getWeekNumber();
    if (lastSeenWeek === -1) lastSeenWeek = wk;

    // If week incremented, we crossed Wed 7 PM — resolve and reset
    if (wk > lastSeenWeek) {
        resolveMatches();
        hasSubmittedThisWeek = false;
        resetWeeklyState();
        lastSeenWeek = wk;
    }

    const lockout = isLockoutNow();
    if (lockout) {
        const opps = JSON.parse(localStorage.getItem('qc_Opponents'));
        const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
        if (Object.keys(opps).length === 0 && Object.keys(subs).length > 0) performMatchmaking();
    }
    updateUI(lockout);
}

function performMatchmaking() {
    const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
    const players = Object.keys(subs);
    const opps = {};
    players.sort(() => Math.random() - 0.5);

    if (players.length % 2 !== 0) {
        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + ' Bot';
        const p1 = players.pop();
        opps[p1] = botName;
        opps[botName] = p1;
        generateBotSubmission(botName);
    }
    while (players.length >= 2) {
        const p1 = players.pop(), p2 = players.pop();
        opps[p1] = p2; opps[p2] = p1;
    }
    localStorage.setItem('qc_Opponents', JSON.stringify(opps));
}

function generateBotSubmission(botName) {
    const bot = new Array(N).fill(0);
    const peak = Math.floor(Math.random() * N);
    const width = 2 + Math.random() * 2;
    const weights = new Array(N).fill(0).map((_, i) => Math.exp(-((i - peak) ** 2) / (2 * width * width)) + 0.15);
    const wSum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N; i++) bot[i] = Math.round((weights[i] / wSum) * TOTAL);
    const drift = TOTAL - bot.reduce((s, v) => s + v, 0);
    bot[peak] += drift;

    const tokenIdx = (Math.random() < 0.6) ? Math.floor(Math.random() * N) : -1;
    const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
    subs[botName] = { amps: bot, token: tokenIdx };
    localStorage.setItem('qc_Submissions', JSON.stringify(subs));
}

function normalizeSubmission(raw) {
    if (!raw) return { amps: new Array(N).fill(0), token: -1 };
    if (Array.isArray(raw)) return { amps: raw, token: -1 };
    return raw;
}

function resolveMatches() {
    const ruleId = RULES[lastSeenWeek % RULES.length].id; // rule of the week JUST ENDED
    const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
    const opps = JSON.parse(localStorage.getItem('qc_Opponents'));
    const lb = JSON.parse(localStorage.getItem('qc_Leaderboard'));
    const results = JSON.parse(localStorage.getItem('qc_LastResult'));
    const processed = new Set();

    for (const [p1, p2] of Object.entries(opps)) {
        if (processed.has(p1) || processed.has(p2)) continue;
        const s1 = normalizeSubmission(subs[p1]);
        const s2 = normalizeSubmission(subs[p2]);

        // 1. apply weekly rule
        const ruled = applyRule(ruleId, s1.amps, s2.amps);
        const final1 = ruled.my, final2 = ruled.opp;

        // 2. count channel wins
        let p1Wins = 0, p2Wins = 0;
        for (let i = 0; i < N; i++) {
            if (final1[i] > final2[i]) p1Wins++;
            else if (final2[i] > final1[i]) p2Wins++;
        }

        // 3. roll token gambles
        const p1TokenBonus = rollTokenBonus(s1.token);
        const p2TokenBonus = rollTokenBonus(s2.token);
        p1Wins += p1TokenBonus;
        p2Wins += p2TokenBonus;

        if (lb[p1] !== undefined) lb[p1] += p1Wins;
        if (lb[p2] !== undefined) lb[p2] += p2Wins;

        results[p1] = { opponent: p2, youAmps: final1, oppAmps: final2, youWins: p1Wins, oppWins: p2Wins, youToken: s1.token, youTokenBonus: p1TokenBonus, ruleId };
        results[p2] = { opponent: p1, youAmps: final2, oppAmps: final1, youWins: p2Wins, oppWins: p1Wins, youToken: s2.token, youTokenBonus: p2TokenBonus, ruleId };
        processed.add(p1); processed.add(p2);
    }

    localStorage.setItem('qc_Leaderboard', JSON.stringify(lb));
    localStorage.setItem('qc_LastResult', JSON.stringify(results));
    localStorage.setItem('qc_Submissions', JSON.stringify({}));
    localStorage.setItem('qc_Opponents', JSON.stringify({}));
    renderLeaderboard();
}

function updateUI(isLockout) {
    if (!currentUser) return;

    const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
    const opps = JSON.parse(localStorage.getItem('qc_Opponents'));
    hasSubmittedThisWeek = !!subs[currentUser];

    renderRulePanel();
    renderSchedulePanel(isLockout);

    if (isLockout) {
        statusBanner.textContent = 'Submissions locked — wave functions resolve Wed 7 PM';
        lockoutMessage.classList.remove('hidden');
        activeGameArea.classList.add('hidden');
        opponentNameDisplay.textContent = opps[currentUser] || '— (no submission this week)';
    } else {
        statusBanner.textContent = 'Open submission — closes Wed 9 AM';
        lockoutMessage.classList.add('hidden');
        activeGameArea.classList.remove('hidden');
        opponentNameDisplay.textContent = 'Hidden until Wed 9 AM';

        if (hasSubmittedThisWeek) {
            submitPointsBtn.textContent = 'Update wavefunction';
            const stored = normalizeSubmission(subs[currentUser]);
            // Reflect stored state into the heatmap if user hasn't changed it locally
            if (allZero()) {
                amplitudes = stored.amps.slice();
                superposedIndex = stored.token ?? -1;
                paintHeatmap();
                updatePointsCounter();
                updateTokenButton();
            }
        } else {
            submitPointsBtn.textContent = 'Submit wavefunction';
        }
    }
    renderLastResult();
}

function renderRulePanel() {
    if (!rulePanel) return;
    const r = getCurrentRule();
    const wk = getWeekNumber() + 1;
    rulePanel.innerHTML = `
        <div class="qc-rule-eyebrow">Week ${wk} rule</div>
        <h3 class="qc-rule-name">${r.name}</h3>
        <p class="qc-rule-short">${r.short}</p>
        <p class="qc-rule-long">${r.long}</p>
        <p class="qc-rule-physics"><strong>Quantum concept:</strong> ${r.physics}</p>
    `;
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtCountdown(target) {
    const diff = target.getTime() - getNow().getTime();
    if (diff <= 0) return 'soon';
    const days = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `${days}d ${h}h ${m}m`;
    return `${h}h ${m}m`;
}

function renderSchedulePanel(isLockout) {
    if (!schedulePanel) return;
    const lockout = getNextLockout();
    const resolve = getNextResolution();
    schedulePanel.innerHTML = `
        <div class="qc-sched-item">
            <span class="qc-sched-label">Submissions close</span>
            <span class="qc-sched-value">Wed 9:00 AM</span>
            <span class="qc-sched-hint">${isLockout ? 'closed now' : 'in ' + fmtCountdown(lockout)}</span>
        </div>
        <div class="qc-sched-item">
            <span class="qc-sched-label">Results &amp; new rule</span>
            <span class="qc-sched-value">Wed 7:00 PM</span>
            <span class="qc-sched-hint">in ${fmtCountdown(resolve)}</span>
        </div>
        <div class="qc-sched-item">
            <span class="qc-sched-label">Resubmit anytime</span>
            <span class="qc-sched-value">until Wed 9 AM</span>
            <span class="qc-sched-hint">${hasSubmittedThisWeek ? 'submitted ✓' : 'not yet submitted'}</span>
        </div>
    `;
}

// ---- Auth ----
tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active'); tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden'); registerForm.classList.add('hidden');
    loginError.classList.add('hidden');
});
tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active'); tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden'); loginForm.classList.add('hidden');
    registerError.classList.add('hidden');
});

loginBtn.addEventListener('click', () => {
    loginError.classList.add('hidden');
    const user = loginUser.value.trim(), pass = loginPass.value.trim();
    if (!user || !pass) { loginError.textContent = 'Please enter both fields.'; loginError.classList.remove('hidden'); return; }
    const auth = JSON.parse(localStorage.getItem('qc_Auth'));
    if (user in auth && auth[user] === pass) {
        currentUser = user; rememberUser(user); showDashboard();
    } else {
        loginError.textContent = 'Incorrect username or password.'; loginError.classList.remove('hidden');
    }
});

registerBtn.addEventListener('click', () => {
    registerError.classList.add('hidden');
    const user = registerUser.value.trim(), pass = registerPass.value.trim();
    if (!user || !pass) { registerError.textContent = 'Required.'; registerError.classList.remove('hidden'); return; }
    if (pass.length < 6 || !/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
        registerError.textContent = 'At least 6 characters with one letter and one number.';
        registerError.classList.remove('hidden'); return;
    }
    const auth = JSON.parse(localStorage.getItem('qc_Auth'));
    const lb = JSON.parse(localStorage.getItem('qc_Leaderboard'));
    if (user in auth) { registerError.textContent = 'Username taken.'; registerError.classList.remove('hidden'); return; }
    auth[user] = pass; lb[user] = 0;
    localStorage.setItem('qc_Auth', JSON.stringify(auth));
    localStorage.setItem('qc_Leaderboard', JSON.stringify(lb));
    currentUser = user; rememberUser(user); showDashboard();
});

logoutBtn.addEventListener('click', () => {
    currentUser = null; forgetUser(); showAuth();
});

function showAuth() {
    authPanel.classList.remove('hidden'); dashboardPanel.classList.add('hidden');
    loginUser.value = ''; loginPass.value = ''; registerUser.value = ''; registerPass.value = '';
}

function resetWeeklyState() {
    amplitudes = new Array(N).fill(0);
    superposedIndex = -1;
    paintHeatmap();
    updatePointsCounter();
    updateTokenButton();
}

function showDashboard() {
    authPanel.classList.add('hidden'); dashboardPanel.classList.remove('hidden');
    playerNameDisplay.textContent = currentUser;
    buildHeatmap();
    resetWeeklyState();
    submissionMessage.classList.add('hidden');
    lastSeenWeek = getWeekNumber();
    // Pre-load any existing submission for this user
    const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
    const my = subs[currentUser];
    if (my) {
        const stored = normalizeSubmission(my);
        amplitudes = stored.amps.slice();
        superposedIndex = stored.token ?? -1;
        paintHeatmap();
        updatePointsCounter();
        updateTokenButton();
    }
    renderLeaderboard();
    checkGameState();
}

// ---- Submit / resubmit ----
$('channels-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isLockoutNow()) return;
    const total = amplitudes.reduce((s, v) => s + v, 0);
    if (total > TOTAL || total === 0) return;

    const subs = JSON.parse(localStorage.getItem('qc_Submissions'));
    const wasUpdate = !!subs[currentUser];
    subs[currentUser] = { amps: amplitudes.slice(), token: superposedIndex };
    localStorage.setItem('qc_Submissions', JSON.stringify(subs));

    hasSubmittedThisWeek = true;
    submitPointsBtn.textContent = 'Update wavefunction';
    submissionMessage.innerHTML = wasUpdate
        ? 'Submission updated. You can keep editing until Wed 9 AM.'
        : 'Wavefunction submitted. You can keep editing until Wed 9 AM.';
    submissionMessage.classList.remove('hidden');
    renderSchedulePanel(false);
});

// ---- Resolution rendering ----
function renderLastResult() {
    if (!currentUser) return;
    const results = JSON.parse(localStorage.getItem('qc_LastResult'));
    const r = results[currentUser];
    if (!r) { resolutionPanel.classList.add('hidden'); resolutionPanel.innerHTML = ''; return; }

    const ruleName = (RULES.find(x => x.id === r.ruleId) || {}).name || 'standard';
    const maxVal = Math.max(...r.youAmps, ...r.oppAmps, 1);
    const cols = [];
    for (let i = 0; i < N; i++) {
        const yh = (r.youAmps[i] / maxVal) * 130;
        const oh = (r.oppAmps[i] / maxVal) * 130;
        const winner = r.youAmps[i] > r.oppAmps[i] ? 'you' : (r.oppAmps[i] > r.youAmps[i] ? 'opp' : 'tie');
        cols.push(`
            <div class="qc-int-col" data-winner="${winner}">
                <div class="qc-bar-stack">
                    <div class="qc-bar you" style="height:${yh}px" title="You: ${r.youAmps[i]}"></div>
                    <div class="qc-bar opp" style="height:${oh}px" title="Opp: ${r.oppAmps[i]}"></div>
                </div>
                <div>CH${i + 1}</div>
            </div>
        `);
    }

    const tokenLine = (r.youToken >= 0)
        ? (r.youTokenBonus > 0
            ? `Your superposition token paid out: <strong>+${r.youTokenBonus} bonus points</strong>.`
            : `Your superposition token rolled <strong>+0</strong> — no bonus this week.`)
        : 'You did not use your superposition token.';

    resolutionPanel.innerHTML = `
        <div class="qc-resolution-head">
            <h4 class="qc-resolution-title">Last week vs ${r.opponent}</h4>
            <div class="qc-resolution-score">You ${r.youWins} — ${r.oppWins} ${r.opponent}</div>
        </div>
        <p class="qc-resolution-rule">Rule applied: <strong>${ruleName}</strong></p>
        <p class="qc-resolution-rule">${tokenLine}</p>
        <div class="qc-interference">${cols.join('')}</div>
        <div class="qc-resolution-legend">
            <span class="you">You</span>
            <span class="opp">${r.opponent}</span>
        </div>
    `;
    resolutionPanel.classList.remove('hidden');
}

function renderLeaderboard() {
    const lb = JSON.parse(localStorage.getItem('qc_Leaderboard'));
    if (!lb) return;
    const sorted = Object.entries(lb)
        .filter(([name]) => !name.includes('Bot'))
        .sort((a, b) => b[1] - a[1]);
    leaderboardList.innerHTML = '';
    if (sorted.length === 0) {
        leaderboardList.innerHTML = '<li><span>No players yet — register to be first!</span><span></span></li>';
        return;
    }
    sorted.forEach(([name, score], index) => {
        const li = document.createElement('li');
        if (name === currentUser) li.classList.add('is-me');
        li.innerHTML = `<span>${index + 1}. ${name}</span><span>${score} pts</span>`;
        leaderboardList.appendChild(li);
    });
}

// ---- Init ----
const savedUser = recallUser();
if (savedUser) { currentUser = savedUser; showDashboard(); } else { showAuth(); renderLeaderboard(); }
