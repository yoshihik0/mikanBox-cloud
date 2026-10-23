const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,login,call}=require('./fixtures.cjs');
const {r2Environment}=require('./r2-fixture.cjs');
const {mediaType,validMediaName}=require('../.test-build/src/media-policy.js');
const {getMediaObject,uploadMedia,savePage}=require('../.test-build/src/storage.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
const {buildStaticExportZip}=require('../.test-build/src/static-export.js');
const backup=require('../.test-build/src/backup-restore.js');
const migration=require('../.test-build/src/media-migration.js');
const encoder=new TextEncoder();
const script='// 日本語\nwindow.libraryLoaded=true;',style='body{color:rebeccapurple}';
async function upload(env,auth,name,content,csrf=auth.csrf_token) {
 const form=new FormData();form.set('save_action','upload_media');form.set('cat','news');form.set('opt_resize','1');form.set('opt_webp','1');form.set('csrf_token',csrf);form.set('ajax_request','1');form.set('image',new File([content],name));
 const response=await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin?view=media',{method:'POST',headers:{Cookie:auth.cookie},body:form}),env);
 return {response,data:await response.json()};
}
test('code MIME policy accepts UTF-8 without rewriting code and rejects binary and executable double extensions',()=>{
 assert.equal(mediaType(encoder.encode(script),'js'),'text/javascript; charset=utf-8');
 assert.equal(mediaType(encoder.encode(style),'css'),'text/css; charset=utf-8');
 for(const bytes of [new Uint8Array(),new Uint8Array([255]),encoder.encode('x\0y'),new Uint8Array(10_000_001)])assert.equal(mediaType(bytes,'js'),null);
 for(const name of ['../bad.js','.hidden.js','evil.php.js','server.php7.css'])assert.equal(validMediaName(name),false);
});
for(const [label,make] of [['D1',environment],['R2',r2Environment]])test(`${label} code uploads preserve filenames and bytes, serve correct MIME, and never execute in admin previews`,async()=>{
 const env=make(),auth=await login(env);
 for(const [name,text,mime] of [['library-1.2.min.js',script,'text/javascript'],['library-1.2.min.css',style,'text/css']]) {
  assert.equal((await upload(env,auth,name,text)).data.success,true);
  const response=await call(env,'/media/'+name);assert.match(response.headers.get('Content-Type'),new RegExp(mime));assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(await response.text(),text);
  const preview=await call(env,'/admin?media_preview='+name,undefined,auth.cookie);assert.equal(preview.headers.get('Content-Type'),'text/plain; charset=utf-8');assert.equal(preview.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal((await upload(env,auth,name,'changed')).data.success,false);assert.equal(await(await call(env,'/media/'+name)).text(),text);
 }
 assert.equal((await upload(env,auth,'missing-csrf.js','window.x=1','')).response.status,403);
 for(const [name,text] of [['evil.php.js','x'],['binary.js',new Uint8Array([255])],['bad.php','<?php x']])assert.equal((await upload(env,auth,name,text)).data.success,false);
 const html=await(await call(env,'/admin?view=media&cat=news&media_type=js',undefined,auth.cookie)).text();assert.match(html,/library-1.2.min.js/);assert.doesNotMatch(html,/class="media-card-title[^>]*>\s*library-1.2.min.css/);assert.match(html,/Copy embed tag|読み込みタグをコピー/);assert.doesNotMatch(html,/<script src="(?:https:\/\/cloud.test)?\/media\/library/);
 if(label==='R2')assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,0);
});
test('code libraries survive migration and portable restores between D1 and R2, including split UTF-8 characters',async()=>{
 const source=r2Environment('d1');
 const text='a'.repeat(499_999)+'日'+script,bytes=encoder.encode(text);
 await uploadMedia(source,'large.js',bytes.buffer,'text/javascript; charset=utf-8');await uploadMedia(source,'style.css',encoder.encode(style).buffer,'text/css; charset=utf-8');
 const job=await migration.beginMediaMigration(source);let status;do{status=await migration.copyMediaMigrationImage(source,job.id);}while(status.copied<status.total);await migration.finishMediaMigration(source,job.id);
 assert.equal(await new Response((await getMediaObject(source,'large.js')).body).text(),text);
 const manifest=await backup.exportBackupManifest(source);
 for(const target of [environment(),r2Environment()]) {
  const id=await backup.createBackupRestore(target,manifest);
  for(const file of manifest.media)for(let i=0;i<file.chunk_count;i++)await backup.stageBackupMediaPart(target,id,await backup.exportBackupMediaPart(source,file.key,i));
  await backup.commitBackupRestore(target,id);assert.equal(await new Response((await getMediaObject(target,'large.js')).body).text(),text);assert.equal(await new Response((await getMediaObject(target,'style.css')).body).text(),style);
 }
});
test('nested pages complete library paths and portable static exports contain both files',async()=>{
 const env=environment();await uploadMedia(env,'library.js',encoder.encode(script).buffer,'text/javascript; charset=utf-8');await uploadMedia(env,'library.css',encoder.encode(style).buffer,'text/css; charset=utf-8');
 await savePage(env,'nested/page',{title:'Library',status:'public_static',wrapper_comp:'__none',is_html:true,content_md:'<link rel="stylesheet" href="media/library.css"><script src="media/library.js?v=1" defer></script><script src="https://cdn.test/x.js"></script>'});
 const request=new Request('https://cloud.test/admin');const {html}=await new MikanBoxRenderer(env,{},request).render('nested/page');assert.match(html,/href="https:\/\/cloud.test\/media\/library.css"/);assert.match(html,/src="https:\/\/cloud.test\/media\/library.js\?v=1"/);assert.match(html,/src="https:\/\/cdn.test\/x.js"/);
 await env.DB.prepare('INSERT INTO static_pages(id,html,built_at) VALUES(?,?,?)').bind('nested/page',html,'now').run();
 const zip=await buildStaticExportZip(env,request,{structure:'directory'}),text=new TextDecoder().decode(zip);assert.match(text,/media\/library.js/);assert.match(text,/media\/library.css/);assert.match(text,/\.\.\/\.\.\/media\/library.js\?v=1/);assert.match(text,/window.libraryLoaded=true/);
});
