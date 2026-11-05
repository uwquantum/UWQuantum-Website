// ==========================================
// Qiskit Fall Fest project submission (fall-fest-submit.html).
//
// Flow (see supabase/fall_fest_submissions.sql):
//   1. begin_fall_fest_submission()  checks team + lead email + files,
//                                     returns the storage paths to upload to
//   2. upload each file to the private "fall-fest-submissions" bucket
//   3. complete_fall_fest_submission() confirms every file arrived
//
// If an upload fails part-way, pressing Submit again with the same files
// resumes the same submission instead of starting a new one (files that
// already arrived are skipped), so a flaky connection doesn't use up the
// team's resubmissions.
// ==========================================

(() => {
  const BUCKET = 'fall-fest-submissions';
  const MB = 1024 * 1024;

  // Keep in sync with fall_fest_file_limit() in the SQL file.
  const KINDS = {
    notebook: { label: 'Project notebook', required: true, max: 20 * MB, exts: ['ipynb'] },
    slides: { label: 'Presentation slides', required: true, max: 25 * MB, exts: ['pdf', 'pptx'] },
    docs: { label: 'Documentation or paper', required: false, max: 15 * MB, exts: ['pdf', 'docx', 'md'] },
    poster: { label: 'Poster', required: false, max: 25 * MB, exts: ['pdf', 'png', 'jpg', 'jpeg'] },
  };
  const MIME = {
    ipynb: 'application/x-ipynb+json',
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  const GITHUB_RE = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+(\/\S*)?$/i;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const form = document.getElementById('ffp-form');
  if (!form) return;
  const submitBtn = document.getElementById('ffp-submit');
  const statusEl = document.getElementById('ffp-status');
  const progressEl = document.getElementById('ffp-progress');
  const successEl = document.getElementById('ffp-success');

  const fieldFor = (kind) => form.querySelector(`.ffp-file[data-kind="${kind}"]`);
  const inputFor = (kind) => fieldFor(kind).querySelector('input[type="file"]');
  const extOf = (name) => (name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';
  const fmtSize = (bytes) =>
    bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

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

  // ---------- File checks ----------
  // Returns an error message, or '' if the file is fine.
  async function checkFile(kind, file) {
    const rules = KINDS[kind];
    const ext = extOf(file.name);
    if (!rules.exts.includes(ext)) {
      const exts = rules.exts.filter((e) => e !== 'jpeg').map((e) => '.' + e);
      const list = exts.length > 1 ? `${exts.slice(0, -1).join(', ')} or ${exts[exts.length - 1]}` : exts[0];
      return `Please choose a ${list} file.`;
    }
    if (file.size === 0) return 'This file is empty.';
    if (file.size > rules.max) {
      return `This file is ${fmtSize(file.size)}; the limit is ${fmtSize(rules.max)}.`;
    }
    if (kind === 'notebook') {
      try {
        const nb = JSON.parse(await file.text());
        if (typeof nb.nbformat !== 'number' || !Array.isArray(nb.cells)) throw new Error();
      } catch {
        return 'This doesn\'t look like a valid Jupyter notebook. Try re-saving it from Jupyter.';
      }
    }
    return '';
  }

  // Validate as soon as a file is picked and show its name + size.
  Object.keys(KINDS).forEach((kind) => {
    const input = inputFor(kind);
    const chip = fieldFor(kind).querySelector('.ffp-chip');
    input.addEventListener('change', async () => {
      clearError(fieldFor(kind));
      chip.hidden = true;
      const file = input.files[0];
      if (!file) return;
      const problem = await checkFile(kind, file);
      if (problem) {
        setError(fieldFor(kind), problem);
        return;
      }
      chip.innerHTML = '';
      chip.append(file.name + ' ');
      const size = document.createElement('span');
      size.className = 'ffp-size';
      size.textContent = `· ${fmtSize(file.size)}`;
      chip.append(size);
      chip.hidden = false;
    });
  });

  // ---------- Validation ----------
  async function validate() {
    form.querySelectorAll('.ffs-field').forEach(clearError);
    let firstBad = null;
    const fail = (field, message) => {
      setError(field, message);
      if (!firstBad) firstBad = field;
    };

    const teamName = form.elements.team_name.value.trim();
    if (!teamName) fail(document.getElementById('team-name-field'), 'Please enter your team name.');

    const email = form.elements.lead_email.value.trim();
    if (!email) fail(document.getElementById('lead-email-field'), 'Please enter your team lead\'s email.');
    else if (!EMAIL_RE.test(email)) fail(document.getElementById('lead-email-field'), 'Please enter a valid email address.');

    const github = form.elements.github_url.value.trim();
    if (github && !GITHUB_RE.test(github)) {
      fail(document.getElementById('github-field'), 'Please enter a GitHub link starting with https://github.com/');
    }

    for (const kind of Object.keys(KINDS)) {
      const file = inputFor(kind).files[0];
      if (!file) {
        if (KINDS[kind].required) fail(fieldFor(kind), 'Please choose a file.');
        continue;
      }
      const problem = await checkFile(kind, file);
      if (problem) fail(fieldFor(kind), problem);
    }
    return firstBad;
  }

  // ---------- Progress list ----------
  function showProgress(steps) {
    progressEl.innerHTML = '';
    steps.forEach(({ key, text }) => {
      const li = document.createElement('li');
      li.dataset.step = key;
      li.textContent = text;
      progressEl.appendChild(li);
    });
    progressEl.hidden = false;
  }
  function stepState(key, state) {
    const li = progressEl.querySelector(`[data-step="${key}"]`);
    if (li) li.className = state;
  }

  // ---------- Submit ----------
  // Remembered between attempts so a failed upload can resume.
  let pending = null; // { signature, id, paths }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    statusEl.classList.remove('error');

    if (form.elements.website.value) { form.hidden = true; successEl.hidden = false; return; }

    submitBtn.disabled = true;
    const firstBad = await validate();
    if (firstBad) {
      submitBtn.disabled = false;
      showStatusError('Please fix the highlighted fields.');
      return focusField(firstBad);
    }

    const teamName = form.elements.team_name.value.trim().replace(/\s+/g, ' ');
    const leadEmail = form.elements.lead_email.value.trim().toLowerCase();
    const github = form.elements.github_url.value.trim() || null;
    const chosen = Object.keys(KINDS)
      .map((kind) => ({ kind, file: inputFor(kind).files[0] }))
      .filter((c) => c.file);

    const signature = JSON.stringify([
      teamName.toLowerCase(), leadEmail, github,
      chosen.map((c) => [c.kind, c.file.name, c.file.size, c.file.lastModified]),
    ]);

    showProgress([
      { key: 'check', text: 'Checking your team' },
      ...chosen.map((c) => ({ key: c.kind, text: `Uploading ${KINDS[c.kind].label.toLowerCase()} (${fmtSize(c.file.size)})` })),
      { key: 'finish', text: 'Finishing up' },
    ]);
    submitBtn.textContent = 'Submitting…';
    let current = 'check';

    try {
      if (!window.sb) throw new Error('Supabase client not loaded');

      // 1. Begin (or resume the previous attempt with identical inputs)
      stepState('check', 'active');
      if (!pending || pending.signature !== signature) {
        const files = {};
        chosen.forEach(({ kind, file }) => {
          files[kind] = { ext: extOf(file.name), size: file.size, name: file.name };
        });
        const { data, error } = await window.sb.rpc('begin_fall_fest_submission', {
          p_team_name: teamName,
          p_lead_email: leadEmail,
          p_github_url: github,
          p_files: files,
        });
        if (error) throw error;
        pending = { signature, id: data.id, paths: data.paths, teamName: data.team_name || teamName };
      }
      stepState('check', 'done');

      // 2. Upload each file
      for (const { kind, file } of chosen) {
        current = kind;
        stepState(kind, 'active');
        const mime = MIME[extOf(file.name)];
        const body = new Blob([file], { type: mime });
        const { error } = await window.sb.storage
          .from(BUCKET)
          .upload(pending.paths[kind], body, { contentType: mime, upsert: false, cacheControl: '3600' });
        // "Already exists" means it arrived on an earlier attempt: fine.
        if (error && !isAlreadyExists(error)) throw Object.assign(error, { uploadKind: kind });
        stepState(kind, 'done');
      }

      // 3. Complete
      current = 'finish';
      stepState('finish', 'active');
      const { data: completedAt, error } = await window.sb.rpc('complete_fall_fest_submission', {
        p_submission_id: pending.id,
      });
      if (error) throw error;
      stepState('finish', 'done');

      showSuccess(pending.teamName, completedAt, chosen, github);
      pending = null;
    } catch (err) {
      console.error('Submission failed:', err);
      stepState(current, 'failed');
      handleError(err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit project';
    }
  });

  function isAlreadyExists(error) {
    const s = String(error.statusCode || error.status || '') + ' ' + String(error.message || '');
    return /409|already exists|duplicate/i.test(s);
  }

  function handleError(err) {
    const msg = String((err && err.message) || '');
    const [code, kind] = msg.split(':');
    const nameField = document.getElementById('team-name-field');
    const emailField = document.getElementById('lead-email-field');

    // Errors that mean the remembered attempt can't be resumed
    if (['SUBMISSION_EXPIRED', 'SUBMISSION_NOT_FOUND'].includes(code)) pending = null;

    switch (code) {
      case 'TEAM_NOT_FOUND':
        setError(nameField, 'We couldn\'t find a registered team with this name. please check the spelling.');
        showStatusError('Team not found.');
        return focusField(nameField);
      case 'LEAD_EMAIL_MISMATCH':
        setError(emailField, 'This isn\'t the team lead\'s email for this team.');
        showStatusError('The team lead\'s email doesn\'t match.');
        return focusField(emailField);
      case 'SUBMISSIONS_CLOSED':
        showStatusError('Submissions are closed.');
        return;
      case 'GITHUB_URL_INVALID': {
        const f = document.getElementById('github-field');
        setError(f, 'Please enter a GitHub link starting with https://github.com/');
        showStatusError('Please check the GitHub link.');
        return focusField(f);
      }
      case 'FILE_REQUIRED':
      case 'FILE_TYPE_INVALID':
      case 'FILE_TOO_LARGE':
      case 'FILE_MISSING':
        if (KINDS[kind]) {
          setError(fieldFor(kind), {
            FILE_REQUIRED: 'Please choose a file.',
            FILE_TYPE_INVALID: 'This file type isn\'t accepted.',
            FILE_TOO_LARGE: `This file is over the ${fmtSize(KINDS[kind].max)} limit.`,
            FILE_MISSING: 'This file didn\'t finish uploading. Press Submit again to retry.',
          }[code]);
          focusField(fieldFor(kind));
        }
        showStatusError('There was a problem with one of your files.');
        return;
      case 'SUBMISSION_EXPIRED':
        showStatusError('This upload took too long and expired. Press Submit to start again.');
        return;
      default:
        if (err && err.uploadKind) {
          setError(fieldFor(err.uploadKind), 'This file couldn\'t be uploaded.');
          showStatusError('An upload failed. Check your connection and press Submit again; files that already uploaded won\'t be sent twice.');
          return;
        }
        showStatusError('Something went wrong submitting your project. Please try again, or email uwquantumclub@outlook.com if it keeps happening.');
    }
  }

  function showStatusError(text) {
    statusEl.textContent = text;
    statusEl.classList.add('error');
  }

  function focusField(field) {
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = field.querySelector('input:not([hidden])');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function showSuccess(teamName, completedAt, chosen, github) {
    const when = new Date(completedAt || Date.now()).toLocaleString('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/Toronto',
    });
    document.getElementById('ffp-success-text').textContent =
      `We received the submission from ${teamName} on ${when} (Waterloo time):`;
    const list = document.getElementById('ffp-success-files');
    list.innerHTML = '';
    chosen.forEach(({ kind, file }) => {
      const li = document.createElement('li');
      li.append(`${KINDS[kind].label}: ${file.name} `);
      const s = document.createElement('span');
      s.textContent = `(${fmtSize(file.size)})`;
      li.append(s);
      list.appendChild(li);
    });
    if (github) {
      const li = document.createElement('li');
      li.textContent = `GitHub: ${github}`;
      list.appendChild(li);
    }
    form.hidden = true;
    progressEl.hidden = true;
    successEl.hidden = false;
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    successEl.focus({ preventScroll: true });
  }
})();
