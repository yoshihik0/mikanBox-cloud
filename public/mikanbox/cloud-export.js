// Media and site exports: the browser reads each file from the public site and builds the ZIP itself,
// so the size of a site sets no limit. Buttons: <form data-cloud-export="media|site">.
(() => {
  'use strict';
  const ja = document.documentElement.lang === 'ja';
  async function action(name) {
    const form = new FormData(); form.set('save_action', name); form.set('csrf_token', window.CSRF_TOKEN); form.set('ajax_request', '1');
    const response = await fetch('/admin', { method: 'POST', body: form, credentials: 'same-origin' }), result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Export failed.');
    return result;
  }
  async function fromPublicSite(path) {
    const base = String(window.PUBLIC_SITE_URL || '').replace(/\/$/, '');
    if (!base) throw new Error(ja ? '公開サイトのアドレスが設定されていません。' : 'The public site address is not set.');
    const response = await fetch(base + path, { mode: 'cors', cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error((ja ? '公開サイトから読めませんでした: ' : 'Could not read from the public site: ') + path);
    return new Uint8Array(await response.arrayBuffer());
  }
  document.addEventListener('submit', async event => {
    const form = event.target, kind = form.dataset?.cloudExport;
    if (!['media', 'site'].includes(kind)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const status = form.querySelector('[data-transfer-status]'), buttons = [...form.querySelectorAll('button')];
    const say = text => { if (status) status.textContent = text; };
    buttons.forEach(button => { button.disabled = true; });
    try {
      const list = await action(kind === 'media' ? 'export_media_list' : 'export_site_list'), zip = new window.MikanZip();
      const files = list.files;
      for (let i = 0; i < files.length; i++) {
        zip.add(files[i].name, await fromPublicSite(files[i].from));
        say((ja ? 'ダウンロード中 ' : 'Downloading ') + (i + 1) + ' / ' + files.length);
      }
      // The routing of the public site goes with the site (Cloudflare and some hosts read these files).
      for (const [name, text] of Object.entries(list.extra || {})) zip.add(name, new TextEncoder().encode(text));
      const date = new Date().toISOString().slice(0, 10);
      window.mikanDownload(zip.blob(), kind === 'media' ? `mikanbox-media-${date}.zip` : `mikanbox-site-${date}.zip`);
      // The progress beside the button goes away; the result goes to the toast, as for other operations.
      say('');
      window.MikanUI?.toast(kind === 'media' ? (ja ? 'メディアをダウンロードしました。' : 'Media downloaded.') : (ja ? '公開サイトをダウンロードしました。' : 'Public site downloaded.'));
    } catch (error) {
      say(''); window.MikanUI ? window.MikanUI.toast(error.message, true) : window.showToast?.(error.message, true);
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  }, true);
})();
