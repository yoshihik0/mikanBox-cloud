// Public site export: the browser reads each file from the public site and builds the ZIP itself,
// so the size of a site sets no limit. Button: <form data-cloud-export="site"> with the "relative" checkbox.
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
  // "Use relative paths": links that start at the site root ("/about", "/media/a.png") are written from the
  // file's own position ("../about", "../media/a.png"), as the PHP editions' relative build does; "/" becomes ".".
  function relative(text, name) {
    const up = '../'.repeat(name.split('/').length - 1);
    const fix = url => url === '/' ? (up || '.') : up + url.slice(1);
    return text
      .replace(/(\s(?:href|src|action|poster)=)(["'])(\/(?!\/)[^"']*)\2/gi, (_, attr, quote, url) => attr + quote + fix(url) + quote)
      .replace(/(\ssrcset=)(["'])([^"']*)\2/gi, (_, attr, quote, list) => attr + quote + list.replace(/(^|,\s*)(\/(?!\/)[^\s,]*)/g, (m, sep, url) => sep + fix(url)) + quote)
      .replace(/url\((["']?)(\/(?!\/)[^"')]*)\1\)/gi, (_, quote, url) => 'url(' + quote + fix(url) + quote + ')');
  }
  document.addEventListener('submit', async event => {
    const form = event.target, kind = form.dataset?.cloudExport;
    if (kind !== 'site') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const status = form.querySelector('[data-transfer-status]'), buttons = [...form.querySelectorAll('button')];
    const say = text => { if (status) status.textContent = text; };
    buttons.forEach(button => { button.disabled = true; });
    try {
      const list = await action('export_site_list'), zip = new window.MikanZip();
      const files = list.files;
      const rewrite = new FormData(form).get('relative') === '1';
      for (let i = 0; i < files.length; i++) {
        let bytes = await fromPublicSite(files[i].from);
        if (rewrite && /\.(?:html?|css)$/i.test(files[i].name)) bytes = new TextEncoder().encode(relative(new TextDecoder().decode(bytes), files[i].name));
        zip.add(files[i].name, bytes);
        say((ja ? 'ダウンロード中 ' : 'Downloading ') + (i + 1) + ' / ' + files.length);
      }
      // The routing of the public site goes with the site (Cloudflare and some hosts read these files).
      for (const [name, text] of Object.entries(list.extra || {})) zip.add(name, new TextEncoder().encode(text));
      const date = new Date().toLocaleDateString('sv');
      window.mikanDownload(zip.blob(), `mikanbox-site-${date}.zip`);
      // The progress beside the button goes away; the result goes to the toast, as for other operations.
      say('');
      window.MikanUI?.toast(ja ? '公開サイトをダウンロードしました。' : 'Public site downloaded.');
    } catch (error) {
      say(''); window.MikanUI ? window.MikanUI.toast(error.message, true) : window.showToast?.(error.message, true);
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  }, true);
  window.__mikanExportRelative = relative;   // for tests/site-export.test.cjs
})();
