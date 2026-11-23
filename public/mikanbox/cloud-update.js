(() => {
  'use strict';
  const storageKey = 'mikanbox-cloud-update:' + location.pathname;
  const getForm = () => document.getElementById('cloud-update-form');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pending = null;
  let running = false;

  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved && /^\d+\.\d+\.\d+$/.test(saved.version) && /^[\da-f-]{36}$/i.test(saved.id)) pending = saved;
  } catch { /* The update can still run if tab storage is unavailable. */ }

  function save(job) {
    pending = job;
    try {
      if (job) sessionStorage.setItem(storageKey, JSON.stringify(job));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Keep the job in memory. */ }
  }

  function render(form, message = '', completed = false, showRecovery = false) {
    if (!form) return;
    form.setAttribute('aria-busy', String(running));
    const start = form.querySelector('[data-cloud-update-start]');
    const resume = form.querySelector('[data-cloud-update-resume]');
    start.style.display = (form.dataset.version && !completed && !pending) ? '' : 'none';
    start.disabled = running;
    resume.style.display = pending && !running ? '' : 'none';
    form.querySelector('[data-cloud-update-status]').textContent = message;
    form.querySelector('[data-cloud-update-reload]').style.display = completed ? '' : 'none';
    form.querySelector('[data-cloud-update-recovery]').hidden = !showRecovery;
  }

  async function requestStep(form, job) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await pause(1000 * 2 ** (attempt - 1));
      try {
        const data = new FormData(form);
        data.set('job_id', job.id);
        data.set('target_version', job.version);
        const response = await fetch(location.pathname, {
          method: 'POST', body: data, cache: 'no-store',
          signal: AbortSignal.timeout(45000)
        });
        if (response.status >= 500 || !response.headers.get('Content-Type')?.includes('application/json')) continue;
        const result = await response.json();
        if (!response.ok || !result.success) {
          return {message: result.message, retry: [401, 403, 409].includes(response.status)};
        }
        if (result.jobId === job.id && ['running', 'complete'].includes(result.status)) return result;
      } catch { /* The previous request may have succeeded; retry the same job ID. */ }
    }
    return {retry: true};
  }

  async function run(form, version) {
    const labels = JSON.parse(form.dataset.labels);
    if (running || !version) return;
    if (document.getElementById('cloud-check-updates')?.getAttribute('aria-busy') === 'true') {
      render(form, labels.refreshBusy);
      return;
    }
    running = true;
    render(form, labels.updating);
    let message = labels.interrupted;
    let completed = false;
    let showRecovery = false;
    try {
      const job = pending || {version, id: crypto.randomUUID()};
      save(job);
      let verificationDeadline;
      while (true) {
        const result = await requestStep(form, job);
        if (result.status === 'complete') {
          completed = true;
          message = labels.complete.replace('{version}', job.version);
          save(null);
          break;
        }
        if (result.status !== 'running') {
          if (!result.retry) save(null);
          message = result.message || (result.retry ? labels.interrupted : labels.failed);
          showRecovery = true;
          break;
        }
        render(getForm(), labels[result.stage] || labels.updating);
        if (result.stage === 'verifying') {
          verificationDeadline ??= Date.now() + 120000;
          if (Date.now() >= verificationDeadline) {
            message = labels.verifyingPaused;
            showRecovery = true;
            break;
          }
        }
        await pause(result.stage === 'verifying' ? 2500 : 400);
      }
    } finally {
      running = false;
      render(getForm(), message, completed, showRecovery);
    }
  }

  // Update checks fetch a fresh copy of the panel, so delegate to the live controls.
  document.addEventListener('click', event => {
    const control = event.target instanceof Element ? event.target : null;
    if (!control) return;
    if (control.closest('[data-cloud-update-setup]')) {
      const settings = document.querySelector('#cloud-connection details');
      if (settings) settings.open = true;
    }
    if ((running || pending) && control.closest('#cloud-check-updates')) {
      event.preventDefault();
      return;
    }
    const form = getForm();
    if (!form || !form.contains(control)) return;
    if (control.closest('[data-cloud-update-reload]')) {
      window.MikanUI.keepPosition();
      location.reload();
    } else if (control.closest('[data-cloud-update-start]')) {
      void run(form, form.dataset.version);
    } else if (control.closest('[data-cloud-update-resume]')) {
      void run(form, pending?.version);
    }
  }, true);

  const form = getForm();
  if (pending && form) render(form, JSON.parse(form.dataset.labels).interrupted, false, true);
})();
