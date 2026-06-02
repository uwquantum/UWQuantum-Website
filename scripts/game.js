// ==========================================
// Quantum Channels, interactive weekly game
// ==========================================

const $ = (id) => document.getElementById(id);

// Escape user-supplied strings before splicing them into innerHTML. Username,
// opponent name, and any other DB-sourced text MUST go through this, even
// though we validate on signup, a determined attacker could call the Supabase
// API directly with a malicious username, and that string would later land in
// every other player's leaderboard.
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// ---- DOM ----
// Auth UI lives on join.html now; on game.html we only have the sign-in CTA
// card (shown when no session) and the dashboard (shown when there is one).
const signinCta = $('game-signin-cta');
const dashboardPanel = $('game-dashboard');
const logoutBtn = $('logout-btn');
const playerNameDisplay = $('player-name');
const opponentNameDisplay = $('opponent-name');
const heatmap = $('qc-heatmap');
const pointsLeftDisplay = $('points-left');
const submitPointsBtn = $('submit-points-btn');
const submissionMessage = $('submission-message');
const leaderboardList = $('leaderboard-list');
const leaderboardWrap = document.querySelector('.qc-leaderboard-wrap');
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

// Week 1 starts at Wednesday 2026-05-20 23:00:00 UTC (= 7 PM EDT).
// The first 7-day stretch after this anchor is Week 1 (display index = code index + 1).
// Must stay in sync with the SQL constant inside qc_current_week().
const WEEK_ANCHOR_MS = Date.UTC(2026, 4, 20, 23, 0, 0);  // months are 0-indexed

// ---- Weekly rules ----
const RULES = [
    {
        id: 'tallest_collapse',
        name: 'Quantum measurement',
        short: 'Your tallest channel collapses to 0.',
        long: 'The act of measuring a quantum state changes it. Each player\'s channel with the most quanta gets reduced to zero when the week resolves, the universe takes back your boldest bet.',
        physics: 'Measurement back-action, observing a quantum system collapses it.',
    },
    {
        id: 'pauli_exclusion',
        name: 'Pauli exclusion',
        short: 'If both players land on the same channel with ≥15 quanta, both stacks vanish.',
        long: 'Two identical fermions can\'t share a quantum state. A channel only counts as a real submission if it holds at least 15 quanta, anything less is noise and is ignored by this rule. If you AND your opponent both submit ≥15 quanta in the same channel, BOTH of your stacks in that channel are set to 0, the channel rejects you both. Predict where your opponent will bet and avoid them.',
        physics: 'Pauli\'s exclusion principle, no two identical fermions can occupy the same quantum state.',
    },
    {
        id: 'tunneling',
        name: 'Quantum tunneling',
        short: 'Each channel has a 25% chance to shift its quanta one step right.',
        long: 'Particles can leak through barriers they shouldn\'t classically cross. After submission, every channel rolls a 25% chance to MOVE all its quanta into the next channel to its right (10 wraps to 1). The original channel ends up empty, your quanta tunneled away.',
        physics: 'Quantum tunneling, particles have a non-zero probability of crossing energy barriers.',
    },
    {
        id: 'uncertainty',
        name: 'Heisenberg uncertainty',
        short: 'One random channel per player shifts by ±15 quanta.',
        long: 'You can\'t know everything precisely. After submission, one randomly-chosen channel from each player gets a random shift between −15 and +15 quanta added to its value (clamped to 0 if it would go negative). Points per channel won are unchanged, still 1 point each.',
        physics: 'Uncertainty principle, complementary properties cannot both be known exactly.',
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
// returns Date.now() + serverOffsetMs, immune to the user editing their system
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
    const elapsed = getNow().getTime() - WEEK_ANCHOR_MS;
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
safeBind('debug-force-resolve', async () => {
    if (!currentUser) { alert('Log in first.'); return; }
    submissionMessage.textContent = 'Resolving on the server...';
    submissionMessage.classList.remove('hidden');
    const { data, error } = await sb.rpc('qc_resolve_latest');
    if (error) {
        submissionMessage.textContent = 'Resolve error: ' + error.message;
        return;
    }
    if (data && data.error) {
        submissionMessage.textContent = 'Server: ' + data.error;
        return;
    }
    submissionMessage.textContent = `Resolved week ${data.week} (rule: ${data.rule}, pairs: ${data.pairs}).`;
    await renderLeaderboard();
    await renderLastResult();
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

// One-time cleanup of legacy localStorage keys from the pre-Supabase version.
['qc_Leaderboard','qc_Auth','qc_Submissions','qc_Opponents','qc_LastResult','qc_WeekAnchor']
    .forEach(k => localStorage.removeItem(k));

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
            <input type="number" min="0" max="100" value="0" class="qc-channel-value" aria-label="Channel ${i + 1} quanta">
            <input type="range" min="0" max="100" value="0" class="qc-channel-slider" aria-label="Channel ${i + 1} slider">
        `;
        const slider = cell.querySelector('.qc-channel-slider');
        const valueInput = cell.querySelector('.qc-channel-value');
        slider.addEventListener('input', (e) => onAmpChange(i, parseInt(e.target.value, 10)));
        valueInput.addEventListener('input', (e) => onAmpChange(i, parseInt(e.target.value, 10) || 0));
        valueInput.addEventListener('focus', (e) => e.target.select());
        // On blur, snap the visible value to the actual stored amplitude, so
        // out-of-range typing (e.g. "999", "-5", "abc") gets corrected.
        valueInput.addEventListener('blur',  (e) => { e.target.value = String(amplitudes[i]); });
        // Enter key = commit (acts like blur)
        valueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });
        // Treat the number input as a click target that doesn't open the token toggle.
        cell.addEventListener('click', (e) => {
            if (e.target === slider || e.target === valueInput) return;
            toggleSuperposition(i);
        });
        heatmap.appendChild(cell);
    }
    paintHeatmap();
}

function onAmpChange(idx, newVal) {
    const others = amplitudes.reduce((s, v, j) => s + (j === idx ? 0 : v), 0);
    const maxAllowed = Math.max(0, TOTAL - others);
    amplitudes[idx] = Math.min(Math.max(0, newVal), maxAllowed);
    paintHeatmap({ skip: idx });   // skip the input you're actively typing in
    updatePointsCounter();
}

function paintHeatmap(opts) {
    const skip = opts && typeof opts.skip === 'number' ? opts.skip : -1;
    const cells = heatmap.querySelectorAll('.qc-channel');
    cells.forEach((cell, i) => {
        const v = amplitudes[i];
        cell.style.background = colorForAmplitude(v);
        const valueInput = cell.querySelector('.qc-channel-value');
        // Don't overwrite the input the user is currently typing in (would jump the caret).
        if (i !== skip || document.activeElement !== valueInput) {
            valueInput.value = String(v);
        }
        valueInput.style.color = textColorForAmplitude(v);
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
                hint.textContent = 'Drag a slider to assign quanta. Tap a channel to place your superposition token, if you win that channel, it gambles +0 or +3 bonus points (50/50). Lose the channel and the token does nothing.';
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
    // Channels below 15 quanta don't count as real submissions, so they can't
    // trigger eviction. This prevents grief-sprinkling 1 quantum everywhere.
    const THRESHOLD = 15;
    for (let i = 0; i < N; i++) {
        if (m[i] >= THRESHOLD && o[i] >= THRESHOLD) {
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
// Channel placement is purely visual/symbolic, the gamble outcome doesn't depend on the channel.
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

    // If the week incremented (we crossed Wed 7 PM), refresh the dashboard
    // so the new rule and a cleared wavefunction are displayed. The actual
    // matchmaking + resolution happens on the server (Supabase Edge Function),
    // so the client just re-fetches state.
    if (wk > lastSeenWeek) {
        hasSubmittedThisWeek = false;
        resetWeeklyState();
        lastSeenWeek = wk;
        if (currentUser) renderLastResult();
        renderLeaderboard();
    }

    updateUI(isLockoutNow());
}

// NOTE: Matchmaking, weekly resolution, and bot generation now happen on the
// server side via the Supabase Edge Function (`resolve-week`), scheduled by
// pg_cron to run every Wednesday at 7 PM. The client no longer touches that
// logic, it only submits its own wavefunction and reads the resulting
// `matches` + `profiles` tables to display history and leaderboard.

function updateUI(isLockout) {
    if (!currentUser) return;

    renderRulePanel();
    renderSchedulePanel(isLockout);

    if (isLockout) {
        statusBanner.textContent = 'Submissions locked, wave functions resolve Wed 7 PM';
        lockoutMessage.classList.remove('hidden');
        activeGameArea.classList.add('hidden');
        opponentNameDisplay.textContent = hasSubmittedThisWeek
            ? 'Revealed at resolution (Wed 7 PM)'
            : ',  (no submission this week)';
    } else {
        statusBanner.textContent = 'Open submission, closes Wed 9 AM';
        lockoutMessage.classList.add('hidden');
        activeGameArea.classList.remove('hidden');
        opponentNameDisplay.textContent = 'Hidden until Wed 9 AM';

        if (hasSubmittedThisWeek) {
            submitPointsBtn.textContent = 'Update wavefunction';
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
    let statusText;
    if (!currentUser)              statusText = 'log in to play';
    else if (hasSubmittedThisWeek) statusText = 'submitted ✓';
    else if (isLockout)            statusText = 'no submission this week';
    else                           statusText = 'not yet submitted';

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
            <span class="qc-sched-label">Your status</span>
            <span class="qc-sched-value">${statusText}</span>
            <span class="qc-sched-hint">${currentUser && !isLockout ? 'edit anytime before close' : ''}</span>
        </div>
    `;
}

// ---- Session controls ----
// Login + registration live on join.html (handled by scripts/auth.js). Here we
// only need to toggle between the sign-in CTA card (no session) and the
// dashboard (active session), plus handle logout.

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await sb.auth.signOut();
        currentUser = null;
        forgetUser();
        showAuth();
    });
}

function showAuth() {
    if (signinCta)      signinCta.classList.remove('hidden');
    if (dashboardPanel) dashboardPanel.classList.add('hidden');
}

function resetWeeklyState() {
    amplitudes = new Array(N).fill(0);
    superposedIndex = -1;
    paintHeatmap();
    updatePointsCounter();
    updateTokenButton();
}

async function getCurrentUserId() {
    // getSession() reads the persisted token straight from localStorage with
    // no network call, much more reliable than getUser(), which makes an
    // HTTP request and can spuriously return null on a slow/flaky network.
    const { data } = await sb.auth.getSession();
    return data?.session?.user?.id || null;
}

async function loadMyExistingSubmission() {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const { data } = await sb
        .from('submissions')
        .select('amps, token_idx')
        .eq('user_id', uid)
        .eq('week_number', getWeekNumber())
        .maybeSingle();
    if (data) {
        amplitudes = data.amps.slice();
        superposedIndex = data.token_idx ?? -1;
        hasSubmittedThisWeek = true;
        paintHeatmap();
        updatePointsCounter();
        updateTokenButton();
    }
}

async function showDashboard() {
    if (signinCta) signinCta.classList.add('hidden');
    dashboardPanel.classList.remove('hidden');
    playerNameDisplay.textContent = currentUser;
    buildHeatmap();
    resetWeeklyState();
    submissionMessage.classList.add('hidden');
    lastSeenWeek = getWeekNumber();
    await loadMyExistingSubmission();
    renderLeaderboard();
    checkGameState();
}

// ---- Submit / resubmit ----
$('channels-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isLockoutNow()) return;
    const total = amplitudes.reduce((s, v) => s + v, 0);
    if (total > TOTAL || total === 0) return;

    const uid = await getCurrentUserId();
    if (!uid) {
        submissionMessage.textContent = 'Please log in to submit.';
        submissionMessage.classList.remove('hidden');
        return;
    }

    const wasUpdate = hasSubmittedThisWeek;
    const { error } = await sb.from('submissions').upsert({
        user_id: uid,
        week_number: getWeekNumber(),
        amps: amplitudes.slice(),
        token_idx: superposedIndex,
        updated_at: new Date(Date.now() + serverOffsetMs).toISOString(),
    }, { onConflict: 'user_id,week_number' });

    if (error) {
        submissionMessage.textContent = 'Submit failed: ' + error.message;
        submissionMessage.classList.remove('hidden');
        return;
    }

    hasSubmittedThisWeek = true;
    submitPointsBtn.textContent = 'Update wavefunction';
    submissionMessage.innerHTML = wasUpdate
        ? 'Submission updated. You can keep editing until Wed 9 AM.'
        : 'Wavefunction submitted. You can keep editing until Wed 9 AM.';
    submissionMessage.classList.remove('hidden');
    renderSchedulePanel(false);
});

// ---- Resolution rendering ----
async function renderLastResult() {
    if (!currentUser) return;
    const uid = await getCurrentUserId();
    if (!uid) return;

    // Pull this player's most recent resolved match
    const { data } = await sb
        .from('matches')
        .select('*')
        .or(`player_a_id.eq.${uid},player_b_id.eq.${uid}`)
        .order('resolved_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data) { resolutionPanel.classList.add('hidden'); resolutionPanel.innerHTML = ''; return; }

    const youAreA = data.player_a_id === uid;
    const r = {
        opponent: youAreA ? data.player_b_name : data.player_a_name,
        youAmps: youAreA ? (data.amps_a || []) : (data.amps_b || []),
        oppAmps: youAreA ? (data.amps_b || []) : (data.amps_a || []),
        youWins: youAreA ? data.player_a_score : data.player_b_score,
        oppWins: youAreA ? data.player_b_score : data.player_a_score,
        youToken: youAreA ? (data.token_a ?? -1) : (data.token_b ?? -1),
        youTokenBonus: youAreA ? (data.token_bonus_a ?? 0) : (data.token_bonus_b ?? 0),
        ruleId: data.rule_id,
    };
    // If the schema doesn't yet carry amps_a/amps_b (early version), bail gracefully
    if (!r.youAmps.length || !r.oppAmps.length) {
        resolutionPanel.classList.add('hidden'); resolutionPanel.innerHTML = ''; return;
    }

    const ruleName = (RULES.find(x => x.id === r.ruleId) || {}).name || 'standard';
    const maxVal = Math.max(...r.youAmps, ...r.oppAmps, 1);

    // Tally for the standings header (channel wins only, token bonus is shown separately)
    let youCh = 0, oppCh = 0, ties = 0;
    for (let i = 0; i < N; i++) {
        if (r.youAmps[i] > r.oppAmps[i]) youCh++;
        else if (r.oppAmps[i] > r.youAmps[i]) oppCh++;
        else ties++;
    }

    // Per-channel tiles
    const tiles = [];
    for (let i = 0; i < N; i++) {
        const yv = r.youAmps[i] || 0;
        const ov = r.oppAmps[i] || 0;
        const yp = (yv / maxVal) * 100;
        const op = (ov / maxVal) * 100;
        let cls, statusLabel;
        if (yv > ov)      { cls = 'qc-win';  statusLabel = 'WIN'; }
        else if (ov > yv) { cls = 'qc-loss'; statusLabel = 'LOSS'; }
        else              { cls = 'qc-tie';  statusLabel = 'TIE'; }
        const youDim = yv < ov ? 'dim' : '';
        const oppDim = ov < yv ? 'dim' : '';

        tiles.push(`
            <div class="qc-result-tile ${cls}">
                <div class="qc-result-channel">
                    <span>CH${i + 1}</span>
                    <span class="qc-result-status">${statusLabel}</span>
                </div>
                <div class="qc-result-row you ${youDim}">
                    <span class="qc-result-label">YOU</span>
                    <span class="qc-result-bar"><span class="qc-result-bar-fill" style="width:${yp}%"></span></span>
                    <span class="qc-result-value">${yv}</span>
                </div>
                <div class="qc-result-row opp ${oppDim}">
                    <span class="qc-result-label">OPP</span>
                    <span class="qc-result-bar"><span class="qc-result-bar-fill" style="width:${op}%"></span></span>
                    <span class="qc-result-value">${ov}</span>
                </div>
            </div>
        `);
    }

    let tokenLine;
    if (r.youToken < 0) {
        tokenLine = 'You did not use your superposition token.';
    } else {
        const tch = `CH${r.youToken + 1}`;
        const wonChannel = (r.youAmps[r.youToken] ?? 0) > (r.oppAmps[r.youToken] ?? 0);
        if (!wonChannel) {
            tokenLine = `Your superposition token was on ${tch}: you didn't win that channel, so no token bonus.`;
        } else if (r.youTokenBonus > 0) {
            tokenLine = `Your superposition token on ${tch} paid out: <strong>+${r.youTokenBonus} bonus points</strong>!`;
        } else {
            tokenLine = `You won ${tch}, but the token gamble rolled <strong>+0</strong>, no bonus this week.`;
        }
    }

    resolutionPanel.innerHTML = `
        <div class="qc-resolution-head">
            <h4 class="qc-resolution-title">Last week vs ${esc(r.opponent)}</h4>
            <div class="qc-resolution-score">You ${Number(r.youWins) | 0}, ${Number(r.oppWins) | 0} ${esc(r.opponent)}</div>
        </div>
        <p class="qc-resolution-rule">Rule applied: <strong>${esc(ruleName)}</strong></p>
        <p class="qc-resolution-rule">${tokenLine}</p>
        <div class="qc-standings">
            <div class="qc-standing you">
                <span class="qc-standing-label">Channels won</span>
                <span class="qc-standing-value">${youCh}</span>
            </div>
            <div class="qc-standing tie">
                <span class="qc-standing-label">Tied</span>
                <span class="qc-standing-value">${ties}</span>
            </div>
            <div class="qc-standing opp">
                <span class="qc-standing-label">${esc(r.opponent)} won</span>
                <span class="qc-standing-value">${oppCh}</span>
            </div>
        </div>
        <div class="qc-result-grid">${tiles.join('')}</div>
    `;
    resolutionPanel.classList.remove('hidden');
}

async function renderLeaderboard() {
    // Keep the leaderboard hidden until the first weekly rule has resolved.
    // Week 0 = inaugural submission window; results come out at the first
    // Wed 7 PM resolution, after which getWeekNumber() advances to >= 1.
    if (leaderboardWrap) {
        if (getWeekNumber() < 1) {
            leaderboardWrap.classList.add('hidden');
            return;
        }
        leaderboardWrap.classList.remove('hidden');
    }
    // Pull the whole ordered list so we can render a 3-step podium AND look up
    // the current player's rank if they're outside the top 3. Player counts are
    // small (one row per signed-up member), so a single query is fine.
    const { data: rawData, error } = await sb
        .from('profiles')
        .select('username, total_points')
        .order('total_points', { ascending: false })
        .order('username', { ascending: true });
    if (error) {
        leaderboardList.innerHTML = `<div class="qc-podium-empty">Leaderboard unavailable</div>`;
        return;
    }
    const EXEC_USERNAMES = new Set(['Aairav']);
    const data = (rawData || []).filter(r => !EXEC_USERNAMES.has(r.username));
    if (!data || data.length === 0) {
        leaderboardList.innerHTML = '<div class="qc-podium-empty">No players yet, register to be first!</div>';
        return;
    }

    const top3 = data.slice(0, 3);
    // Visual order on the podium: 2nd, 1st, 3rd, so #1 sits in the middle.
    const slots = [top3[1], top3[0], top3[2]].map((row, i) => {
        const rank = [2, 1, 3][i];
        if (!row) return `<div class="qc-podium-step qc-podium-${rank} qc-podium-empty-step"></div>`;
        const isMe = row.username === currentUser;
        return `
            <div class="qc-podium-step qc-podium-${rank}${isMe ? ' is-me' : ''}">
                <div class="qc-podium-rank-badge">${rank}</div>
                <div class="qc-podium-name">${esc(row.username)}${isMe ? ' (you)' : ''}</div>
                <div class="qc-podium-points">${Number(row.total_points) | 0} <span>pts</span></div>
            </div>
        `;
    }).join('');

    let youLine = '';
    if (currentUser) {
        const meIdx = data.findIndex(r => r.username === currentUser);
        if (meIdx >= 3) {
            const me = data[meIdx];
            youLine = `
                <div class="qc-podium-you">
                    <span class="qc-podium-you-rank">#${meIdx + 1}</span>
                    <span class="qc-podium-you-name">${esc(me.username)} (you)</span>
                    <span class="qc-podium-you-points">${Number(me.total_points) | 0} pts</span>
                </div>
            `;
        }
    }

    leaderboardList.innerHTML = `<div class="qc-podium">${slots}</div>${youLine}`;
}

// ---- Init ----
// The rule + schedule panels are informational, populate them immediately so
// they're visible even before the auth check completes (and for logged-out users).
renderRulePanel();
renderSchedulePanel(isLockoutNow());
// Reveal the leaderboard for logged-out viewers once the first week has resolved.
renderLeaderboard();

// Only these emails see the debug time-travel panel.
const ADMIN_EMAILS = ['a35kalra@uwaterloo.ca', 'mkjdesil@uwaterloo.ca'];
function maybeRevealDebugPanel(email) {
    const panel = $('debug-panel');
    if (!panel) return;
    if (email && ADMIN_EMAILS.includes(email.toLowerCase())) {
        panel.hidden = false;
    } else {
        panel.hidden = true;
    }
}

// Restore session via Supabase (it persists in localStorage with key qc-supabase-auth).
(async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) {
        maybeRevealDebugPanel(data.session.user.email);
        const { data: profile } = await sb
            .from('profiles')
            .select('username')
            .eq('id', data.session.user.id)
            .maybeSingle();
        if (profile) {
            currentUser = profile.username;
            rememberUser(profile.username);
            await showDashboard();
            return;
        }
    }
    maybeRevealDebugPanel(null);
    showAuth();
    renderLeaderboard();
})();
