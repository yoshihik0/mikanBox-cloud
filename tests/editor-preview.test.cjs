const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {environment,call,login}=require('./fixtures.cjs');
const {savePage}=require('../.test-build/src/storage.js');

// Since 2.17.2 the editor's preview is a link to the saved page (as in the page list);
// preview-editor.js stays as an inert script for existing script tags.
test('preview-editor.js is inert and the editor previews the saved page in a new tab',async()=>{
  assert.doesNotMatch(fs.readFileSync('public/mikanbox/preview-editor.js','utf8'),/addEventListener|fetch\(/);
  const env=environment(),auth=await login(env);
  await savePage(env,'about',{title:'About',status:'draft',content_md:'Hello'});
  await savePage(env,'notes',{title:'Notes',status:'draft',content_md:'# Notes',output_format:'md'});
  const html=await(await call(env,'/admin?view=pages&edit=about',undefined,auth.cookie)).text();
  assert.match(html,/<a id="editor-preview-link" href="\/preview\/about" target="_blank"/);
  const md=await(await call(env,'/admin?view=pages&edit=notes',undefined,auth.cookie)).text();
  assert.match(md,/<a id="editor-preview-link" href="\/admin\?page_preview=notes" target="_blank"/);
  const fresh=await(await call(env,'/admin?view=pages&new=1',undefined,auth.cookie)).text();
  assert.match(fresh,/<span id="editor-preview-link" class="btn btn-gray btn-disabled"/);
});
