(() => {
  async function request(form, action, jobId) {
    const data = new FormData(form);
    data.set('save_action', action); data.set('ajax_request', '1');
    if (jobId) data.set('migration_id', jobId);
    const response = await fetch('/admin', {method: 'POST', body: data, headers: {'Accept': 'application/json'}});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || result.message || 'Request failed');
    return result;
  }
  document.querySelectorAll('[data-media-migration]').forEach(form => {
    const en = form.dataset.lang === 'en';
    const status = form.querySelector('[data-storage-progress]');
    const submit = form.querySelector('[type="submit"]');
    const cancel = form.querySelector('[data-storage-cancel]');
    let running = false, cancelled = false, switching = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (running) return;
      running = true; cancelled = false; submit.disabled = true;
      try {
        let job = {id: form.dataset.jobId, total: -1, copied: 0};
        if (!job.id) {
          const result = await request(form, 'begin_media_migration');
          job = result.migration; form.dataset.jobId = job.id; if (cancel) {cancel.hidden = false; cancel.style.display = '';}
        }
        do {
          if (cancelled) return;
          const result = await request(form, 'copy_media_migration', job.id);
          job = result.migration;
          status.textContent = `${en ? 'Verified images' : '確認済みの画像'}: ${job.copied} / ${job.total}`;
        } while (job.copied < job.total);
        if (cancelled) return;
        switching = true; if (cancel) cancel.disabled = true;
        status.textContent = en ? 'Switching storage…' : '保存先を切り替えています…';
        await request(form, 'finish_media_migration', job.id);
        location.href = '/admin?view=site&storage_migrated=1#image-storage';
      } catch (error) {
        if (!cancelled) status.textContent = `${error.message} ${switching ? (en ? 'Reload to check the result.' : '再読み込みして結果を確認してください。') : (en ? 'D1 is still in use. Retry to resume.' : 'D1を引き続き使用しています。再開してやり直せます。')}`;
      } finally { running = false; submit.disabled = false; }
    });
    cancel?.addEventListener('click', async () => {
      cancelled = true; cancel.disabled = true;
      try { await request(form, 'cancel_media_migration', form.dataset.jobId); location.reload(); }
      catch (error) { status.textContent = error.message; cancel.disabled = false; }
    });
  });
  document.querySelectorAll('[data-storage-cleanup]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
      try { const result = await request(form, 'cleanup_media'); form.querySelector('[role="status"]').textContent = result.message || 'OK'; }
      catch (error) { form.querySelector('[role="status"]').textContent = error.message; }
      finally { button.disabled = false; }
    });
  });
})();
