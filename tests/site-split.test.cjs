const test=require('node:test'),assert=require('node:assert/strict');
const {environment,call,login}=require('./fixtures.cjs');
const {savePage,saveComponent,uploadMedia}=require('../.test-build/src/storage.js');
const {buildStatic}=require('../.test-build/src/ssg.js');
const {publicationManifest,readPublicationEntry}=require('../.test-build/src/static-publication.js');
const {beginPublication,hashPublicationFiles,preparePublication,uploadPublicationFile,finishPublication}=require('../.test-build/src/publication-service.js');
const {publicRequest}=require('../.test-build/src/site-split.js');
const admin=new Request('https://admin.cloud.test/admin'),decode=new TextDecoder();
function split(env){Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_WORKER_NAME:'cloud-admin',CLOUDFLARE_PUBLIC_WORKER_NAME:'cloud-public',PUBLIC_SITE_URL:'https://www.example.test',ASSETS:{fetch:async request=>new Response('asset:'+new URL(request.url).pathname)}});return env;}
const page=(status,content_md='Body')=>({title:'T',status,content_md});

test('the admin Worker serves no site content without a session in split mode',async()=>{
 const env=split(environment());await savePage(env,'index',page('public_static'));await savePage(env,'about',page('public_dynamic'));await savePage(env,'data',page('db'));
 await saveComponent(env,'card',{html:'',js:'cardJS()'});await uploadMedia(env,'draft.png',new Uint8Array([137,80,78,71,13,10,26,10]).buffer,'image/png');
 for(const url of ['/','/about','/index.php?page=about','/preview/about','/media/draft.png','/component-js/card.js','/api/data','/sitemap.xml','/rss.xml']) {
  const response=await call(env,url);assert.equal(response.status,404,url);assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
  assert.doesNotMatch(await response.text(),/cardJS|PNG|<h1|urlset/,url);
 }
 assert.equal((await call(env,'/public-mcp')).status!==404,true);
});
test('signed-in users are sent to a sandboxed preview of the same path',async()=>{
 const env=split(environment()),auth=await login(env);await savePage(env,'about',page('draft','Draft body'));
 let response=await call(env,'/about',null,auth.cookie);assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'https://cloud.test/preview/about');
 response=await call(env,'/preview/about',null,auth.cookie);assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Security-Policy'),/^sandbox allow-scripts/);assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/allow-same-origin/);
 assert.equal((await call(env,'/admin',null,auth.cookie)).headers.get('Content-Security-Policy').includes('sandbox'),false);
});
test('the public build and feeds carry the public origin, never the admin one',async()=>{
 const env=split(environment());await savePage(env,'index',page('public_static','[About](/about)'));await savePage(env,'about',page('public_static'));
 await buildStatic(env,publicRequest(env,admin));
 const html=env.sqlite.prepare("SELECT html FROM static_pages WHERE id='index'").get().html;assert.doesNotMatch(html,/admin\.cloud\.test/);
 const sitemap=decode.decode((await readPublicationEntry(env,admin,'/sitemap.xml')).body);
 assert.match(sitemap,/https:\/\/www\.example\.test\/about/);assert.doesNotMatch(sitemap,/cloud\.test/);
});
test('the public manifest holds feeds and DB JSON but none of the admin scripts',async()=>{
 const env=split(environment());await savePage(env,'data',page('db','{{DATAROW}}'));await savePage(env,'index',page('public_static'));await buildStatic(env,publicRequest(env,admin));
 const paths=(await publicationManifest(env)).entries.map(entry=>entry.path);
 for(const path of ['/index.html','/sitemap.xml','/rss.xml','/podcast.xml','/api/data.json','/mikanbox/ai-question.js'])assert.ok(paths.includes(path),path);
 for(const path of paths)assert.doesNotMatch(path,/cloud-admin|cloud-publish|admin\.css/);
 assert.match(decode.decode((await readPublicationEntry(env,admin,'/_redirects')).body),/^\/api\/data \/api\/data\.json 200$/m);
 assert.match(decode.decode((await readPublicationEntry(env,admin,'/_headers')).body),/\/api\/\*\n  Access-Control-Allow-Origin: \*/);
 assert.equal(await readPublicationEntry(env,admin,'/api/index.json'),null);
});
test('publication creates an assets-only version on the public Worker',async()=>{
 const env=split(environment());env.CLOUDFLARE_API_TOKEN='test-token';await savePage(env,'index',page('public_static'));
 const original=global.fetch,calls=[];let active='public-initial',metadata;
 global.fetch=async(url,init={})=>{
  calls.push((init.method||'GET')+' '+url.replace(/^.*\/workers\//,''));
  if(url.endsWith('/scripts/cloud-public/deployments')&&init.method!=='POST')return Response.json({success:true,result:{deployments:[{versions:[{version_id:active,percentage:100}]}]}});
  if(url.endsWith('/scripts/cloud-public/assets-upload-session'))return Response.json({success:true,result:{jwt:'session',buckets:[Object.values(JSON.parse(init.body).manifest).map(v=>v.hash)]}});
  if(url.includes('/workers/assets/upload'))return Response.json({success:true,result:{jwt:'completed'}});
  if(url.endsWith('/scripts/cloud-public/versions')){metadata=JSON.parse(await init.body.get('metadata').text());return Response.json({success:true,result:{id:'public-next'}});}
  if(url.endsWith('/scripts/cloud-public/deployments')&&init.method==='POST'){active='public-next';return Response.json({success:true,result:{}});}
  throw new Error('Unexpected API path: '+url);
 };
 try{
  const begin=await beginPublication(env,admin,'admin',true),files=[];
  for(let i=0;i<begin.entries.length;i++){const entry=await readPublicationEntry(env,admin,begin.entries[i].path);files.push({path:entry.path,hash:i.toString(16).padStart(32,'0'),size:entry.body.length,contentType:entry.contentType,bytes:entry.body});}
  await hashPublicationFiles(env,begin.job,'admin',files);const prepared=await preparePublication(env,begin.job,'admin');
  for(const entry of prepared.uploads){const file=files.find(f=>f.hash===entry.hash);await uploadPublicationFile(env,begin.job,'admin',entry.hash,new File([Buffer.from(file.bytes).toString('base64')],entry.hash,{type:file.contentType}));}
  assert.equal((await finishPublication(env,begin.job,'admin')).version,'public-next');
  assert.equal(metadata.main_module,undefined);assert.equal(metadata.bindings,undefined);assert.equal(metadata.assets.jwt,'completed');
  assert.ok(calls.every(call=>!call.includes('cloud-admin')&&!call.includes('content/v2')),calls.join('\n'));
 }finally{global.fetch=original;}
});
test('published feeds do not change between the hashing read and the upload read',async()=>{
 const env=split(environment());await savePage(env,'index',page('public_static'));await savePage(env,'audio',{...page('public_static'),podcast_audio:'a.mp3'});
 const reads=async()=>Promise.all(['/rss.xml','/podcast.xml','/sitemap.xml'].map(async path=>decode.decode((await readPublicationEntry(env,admin,path)).body)));
 const first=await reads(),RealDate=Date;
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+3600_000]));}static now(){return RealDate.now()+3600_000;}};
 try{assert.deepEqual(await reads(),first);}finally{global.Date=RealDate;}
});
test('feeds leave out the 404 page',async()=>{
 const {generateSitemapXml,generateRssXml}=require('../.test-build/src/feeds.js'),{loadSettings}=require('../.test-build/src/storage.js');
 const env=split(environment());for(const id of ['index','404','search'])await savePage(env,id,page('public_static'));
 for(const make of [generateSitemapXml,generateRssXml]){const xml=await make(env,await loadSettings(env),admin);assert.doesNotMatch(xml,/\/404</);assert.match(xml,/\/search</);assert.match(xml,/example\.test\//);}
});
test('the page list knows which pages the public site shows as current',async()=>{
 const {publicationStatus}=require('../.test-build/src/publish-status.js');
 const env=split(environment());await savePage(env,'index',page('public_static'));await savePage(env,'later',page('public_static'));await savePage(env,'draft',page('draft'));
 await buildStatic(env,publicRequest(env,admin));
 const list=async()=>require('../.test-build/src/storage.js').listPages(env);
 let status=await publicationStatus(env,'https://admin.cloud.test',await list());
 assert.equal(status.pages.index.state,'none');assert.equal(status.pages.draft.state,'none');assert.equal(status.stale,2);
 env.sqlite.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?)").run(JSON.stringify({paths:['/index.html','/later.html'],published_at:new Date(Date.now()+1000).toISOString()}));
 status=await publicationStatus(env,'https://admin.cloud.test',await list());
 assert.deepEqual(status.pages.index,{url:'https://www.example.test/',state:'live'});assert.equal(status.pages.later.url,'https://www.example.test/later');assert.equal(status.stale,0);
 await savePage(env,'later',page('public_static','Edited'));
 status=await publicationStatus(env,'https://admin.cloud.test',await list());assert.equal(status.pages.later.state,'stale');assert.equal(status.pages.index.state,'live');assert.equal(status.stale,1);
});
