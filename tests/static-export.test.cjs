const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const {savePage,saveComponent,saveSettings,uploadMedia}=require('../.test-build/src/storage.js');
const {buildStaticExportZip}=require('../.test-build/src/static-export.js');
const request=new Request('https://cloud.test/admin');
const decode=new TextDecoder();
function unzip(bytes) {
  const files=new Map();let offset=0;
  while(offset+30<bytes.length) {
    const view=new DataView(bytes.buffer,bytes.byteOffset+offset);
    if(view.getUint32(0,true)!==0x04034b50)break;
    const size=view.getUint32(18,true),length=view.getUint16(26,true),extra=view.getUint16(28,true),start=offset+30+length+extra;
    files.set(decode.decode(bytes.subarray(offset+30,offset+30+length)),bytes.subarray(start,start+size));offset=start+size;
  }
  return files;
}
async function snapshot(env,id,html,status='public_static') {
  await savePage(env,id,{title:id,status,content_md:'Unbuilt source'});
  await env.DB.prepare('INSERT INTO static_pages(id,html,built_at) VALUES(?,?,?)').bind(id,html,'2026-10-03').run();
}
test('static ZIP exports only built public snapshots without settings, users, AI docs, or private pages',async()=>{
  const env=environment();await saveSettings(env,{api_key:'SECRET_SETTINGS'});
  await snapshot(env,'index','<h1>Saved build</h1>');
  await snapshot(env,'private','SECRET_DRAFT','draft');
  await snapshot(env,'pending','SECRET_PENDING','pending');
  await snapshot(env,'dynamic','Not static','public_dynamic');
  await savePage(env,'unbuilt',{title:'New',status:'public_static'});
  await saveComponent(env,'DESIGN.md',{html:'SECRET_AI',is_ai_doc:true,js:'SECRET_JS'});
  const files=unzip(await buildStaticExportZip(env,request,{structure:'flat'}));
  assert.deepEqual([...files.keys()],['index.html']);assert.equal(decode.decode(files.get('index.html')),'<h1>Saved build</h1>');
  assert.doesNotMatch(decode.decode(await buildStaticExportZip(env,request,{structure:'flat'})),/SECRET/);
});
test('flat and directory exports rewrite public page aliases and preserve exact-ID precedence',async()=>{
  const env=environment();
  await snapshot(env,'index','<a href="https://cloud.test/news/item/">Item</a><a href="/test/index.html">Nested</a><a href="/test/">Exact draft</a><a href="/dynamic/">Live</a><a href="https://other.test/a?x=1&amp;y=2">External</a>');
  await snapshot(env,'news/item','<a href="https://cloud.test/">Home</a><a href="/test/index.html?q=1&amp;x=2#section">Nested</a>');
  await snapshot(env,'test/index','Nested');
  await savePage(env,'test',{title:'Exact private',status:'draft'});
  await savePage(env,'dynamic',{title:'Live',status:'public_dynamic'});
  let files=unzip(await buildStaticExportZip(env,request,{structure:'flat'}));
  assert.match(decode.decode(files.get('index.html')),/href="news\/item.html"/);
  assert.match(decode.decode(files.get('index.html')),/href="https:\/\/cloud.test\/test\/"/);
  assert.match(decode.decode(files.get('index.html')),/https:\/\/other.test\/a\?x=1&amp;y=2/);
  let item=decode.decode(files.get('news/item.html'));assert.match(item,/href="\.\.\/index.html"/);assert.match(item,/\.\.\/test\/index.html\?q=1&amp;x=2#section/);
  files=unzip(await buildStaticExportZip(env,request,{structure:'directory'}));
  assert.ok(files.has('news/item/index.html'));assert.ok(files.has('test/index.html'));
  item=decode.decode(files.get('news/item/index.html'));assert.match(item,/href="\.\.\/\.\.\/index.html"/);assert.match(item,/\.\.\/\.\.\/test\/index.html/);
});
test('export includes referenced original images, scoped component JS, and public CSS assets',async()=>{
  const env=environment(),image=new Uint8Array([137,80,78,71,13,10,26,10,0]);
  await uploadMedia(env,'one.png',image.buffer,'image/png');await uploadMedia(env,'unused.png',image.buffer,'image/png');
  await saveComponent(env,'card',{html:'',js:'window.card=true;'});
  await saveComponent(env,'DESIGN.md',{html:'PRIVATE',is_ai_doc:true,js:'PRIVATE_JS'});
  env.ASSETS={fetch:async req=>new Response(new URL(req.url).pathname==='/mikanbox/site.css'?'body{background:url("../media/one.png")}':'', {status:200})};
  await snapshot(env,'nested/page','<base href="https://cloud.test/"><link href="/mikanbox/site.css" rel="stylesheet"><img src="/media/one.png" srcset="/media/one.png 1x, /media/one.png 2x"><style>p{background:url(/media/one.png)}</style><script src="/component-js/card.js"></script><script src="/component-js/DESIGN.md.js"></script>');
  const files=unzip(await buildStaticExportZip(env,request,{structure:'directory'}));
  assert.ok(files.has('media/one.png'));assert.equal(files.has('media/unused.png'),false);assert.deepEqual(files.get('media/one.png'),image);
  assert.equal(decode.decode(files.get('component-js/card.js')),'window.card=true;');
  assert.equal(files.has('component-js/DESIGN.md.js'),false);
  const html=decode.decode(files.get('nested/page/index.html'));assert.match(html,/src="\.\.\/\.\.\/media\/one.png"/);assert.match(html,/\.\.\/\.\.\/component-js\/card.js/);assert.doesNotMatch(html,/<base|DESIGN\.md/);
  assert.match(decode.decode(files.get('mikanbox/site.css')),/\.\.\/media\/one.png/);
});
test('static export disables Cloud WebMCP and replaces AI controls with a live public-help link',async()=>{
  const env=environment();
  await snapshot(env,'index','<div data-mikanbox-ai-question data-section="one"></div><script src="/mikanbox/ai-question.js" data-mcp-endpoint="/public-mcp" defer></script><script>window.authored=true;</script>');
  const files=unzip(await buildStaticExportZip(env,request,{structure:'flat'})),html=decode.decode(files.get('index.html'));
  assert.match(html,/href="https:\/\/cloud.test\/public-help.html"/);assert.doesNotMatch(html,/data-mikanbox-ai-question|ai-question.js|data-mcp-endpoint/);assert.match(html,/window.authored=true/);assert.equal(files.has('mikanbox/ai-question.js'),false);
});
test('export enforces the 42-query image budget and aggregate 20MB ZIP size before chunk downloads',async()=>{
  const env=environment();let reads=0;
  const original=env.DB.prepare.bind(env.DB);env.DB.prepare=sql=>{if(sql.includes('SELECT data FROM media_chunks'))reads++;return original(sql);};
  for(let i=0;i<20;i++)await env.DB.prepare('INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count) VALUES(?,?,?,?,?,?,?,?)').bind('part'+i+'.png','image/png',1,'now','','id'+i,'hash',2).run();
  await snapshot(env,'index',Array.from({length:20},(_,i)=>'<img src="/media/part'+i+'.png">').join(''));
  await assert.rejects(buildStaticExportZip(env,request,{structure:'flat'}),/42-query/);assert.equal(reads,0);
  const large=environment();
  for(let i=0;i<2;i++)await large.DB.prepare('INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count) VALUES(?,?,?,?,?,?,?,?)').bind('big'+i+'.png','image/png',10_000_000,'now','','id'+i,'hash',1).run();
  await snapshot(large,'index','<img src="/media/big0.png"><img src="/media/big1.png">');
  await assert.rejects(buildStaticExportZip(large,request,{structure:'flat'}),/20 MB/);
});
test('missing builds, unsupported structure, and missing media fail clearly without returning a broken ZIP',async()=>{
  const env=environment();await assert.rejects(buildStaticExportZip(env,request,{structure:'flat'}),/No built/);
  await snapshot(env,'index','<img src="/media/missing.png">');
  await assert.rejects(buildStaticExportZip(env,request,{structure:'flat'}),/Missing image/);
  await assert.rejects(buildStaticExportZip(env,request,{structure:'other'}),/Invalid export structure/);
});
test('directory index path collisions fail instead of creating duplicate ZIP members',async()=>{
  const env=environment();await snapshot(env,'test','Exact');await snapshot(env,'test/index','Nested');
  await assert.rejects(buildStaticExportZip(env,request,{structure:'directory'}),/path collision/);
  const files=unzip(await buildStaticExportZip(env,request,{structure:'flat'}));assert.ok(files.has('test.html'));assert.ok(files.has('test/index.html'));
});
