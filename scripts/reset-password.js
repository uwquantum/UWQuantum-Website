// ==========================================
// Password reset page. Supabase redirects users here from the recovery email
// with a one-time recovery token. We listen for the PASSWORD_RECOVERY event
// (or an already-established recovery session) and then let the user set a
// new password via sb.auth.updateUser.
// ==========================================

const $ = (id) => document.getElementById(id);

const loadingView = $('reset-loading');
const formView    = $('reset-form');
const invalidView = $('reset-invalid');
const doneView    = $('reset-done');
const passInput   = $('reset-password');
const confInput   = $('reset-password-confirm');
const resetBtn    = $('reset-btn');
const resetMsg    = $('reset-message');

function showOnly(view) {
    [loadingView, formView, invalidView, doneView].forEach((v) => v?.classList.add('hidden'));
    view?.classList.remove('hidden');
}

let recoveryReady = false;

sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        recoveryReady = true;
        showOnly(formView);
    }
});

// Fall back: if the page loaded with no hash fragment and no existing session,
// the link was likely clicked twice or is otherwise stale.
(async () => {
    // Give Supabase a moment to parse the URL hash and fire the recovery event.
    await new Promise((r) => setTimeout(r, 400));
    if (recoveryReady) return;

    const { data } = await sb.auth.getSession();
    if (data?.session) {
        // A session exists (e.g. user reloaded after starting recovery). Allow
        // them to set a new password.
        showOnly(formView);
    } else {
        showOnly(invalidView);
    }
})();

resetBtn?.addEventListener('click', async () => {
    resetMsg.classList.add('hidden');
    resetMsg.classList.remove('error');
    const pass = passInput.value.trim();
    const conf = confInput.value.trim();

    if (!pass || !conf) {
        resetMsg.textContent = 'Enter and confirm your new password.';
        resetMsg.classList.add('error');
        resetMsg.classList.remove('hidden');
        return;
    }
    if (pass !== conf) {
        resetMsg.textContent = 'Passwords do not match.';
        resetMsg.classList.add('error');
        resetMsg.classList.remove('hidden');
        return;
    }
    if (pass.length < 6 || !/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) {
        resetMsg.textContent = 'Password: at least 6 characters with one letter and one number.';
        resetMsg.classList.add('error');
        resetMsg.classList.remove('hidden');
        return;
    }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Updating…';
    const { error } = await sb.auth.updateUser({ password: pass });
    resetBtn.disabled = false;
    resetBtn.textContent = 'Update password';

    if (error) {
        resetMsg.textContent = error.message;
        resetMsg.classList.add('error');
        resetMsg.classList.remove('hidden');
        return;
    }
    showOnly(doneView);
});
