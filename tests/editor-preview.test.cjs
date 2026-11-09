const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {environment,call,login,post}=require('./fixtures.cjs');
const {savePage,loadPage}=require('../.test-build/src/storage.js');

// Since 2.19.0 the editor's Preview shows the content being edited, saved or not (as in the PHP
// editions): the form's fields are stashed (POST preview_stash), and the preview tab opens a plain
// GET address with the token. Nothing is saved.
const stash=async(env,auth,fields)=>(await post(env,auth,{save_action:'preview_stash',...fields})).data;
const preview=(env,auth,id,token)=>call(env,'/admin.php?page_preview='+encodeURIComponent(id)+'&stash='+token,undefined,auth.cookie);

test('the editor has one Preview button for the content being edited, and /admin.php answers like /admin',async()=>{
  const script=fs.readFileSync('public/mikanbox/preview-editor.js','utf8');
  assert.match(script,/preview_stash/);assert.match(script,/data-editor-preview/);
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'draft',content_md:'Hello'});
  for(const path of ['/admin?view=pages&edit=about','/admin?view=pages&new=1']) {
    const html=await(await call(env,path,undefined,auth.cookie)).text();
    assert.match(html,/<button type="button" id="editor-preview-btn" class="btn btn-blue" data-editor-preview/);
    assert.doesNotMatch(html,/editor-preview-link/);
  }
  assert.equal((await call(env,'/admin.php?view=pages',undefined,auth.cookie)).status,200);
});

test('an unsaved page is previewed in its output format without being saved',async()=>{
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'public_static',content_md:'Saved text'});
  // HTML: the edited text, not the saved one.
  let result=await stash(env,auth,{id:'about',old_id:'about',title:'About',status:'public_static',content_md:'Edited **text**',output_format:'html'});
  assert.equal(result.success,true);assert.match(result.token,/^[a-f0-9]{32}$/);
  let response=await preview(env,auth,'about',result.token);
  assert.match(response.headers.get('Content-Type'),/^text\/html/);assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);
  assert.match(await response.text(),/Edited <strong>text<\/strong>/);
  // Markdown-only and data formats: UTF-8 text of the actual output.
  result=await stash(env,auth,{id:'about',old_id:'about',title:'About',status:'draft',content_md:'日本語 {{TITLE}}',output_format:'md'});
  response=await preview(env,auth,'about',result.token);
  assert.equal(response.headers.get('Content-Type'),'text/plain; charset=utf-8');assert.match(await response.text(),/日本語 About/);
  result=await stash(env,auth,{id:'about',old_id:'about',title:'About',status:'draft',content_md:'[1,2,3]',output_format:'json'});
  response=await preview(env,auth,'about',result.token);assert.equal(await response.text(),'[1,2,3]');
  // A new page (no ID yet is "_"); the saved page is untouched and nothing new exists.
  result=await stash(env,auth,{id:'brand-new',old_id:'',title:'Fresh',status:'draft',content_md:'Draft body',output_format:'html'});
  response=await preview(env,auth,'brand-new',result.token);assert.match(await response.text(),/Draft body/);
  result=await stash(env,auth,{id:'',old_id:'',title:'No ID',status:'draft',content_md:'Without an ID',output_format:'html'});
  response=await preview(env,auth,'_',result.token);assert.equal(response.status,200);assert.match(await response.text(),/Without an ID/);
  assert.equal((await loadPage(env,'about')).content_md,'Saved text');assert.equal(await loadPage(env,'brand-new'),null);
});

test('a preview stash belongs to its user, expires, and keeps at most four per user',async()=>{
  const env=environment(),auth=await login(env),other=await login(env,'second','Second');
  const first=(await stash(env,auth,{id:'a',old_id:'',title:'A',content_md:'unique-secret-body',output_format:'html'})).token;
  assert.equal((await preview(env,other,'a',first)).status,404,'another user cannot read it');
  assert.equal((await preview(env,auth,'a','0'.repeat(32))).status,404);assert.equal((await preview(env,auth,'a','../../x')).status,404);
  assert.doesNotMatch(await(await call(env,'/admin?page_preview=a&stash='+first)).text(),/unique-secret-body/,'sign-in is required');
  for(let i=0;i<4;i++)await stash(env,auth,{id:'a',old_id:'',title:'A',content_md:'more '+i,output_format:'html'});
  assert.equal((await preview(env,auth,'a',first)).status,404,'the oldest of five is gone');
  env.sqlite.prepare('UPDATE preview_stash SET created_at=created_at-3600000').run();
  const left=env.sqlite.prepare('SELECT token FROM preview_stash WHERE username=?').all('admin');
  assert.equal(left.length,4);assert.equal((await preview(env,auth,'a',left[0].token)).status,404,'expired after 30 minutes');
  await stash(env,auth,{id:'a',old_id:'',title:'A',content_md:'fresh',output_format:'html'});
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM preview_stash WHERE created_at<?').get(Date.now()-1800000).n,0,'expired rows are removed on the next stash');
});

test('an invalid ID in the form is reported, not rendered',async()=>{
  const env=environment(),auth=await login(env);
  const {token}=await stash(env,auth,{id:'bad id!',old_id:'',title:'X',content_md:'x',output_format:'html'});
  const response=await preview(env,auth,'_',token);
  assert.equal(response.status,400);assert.match(response.headers.get('Content-Type'),/text\/plain/);
});
