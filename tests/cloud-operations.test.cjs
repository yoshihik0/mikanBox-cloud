const test=require('node:test'),assert=require('node:assert/strict');
const {environment,login,call}=require('./fixtures.cjs');
const {savePage,loadPage}=require('../.test-build/src/storage.js');
const {renameMediaReferences}=require('../.test-build/src/content-operations.js');
const {saveCloudToken,cloudToken,beginD1Export,pollD1Export,prepareD1Download}=require('../.test-build/src/cloudflare-api.js');
const {beginPublication,hashPublicationFiles,preparePublication,uploadPublicationFile,finishPublication}=require('../.test-build/src/publication-service.js');
const {readPublicationEntry}=require('../.test-build/src/static-publication.js');
const {latestCloudRelease}=require('../.test-build/src/cloud-release.js');
const {CLOUD_VERSION}=require('../.test-build/src/version.js');
// Derived so the assertion does not rot on every version bump.
const newer=CLOUD_VERSION.replace(/\d+$/,part=>String(Number(part)+1));
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
function target(env){Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_WORKER_NAME:'test-cloud',CLOUDFLARE_D1_ID:'isolated-db'});return env;}
test('Cloud release comparison refuses PHP metadata and unavailable release feeds do not invent versions',async()=>{
 const env=environment(),original=global.fetch;env.CLOUD_RELEASE_MANIFEST_URL='https://releases.example.test/cloud.json';
 try{global.fetch=async()=>Response.json({edition:'sqlite',version:'2.7.0'});assert.equal((await latestCloudRelease(env,true)).status,'error');global.fetch=async()=>Response.json({edition:'cloud',version:'v'+newer,url:'https://releases.example.test/v'+newer});const release=await latestCloudRelease(env,true);assert.equal(release.version,newer);assert.equal(release.outdated,true);}finally{global.fetch=original;}
});
test('Cloud release notice reads published releases, not a branch',async()=>{
 const env=environment(),original=global.fetch;let requested;
 const feed=(...tags)=>'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">'+tags.map(tag=>`<entry><id>tag:github.com,2008:Repository/1/${tag}</id><link rel="alternate" type="text/html" href="https://github.com/yoshihik0/mikanBox-cloud/releases/tag/${tag}"/><title>${tag}</title></entry>`).join('')+'</feed>';
 try{
  global.fetch=async url=>{requested=url;return new Response(feed('nightly','v'+newer,'v'+CLOUD_VERSION),{headers:{'Content-Type':'application/atom+xml'}});};
  const release=await latestCloudRelease(env,true);
  assert.equal(requested,'https://github.com/yoshihik0/mikanBox-cloud/releases.atom');
  assert.doesNotMatch(requested,/raw\.githubusercontent\.com|split-prototype/);
  assert.equal(release.version,newer);assert.equal(release.outdated,true);
  assert.equal(release.url,'https://github.com/yoshihik0/mikanBox-cloud/releases/tag/v'+newer);
  global.fetch=async()=>new Response(feed('v'+CLOUD_VERSION));assert.equal((await latestCloudRelease(env,true)).outdated,false);
  global.fetch=async()=>new Response('<feed><entry><link href="https://github.com/someone/else/releases/tag/v99.0.0"/></entry></feed>');
  assert.equal((await latestCloudRelease(env,true)).status,'error','another repository never counts');
  global.fetch=async()=>new Response('x'.repeat(600*1024));assert.equal((await latestCloudRelease(env,true)).status,'error','an oversized answer is refused');
 }finally{global.fetch=original;}
});
test('AI identity URL does not redirect Cloud page rendering or change its root',()=>{
 const renderer=new MikanBoxRenderer(environment(),{site_url:'https://identity.example.test/alias'},new Request('https://cloud.test/'));
 assert.equal(renderer.getSiteUrl(),'https://www.cloud.test');
});
test('encrypted Cloud credentials and export polling do not depend on D1 availability',async()=>{
 const env=target(environment()),original=global.fetch,token='private-test-credential-123456',requests=[];
 global.fetch=async(url,init)=>{requests.push({url,init});return Response.json({success:true,result:url.endsWith('/deployments')?{deployments:[]}:{at_bookmark:'bookmark',status:'complete',result:{signed_url:'https://example.test/backup.sql'}}});};
 try{
  await saveCloudToken(env,token);assert.equal(await cloudToken(env),token);assert.doesNotMatch(env.sqlite.prepare("SELECT value FROM settings WHERE key='cloud_connection'").get().value,/private-test/);
  const started=await beginD1Export(env,'https://cloud.test');assert.doesNotMatch(started.capability,/private-test/);env.DB.prepare=()=>{throw new Error('D1 unavailable during export');};
  assert.equal((await pollD1Export(env,started.capability,'https://cloud.test')).status,'complete');assert.equal(JSON.parse(requests.at(-1).init.body).current_bookmark,'bookmark');
  await assert.rejects(pollD1Export(env,started.capability,'https://other.test'),/invalid/);
 }finally{global.fetch=original;}
});
test('completed D1 export streams an authenticated same-origin attachment',async()=>{
 const env=target(environment()),auth=await login(env),original=global.fetch;env.CLOUDFLARE_API_TOKEN='private-test-credential-123456';let downloads=0,apiCalls=0,redirect=false;
 global.fetch=async(url,init={})=>{const u=String(url);if(u.startsWith('https://api.cloudflare.com/')){apiCalls++;if(apiCalls>1)throw new Error('Completed export must not be polled again');return Response.json({success:true,result:{at_bookmark:'bookmark',status:'complete',result:{signed_url:'https://example.test/backup.sql'}}});}if(u==='https://example.test/backup.sql'){downloads++;assert.equal(init.redirect,'manual');return redirect?new Response(null,{status:302,headers:{location:'https://other.test/'}}):new Response('CREATE TABLE example(id INTEGER);');}throw new Error('unexpected URL');};
 try{
  const started=await beginD1Export(env,'https://cloud.test'),ready=await prepareD1Download(env,started.export,'https://cloud.test');assert.doesNotMatch(JSON.stringify(ready),/example.test/);const data={save_action:'download_d1_export',csrf_token:auth.csrf_token,capability:ready.download_capability};
  const unauth=await call(env,'/admin',data);assert.doesNotMatch(unauth.headers.get('content-disposition')||'',/attachment/);assert.equal(downloads,0);
  const badCsrf=await call(env,'/admin',{...data,csrf_token:'bad'},auth.cookie);assert.equal(badCsrf.status,403);assert.equal(downloads,0);
  const invalid=await call(env,'/admin',{...data,capability:'invalid'},auth.cookie);assert.equal(invalid.status,400);assert.equal(downloads,0);
  const response=await call(env,'/admin',data,auth.cookie);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(await response.text(),/CREATE TABLE/);assert.equal(downloads,1);assert.equal(apiCalls,1);
  redirect=true;const redirected=await call(env,'/admin',data,auth.cookie);assert.equal(redirected.status,400);assert.equal(downloads,2);
 }finally{global.fetch=original;}
});
test('split publication token is checked against the public Worker',async()=>{
 const env=target(environment()),original=global.fetch;env.CLOUDFLARE_PUBLIC_WORKER_NAME='public-site';let url='';
 try{global.fetch=async target=>{url=target;return Response.json({success:true,result:{deployments:[]}});};await saveCloudToken(env,'private-test-credential-123456');assert.match(url,/\/scripts\/public-site\/deployments$/);}finally{global.fetch=original;}
});
test('WebP conversion records the published file and rewrites references with history, atomically',async()=>{
 const {putMedia}=require('./fixtures.cjs'),{inspectMedia,getMedia}=require('../.test-build/src/media-store.js');
 const env=environment(),png=new Uint8Array([137,80,78,71,13,10,26,10]),webp=new TextEncoder().encode('RIFFxxxxWEBPdata');
 const before=await putMedia(env,'photo.png',png);await savePage(env,'page',{title:'Image',status:'public_static',content_md:'![image](/media/photo.png)'});
 const converted=await inspectMedia('photo.webp',webp);
 await assert.rejects(renameMediaReferences(env,'photo.png','photo.webp','admin',{...converted,expectedEtag:before.etag}),/public site|公開サイト/,'not recorded before it is published');
 env.sqlite.exec(`INSERT INTO settings(key,value) VALUES('static_publication','{"job":"j1","paths":[]}')`);env.sqlite.exec(`INSERT INTO publication_jobs(id,state) VALUES('j1','{}')`);
 env.sqlite.prepare('INSERT INTO publication_entries(job_id,path,hash,size) VALUES(?,?,?,?)').run('j1','/media/photo.webp',converted.hash,webp.length);
 await assert.rejects(renameMediaReferences(env,'photo.png','photo.webp','admin',{...converted,expectedEtag:'stale'}),/changed/);
 await renameMediaReferences(env,'photo.png','photo.webp','admin',{...converted,expectedEtag:before.etag});
 assert.equal(await getMedia(env,'photo.png'),null);assert.equal((await getMedia(env,'photo.webp')).hash,converted.hash);
 assert.match((await loadPage(env,'page')).content_md,/photo.webp/);assert.match(env.sqlite.prepare('SELECT data FROM post_revisions').get().data,/photo.png/);
});
test('publication recovers an accepted deployment after a lost response',async()=>{
 const env=target(environment());env.CLOUDFLARE_API_TOKEN='test-token';env.ASSETS={fetch:async()=>new Response('public browser asset')};
 const request=new Request('https://cloud.test/admin'),original=global.fetch;let active='initial',metadata,deployCalls=0,failResponse=true;
 global.fetch=async(url,init={})=>{
  if(url.endsWith('/deployments')&&init.method!=='POST')return Response.json({success:true,result:{deployments:[{versions:[{version_id:active,percentage:100}]}]}});
  if(url.endsWith('/assets-upload-session')){const manifest=JSON.parse(init.body).manifest;assert.ok(!manifest['/_headers']);return Response.json({success:true,result:{jwt:'upload-session',buckets:[Object.values(manifest).map(v=>v.hash)]}});}
  if(url.includes('/workers/assets/upload'))return Response.json({success:true,result:{jwt:'completed'}});
  if(url.endsWith('/scripts/cloud-public/versions')&&init.method==='POST'){metadata=JSON.parse(await init.body.get('metadata').text());return Response.json({success:true,result:{id:'new-version'}});}
  if(url.endsWith('/deployments')&&init.method==='POST'){deployCalls++;active='new-version';if(failResponse){failResponse=false;throw new Error('Response lost after deploy');}return Response.json({success:true,result:{}});}
  throw new Error('Unexpected API path: '+url);
 };
 try{
  const begin=await beginPublication(env,request,'admin',false),files=[];
  for(let i=0;i<begin.entries.length;i++){const entry=await readPublicationEntry(env,request,begin.entries[i].path);files.push({path:entry.path,hash:i.toString(16).padStart(32,'0'),size:entry.body.length,contentType:entry.contentType,bytes:entry.body});}
  await hashPublicationFiles(env,begin.job,'admin',files);const prepared=await preparePublication(env,begin.job,'admin');
  await assert.rejects(finishPublication(env,begin.job,'admin'),/not uploaded/);
  for(const entry of prepared.uploads){const file=files.find(f=>f.hash===entry.hash);await uploadPublicationFile(env,begin.job,'admin',entry.hash,new File([Buffer.from(file.bytes).toString('base64')],entry.hash,{type:file.contentType}));}
  await assert.rejects(finishPublication(env,begin.job,'admin'),/Response lost/);const result=await finishPublication(env,begin.job,'admin');assert.equal(result.version,'new-version');assert.equal(deployCalls,1);
  assert.equal(metadata.bindings,undefined,'the public Worker has no code and no bindings');assert.equal(metadata.main_module,undefined);assert.equal(metadata.assets.config.html_handling,'none');assert.ok(metadata.assets.config._headers.includes('static'));
  assert.equal(env.sqlite.prepare("SELECT key FROM settings WHERE key='publication_lock'").get(),undefined);
 }finally{global.fetch=original;}
});
