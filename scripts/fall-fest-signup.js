// ==========================================
// Qiskit Fall Fest hackathon registration (fall-fest-signup.html).
// Validates the form client-side, then inserts one row into the
// public.fall_fest_registrations table in Supabase (see
// supabase/fall_fest_registrations.sql for the table + RLS policy).
//
// The anon key can only INSERT into that table; it cannot read rows back,
// so nobody can scrape registrations from the browser. A duplicate email is
// rejected by a unique index and surfaced as a friendly message.
// ==========================================

(() => {
  const TABLE = 'fall_fest_registrations';

  const form = document.getElementById('ffs-form');
  const submitBtn = document.getElementById('ffs-submit');
  const statusEl = document.getElementById('ffs-status');
  const successEl = document.getElementById('ffs-success');
  if (!form) return;

  // ---------- "Other" text inputs ----------
  // Any radio with data-other="<id>" reveals that text input when chosen.
  const otherRadios = form.querySelectorAll('input[type="radio"][data-other]');
  otherRadios.forEach((radio) => {
    const otherInput = document.getElementById(radio.dataset.other);
    form.querySelectorAll(`input[name="${radio.name}"]`).forEach((r) => {
      r.addEventListener('change', () => {
        const on = radio.checked;
        otherInput.hidden = !on;
        otherInput.required = on;
        if (on) otherInput.focus();
        else clearError(otherInput.closest('.ffs-field'));
      });
    });
  });

  // ---------- Helpers ----------
  const val = (name) => {
    const el = form.elements[name];
    return el ? String(el.value || '').trim() : '';
  };
  const radioVal = (name) => {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : '';
  };
  const checkedVals = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);

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

  // Clear a question's error as soon as the person interacts with it.
  form.addEventListener('input', (e) => clearError(e.target.closest('.ffs-field')));
  form.addEventListener('change', (e) => clearError(e.target.closest('.ffs-field')));

  // ---------- Validation ----------
  function validate() {
    form.querySelectorAll('.ffs-field').forEach(clearError);
    let firstBad = null;
    const fail = (field, message) => {
      setError(field, message);
      if (!firstBad) firstBad = field;
    };

    // Text / email / number / textarea inputs
    form.querySelectorAll('.ffs-input').forEach((input) => {
      if (input.hidden) return;
      const field = input.closest('.ffs-field');
      const v = input.value.trim();
      if (input.required && !v) {
        fail(field, input.classList.contains('ffs-other')
          ? 'Please fill in your "Other" answer.'
          : 'This question is required.');
      } else if (input.type === 'email' && v && !input.checkValidity()) {
        fail(field, 'Please enter a valid email address.');
      } else if (input.type === 'number' && v) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 20) {
          fail(field, 'Please enter a whole number between 0 and 20.');
        }
      }
    });

    // Radio / checkbox groups
    form.querySelectorAll('.ffs-choice[data-required]').forEach((group) => {
      if (group.classList.contains('ffs-invalid')) return; // "Other" already flagged
      if (!group.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) {
        fail(group, group.dataset.checkboxGroup
          ? 'Please select at least one option.'
          : 'This question is required.');
      }
    });

    return firstBad;
  }

  // ---------- Submit ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.classList.remove('error');

    // Honeypot: pretend success for bots, store nothing.
    if (val('website')) {
      showSuccess();
      return;
    }

    const firstBad = validate();
    if (firstBad) {
      statusEl.textContent = 'Please answer the highlighted questions.';
      statusEl.classList.add('error');
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = firstBad.querySelector('input:not([hidden]), textarea');
      if (focusable) focusable.focus({ preventScroll: true });
      return;
    }

    const institution = radioVal('institution');
    const faculty = radioVal('faculty');
    const dietary = radioVal('dietary');

    const row = {
      full_name: val('full_name'),
      email: val('email').toLowerCase(),
      institution,
      institution_other: institution === 'other' ? val('institution_other') : null,
      watiam: val('watiam'),
      student_id: val('student_id'),
      study_level: radioVal('study_level'),
      faculty,
      faculty_other: faculty === 'other' ? val('faculty_other') : null,
      program: val('program'),
      team_status: radioVal('team_status'),
      team_size: Number(val('team_size')),
      python_experience: radioVal('python_experience'),
      quantum_experience: radioVal('quantum_experience'),
      opening_attendance: radioVal('opening_attendance'),
      session_availability: checkedVals('session_availability'),
      judging_attendance: radioVal('judging_attendance'),
      symposium_interest: radioVal('symposium_interest'),
      dietary,
      dietary_other: dietary === 'other' ? val('dietary_other') : null,
      accessibility_requests: val('accessibility_requests') || null,
      acknowledged: checkedVals('acknowledged').length > 0,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      if (!window.sb) throw new Error('Supabase client not loaded');
      // No .select() after insert: anon has no SELECT permission on this table.
      const { error } = await window.sb.from(TABLE).insert(row);
      if (error) throw error;
      showSuccess();
    } catch (err) {
      console.error('Registration failed:', err);
      statusEl.classList.add('error');
      if (err && err.code === '23505') {
        statusEl.textContent =
          'This email is already registered. To change your answers, email uwquantumclub@outlook.com.';
        setError(document.getElementById('email').closest('.ffs-field'),
          'A registration with this email already exists.');
      } else {
        statusEl.textContent =
          'Something went wrong submitting your registration. Please try again, or email uwquantumclub@outlook.com if it keeps happening.';
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit registration';
    }
  });

  function showSuccess() {
    form.hidden = true;
    successEl.hidden = false;
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    successEl.focus({ preventScroll: true });
  }
})();
