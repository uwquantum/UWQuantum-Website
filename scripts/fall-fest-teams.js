// ==========================================
// Qiskit Fall Fest team registration (fall-fest-teams.html).
// Builds 1–5 member cards, validates client-side, then calls the
// register_fall_fest_team() database function in Supabase, which re-checks
// everything (including the team-name filter) and saves the team and its
// members in one transaction. See supabase/fall_fest_teams.sql.
// ==========================================

(() => {
  const MIN_MEMBERS = 1;
  const MAX_MEMBERS = 5;

  const form = document.getElementById('fft-form');
  if (!form) return;
  const membersEl = document.getElementById('fft-members');
  const addBtn = document.getElementById('fft-add');
  const countEl = document.getElementById('fft-count');
  const trackEl = document.getElementById('fft-track');
  const submitBtn = document.getElementById('fft-submit');
  const statusEl = document.getElementById('fft-status');
  const successEl = document.getElementById('fft-success');

  let nextUid = 1; // unique per card, never reused, so ids/names never clash

  // ---------- Member cards ----------
  function memberCardHTML(u) {
    return `
      <div class="fft-member-head">
        <h3 class="fft-member-title">Member <span data-num></span></h3>
        <div class="fft-head-actions">
          <label class="fft-lead">
            <input type="radio" name="lead" value="${u}" data-lead />
            Team lead / point of contact
          </label>
          <button type="button" class="fft-remove" data-remove>Remove</button>
        </div>
      </div>

      <div class="fft-grid">
        <div class="ffs-field">
          <label class="ffs-q" for="m${u}-name">Full name <span class="ffs-req">*</span></label>
          <input class="ffs-input" type="text" id="m${u}-name" data-key="full_name"
                 maxlength="200" autocomplete="off" required />
        </div>

        <div class="ffs-field">
          <label class="ffs-q" for="m${u}-email">Email <span class="ffs-req">*</span></label>
          <input class="ffs-input" type="email" id="m${u}-email" data-key="email"
                 maxlength="254" autocomplete="off" required />
        </div>

        <fieldset class="ffs-field ffs-choice fft-span" data-radio="school">
          <legend class="ffs-q">School <span class="ffs-req">*</span></legend>
          <div class="fft-inline-opts">
            <label class="ffs-opt"><input type="radio" name="m${u}-school" value="uwaterloo" /> University of Waterloo</label>
            <label class="ffs-opt"><input type="radio" name="m${u}-school" value="other" /> Other</label>
          </div>
          <input class="ffs-input ffs-other" type="text" id="m${u}-school-other" data-key="school_other"
                 placeholder="School name" maxlength="200" aria-label="School name" hidden />
        </fieldset>

        <div class="ffs-field">
          <label class="ffs-q" for="m${u}-program">Academic program <span class="ffs-req">*</span></label>
          <input class="ffs-input" type="text" id="m${u}-program" data-key="program"
                 maxlength="200" autocomplete="off" required />
        </div>

        <div class="ffs-field" data-watiam-field hidden>
          <label class="ffs-q" for="m${u}-watiam">WatIAM ID <span class="ffs-req">*</span></label>
          <input class="ffs-input" type="text" id="m${u}-watiam" data-key="watiam"
                 maxlength="50" autocomplete="off" placeholder="e.g. j25smith" />
        </div>

        <fieldset class="ffs-field ffs-choice fft-span" data-radio="attendance">
          <legend class="ffs-q">Availability <span class="ffs-req">*</span></legend>
          <div class="fft-inline-opts">
            <label class="ffs-opt"><input type="radio" name="m${u}-attendance" value="in_person" /> In person</label>
            <label class="ffs-opt"><input type="radio" name="m${u}-attendance" value="remote" /> Remote</label>
            <label class="ffs-opt"><input type="radio" name="m${u}-attendance" value="hybrid" /> Hybrid</label>
          </div>
        </fieldset>
      </div>`;
  }

  function addMember({ focus = true } = {}) {
    if (cards().length >= MAX_MEMBERS) return;
    const u = nextUid++;
    const card = document.createElement('div');
    card.className = 'fft-member';
    card.dataset.uid = u;
    card.innerHTML = memberCardHTML(u);
    membersEl.appendChild(card);

    // School: show "Other" text box or WatIAM field as appropriate
    card.querySelectorAll(`input[name="m${u}-school"]`).forEach((r) =>
      r.addEventListener('change', () => syncSchool(card)));
    // Attendance changes can affect the judging-track message
    card.querySelectorAll(`input[name="m${u}-attendance"]`).forEach((r) =>
      r.addEventListener('change', updateTrack));
    card.querySelector('[data-lead]').addEventListener('change', syncLead);
    card.querySelector('[data-remove]').addEventListener('click', () => removeMember(card));

    if (!form.querySelector('input[name="lead"]:checked')) {
      card.querySelector('[data-lead]').checked = true;
    }
    refresh();
    if (focus) card.querySelector('[data-key="full_name"]').focus();
  }

  function removeMember(card) {
    if (cards().length <= MIN_MEMBERS) return;
    const wasLead = card.querySelector('[data-lead]').checked;
    card.remove();
    if (wasLead) cards()[0].querySelector('[data-lead]').checked = true;
    refresh();
    updateTrack();
  }

  function syncSchool(card) {
    const u = card.dataset.uid;
    const school = (card.querySelector(`input[name="m${u}-school"]:checked`) || {}).value;
    const other = card.querySelector('[data-key="school_other"]');
    const watiamField = card.querySelector('[data-watiam-field]');
    other.hidden = school !== 'other';
    watiamField.hidden = school !== 'uwaterloo';
    if (school === 'other') other.focus();
    clearError(watiamField);
  }

  function syncLead() {
    cards().forEach((c) =>
      c.classList.toggle('is-lead', c.querySelector('[data-lead]').checked));
  }

  const cards = () => [...membersEl.querySelectorAll('.fft-member')];

  function refresh() {
    const list = cards();
    list.forEach((c, i) => {
      c.querySelector('[data-num]').textContent = i + 1;
      c.querySelector('[data-remove]').hidden = list.length <= MIN_MEMBERS;
    });
    addBtn.disabled = list.length >= MAX_MEMBERS;
    countEl.textContent = list.length >= MAX_MEMBERS
      ? `${MAX_MEMBERS} of ${MAX_MEMBERS} members (maximum)`
      : `${list.length} of ${MAX_MEMBERS} members`;
    syncLead();
  }

  addBtn.addEventListener('click', () => addMember());

  // ---------- Judging track message ----------
  form.querySelectorAll('input[name="in_person_nov6"]').forEach((r) =>
    r.addEventListener('change', updateTrack));

  function anyoneOnSite() {
    return cards().some((c) => {
      const a = c.querySelector(`input[name="m${c.dataset.uid}-attendance"]:checked`);
      return a && a.value !== 'remote';
    });
  }
  function allAttendanceAnswered() {
    return cards().every((c) =>
      c.querySelector(`input[name="m${c.dataset.uid}-attendance"]:checked`));
  }

  function updateTrack() {
    const answer = (form.querySelector('input[name="in_person_nov6"]:checked') || {}).value;
    trackEl.classList.remove('warn');
    if (!answer) { trackEl.hidden = true; return; }
    trackEl.hidden = false;
    if (answer === 'no') {
      trackEl.textContent =
        'Your team will be judged in the separate remote category.';
    } else if (allAttendanceAnswered() && !anyoneOnSite()) {
      trackEl.classList.add('warn');
      trackEl.textContent =
        'Every member below is marked Remote. Mark at least one person as In person or Hybrid, or answer No.';
    } else {
      trackEl.textContent =
        'Your team will be judged in the main in-person category and is eligible to win.';
    }
  }

  // ---------- Errors ----------
  function setError(field, message) {
    if (!field) return;
    field.classList.add('ffs-invalid');
    let msg = field.querySelector(':scope > .ffs-error');
    if (!msg) {
      msg = document.createElement('p');
      msg.className = 'ffs-error';
      field.appendChild(msg);
    }
    msg.textContent = message;
  }
  function clearError(field) {
    if (!field) return;
    field.classList.remove('ffs-invalid');
    const msg = field.querySelector(':scope > .ffs-error');
    if (msg) msg.remove();
  }
  form.addEventListener('input', (e) => clearError(e.target.closest('.ffs-field')));
  form.addEventListener('change', (e) => clearError(e.target.closest('.ffs-field')));

  // ---------- Validation ----------
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function validate() {
    form.querySelectorAll('.ffs-field').forEach(clearError);
    let firstBad = null;
    const fail = (field, message) => {
      setError(field, message);
      if (!firstBad) firstBad = field;
    };

    // Team name
    const nameInput = document.getElementById('team_name');
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) fail(nameInput.closest('.ffs-field'), 'Please enter a team name.');
    else if (name.length < 2) fail(nameInput.closest('.ffs-field'), 'Team names need at least 2 characters.');

    // In-person question
    const inPersonField = document.getElementById('in-person-field');
    const inPerson = (form.querySelector('input[name="in_person_nov6"]:checked') || {}).value;
    if (!inPerson) fail(inPersonField, 'This question is required.');

    // Members
    const seenEmails = new Map();
    cards().forEach((card) => {
      const u = card.dataset.uid;
      const get = (key) => card.querySelector(`[data-key="${key}"]`);
      const req = (key, msg) => {
        const el = get(key);
        if (!el.value.trim()) fail(el.closest('.ffs-field'), msg || 'This field is required.');
      };

      req('full_name');
      const emailEl = get('email');
      const email = emailEl.value.trim().toLowerCase();
      if (!email) fail(emailEl.closest('.ffs-field'), 'This field is required.');
      else if (!EMAIL_RE.test(email)) fail(emailEl.closest('.ffs-field'), 'Please enter a valid email address.');
      else if (seenEmails.has(email)) fail(emailEl.closest('.ffs-field'), 'This email is already used by another member above.');
      else seenEmails.set(email, emailEl);

      const schoolField = card.querySelector('[data-radio="school"]');
      const school = (card.querySelector(`input[name="m${u}-school"]:checked`) || {}).value;
      if (!school) fail(schoolField, 'Please choose a school.');
      else if (school === 'other' && !get('school_other').value.trim()) fail(schoolField, 'Please enter the school name.');

      req('program');
      if (school === 'uwaterloo') req('watiam', 'Please enter a WatIAM ID for Waterloo students.');

      const attField = card.querySelector('[data-radio="attendance"]');
      if (!card.querySelector(`input[name="m${u}-attendance"]:checked`)) fail(attField, 'Please choose an option.');
    });

    if (inPerson === 'yes' && allAttendanceAnswered() && !anyoneOnSite()) {
      fail(inPersonField, 'At least one member must be In person or Hybrid to answer Yes.');
    }

    const confirmField = document.getElementById('confirm-field');
    if (!form.querySelector('input[name="confirmed"]:checked')) {
      fail(confirmField, 'Please confirm before registering.');
    }

    return firstBad;
  }

  // ---------- Submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.classList.remove('error');

    // Honeypot: pretend success for bots, store nothing.
    if (form.elements.website.value) { showSuccess(''); return; }

    const firstBad = validate();
    if (firstBad) {
      showStatusError('Please fix the highlighted fields.');
      focusField(firstBad);
      return;
    }

    const teamName = document.getElementById('team_name').value.trim().replace(/\s+/g, ' ');
    const members = cards().map((card) => {
      const u = card.dataset.uid;
      const v = (key) => card.querySelector(`[data-key="${key}"]`).value.trim();
      const school = card.querySelector(`input[name="m${u}-school"]:checked`).value;
      return {
        full_name: v('full_name'),
        email: v('email').toLowerCase(),
        school,
        school_other: school === 'other' ? v('school_other') : null,
        program: v('program'),
        watiam: school === 'uwaterloo' ? v('watiam') : null,
        attendance: card.querySelector(`input[name="m${u}-attendance"]:checked`).value,
        is_lead: card.querySelector('[data-lead]').checked,
      };
    });

    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering…';

    try {
      if (!window.sb) throw new Error('Supabase client not loaded');
      const { error } = await window.sb.rpc('register_fall_fest_team', {
        p_team_name: teamName,
        p_in_person_nov6: form.querySelector('input[name="in_person_nov6"]:checked').value === 'yes',
        p_members: members,
      });
      if (error) throw error;
      showSuccess(teamName);
    } catch (err) {
      console.error('Team registration failed:', err);
      handleServerError(err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register team';
    }
  });

  function handleServerError(err) {
    const msg = String((err && err.message) || '');
    const [code, detail] = msg.split(':');
    const nameField = document.getElementById('team-name-field');
    const emailField = (email) => {
      const el = [...membersEl.querySelectorAll('[data-key="email"]')]
        .find((i) => i.value.trim().toLowerCase() === (detail || '').trim());
      return el ? el.closest('.ffs-field') : null;
    };

    switch (code) {
      case 'TEAM_NAME_TAKEN':
        setError(nameField, 'Another team already has this name. Please choose a different one.');
        showStatusError('That team name is taken.');
        return focusField(nameField);
      case 'TEAM_NAME_INAPPROPRIATE':
        setError(nameField, 'This team name isn\'t allowed. Please choose a different one.');
        showStatusError('Please choose a different team name.');
        return focusField(nameField);
      case 'TEAM_NAME_INVALID':
        setError(nameField, 'Team names must be 2 to 50 characters.');
        showStatusError('Please check the team name.');
        return focusField(nameField);
      case 'EMAIL_ON_ANOTHER_TEAM': {
        const f = emailField();
        if (f) {
          setError(f, 'This person is already on another registered team.');
          focusField(f);
        }
        showStatusError('A member is already on another team. If that\'s a mistake, email uwquantumclub@outlook.com.');
        return;
      }
      case 'DUPLICATE_EMAIL': {
        const f = emailField();
        if (f) { setError(f, 'Two members have the same email.'); focusField(f); }
        showStatusError('Two members have the same email.');
        return;
      }
      case 'IN_PERSON_REQUIRES_MEMBER': {
        const f = document.getElementById('in-person-field');
        setError(f, 'At least one member must be In person or Hybrid to answer Yes.');
        showStatusError('Please check the in-person question.');
        return focusField(f);
      }
      default:
        showStatusError('Something went wrong registering your team. Please try again, or email uwquantumclub@outlook.com if it keeps happening.');
    }
  }

  function showStatusError(text) {
    statusEl.textContent = text;
    statusEl.classList.add('error');
  }

  function focusField(field) {
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = field.querySelector('input:not([hidden]), textarea');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function showSuccess(teamName) {
    if (teamName) {
      document.getElementById('fft-success-text').textContent =
        `${teamName} is registered for Qiskit Fall Fest!`;
    }
    form.hidden = true;
    successEl.hidden = false;
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    successEl.focus({ preventScroll: true });
  }

  // Start with one card (the person filling in the form), marked as lead.
  addMember({ focus: false });
})();
