const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,login,call,putMedia,mockCloudflare,uploadThroughAdmin}=require('./fixtures.cjs');
const {getMedia}=require('../.test-build/src/media-store.js');
const {mediaType,validMediaName}=require('../.test-build/src/media-policy.js');
const {savePage}=require('../.test-build/src/storage.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
const encoder=new TextEncoder();
const script='// 日本語\nwindow.libraryLoaded=true;',style='body{color:rebeccapurple}';
test('code MIME policy accepts UTF-8 without rewriting code and rejects binary and executable double extensions',()=>{
 assert.equal(mediaType(encoder.encode(script),'js'),'text/javascript; charset=utf-8');
 assert.equal(mediaType(encoder.encode(style),'css'),'text/css; charset=utf-8');
 for(const bytes of [new Uint8Array(),new Uint8Array([255]),encoder.encode('x\0y'),new Uint8Array(10_000_001)])assert.equal(mediaType(bytes,'js'),null);
 for(const name of ['../bad.js','.hidden.js','evil.php.js','server.php7.css'])assert.equal(validMediaName(name),false);
});
test('code files are published at once like images, keep their bytes and name, and open on the public site',async()=>{
 const env=environment(),auth=await login(env),cf=mockCloudflare(env);
 try{
  for(const [name,text,mime] of [['library-1.2.min.js',script,'text/javascript'],['library-1.2.min.css',style,'text/css']]) {
   const r=await uploadThroughAdmin(env,auth,name,encoder.encode(text),{cat:'news'});assert.equal(r.success,true,r.message);assert.equal(r.media.name,name,'no category prefix for code');assert.equal(r.media.content_type.split(';')[0],mime);
   assert.equal(Buffer.from(cf.known.get(cf.site.get('/media/'+name))).toString(),text);
   const preview=await call(env,'/admin?media_preview='+name,undefined,auth.cookie);assert.equal(preview.status,302);
   assert.equal((await uploadThroughAdmin(env,auth,name,encoder.encode('changed'))).success,false);
  }
  for(const [name,text] of [['evil.php.js','x'],['binary.js',new Uint8Array([255])],['bad.php','<?php x']])assert.equal((await uploadThroughAdmin(env,auth,name,text)).success,false);
  const html=await(await call(env,'/admin?view=media&cat=news&media_type=js',undefined,auth.cookie)).text();assert.match(html,/library-1.2.min.js/);assert.doesNotMatch(html,/class="media-card-title[^>]*>\s*library-1.2.min.css/);assert.match(html,/Copy embed tag|読み込みタグをコピー/);assert.doesNotMatch(html,/<script src="(?:https:\/\/cloud.test)?\/media\/library/);
 }finally{cf.restore();}
});
test('nested pages complete library paths to the public site',async()=>{
 const env=environment();await putMedia(env,'library.js',encoder.encode(script));await putMedia(env,'library.css',encoder.encode(style));
 await savePage(env,'nested/page',{title:'Library',status:'public_static',wrapper_comp:'__none',is_html:true,content_md:'<link rel="stylesheet" href="media/library.css"><script src="media/library.js?v=1" defer></script><script src="https://cdn.test/x.js"></script>'});
 const {html}=await new MikanBoxRenderer(env,{},new Request('https://cloud.test/admin')).render('nested/page');
 assert.match(html,/href="https:\/\/www.cloud.test\/media\/library.css"/);assert.match(html,/src="https:\/\/www.cloud.test\/media\/library.js\?v=1"/);assert.match(html,/src="https:\/\/cdn.test\/x.js"/);
});
