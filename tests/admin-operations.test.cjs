const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {environment,call,login}=require('./fixtures.cjs');
const {savePage}=require('../.test-build/src/storage.js');

// PHP 2.19.0 operation rules, audited for the Cloud screens too: no browser dialogs (alert, confirm,
// prompt) anywhere in the admin; results go to the toast and confirmations are asked in the screen
// (admin-ui.js); actions run in place. A full reload is allowed only where the screen's premise changes.
const files=[...fs.readdirSync('src/admin').map(f=>'src/admin/'+f),'src/visual.ts',
  ...['cloud-admin','cloud-backup','cloud-editor','cloud-import','cloud-media','cloud-publish','cloud-storage','preview-editor','admin-ui','visual','visual-live','ai-question'].map(f=>`public/mikanbox/${f}.js`)];
const DIALOG=/(?<![\w.$])(?:alert|confirm|prompt)\s*\(/;

test('no alert, confirm or prompt in any admin script or template (a reappearing one fails here)',()=>{
  for(const file of files)for(const [index,line] of fs.readFileSync(file,'utf8').split('\n').entries())
    assert.doesNotMatch(line,DIALOG,`${file}:${index+1} uses a browser dialog`);
});

test('rendered admin screens carry no inline dialog handlers',async()=>{
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'draft',content_md:'x'});
  for(const path of ['/admin','/admin?view=pages&edit=about','/admin?view=pages&new=1','/admin?view=design&new=1','/admin?view=import','/admin?view=site']) {
    const html=await(await call(env,path,undefined,auth.cookie)).text();
    assert.doesNotMatch(html,/on(?:submit|click|change)="[^"]*(?:confirm|alert|prompt)\(/,path);
    assert.doesNotMatch(html,DIALOG,path+' has a dialog call in its inline script');
  }
});

test('full page reloads are limited to the audited exceptions',()=>{
  // file → number of reload/navigation sites, each with its reason:
  //  cloud-admin.js   1  language change (every label changes)
  //  cloud-backup.js  2  restoring a backup replaces the whole site, accounts included
  //  cloud-storage.js 2  switching media storage / cancelling its migration changes the storage screen's premise
  //  cloud-publish.js 0  (D1 restore reloads via the backup flow; the SQL download is a file download form)
  const allowed={'public/mikanbox/cloud-admin.js':1,'public/mikanbox/cloud-backup.js':2,'public/mikanbox/cloud-storage.js':2,'public/mikanbox/cloud-publish.js':1};
  for(const file of files.filter(f=>f.startsWith('public/mikanbox/cloud-'))) {
    const count=(fs.readFileSync(file,'utf8').match(/location\.reload\(|location\.href\s*=/g)||[]).length;
    assert.equal(count,allowed[file]||0,`${file}: ${count} reload sites`);
  }
});

test('operations run in place: delete, save and device forms are marked for admin-ui, with in-screen confirmations',async()=>{
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'draft',content_md:'x'});
  const editor=await(await call(env,'/admin?view=pages&edit=about',undefined,auth.cookie)).text();
  assert.match(editor,/<button type="submit" form="page-form" name="save_action" value="delete_page" class="btn btn-red" formnovalidate>/);
  assert.match(editor,/<tr data-page-id="about">/,'rows carry the id the close motion returns to');
  const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
  for(const action of ['save_memo','save_settings','save_cloud_update_repository'])assert.match(site,new RegExp(`<form method="post"[^>]*data-ajax[^>]*>[\\s\\S]{0,200}value="${action}"`),action);
  assert.match(site,/data-confirm="[^"]+" data-confirm-ok="[^"]*" data-confirm-title="[^"]*">/);
  assert.match(site,/<div id="issued-code-slot" data-note="/);
  // A code is shown once: admin-ui does not refresh the form (that would replace the form before the code is placed); cloud-admin.js refreshes, then fills the slot.
  assert.match(site,/<form method="post" data-ajax>[^]{0,200}value="device_code_create"/);assert.doesNotMatch(site,/data-refresh="#users-mgmt">[^]{0,200}value="device_code_create"/);
  const adminScript=fs.readFileSync('public/mikanbox/cloud-admin.js','utf8');
  assert.match(adminScript,/await window\.MikanUI\.refresh\('#users-mgmt'\)/);
  // The language select is in an in-place form, and the script reloads for any form that contains it.
  assert.match(site,/<form method="post" data-ajax>[^]*?<select name="system_lang">/);
  assert.match(adminScript,/form\.querySelector\?\.\('\[name="system_lang"\]'\)/);
  assert.match(site,/<form method="post" class="device-expiry-form" data-ajax>/);
  assert.match(site,/data-refresh="#users-mgmt"/);
  // The editor lives in its slot, so closing it removes it.
  assert.match(editor,/<div id="page-editor-slot">\s*<div id="page-editor"/);
  const design=await(await call(env,'/admin?view=design',undefined,auth.cookie)).text();
  assert.match(design,/id="comps-table-wrap"/);
});

test('deleting answers JSON with the deleted ID, and a device that stops itself is sent to sign in',async()=>{
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'draft',content_md:'x'});
  const {post}=require('./fixtures.cjs');
  const r=await post(env,auth,{save_action:'delete_page',old_id:'about',id:'about'});
  assert.equal(r.data.success,true);assert.equal(r.data.deleted,'about');
  const devices=require('../.test-build/src/devices.js');
  const mine=(await devices.deviceSession(new Request('https://cloud.test/admin',{headers:{Cookie:auth.cookie}}),env)).device;
  const out=await post(env,auth,{save_action:'device_revoke',device_id:mine.id});
  assert.equal(out.data.success,true);assert.equal(out.data.redirect,'/admin');
  assert.match(out.response.headers.get('Set-Cookie')||'',/Max-Age=0|Expires=/i);
});

test('the in-screen dialogs have the PHP admin\'s markup: unsaved prompt with save/discard/cancel, rename dialog',async()=>{
  const env=environment(),auth=await login(env);
  const html=await(await call(env,'/admin?view=pages',undefined,auth.cookie)).text();
  // Unsaved changes: the three-way modal of the PHP admin (same ids, classes, texts, order), not a generic OK dialog.
  assert.match(html,/<div id="unsaved-modal" class="unsaved-modal-overlay" style="display: none;">\s*<div class="unsaved-modal-content">\s*<h3>未保存の変更があります<\/h3>\s*<p>編集中のデータはまだ保存されていません。<br>保存してから閉じますか？<\/p>\s*<div class="unsaved-modal-actions">\s*<button id="btn-modal-save" class="btn btn-blue">[^]*?保存して閉じる<\/button>\s*<button id="btn-modal-discard" class="btn btn-red">[^]*?破棄して閉じる<\/button>\s*<button id="btn-modal-cancel" class="btn btn-gray">キャンセル<\/button>/);
  for(const rule of ['.unsaved-modal-overlay {','.unsaved-modal-content {','.unsaved-modal-actions {','@keyframes fadeIn'])assert.ok(html.includes(rule),rule);
  // Rename: PHP's buttons (light grey with a border) and warning icon colour.
  assert.match(html,/<dialog id="rename-confirm-dialog" class="custom-dialog">[^]*?<span class="material-symbols-outlined" style="color: #f59e0b;">warning<\/span>/);
  assert.match(html,/id="btn-rename-cancel"[^>]*style="background:#f1f5f9; color:#1e293b; border: 1px solid #cbd5e1;"/);
  // The editor script uses it, not a confirm dialog with an OK button.
  const script=fs.readFileSync('public/mikanbox/cloud-editor.js','utf8');
  assert.match(script,/guardUnsaved/);assert.doesNotMatch(script,/confirmDiscard|btn-orange/);
  // The delete confirmation is the shared one (admin-ui.js), the same in both editions.
  assert.match(script,/ui\(\)\.confirm\(C\.confirmDelete/);
});

test('closing an editor: fade in place, scroll to the list top, then remove it (PHP 2.19.3)',()=>{
  const script=fs.readFileSync('public/mikanbox/cloud-editor.js','utf8');
  const close=script.slice(script.indexOf('function spaCloseEditor'),script.indexOf('// ---- Clicks'));
  // Order: refresh the list, fadeOut(editor, 200), scrollToY(list top), and only then the slot is emptied.
  const at=text=>{const i=close.indexOf(text);assert.ok(i>=0,text);return i;};
  assert.ok(at('await refreshList(type)')<at('ui().fadeOut(editor, 200)')&&at('ui().fadeOut(editor, 200)')<at('ui().scrollToY(')&&at('ui().scrollToY(')<at("slot.innerHTML = ''"));
  assert.doesNotMatch(close,/collapse\(|editedRow|block: 'center'|settleScroll/,'no shrink and no scroll to a row any more');
  const shared=fs.readFileSync('public/mikanbox/admin-ui.js','utf8');
  assert.match(shared,/function fadeOut\(el, ms = 200\)/);assert.match(shared,/function scrollToY\(top, minMs = 300, maxMs = 600\)/);
  // The guard asks about, and saves, the editor being left; a save that cannot be done never counts as saved.
  assert.match(script,/function guardUnsaved\(type\)/);assert.match(script,/dirty\.has\(type\)/);
  assert.doesNotMatch(script,/discard\.click\(\)/,'a missing form or button must not discard');
  assert.match(script,/#page-editor #page-form' : '#design-editor #comp-form'/);
});

test('delete buttons skip the browser\'s form validation, so an empty title cannot swallow the delete',async()=>{
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'draft',content_md:'x'});
  assert.match(await(await call(env,'/admin?view=pages&edit=about',undefined,auth.cookie)).text(),/value="delete_page" class="btn btn-red" formnovalidate>/);
  assert.match(await(await call(env,'/admin?view=design&new=1',undefined,auth.cookie)).text()+await(await call(env,'/admin?view=design&edit=_layout',undefined,auth.cookie)).text(),/value="delete_comp" class="btn btn-red" formnovalidate>/);
});
