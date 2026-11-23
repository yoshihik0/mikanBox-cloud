const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {environment,login,post,call,putMedia,mockCloudflare,browserPublish,uploadThroughAdmin}=require('./fixtures.cjs');
const {savePage,loadPage}=require('../.test-build/src/storage.js');
const {getMedia}=require('../.test-build/src/media-store.js');
const worker=require('../.test-build/src/index.js').default;
const png=(w,h)=>{const b=new Uint8Array(40);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(b.buffer).setUint32(16,w);new DataView(b.buffer).setUint32(20,h);return b;};
async function site(){const env=environment(),auth=await login(env);const cf=mockCloudflare(env);await savePage(env,'index',{title:'Top',status:'public_static',content_md:'x'});return {env,auth,cf};}

test('an upload is published first and recorded only once the public site has exactly that file',async()=>{
 const {env,auth,cf}=await site();
 try{
  // A site never published: the first file goes out with a full build.
  const first=await uploadThroughAdmin(env,auth,'photo.png',png(800,600),{cat:'news'});
  assert.equal(first.success,true,first.message);assert.equal(first.media.name,'news_photo.png');
  const row=await getMedia(env,'news_photo.png');assert.equal(row.width,800);assert.equal(row.height,600);assert.equal(row.hash,row.etag.slice(0,32));
  assert.ok(cf.site.has('/media/news_photo.png'));assert.ok(cf.site.has('/index.html'),'the first upload built the site');
  // Later uploads publish just that file next to what is there.
  assert.equal((await uploadThroughAdmin(env,auth,'b.png',png(10,10))).success,true);
  assert.ok(cf.site.has('/media/news_photo.png')&&cf.site.has('/media/b.png'));
  // The same name is not refused: it gets _1, _2, ... as in the PHP editions.
  const again=await uploadThroughAdmin(env,auth,'b.png',png(20,20));assert.equal(again.success,true,again.message);assert.equal(again.media.name,'b_1.png');
  const third=await uploadThroughAdmin(env,auth,'b.png',png(30,30));assert.equal(third.success,true,third.message);assert.equal(third.media.name,'b_2.png');
  assert.ok(cf.site.has('/media/b.png')&&cf.site.has('/media/b_1.png')&&cf.site.has('/media/b_2.png'));
  // Recording a file the public site does not carry is refused.
  const form=new FormData();form.set('save_action','upload_media');form.set('media_name','ghost.png');form.set('image',new File([png(5,5)],'ghost.png'));form.set('csrf_token',auth.csrf_token);form.set('ajax_request','1');
  const ghost=await(await worker.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:auth.cookie},body:form}),env)).json();
  assert.equal(ghost.success,false);assert.equal(await getMedia(env,'ghost.png'),null);
  // A file of the wrong type never reaches the public site.
  const bad=await uploadThroughAdmin(env,auth,'fake.png',new TextEncoder().encode('<html>'));assert.equal(bad.success,false);assert.ok(!cf.site.has('/media/fake.png'));
 }finally{cf.restore();}
});

test('when Cloudflare asks for files again, they are read from the public site',async()=>{
 const {env,auth,cf}=await site();
 try{
  await uploadThroughAdmin(env,auth,'one.png',png(3,3));
  cf.forget();
  await uploadThroughAdmin(env,auth,'two.png',png(4,4));
  assert.ok(cf.calls.some(url=>url.startsWith('https://www.cloud.test/media/one.png')),'one.png was fetched from the public site');
  assert.deepEqual([...cf.site.keys()].filter(p=>p.startsWith('/media/')).sort(),['/media/one.png','/media/two.png']);
 }finally{cf.restore();}
});

test('a renamed file is served from its old path until the next build, which moves it',async()=>{
 const {env,auth,cf}=await site();
 try{
  await uploadThroughAdmin(env,auth,'old.png',png(3,3));
  const renamed=await post(env,auth,{save_action:'rename_media',file:'old.png',new_name:'new.png',confirmed:'1'});assert.equal(renamed.data.success,true,renamed.data.message);
  assert.equal((await getMedia(env,'new.png')).source,'/media/old.png');
  cf.forget();
  await browserPublish(env,auth,{rebuild:true});
  assert.ok(cf.site.has('/media/new.png')&&!cf.site.has('/media/old.png'));
  assert.equal((await getMedia(env,'new.png')).source,null);
 }finally{cf.restore();}
});

test('a resize publishes the new content under the same name, then records it',async()=>{
 const {env,auth,cf}=await site();
 try{
  await uploadThroughAdmin(env,auth,'pic.png',png(100,100));
  const before=await getMedia(env,'pic.png'),smaller=png(50,50);
  const form=async data=>{const f=new FormData();for(const [k,v] of Object.entries(data))f.set(k,v);f.set('csrf_token',auth.csrf_token);f.set('ajax_request','1');return (await worker.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:auth.cookie},body:f}),env)).json();};
  const prepared=await form({save_action:'media_prepare',file:'pic.png',new_filename:'pic.png',image:new File([smaller],'pic.png')});assert.equal(prepared.success,true,prepared.message);
  // Recording before publishing is refused.
  assert.equal((await form({save_action:'resize_media',file:'pic.png',source_file:'pic.png',new_filename:'pic.png',source_etag:before.etag,image:new File([smaller],'pic.png')})).success,false);
  await browserPublish(env,auth,{mediaOnly:'pic.png',newMedia:prepared.media,bytes:smaller});
  const saved=await form({save_action:'resize_media',file:'pic.png',source_file:'pic.png',new_filename:'pic.png',source_etag:before.etag,image:new File([smaller],'pic.png')});
  assert.equal(saved.success,true,saved.message);assert.equal((await getMedia(env,'pic.png')).width,50);
 }finally{cf.restore();}
});

test('MCP publishes an uploaded file from the server, and says what to do when it cannot',async()=>{
 const env=environment(),auth=await login(env);await savePage(env,'index',{title:'Top',status:'public_static',content_md:'x'});
 const key=(await post(env,auth,{save_action:'generate_api_key'})).data.mcp_api_key||env.sqlite.prepare("SELECT value FROM settings WHERE key='settings'").get().value.match(/"api_key":"([^"]+)"/)[1];
 const tool=async(name,args)=>{const r=await worker.fetch(new Request('https://cloud.test/mcp',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);const j=await r.json();return {error:j.result.isError,text:j.result.content[0].text};};
 const cf=mockCloudflare(env);
 try{
  const image=Buffer.from(png(7,7)).toString('base64');
  const never=await tool('upload_media',{filename:'a.png',content_base64:image});assert.equal(never.error,true);assert.match(never.text,/ビルド|Build/);assert.equal(await getMedia(env,'a.png'),null);
  await browserPublish(env,auth,{rebuild:true});
  const done=await tool('upload_media',{filename:'a.png',content_base64:image,category:'news'});assert.equal(done.error,false,done.text);
  assert.ok(cf.site.has('/media/news_a.png'));assert.ok(await getMedia(env,'news_a.png'));assert.match(done.text,/https:\/\/www\.cloud\.test\/media\/news_a\.png/);
  const renamed=await tool('upload_media',{filename:'a.png',content_base64:image,category:'news'});assert.equal(renamed.error,false,renamed.text);assert.match(renamed.text,/news_a_1\.png/,'a taken name gets _1 and existing files are never overwritten');
  cf.forget();
  const resend=await tool('upload_media',{filename:'b.png',content_base64:image});assert.equal(resend.error,true);assert.match(resend.text,/ビルド|Build/);assert.equal(await getMedia(env,'b.png'),null);
 }finally{cf.restore();}
});

test('exports list the files to read from the public site',async()=>{
 const {env,auth,cf}=await site();
 try{
  await uploadThroughAdmin(env,auth,'x.png',png(2,2));
  const media=await post(env,auth,{save_action:'transfer_export'});assert.deepEqual(media.data.media.map(m=>[m.key,m.from]),[['x.png','/media/x.png']]);
  const whole=await post(env,auth,{save_action:'export_site_list'});
  assert.ok(whole.data.files.some(f=>f.name==='index.html')&&whole.data.files.some(f=>f.name==='media/x.png'));
  assert.ok(typeof whole.data.extra._redirects==='string');
 }finally{cf.restore();}
});

test('the media screen no longer stores files: admin /media/ and media_preview go to the public site',async()=>{
 const env=environment(),auth=await login(env);await putMedia(env,'p.png',png(2,2));
 const direct=await call(env,'/media/p.png',undefined,auth.cookie);assert.equal(direct.status,302);assert.equal(direct.headers.get('Location'),'https://www.cloud.test/media/p.png');
 const preview=await call(env,'/admin?media_preview=p.png',undefined,auth.cookie);assert.equal(preview.status,302);assert.equal(preview.headers.get('Location'),'https://www.cloud.test/media/p.png');
 assert.equal((await call(env,'/media/p.png')).status,404,'nothing without a session');
});

test('update 0022 keeps the media information and drops the stored bytes',()=>{
 const dir=path.join(__dirname,'../migrations'),sqlite=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(dir).sort())if(file<'0022')sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'));
 const etag='ab'.repeat(32);
 sqlite.exec(`INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count) VALUES('a.png','image/png',3,'t','','u1','${etag}',1)`);
 sqlite.prepare('INSERT INTO media_chunks(upload_id,chunk_index,data) VALUES(?,?,?)').run('u1',0,new Uint8Array([1,2,3]));
 sqlite.exec(fs.readFileSync(path.join(dir,'0022_media_on_public_site.sql'),'utf8'));
 const row={...sqlite.prepare('SELECT * FROM media').get()};
 assert.equal(row.hash,etag.slice(0,32));assert.equal(row.size,3);assert.equal(row.data,undefined);assert.equal(row.upload_id,undefined);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('media_chunks','backup_chunks')").get().n,0);
 assert.deepEqual({...sqlite.prepare('SELECT bytes,files FROM media_usage').get()},{bytes:3,files:1});
});
