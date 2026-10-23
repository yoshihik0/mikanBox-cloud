const test=require('node:test'),assert=require('node:assert/strict');
const {environment,login}=require('./fixtures.cjs');
const {savePage,loadPage,uploadMedia,getMediaObject}=require('../.test-build/src/storage.js');
const {replaceMediaImage}=require('../.test-build/src/media-transform.js');
const {renameMediaReferences}=require('../.test-build/src/content-operations.js');
const {saveCloudToken,cloudToken,beginD1Export,pollD1Export}=require('../.test-build/src/cloudflare-api.js');
const {beginPublication,hashPublicationFiles,preparePublication,uploadPublicationFile,finishPublication}=require('../.test-build/src/publication-service.js');
const {readPublicationEntry}=require('../.test-build/src/static-publication.js');
const {latestCloudRelease}=require('../.test-build/src/cloud-release.js');
const {CLOUD_VERSION}=require('../.test-build/src/version.js');
// Derived so the assertion does not rot on every version bump.
const newer=CLOUD_VERSION.replace(/\d+$/,part=>String(Number(part)+1));
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
function target(env){Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_WORKER_NAME:'test-cloud',CLOUDFLARE_D1_ID:'isolated-db'});return env;}
test('Cloud release comparison refuses PHP metadata and unavailable release feeds do not invent versions',async()=>{
 const env=environment(),original=global.fetch;assert.equal((await latestCloudRelease(env)).status,'unconfigured');env.CLOUD_RELEASE_MANIFEST_URL='https://releases.example.test/cloud.json';
 try{global.fetch=async()=>Response.json({edition:'sqlite',version:'2.7.0'});assert.equal((await latestCloudRelease(env,true)).status,'error');global.fetch=async()=>Response.json({edition:'cloud',version:'v'+newer,url:'https://releases.example.test/v'+newer});const release=await latestCloudRelease(env,true);assert.equal(release.version,newer);assert.equal(release.outdated,true);}finally{global.fetch=original;}
});
test('AI identity URL does not redirect Cloud page rendering or change its root',()=>{
 const renderer=new MikanBoxRenderer(environment(),{site_url:'https://identity.example.test/alias'},new Request('https://cloud.test/'));
 assert.equal(renderer.getSiteUrl(),'https://cloud.test');
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
test('image replacement and WebP conversion preserve bytes, references and history atomically',async()=>{
 const env=environment(),png=new Uint8Array([137,80,78,71,13,10,26,10]),webp=new TextEncoder().encode('RIFFxxxxWEBPdata');
 await uploadMedia(env,'photo.png',png.buffer,'image/png');await savePage(env,'page',{title:'Image',status:'public_static',content_md:'![image](/media/photo.png)'});
 const before=await getMediaObject(env,'photo.png');await assert.rejects(replaceMediaImage(env,'photo.png',png,'"stale"'),/changed/);
 await renameMediaReferences(env,'photo.png','photo.webp','admin',{bytes:webp,expectedEtag:before.httpEtag});
 assert.equal(await getMediaObject(env,'photo.png'),null);assert.deepEqual(new Uint8Array(await(await getMediaObject(env,'photo.webp')).arrayBuffer()),webp);
 assert.match((await loadPage(env,'page')).content_md,/photo.webp/);assert.match(env.sqlite.prepare('SELECT data FROM post_revisions').get().data,/photo.png/);
});
test('publication inherits existing bindings and recovers an accepted deployment after a lost response',async()=>{
 const env=target(environment());env.CLOUDFLARE_API_TOKEN='test-token';env.ASSETS={fetch:async()=>new Response('public browser asset')};
 const request=new Request('https://cloud.test/admin'),original=global.fetch;let active='initial',metadata,deployCalls=0,failResponse=true;
 global.fetch=async(url,init={})=>{
  if(url.endsWith('/deployments')&&init.method!=='POST')return Response.json({success:true,result:{deployments:[{versions:[{version_id:active,percentage:100}]}]}});
  if(url.endsWith('/assets-upload-session')){const manifest=JSON.parse(init.body).manifest;assert.ok(!manifest['/_headers']);return Response.json({success:true,result:{jwt:'upload-session',buckets:[Object.values(manifest).map(v=>v.hash)]}});}
  if(url.includes('/workers/assets/upload'))return Response.json({success:true,result:{jwt:'completed'}});
  if(url.endsWith('/versions/initial'))return Response.json({success:true,result:{resources:{bindings:[{name:'DB',type:'d1'},{name:'JWT_SECRET',type:'secret_text'},{name:'ASSETS',type:'assets'}],script_runtime:{compatibility_date:'2026-10-03',compatibility_flags:[]}}}});
  if(url.endsWith('/content/v2')){const form=new FormData();form.set('worker.js',new Blob(['export default{}']), 'worker.js');const response=new Response(form);response.headers.set('cf-entrypoint','worker.js');return response;}
  if(url.endsWith('/versions?bindings_inherit=strict')){metadata=JSON.parse(await init.body.get('metadata').text());return Response.json({success:true,result:{id:'new-version'}});}
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
  assert.deepEqual(metadata.bindings.filter(b=>b.name!=='ASSETS'),[{name:'DB',type:'inherit',version_id:'initial'},{name:'JWT_SECRET',type:'inherit',version_id:'initial'}]);assert.equal(metadata.assets.config.html_handling,'none');assert.ok(metadata.assets.config._headers.includes('static'));
  assert.equal(env.sqlite.prepare("SELECT key FROM settings WHERE key='publication_lock'").get(),undefined);
 }finally{global.fetch=original;}
});
