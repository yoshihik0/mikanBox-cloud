// "Check for tampering" (Cloud 0.17.0). The Worker lists what to compare (action integrity_plan: a few indexed D1 reads);
// this script does the rest in the browser, so the Worker's 10 ms CPU and 50 subrequests are never in play:
//  - public files: fetched from the public site (it answers cross-origin reads) and hashed; compared with the
//    fingerprints recorded at publication;
//  - stored data: hashed here and compared with the last record of the history.
// Only the differences found are sent back, when "This is my change (accept)" is pressed.
(() => {
  'use strict';
  const encoder = new TextEncoder();
  const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
  // The same text the Worker fingerprints (src/audit.ts canonicalItem / canonicalSettings).
  function canonicalItem(raw) {
    try { const o = JSON.parse(raw); if (o && typeof o === 'object' && !Array.isArray(o)) { delete o.updated_at; delete o.revision_tag; return JSON.stringify(o); } } catch (_) { /* not JSON */ }
    return raw;
  }
  function canonicalSettings(raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        delete o.api_key; delete o.mcp_disabled;
        return JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
      }
    } catch (_) { /* not JSON */ }
    return raw;
  }
  /** Stored data against the last record of the history. */
  async function checkData(plan) {
    const found = { changed: [], missing: [], unrecorded: [] }, current = {};
    const accepted = (plan.accepted && plan.accepted.data) || {};
    for (const item of plan.data || []) {
      if (item.value === null) {
        current[item.key] = '';
        if (!item.deleted && item.after && accepted[item.key] !== '') found.missing.push(item.key);
        continue;
      }
      const now = await sha256(encoder.encode(item.key === 'settings' ? canonicalSettings(item.value) : canonicalItem(item.value)));
      current[item.key] = now;
      if (accepted[item.key] === now) continue;
      if (item.deleted) found.unrecorded.push(item.key);
      else if (now !== item.after) found.changed.push(item.key);
    }
    for (const list of Object.values(found)) list.sort();
    return { found, current };
  }
  /** Public files against the fingerprints recorded at publication. fetchFile(path) -> {status, bytes} or throws. */
  async function checkPublic(plan, fetchFile) {
    const out = { found: { changed: [], missing: [] }, current: {}, unreachable: 0, unverified: 0, checked: 0 };
    const accepted = (plan.accepted && plan.accepted.public) || {};
    const queue = [];
    for (const file of plan.files || []) { if (!file.hash) out.unverified++; else queue.push(file); }
    async function worker() {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          const response = await fetchFile(file.path);
          if (response.status === 404) { out.current[file.path] = ''; if (accepted[file.path] !== '') out.found.missing.push(file.path); out.checked++; continue; }
          if (response.status < 200 || response.status > 299) { out.unreachable++; continue; }
          const now = (await sha256(response.bytes)).slice(0, 32);
          out.current[file.path] = now; out.checked++;
          if (now !== file.hash && accepted[file.path] !== now) out.found.changed.push(file.path);
        } catch (_) { out.unreachable++; }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const list of Object.values(out.found)) list.sort();
    return out;
  }
  window.MikanIntegrity = { canonicalItem, canonicalSettings, sha256, checkData, checkPublic };

  const box = document.getElementById('integrity-box');
  if (!box) return;
  const run = document.getElementById('integrity-run'), output = document.getElementById('integrity-output');
  let labels = {};
  try { labels = JSON.parse(box.dataset.labels || '{}'); } catch (_) { /* labels stay empty */ }
  const L = (key, ...args) => { let i = 0; return String(labels[key] ?? key).replace(/%[sd]/g, () => String(args[i++] ?? '')); };
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = (title, items) => items.length ? '<p class="integrity-sub">' + esc(title) + ' (' + items.length + ')</p><ul class="integrity-list">'
    + items.slice(0, 100).map(item => '<li><code>' + esc(item) + '</code></li>').join('') + (items.length > 100 ? '<li>…</li>' : '') + '</ul>' : '';
  const dataLabel = key => key === 'settings' ? L('integrity_item_settings') : L('integrity_item_' + key.split(':')[0]) + ' ' + key.slice(key.indexOf(':') + 1);
  const localTime = iso => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'ja-JP', { dateStyle: 'short', timeStyle: 'short' }); };
  let last = null;

  async function action(name, extra = {}) {
    const form = new FormData();
    form.set('save_action', name); form.set('csrf_token', window.CSRF_TOKEN); form.set('ajax_request', '1');
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    const response = await fetch('/admin', { method: 'POST', body: form, credentials: 'same-origin' });
    let json = null;
    try { json = await response.json(); } catch (_) { /* not JSON */ }
    if (!response.ok || !json || json.success !== true) throw new Error((json && json.message) || L('err_network_error'));
    return json;
  }
  function render(plan, data, pub, note) {
    const base = String(plan.public_url || '').replace(/\/$/, '');
    const findings = pub.found.changed.length + pub.found.missing.length + data.found.changed.length + data.found.missing.length + data.found.unrecorded.length > 0;
    const at = localTime(plan.at);
    let html = '<div class="integrity-result">';
    if (note) html += '<p class="integrity-ok">' + esc(note) + '</p>';
    html += findings ? '<p class="integrity-warn" role="alert">' + esc(L('integrity_found', at)) + '</p>' : '<p class="integrity-ok">' + esc(L('integrity_ok', at)) + '</p>';
    if (pub.found.changed.length || pub.found.missing.length) html += '<h4>' + esc(L('integrity_sec_public')) + '</h4>' + list(L('integrity_changed'), pub.found.changed) + list(L('integrity_missing'), pub.found.missing);
    const d = data.found;
    if (d.changed.length || d.missing.length || d.unrecorded.length) html += '<h4>' + esc(L('integrity_sec_data')) + '</h4>'
      + list(L('integrity_data_changed'), d.changed.map(dataLabel)) + list(L('integrity_data_missing'), d.missing.map(dataLabel)) + list(L('integrity_data_unrecorded'), d.unrecorded.map(dataLabel));
    const notes = [];
    if (!plan.published) notes.push(L('integrity_cloud_not_published'));
    else if (!base) notes.push(L('integrity_cloud_unreachable', plan.files.length));
    else {
      notes.push(L('integrity_cloud_checked', pub.checked));
      if (pub.unreachable) notes.push(L('integrity_cloud_unreachable', pub.unreachable));
      if (pub.unverified) notes.push(L('integrity_cloud_unverified', pub.unverified));
      if (plan.files_truncated) notes.push(L('integrity_cloud_truncated'));
    }
    notes.push(L('integrity_cloud_program_na'));
    html += '<ul class="integrity-notes">' + notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
    if (plan.unusual.length) {
      html += '<h4>' + esc(L('integrity_unusual_head')) + '</h4><p class="integrity-ref">' + esc(L('integrity_unusual_hint')) + '</p><table class="integrity-unusual"><tbody>'
        + plan.unusual.map(row => {
          const target = row.from_value && row.to_value ? row.target + ' (' + row.from_value + ' → ' + row.to_value + ')' : row.to_value ? row.target + ' (' + row.to_value + ')' : row.from_value ? row.from_value + ' → ' + row.target : row.target.replace(/,/g, ', ');
          return '<tr class="audit-unusual"><td>' + esc(localTime(row.at)) + '</td><td>' + esc(L('audit_event_' + row.event)) + '</td><td>' + esc(row.actor) + '</td><td>' + esc(target) + '</td><td>' + esc(row.ip) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    if (findings) html += '<p><button type="button" class="btn btn-gray btn-small" data-integrity-accept>' + esc(L('integrity_accept_btn')) + '</button> <small class="sub-text">' + esc(L('integrity_accept_hint')) + '</small></p>';
    output.innerHTML = html + '</div>';
  }
  async function check(note) {
    const label = run.textContent;
    run.disabled = true; run.textContent = L('integrity_checking');
    output.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const plan = await action('integrity_plan');
      const base = String(plan.public_url || '').replace(/\/$/, '');
      const fetchFile = async path => {
        const response = await fetch(base + path.split('/').map(encodeURIComponent).join('/'), { mode: 'cors', cache: 'no-store', credentials: 'omit' });
        return { status: response.status, bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : null };
      };
      const [data, pub] = await Promise.all([checkData(plan), plan.published && base ? checkPublic(plan, fetchFile) : { found: { changed: [], missing: [] }, current: {}, unreachable: 0, unverified: 0, checked: 0 }]);
      last = { data, pub };
      render(plan, data, pub, note);
    } catch (error) {
      window.showToast && window.showToast(error.message || L('err_network_error'), true);
    } finally { run.disabled = false; run.textContent = label; output.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  }
  run.addEventListener('click', () => check(''));
  output.addEventListener('click', async event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-integrity-accept]') || !last) return;
    const findings = { public: {}, data: {} };
    for (const path of [...last.pub.found.changed, ...last.pub.found.missing]) findings.public[path] = last.pub.current[path] || '';
    for (const key of [...last.data.found.changed, ...last.data.found.missing, ...last.data.found.unrecorded]) findings.data[key] = last.data.current[key] || '';
    try { const done = await action('integrity_accept', { findings: JSON.stringify(findings) }); await check(done.message || ''); }
    catch (error) { window.showToast && window.showToast(error.message || L('err_network_error'), true); }
  });
})();
