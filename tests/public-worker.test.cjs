const test=require('node:test'),assert=require('node:assert/strict');
const {environment,login,call,post}=require('./fixtures.cjs');
const {savePage}=require('../.test-build/src/storage.js');
const {beginPublication,preparePublication}=require('../.test-build/src/publication-service.js');
const {publicWorkerMissing}=require('../.test-build/src/site-split.js');
const request=new Request('https://cloud.test/admin');
// Publication goes to a public Worker of its own. Without one nothing is deployed anywhere.
function target(env,extra={}){delete env.CLOUDFLARE_PUBLIC_WORKER_NAME;delete env.PUBLIC_SITE_URL;return Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_WORKER_NAME:'admin-site',CLOUDFLARE_D1_ID:'db',CLOUDFLARE_API_TOKEN:'test-token',ASSETS:{fetch:async()=>new Response('asset')}},extra);}
async function noCloudflare(run){const original=global.fetch;let calls=0;global.fetch=async url=>{calls++;throw new Error('Unexpected Cloudflare call: '+url);};try{return {result:await run(),calls};}catch(error){return {error,calls};}finally{global.fetch=original;}}

test('the public Worker is missing unless it is set and differs from the management Worker',()=>{
 assert.equal(publicWorkerMissing({CLOUDFLARE_WORKER_NAME:'a'}),true);
 assert.equal(publicWorkerMissing({CLOUDFLARE_WORKER_NAME:'a',CLOUDFLARE_PUBLIC_WORKER_NAME:'a'}),true);
 assert.equal(publicWorkerMissing({CLOUDFLARE_WORKER_NAME:'a',CLOUDFLARE_PUBLIC_WORKER_NAME:'a',SITE_ENVIRONMENT:'local'}),true,'the same name is never allowed');
 assert.equal(publicWorkerMissing({CLOUDFLARE_WORKER_NAME:'a',SITE_ENVIRONMENT:'production'}),true);
 assert.equal(publicWorkerMissing({CLOUDFLARE_WORKER_NAME:'a',CLOUDFLARE_PUBLIC_WORKER_NAME:'b'}),false);
 assert.equal(publicWorkerMissing({CLOUDFLARE_WORKER_NAME:'a',SITE_ENVIRONMENT:'local'}),true,'local development is no exception');
});

test('building, publishing and image auto-publication deploy nothing without a public Worker',async()=>{
 for(const extra of [{},{CLOUDFLARE_PUBLIC_WORKER_NAME:'admin-site'},{SITE_ENVIRONMENT:'staging'},{SITE_ENVIRONMENT:'local'}]){
  const env=target(environment(),extra);await savePage(env,'index',{title:'Top',status:'public_static',content_md:'x'});
  for(const args of [[true],[false],[false,[],'photo.png']]){
   const {error,calls}=await noCloudflare(()=>beginPublication(env,request,'admin',...args));
   assert.match(String(error?.message),/CLOUDFLARE_PUBLIC_WORKER_NAME/,JSON.stringify(extra));
   assert.match(String(error?.message),/公開用のWorker/);
   assert.equal(calls,0,'no Cloudflare API call');
  }
  assert.equal(env.sqlite.prepare("SELECT key FROM settings WHERE key='publication_lock'").get(),undefined,'no publication lock is left');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM publication_jobs').get().n,0);
 }
});

test('a job started with a public Worker stops if the setting disappears',async()=>{
 const env=target(environment(),{CLOUDFLARE_PUBLIC_WORKER_NAME:'public-site',PUBLIC_SITE_URL:'https://public.example.test'});
 await savePage(env,'index',{title:'Top',status:'public_static',content_md:'x'});
 const original=global.fetch;global.fetch=async url=>{if(url.endsWith('/workers/scripts/public-site/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:'v1',percentage:100}]}]}});throw new Error('Unexpected API path: '+url);};
 let begin;try{begin=await beginPublication(env,request,'admin',false);}finally{global.fetch=original;}
 env.sqlite.prepare("UPDATE publication_entries SET hash='0123456789abcdef0123456789abcdef',size=1 WHERE hash IS NULL").run();
 delete env.CLOUDFLARE_PUBLIC_WORKER_NAME;
 const {error,calls}=await noCloudflare(()=>preparePublication(env,begin.job,'admin'));
 assert.match(String(error?.message),/CLOUDFLARE_PUBLIC_WORKER_NAME/);assert.equal(calls,0);
});

test('the admin screen refuses publication and says where to set the public Worker',async()=>{
 const env=target(environment()),auth=await login(env);
 const {response,data}=await post(env,auth,{save_action:'publication_begin',rebuild:'1',excluded:'[]',media_only:''});
 assert.equal(data.success,false);assert.match(data.message,/CLOUDFLARE_PUBLIC_WORKER_NAME/);assert.ok(response.status>=400);
 const page=await (await call(env,'/admin',undefined,auth.cookie)).text();
 assert.match(page,/data-public-worker-missing>[^<]*<a href="https:\/\/yoshihiko\.com\/mikanbox\/help_(ja|en)\.html\?edition=cloud#public-worker"/);
 env.CLOUDFLARE_PUBLIC_WORKER_NAME='public-site';env.PUBLIC_SITE_URL='https://public.example.test';
 assert.doesNotMatch(await (await call(env,'/admin',undefined,auth.cookie)).text(),/data-public-worker-missing/);
 delete env.CLOUDFLARE_PUBLIC_WORKER_NAME;env.SITE_ENVIRONMENT='local';
 assert.match(await (await call(env,'/admin',undefined,auth.cookie)).text(),/data-public-worker-missing/,'local development is no exception');
});
