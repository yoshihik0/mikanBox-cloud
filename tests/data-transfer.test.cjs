const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {environment,login,post,mockCloudflare,browserPublish,uploadThroughAdmin}=require('./fixtures.cjs');
const {savePage,loadPage,loadSettings,saveSettings,saveComponent,loadComponent}=require('../.test-build/src/storage.js');
const {getMedia}=require('../.test-build/src/media-store.js');
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
const scripts=['cloud-zip.js','data-transfer.js','cloud-transfer.js'].map(f=>fs.readFileSync('public/mikanbox/'+f,'utf8'));

// The real data tool scripts in a small browser: admin actions go to the Worker, the public site is the mock.
function browser(env,auth){
 const handlers=[],toasts=[];let saved=null;
 const window={MikanUI:{confirm:async()=>true,toast:(m,e)=>toasts.push([m,!!e])},CSRF_TOKEN:auth.csrf_token,PUBLIC_SITE_URL:'https://www.cloud.test',
  cloudPublish:async(rebuild,excluded,mediaOnly,options)=>{if(window.failPublish)throw new Error('Injected publication failure');return browserPublish(env,auth,{rebuild,source:options?.source,newMedia:options?.newMedia});}};
 const context={window,FormData,File,Blob,Response,DataView,DecompressionStream,TextDecoder,TextEncoder,Uint8Array,Map,URL,crypto:globalThis.crypto,setTimeout,
  document:{documentElement:{lang:'en'},addEventListener:(type,fn)=>{if(type==='submit')handlers.push(fn);},body:{append(){}},createElement:()=>({click(){},remove(){}})},
  fetch:async(url,init={})=>{
   if(String(url).startsWith('https://www.cloud.test/'))return global.fetch(url,init);
   const data=Object.fromEntries([...init.body.entries()].map(([k,v])=>[k,v]));
   const form=new FormData();for(const [k,v] of Object.entries(data))form.set(k,v);
   const worker=require('../.test-build/src/index.js').default;
   return worker.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:auth.cookie},body:form}),env);
  }};
 context.globalThis=context;vm.createContext(context);
 for(const code of scripts)vm.runInContext(code,context);
 window.mikanDownload=blob=>{saved=blob;};
 const submit=async form=>{for(const fn of handlers)await fn({target:form,preventDefault(){},stopImmediatePropagation(){}});};
 const fields=values=>{const f=new FormData();for(const [k,v] of Object.entries(values))f.set(k,v);return f;};
 return {toasts,window,
  save:async(contents,history=false)=>{saved=null;const values={contents,...(history?{include_revisions:'1'}:{})};
   const form={dataset:{transfer:'export'},querySelector:()=>null,querySelectorAll:()=>[]};
   const Original=context.FormData;context.FormData=class extends Original{constructor(input){super();if(input===form)for(const [k,v] of fields(values))this.set(k,v);}};
   await submit(form);context.FormData=Original;return saved;},
  read:async(mode,files)=>{const status={textContent:''},button={disabled:false};
   const form={dataset:{transfer:'import',messages:JSON.stringify({transfer_refused:'refused {ids}',transfer_media_failed:'failed {list}'})},reset(){},querySelector:selector=>selector==='input[type="file"]'?{files}:selector==='[name="mode"]:checked'?{value:mode}:selector==='[data-transfer-status]'?status:selector==='button[type="submit"]'?button:selector==='[name="csrf_token"]'?{value:auth.csrf_token}:null};
   await submit(form);return toasts.at(-1);},
  zip:async blob=>window.MikanZip.open(blob),
  newZip:files=>{const z=new window.MikanZip();for(const [n,b] of Object.entries(files))z.add(n,typeof b==='string'?new TextEncoder().encode(b):b);return new File([z.blob()],'file.zip');}};
}
async function site(){
 const env=environment(),auth=await login(env);const cf=mockCloudflare(env);
 await saveSettings(env,{...await loadSettings(env),site_name:'Before',api_key:'live-key'});
 await savePage(env,'index',{title:'Home',status:'public_static',content_md:'v1'});
 await savePage(env,'news/first',{title:'First',status:'draft'});
 await saveComponent(env,'header',{html:'<h1>x</h1>'});
 await browserPublish(env,auth,{rebuild:true});
 return {env,auth,cf};
}

test('Save with "Match the filtered lists": pages, components and media follow their own filters; without the box everything is saved',async()=>{
 const {env,auth,cf}=await site();
 try{
  await savePage(env,'news/first',{title:'First',status:'draft',category:'news'});
  await saveComponent(env,'footer',{html:'<p>f</p>'});
  const filter=JSON.stringify({cat:'news',q:'',fmt:'',q_media:'',media_type:'',media_all:false,components:['header']});
  const some=(await post(env,auth,{save_action:'transfer_export',match_filter:'1',filter_json:filter})).data;
  assert.deepEqual(some.pages.map(p=>p.id),['news/first']);assert.deepEqual(some.components.map(c=>c.id),['header']);
  const byFormat=(await post(env,auth,{save_action:'transfer_export',match_filter:'1',filter_json:JSON.stringify({fmt:'data',components:null})})).data;
  assert.ok(byFormat.pages.length>0&&byFormat.pages.every(p=>['json','xml','csv','txt','js','css'].includes(p.data.output_format)),'only data-format pages');assert.ok(byFormat.components.some(c=>c.id==='footer')&&byFormat.components.some(c=>c.id==='header'),'no component filter saves them all');
  const bySearch=(await post(env,auth,{save_action:'transfer_export',match_filter:'1',filter_json:JSON.stringify({q:'FIRST',components:null})})).data;
  assert.deepEqual(bySearch.pages.map(p=>p.id),['news/first']);
  const ignored=(await post(env,auth,{save_action:'transfer_export',filter_json:filter})).data;
  assert.ok(ignored.pages.length>2&&ignored.pages.some(p=>p.id==='index'),'the filter is used only when the box is checked');
  const nothing=(await post(env,auth,{save_action:'transfer_export',match_filter:'1',filter_json:'not json'})).data;
  assert.equal(nothing.pages.length,ignored.pages.length,'an unusable filter saves everything');
 }finally{cf.restore();}
});

test('Save: one ZIP of the data and the media read from the public site, in the PHP layout; history only when asked for',async()=>{
 const {env,auth,cf}=await site();
 try{
  assert.equal((await uploadThroughAdmin(env,auth,'photo.png',png)).success,true);
  env.sqlite.prepare('INSERT INTO post_revisions(post_id,data,created_at,editor_id) VALUES(?,?,?,?)').run('index','{"title":"Old"}','2026-01-01T00:00:00Z','admin');
  const b=browser(env,auth),zip=await b.zip(await b.save('both'));
  const names=zip.names().sort();
  for(const name of ['data/settings.json','data/posts/index.json','data/posts/news/first.json','data/components/header.json','media/photo.png'])assert.ok(names.includes(name),name);
  assert.ok(!names.some(n=>n.startsWith('data/revisions/')),'no history unless asked for');
  const settings=JSON.parse(new TextDecoder().decode(await zip.read('data/settings.json')));
  assert.equal(settings.site_name,'Before');assert.equal(settings.api_key,undefined);assert.equal(settings.site_id,undefined);
  assert.deepEqual(Buffer.from(await zip.read('media/photo.png')),Buffer.from(png));
  assert.ok((await b.zip(await b.save('data',true))).names().includes('data/revisions/index.json'),'history when asked for');
  assert.deepEqual([...(await b.zip(await b.save('media'))).names()],['media/photo.png']);
  assert.ok(!(await b.zip(await b.save('data'))).names().some(n=>n.startsWith('media/')));
 }finally{cf.restore();}
});

test('Read: add, overwrite and replace; the media go to the public site; the keys stay',async()=>{
 const {env,auth,cf}=await site();
 try{
  const b=browser(env,auth);
  const file=b.newZip({'data/settings.json':JSON.stringify({site_name:'From file',api_key:'evil',site_id:'evil'}),
   'data/posts/index.json':JSON.stringify({title:'From file',status:'public_static',content_md:'file'}),
   'data/posts/added.json':JSON.stringify({title:'Added',status:'draft'}),
   'data/components/header.json':JSON.stringify({html:'file'}),
   'media/new.png':png,'notes.txt':'ignored'});
  // add: only what is missing; the settings are not read
  await b.read('add',[file]);
  assert.equal((await loadPage(env,'index')).title,'Home');assert.equal((await loadPage(env,'added')).title,'Added');
  assert.equal((await loadComponent(env,'header')).html,'<h1>x</h1>');assert.equal((await loadSettings(env)).site_name,'Before');
  assert.ok(await getMedia(env,'new.png'));assert.ok(cf.site.has('/media/new.png'),'the new file is on the public site');
  // overwrite: the same IDs; the previous content goes to the history
  await b.read('overwrite',[file]);
  assert.equal((await loadPage(env,'index')).title,'From file');assert.equal((await loadComponent(env,'header')).html,'file');
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM post_revisions WHERE post_id='index'").get().n,1);
  const settings=await loadSettings(env);assert.equal(settings.site_name,'From file');assert.equal(settings.api_key,'live-key');assert.notEqual(settings.site_id,'evil');
  assert.ok(await loadPage(env,'news/first'),'what the file lacks stays');
  // replace with a saved file brings the site back, and deletes what the file did not have
  await b.read('replace',[b.newZip({'data/posts/only.json':JSON.stringify({title:'Only',status:'draft'})})]);
  const saved=new File([await b.save('both')],'saved.zip');
  assert.deepEqual(env.sqlite.prepare('SELECT id FROM posts').all().map(r=>r.id),['only']);
  assert.ok(await loadComponent(env,'header'),'a file of pages leaves the components alone');
  assert.ok(await getMedia(env,'new.png'),'a file of pages leaves the media alone');
  await b.read('replace',[b.newZip({'media/other.png':png})]);
  assert.equal(await getMedia(env,'new.png'),null);assert.ok(await getMedia(env,'other.png'));
  assert.ok(cf.site.has('/media/other.png')&&!cf.site.has('/media/new.png'),'the public site follows');
  await b.read('replace',[saved]);
  assert.deepEqual(env.sqlite.prepare('SELECT id FROM posts').all().map(r=>r.id),['only']);
  assert.ok(await getMedia(env,'new.png')&&!(await getMedia(env,'other.png')));
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE event='data_restored'").get().n,3);
 }finally{cf.restore();}
});

test('Read: IDs that break the rule and files that are not media are refused, the rest is read',async()=>{
 const {env,auth,cf}=await site();
 try{
  const b=browser(env,auth);
  const [message,error]=await b.read('add',[b.newZip({'data/posts/media/x.json':JSON.stringify({title:'Reserved',status:'draft'}),'data/posts/ok.json':JSON.stringify({title:'OK',status:'draft'})}),new File(['<html>'],'fake.png'),new File([png],'loose.png')]);
  assert.equal(error,true);assert.match(message,/media\/x/);assert.match(message,/fake\.png/);
  assert.ok(await loadPage(env,'ok'));assert.equal(await loadPage(env,'media/x'),null);
  assert.ok(await getMedia(env,'loose.png'));assert.equal(await getMedia(env,'fake.png'),null);
  const [nothing]=await b.read('add',[new File(['x'],'notes.txt')]);assert.match(nothing,/transfer_nothing/);
 }finally{cf.restore();}
});

test('Read: media are recorded only once the public site carries them; a failed publication records nothing',async()=>{
 const {env,auth,cf}=await site();
 try{
  const b=browser(env,auth);
  b.window.failPublish=true;
  const [message,error]=await b.read('add',[b.newZip({'media/late.png':png})]);
  assert.equal(error,true);assert.match(message,/transfer_publish_failed/);
  assert.equal(await getMedia(env,'late.png'),null,'nothing recorded');assert.ok(!cf.site.has('/media/late.png'));
  b.window.failPublish=false;
  await b.read('add',[b.newZip({'media/late.png':png})]);
  assert.ok(await getMedia(env,'late.png'));assert.ok(cf.site.has('/media/late.png'),'reading again puts it on the public site and records it');
  // Recording a file the public site does not carry is refused.
  const r=await post(env,auth,{save_action:'transfer_record_media',media:JSON.stringify([{name:'ghost.png',hash:'a'.repeat(32),etag:'a'.repeat(64),size:3,content_type:'image/png'}])});
  assert.equal(r.data.recorded,0);assert.equal(await getMedia(env,'ghost.png'),null);
 }finally{cf.restore();}
});
