const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {environment}=require('./fixtures.cjs');
const {savePage}=require('../.test-build/src/storage.js');
const {buildStatic}=require('../.test-build/src/ssg.js');
const {publicationManifest,readPublicationEntry}=require('../.test-build/src/static-publication.js');
const {beginPublication}=require('../.test-build/src/publication-service.js');
const request=new Request('https://cloud.test/admin');
// The digest the browser computes in cloud-publish.js.
const browserHash=bytes=>createHash('sha256').update(bytes).digest('hex').slice(0,32);
function env(){const value=environment();Object.assign(value,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_WORKER_NAME:'test-cloud',CLOUDFLARE_API_TOKEN:'test-token',ASSETS:{fetch:async r=>new Response('asset:'+new URL(r.url).pathname)}});return value;}
async function withDeployments(run){const original=global.fetch;global.fetch=async url=>{if(url.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:'v1',percentage:100}]}]}});throw new Error('Unexpected API path: '+url);};try{return await run();}finally{global.fetch=original;}}

test('built pages carry the hash the browser would compute, so publication skips reading them',async()=>{
 const value=env();await savePage(value,'index',{title:'Top',status:'public_static',content_md:'日本語の本文'});await savePage(value,'about',{title:'About',status:'public_static',content_md:'About'});
 await buildStatic(value,request);
 const pages=(await publicationManifest(value)).entries.filter(entry=>entry.kind==='page');assert.equal(pages.length,2);
 for(const entry of pages)assert.equal(entry.hash,browserHash((await readPublicationEntry(value,request,entry.path)).body),entry.path);
 const begin=await withDeployments(()=>beginPublication(value,request,'admin',false));
 const unhashed=begin.entries.filter(entry=>!entry.hash).map(entry=>entry.path);
 assert.equal(unhashed.some(path=>path.endsWith('.html')),false,unhashed.join(','));
});
test('a rebuild replaces the hash with that of the new HTML',async()=>{
 const value=env();await savePage(value,'index',{title:'Top',status:'public_static',content_md:'First'});await buildStatic(value,request);
 const first=value.sqlite.prepare("SELECT hash FROM static_pages WHERE id='index'").get().hash;
 await savePage(value,'index',{title:'Top',status:'public_static',content_md:'Second'});await buildStatic(value,request);
 const row=value.sqlite.prepare("SELECT html,hash FROM static_pages WHERE id='index'").get();
 assert.notEqual(row.hash,first);assert.equal(row.hash,browserHash(Buffer.from(row.html)));
});
test('pages without a stored hash fall back to the browser',async()=>{
 const value=env();await savePage(value,'index',{title:'Top',status:'public_static',content_md:'Old'});
 value.sqlite.prepare("INSERT INTO static_pages(id,html,built_at) VALUES('index','<p>restored</p>','now')").run();
 const begin=await withDeployments(()=>beginPublication(value,request,'admin',false));
 assert.equal(begin.entries.find(entry=>entry.path==='/index.html').hash,null);
});
