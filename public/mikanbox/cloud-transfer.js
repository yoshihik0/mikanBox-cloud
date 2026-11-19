// Cloud edition's part of the data tool. Save: the browser builds the ZIP (the same layout as the PHP
// editions, see src/data-transfer.ts) from the data the admin returns and the media files of the public
// site; "Database" downloads the D1 SQL file. Read is data-transfer.js (shared); afterwards the media go
// to the public site with a publication whose new files come from the file that was read.
(() => {
  'use strict';
  const ja = document.documentElement.lang === 'ja';
  const encoder = new TextEncoder();
  const json = value => encoder.encode(JSON.stringify(value, null, 2));
  const hex = buffer => [...new Uint8Array(buffer)].map(v => v.toString(16).padStart(2, '0')).join('');
  window.MIKANBOX_ADMIN_ENDPOINT = '/admin';
  window.MikanTransferPublish = source => window.cloudPublish(true, [], '', { source });
  async function action(values) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    data.set('csrf_token', window.CSRF_TOKEN); data.set('ajax_request', '1');
    const response = await fetch('/admin', { method: 'POST', body: data, credentials: 'same-origin' }), result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Export failed.');
    return result;
  }
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.dataset?.transfer !== 'export') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const fields = new FormData(form), contents = String(fields.get('contents') || 'both'), status = form.querySelector('[data-transfer-status]');
    const say = text => { if (status) status.textContent = text; };
    const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
    try {
      if (contents === 'database') {
        say(ja ? 'Cloudflareで書き出しています…' : 'Cloudflare is exporting…');
        await window.cloudD1Export();
        say(''); window.MikanUI?.toast(ja ? 'データベースのダウンロードを開始しました。' : 'Database download started.');
        return;
      }
      const data = await action({ save_action: 'transfer_export', include_revisions: fields.get('include_revisions') === '1' && contents !== 'media' ? '1' : '0' });
      const zip = new window.MikanZip();
      if (contents !== 'media') {
        zip.add('data/settings.json', json(data.settings));
        for (const page of data.pages) zip.add('data/posts/' + page.id + '.json', json(page.data));
        for (const part of data.components) zip.add('data/components/' + part.id + '.json', json(part.data));
        for (const entry of data.revisions) zip.add('data/revisions/' + entry.id + '.json', json(entry.items));
      }
      if (contents !== 'data') {
        const base = String(window.PUBLIC_SITE_URL || '').replace(/\/$/, '');
        for (let i = 0; i < data.media.length; i++) {
          const media = data.media[i];
          say((ja ? '画像を読み込み中 ' : 'Reading media ') + (i + 1) + ' / ' + data.media.length);
          const response = await fetch(base + media.from, { mode: 'cors', cache: 'no-store', credentials: 'omit' });
          if (!response.ok) throw new Error((ja ? '公開サイトから読めませんでした: ' : 'Could not read from the public site: ') + media.key);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== media.size || hex(await crypto.subtle.digest('SHA-256', bytes)) !== media.etag) throw new Error((ja ? '公開サイトのファイルが記録と違います。サイトをビルドしてから保存してください: ' : 'The public file differs from the record. Build the site, then save again: ') + media.key);
          zip.add('media/' + media.key, bytes);
        }
        if (contents === 'media' && !data.media.length) throw new Error(ja ? '保存するものがありません。' : 'There is nothing to save.');
      }
      const label = { both: 'backup', data: 'data', media: 'media' }[contents];
      window.mikanDownload(zip.blob(), 'mikanbox-' + label + '-' + new Date().toLocaleDateString('sv') + '.zip');
      say(''); window.MikanUI?.toast(ja ? '保存しました。' : 'Saved.');
    } catch (error) {
      say(''); window.MikanUI?.toast(error.message, true);
    } finally { buttons.forEach(b => { b.disabled = false; }); }
  }, true);
})();
