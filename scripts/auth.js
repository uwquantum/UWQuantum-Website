// ==========================================
// Auth handlers — used on join.html.
// If the visitor already has a Supabase session, we replace the auth card
// with a "you're signed in" panel and leave the rest of the page browseable
// (no forced redirect). Otherwise we wire up the login + register forms;
// on successful submission we send the user to game.html, where game.js
// picks up the persisted Supabase session and shows the dashboard.
// ==========================================

const $ = (id) => document.getElementById(id);

const UW_EMAIL_RE = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)?uwaterloo\.ca$/i;

(async () => {
    const { data } = await sb.auth.getSession();
    if (data?.session) {
        await showSignedIn(data.session);
    } else {
        wireFormHandlers();
    }
})();

async function showSignedIn(session) {
    const card = document.querySelector('.qc-auth-card');
    if (!card) return;
    const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle();
    const username = profile?.username || session.user.email?.split('@')[0] || 'member';
    card.innerHTML = `
        <h3 class="game-card-title">You're signed in as ${username}</h3>
        <p class="qc-signin-blurb">Head to the game to submit your wavefunction, or log out to switch accounts.</p>
        <div class="qc-signin-actions">
            <a href="game.html" class="hero-btn primary">Go to game <span aria-hidden="true">→</span></a>
            <button class="hero-btn outline" id="qc-logout-btn" type="button">Log out</button>
        </div>
    `;
    document.getElementById('qc-logout-btn')?.addEventListener('click', async () => {
        await sb.auth.signOut();
        location.reload();
    });
}

function wireFormHandlers() {
    const tabLogin      = $('tab-login');
    const tabRegister   = $('tab-register');
    const loginForm     = $('login-form');
    const registerForm  = $('register-form');
    const loginBtn      = $('login-btn');
    const registerBtn   = $('register-btn');
    const loginEmail    = $('login-email');
    const loginPass     = $('login-password');
    const registerUser  = $('register-username');
    const registerEmail = $('register-email');
    const registerPass  = $('register-password');
    const loginError    = $('login-error');
    const registerError = $('register-error');

    if (window.location.hash === '#login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    }

    tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        loginError.classList.add('hidden');
    });
    tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        registerError.classList.add('hidden');
    });

    loginBtn.addEventListener('click', async () => {
        loginError.classList.add('hidden');
        const email = loginEmail.value.trim().toLowerCase();
        const pass  = loginPass.value.trim();
        if (!email || !pass) {
            loginError.textContent = 'Please enter both email and password.';
            loginError.classList.remove('hidden'); return;
        }
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) {
            loginError.textContent = /invalid|credentials/i.test(error.message)
                ? 'Incorrect email or password.'
                : error.message;
            loginError.classList.remove('hidden');
            return;
        }
        window.location.assign('game.html');
    });

    registerBtn.addEventListener('click', async () => {
        registerError.classList.add('hidden');
        const user  = registerUser.value.trim();
        const email = registerEmail.value.trim().toLowerCase();
        const pass  = registerPass.value.trim();

        if (!user || !email || !pass) {
            registerError.textContent = 'All fields are required.';
            registerError.classList.remove('hidden'); return;
        }
        if (!/^[a-zA-Z0-9_-]{3,20}$/.test(user)) {
            registerError.textContent = 'Username: 3–20 characters, letters/digits/underscore/dash only.';
            registerError.classList.remove('hidden'); return;
        }
        if (!UW_EMAIL_RE.test(email)) {
            registerError.textContent = 'Email must end with @uwaterloo.ca.';
            registerError.classList.remove('hidden'); return;
        }
        if (pass.length < 6 || !/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
            registerError.textContent = 'Password: at least 6 characters with one letter and one number.';
            registerError.classList.remove('hidden'); return;
        }
        const { data, error } = await sb.auth.signUp({
            email, password: pass,
            options: { data: { username: user } },
        });
        if (error) {
            registerError.textContent = /registered|already/i.test(error.message)
                ? 'An account with this email already exists. Try logging in.'
                : error.message;
            registerError.classList.remove('hidden');
            return;
        }
        if (!data.session) {
            registerError.textContent =
                `Account created. Check your ${email} inbox for a confirmation link, then return here to log in.`;
            registerError.classList.remove('hidden');
            return;
        }
        window.location.assign('game.html');
    });
}
