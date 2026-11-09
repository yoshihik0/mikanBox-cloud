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
  assert.match(editor,/<button type="submit" form="page-form" name="save_action" value="delete_page" class="btn btn-red">/);
  assert.match(editor,/<tr data-page-id="about">/,'rows carry the id the close motion returns to');
  const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
  for(const action of ['save_memo','save_settings','save_cloud_update_repository'])assert.match(site,new RegExp(`<form method="post"[^>]*data-ajax[^>]*>[\\s\\S]{0,200}value="${action}"`),action);
  assert.match(site,/data-confirm="[^"]+" data-confirm-ok="[^"]*" data-confirm-title="[^"]*">/);
  assert.match(site,/<div id="issued-code-slot" data-note="/);
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
