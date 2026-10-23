const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const storage=require('../.test-build/src/storage.js');
const {savePage,saveComponent,saveSettings,uploadMedia}=storage;
const {buildStatic}=require('../.test-build/src/ssg.js');
const {r2Environment}=require('./r2-fixture.cjs');
const {publicationManifest,readPublicationEntry,publicationEntries,buildPublicationAssets,PUBLICATION_PUBLIC_ASSETS,PUBLICATION_FILE_BYTES,WORKER_FIRST_ROUTES}=require('../.test-build/src/static-publication.js');
const request=new Request('https://cloud.test/admin'),decode=new TextDecoder();
function env() {
  const value=environment();value.ASSETS={fetch:async request=>new Response('public:'+new URL(request.url).pathname)};return value;
}
async function snapshot(env,id,html,status='public_static') {
  await savePage(env,id,{title:id,status,content_md:'Current source'});
  await env.DB.prepare('INSERT INTO static_pages(id,html,built_at) VALUES(?,?,?)').bind(id,html,'now').run();
}
test('publication manifest includes current built public pages and every stored image without loading secrets and snapshot bodies',async()=>{
  const value=env();await saveSettings(value,{api_key:'SECRET_KEY'});
  await snapshot(value,'index','<h1>Published</h1>');await snapshot(value,'draft','SECRET_DRAFT','draft');await snapshot(value,'pending','SECRET_PENDING','pending');await snapshot(value,'dynamic','Not static','public_dynamic');
  await savePage(value,'unbuilt',{title:'Not built',status:'public_static'});
  await saveComponent(value,'card',{html:'',js:'publicJS()'});await saveComponent(value,'DESIGN.md',{html:'SECRET_DOC',is_ai_doc:true,js:'SECRET_JS()'});
  const image=new Uint8Array([137,80,78,71,13,10,26,10]);await uploadMedia(value,'unused-private-context.png',image.buffer,'image/png');
  const manifest=await publicationManifest(value),paths=manifest.entries.map(e=>e.path);
  assert.ok(paths.includes('/index.html'));assert.ok(paths.includes('/component-js/card.js'));
  // Images are published even when no static page references them, because dynamic pages read the same paths.
  assert.ok(paths.includes('/media/unused-private-context.png'));
  for(const path of ['/draft.html','/pending.html','/dynamic.html','/unbuilt.html','/component-js/DESIGN.md.js','/data/settings.json'])assert.equal(paths.includes(path),false);
  assert.equal(manifest.count,paths.length);assert.ok(manifest.totalKnownBytes>image.length);assert.doesNotMatch(JSON.stringify(manifest),/SECRET|Published/);
  assert.deepEqual((await readPublicationEntry(value,request,'/media/unused-private-context.png')).body,image);
});
test('publication uses distinct exact HTML paths and preserves same-origin WebMCP, media and component URLs',async()=>{
  const value=env(),html='<img src="/media/a.png"><a href="/test/">Exact</a><script src="/mikanbox/ai-question.js" data-mcp-endpoint="/public-mcp"></script><div data-mikanbox-ai-question></div>';
  await snapshot(value,'index',html);await snapshot(value,'test','Exact');await snapshot(value,'test/index','Directory');
  const assets=await buildPublicationAssets(value,request);
  assert.equal(decode.decode(assets.get('/index.html').body),html);assert.equal(decode.decode(assets.get('/test.html').body),'Exact');assert.equal(decode.decode(assets.get('/test/index.html').body),'Directory');
  assert.ok(assets.has('/mikanbox/ai-question.js'));assert.match(decode.decode(assets.get('/_headers').body),/X-Mikanbox-Delivery: static/);
  assert.match(decode.decode(assets.get('/_headers').body),/X-Content-Type-Options: nosniff/);assert.match(decode.decode(assets.get('/_headers').body),/\/media\/\*\n  Content-Security-Policy: sandbox/);
});
test('per-file retrieval rechecks publication status and component AI flags after a manifest is made',async()=>{
  const value=env();await snapshot(value,'page','Visible');await saveComponent(value,'script',{html:'',js:'visible()'});
  const before=await publicationManifest(value);assert.ok(before.entries.some(e=>e.path==='/page.html'));
  await savePage(value,'page',{title:'Hidden',status:'draft'});await saveComponent(value,'script',{html:'Hidden',js:'secret()',is_ai_doc:true});
  assert.equal(await readPublicationEntry(value,request,'/page.html'),null);assert.equal(await readPublicationEntry(value,request,'/component-js/script.js'),null);
});
test('reserved pages and malicious path variants cannot be exported or fetched',async()=>{
  const value=env();
  for(const id of ['search','admin','api/x','mcp','public-mcp','public-help','media/x','mikanbox/x','component-js/x'])await snapshot(value,id,'FORBIDDEN');
  const manifest=await publicationManifest(value);assert.equal(manifest.entries.some(e=>e.kind==='page'),false);
  for(const path of ['/search.html','/admin.html','/api/x.html','/mcp.html','/public-help.html','/media/../secret.png','/media/%2e%2e.png','/media/x.png?x=1','//index.html','/mikanbox/config.json','/mikanbox/../../.env','/media/x.mp3','/admin','/data/settings.json'])assert.equal(await readPublicationEntry(value,request,path),null,path);
});
test('publication only reads the fixed public assets and strips request credentials from asset fetches',async()=>{
  const value=env(),seen=[];value.ASSETS={fetch:async req=>{seen.push(req);return new Response('safe asset');}};
  for(const path of PUBLICATION_PUBLIC_ASSETS)assert.ok(await readPublicationEntry(value,new Request('https://cloud.test/admin',{headers:{Authorization:'Bearer SECRET',Cookie:'SECRET'}}),path));
  assert.deepEqual(seen.map(req=>new URL(req.url).pathname),PUBLICATION_PUBLIC_ASSETS);assert.ok(seen.every(req=>!req.headers.has('Authorization')&&!req.headers.has('Cookie')));
});
test('file metadata and asset downloads enforce the 25MiB per-file limit',async()=>{
  const value=env();await snapshot(value,'too-big','x'.repeat(PUBLICATION_FILE_BYTES+1));
  await assert.rejects(publicationManifest(value),/25 MiB/);
  const asset=env();asset.ASSETS={fetch:async()=>new Response('small body',{headers:{'Content-Length':String(PUBLICATION_FILE_BYTES+1)}})};
  await assert.rejects(readPublicationEntry(asset,request,'/mikanbox/admin.css'),/25 MiB/);
});
test('publication generator retrieves one page body at a time',async()=>{
  const value=env();await snapshot(value,'a','A');await snapshot(value,'b','B');let bodies=0;
  const prepare=value.DB.prepare.bind(value.DB);value.DB.prepare=sql=>{if(sql.startsWith('SELECT s.html'))bodies++;return prepare(sql);};
  const generator=publicationEntries(value,request);assert.equal(bodies,0);
  assert.equal((await generator.next()).value.path,'/a.html');assert.equal(bodies,1);
  assert.equal((await generator.next()).value.path,'/b.html');assert.equal(bodies,2);
  await generator.return();
});
test('manifest refuses sites over the 20,000-file publication limit',async()=>{
  const value=env();
  value.sqlite.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<19997) INSERT INTO posts(id,data,status) SELECT 'p'||x,'{}','public_static' FROM n; INSERT INTO static_pages(id,html,built_at) SELECT id,'small','now' FROM posts;");
  await assert.rejects(publicationManifest(value),/20,000/);
});
test('static URL aliases preserve exact private/dynamic precedence and nested index paths',async()=>{
 const value=env();await snapshot(value,'index','Home');await snapshot(value,'test/index','Nested');await snapshot(value,'other/index','Other');await savePage(value,'test',{title:'Private',status:'draft'});
 const rules=decode.decode((await readPublicationEntry(value,request,'/_redirects')).body);
 assert.match(rules,/^\/ \/index.html 200$/m);assert.match(rules,/^\/test\/index \/test\/index.html 200$/m);
 assert.doesNotMatch(rules,/^\/test\/? /m);assert.match(rules,/^\/other \/other\/index.html 200$/m);
});
test('images are published as static files and are not routed to the Worker first',async()=>{
  const value=env(),image=new Uint8Array([137,80,78,71,13,10,26,10]);
  await uploadMedia(value,'photo.png',image.buffer,'image/png');
  await savePage(value,'only-dynamic',{title:'Dynamic',status:'public_dynamic',content_md:'![x](/media/photo.png)'});
  const entry=(await publicationManifest(value)).entries.find(item=>item.path==='/media/photo.png');
  assert.equal(entry.kind,'media');assert.equal(entry.size,image.length);
  assert.deepEqual((await readPublicationEntry(value,request,'/media/photo.png')).body,image);
  assert.equal(WORKER_FIRST_ROUTES.includes('/media/*'),false);
  // The admin and preview paths must keep reaching the Worker.
  for(const route of ['/admin','/admin/*','/preview/*','/api/*'])assert.ok(WORKER_FIRST_ROUTES.includes(route));
});
test('site generation withdraws deleted pages and pages that are no longer static',async()=>{
  const value=env();
  for(const id of ['index','removed','privatised'])await savePage(value,id,{title:id,status:'public_static',content_md:'body'});
  await buildStatic(value,request);
  const published=(await publicationManifest(value)).entries.map(item=>item.path);
  for(const path of ['/index.html','/removed.html','/privatised.html'])assert.ok(published.includes(path));

  await value.DB.prepare("DELETE FROM posts WHERE id='removed'").run();
  await savePage(value,'privatised',{title:'privatised',status:'draft',content_md:'body'});
  await buildStatic(value,request);
  const after=await publicationManifest(value),paths=after.entries.map(item=>item.path);
  assert.ok(paths.includes('/index.html'));
  assert.equal(paths.includes('/removed.html'),false);
  assert.equal(paths.includes('/privatised.html'),false);
  // Their bodies and URL aliases must be gone too, not just the manifest row.
  assert.equal(await readPublicationEntry(value,request,'/removed.html'),null);
  assert.equal(await readPublicationEntry(value,request,'/privatised.html'),null);
  const redirects=decode.decode((await readPublicationEntry(value,request,'/_redirects')).body);
  assert.doesNotMatch(redirects,/removed|privatised/);
});
test('an edited public page keeps its built snapshot until the next rebuild',async()=>{
  const value=env();
  await savePage(value,'page',{title:'Page',status:'public_static',content_md:'First'});
  await buildStatic(value,request);
  await savePage(value,'page',{title:'Page',status:'public_static',content_md:'Second'});
  // Editing does not clear the snapshot, so a publish never drops the page.
  assert.ok((await publicationManifest(value)).entries.some(item=>item.path==='/page.html'));
  assert.match(decode.decode((await readPublicationEntry(value,request,'/page.html')).body),/First/);
  await buildStatic(value,request);
  assert.match(decode.decode((await readPublicationEntry(value,request,'/page.html')).body),/Second/);
});
test('images stored in R2 are published as static files too',async()=>{
  const value=r2Environment();value.ASSETS={fetch:async request=>new Response('public:'+new URL(request.url).pathname)};
  const image=new Uint8Array([137,80,78,71,13,10,26,10]);
  await uploadMedia(value,'r2-photo.png',image.buffer,'image/png');
  const entry=(await publicationManifest(value)).entries.find(item=>item.path==='/media/r2-photo.png');
  assert.equal(entry.kind,'media');assert.equal(entry.size,image.length);
  // The bytes must come back from R2, not only the metadata row from D1.
  assert.deepEqual((await readPublicationEntry(value,request,'/media/r2-photo.png')).body,image);
});
