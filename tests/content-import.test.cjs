const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const {importContentPackage,importWordPressContent,normalizeWordPressImport}=require('../.test-build/src/content-import.js');

test('package content imports atomically, skips conflicts, and never imports settings',async()=>{
  const env=environment();
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('settings',?)").bind(JSON.stringify({site_id:'local',api_key:'keep'})).run();
  await env.DB.prepare("INSERT INTO posts(id,data,status,sort_order,updated_at) VALUES('existing',?, 'draft',0,'')").bind(JSON.stringify({title:'Local'})).run();
  const result=await importContentPackage(env,{
    settings:{site_id:'remote',api_key:'should-not-import'},
    pages:[{id:'existing',data:{title:'Remote',status:'draft'}},{id:'new-page',data:{title:'New',status:'public_dynamic',content_md:'Hello',sort_order:3}}],
    components:[{id:'header',data:{html:'<header>New</header>'}}]
  });
  assert.deepEqual(result,{pages:1,components:1,skippedPages:1,skippedComponents:0});
  assert.equal((await env.DB.prepare("SELECT data FROM posts WHERE id='existing'").first()).data,JSON.stringify({title:'Local'}));
  assert.equal(JSON.parse((await env.DB.prepare("SELECT data FROM posts WHERE id='new-page'").first()).data).content_md,'Hello');
  assert.equal(JSON.parse((await env.DB.prepare("SELECT value FROM settings WHERE key='settings'").first()).value).site_id,'local');
});

test('invalid IDs, duplicate IDs, invalid statuses, and oversized input are rejected before writing',async()=>{
  const env=environment();
  await assert.rejects(importContentPackage(env,{pages:[{id:'../escape',data:{title:'Bad',status:'draft'}}]}));
  await assert.rejects(importContentPackage(env,{pages:[{id:'same',data:{title:'A',status:'draft'}},{id:'same',data:{title:'B',status:'draft'}}]}));
  await assert.rejects(importContentPackage(env,{pages:[{id:'bad-status',data:{title:'Bad',status:'admin'}}]}));
  await assert.rejects(importContentPackage(env,{pages:[{id:'large',data:{title:'x',status:'draft',content_md:'x'.repeat(1_000_001)}}]}));
  await assert.rejects(importContentPackage(env,{pages:[{id:'unicode',data:{title:'日'.repeat(200_000),status:'draft',content_md:'語'.repeat(200_000)}}]}));
  await assert.rejects(importContentPackage(env,{components:[{id:'bad-component',data:{html:42}}]}));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM posts').first()).n,0);
});

test('WordPress WXR fields map to mikanBox page data and duplicate slugs are rejected',async()=>{
  const payload=normalizeWordPressImport({pages:[
    {title:'Published',slug:'hello-world',status:'publish',date:'2024-01-02 03:04:05',category:'News',content_md:'# Hello'},
    {title:'Pending',slug:'pending',status:'pending',date:'0000-00-00 00:00:00',content_md:'Body'},
    {title:'Private',slug:'private',status:'private',content_md:'Secret'}
  ]});
  assert.deepEqual(payload.pages.map(p=>[p.id,p.data.status,p.data.category]),[
    ['hello-world','public_static','News'],['pending','pending',''],['private','draft','']
  ]);
  assert.equal(payload.pages[0].data.content_md,'# Hello');
  assert.equal(payload.pages[0].data.preview_token,undefined);
  await assert.rejects(importWordPressContent(environment(),{pages:[{slug:'duplicate',title:'One'},{slug:'duplicate',title:'Two'}]}),/Duplicate page ID/);
});

test('legacy public statuses become public and pending pages receive fresh preview tokens',async()=>{
  const env=environment();
  const first=await importContentPackage(env,{pages:[
    {id:'legacy-public',data:{title:'Public',status:'public'}},
    {id:'needs-review',data:{title:'Pending',status:'pending',preview_token:'source-token',revision_tag:'source-revision'}}
  ]});
  assert.equal(first.pages,2);
  const publicData=JSON.parse((await env.DB.prepare("SELECT data FROM posts WHERE id='legacy-public'").first()).data);
  const pendingData=JSON.parse((await env.DB.prepare("SELECT data FROM posts WHERE id='needs-review'").first()).data);
  assert.equal(publicData.status,'public_static');
  assert.ok(pendingData.preview_token);
  assert.notEqual(pendingData.preview_token,'source-token');
  assert.equal(pendingData.revision_tag,undefined);
});


test('authenticated import route adds content and rejects invalid payloads without writes',async()=>{
 const {login,post}=require('./fixtures.cjs');const env=environment(),auth=await login(env);
 let result=await post(env,auth,{save_action:'content_import_package',import_payload:JSON.stringify({pages:[{id:'imported-route',data:{title:'Imported',status:'draft',content_md:'Body'}}]})});
 assert.equal(result.data.success,true);assert.equal(result.data.pages,1);
 result=await post(env,auth,{save_action:'content_import_package',import_payload:JSON.stringify({pages:[{id:'bad-css',data:{title:'Bad',css:{invalid:true}}}]})});
 assert.equal(result.data.success,false);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM posts WHERE id='bad-css'").first()).n,0);
});
