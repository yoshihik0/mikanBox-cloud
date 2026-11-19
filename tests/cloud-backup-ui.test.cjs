const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {environment,login,post,putMedia}=require('./fixtures.cjs');
const {savePage}=require('../.test-build/src/storage.js');
const {getMedia}=require('../.test-build/src/media-store.js');
const image=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
// Runs the real cloud-backup.js: admin actions go to the Worker, media reads go to the mock public site (env.publicFiles).
function browser(env,auth,{publish,form,file,intercept}={}){
 let handler,blob,reloaded=false;const output={};
 const target=form||{dataset:{cloudbackup:'export'},querySelector:()=>output,querySelectorAll:()=>[]};
 class Fields extends FormData{constructor(input){super();if(input===target&&file)this.set('backup_file',file);}}
 const context={FormData:Fields,File,Blob,Response,DataView,DecompressionStream,TextDecoder,TextEncoder,Uint8Array,Map,URL,crypto:globalThis.crypto,btoa,atob,setTimeout,
  location:{reload(){reloaded=true;},set href(v){reloaded=true;}},
  window:{MikanUI:{confirm:async()=>true,toast(){}},CSRF_TOKEN:auth.csrf_token,PUBLIC_SITE_URL:'https://www.cloud.test',showToast(){},cloudPublish:publish||(async()=>{})},
  document:{documentElement:{lang:'en'},addEventListener(type,listener){if(type==='submit')handler=listener;}},
  fetch:async(url,init={})=>{
   if(String(url).startsWith('https://www.cloud.test/')){const bytes=env.publicFiles?.get(decodeURIComponent(new URL(url).pathname));return bytes?new Response(bytes):new Response('',{status:404});}
   const data=Object.fromEntries(init.body),response=intercept?await intercept(data,()=>post(env,auth,data)):await post(env,auth,data);return new Response(JSON.stringify(response.data),{status:response.response.status});
  }};
 context.globalThis=context;
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/mikanbox/cloud-zip.js','utf8'),context);
 context.window.mikanDownload=value=>{blob=value;};
 vm.runInContext(fs.readFileSync('public/mikanbox/cloud-backup.js','utf8'),context);
 return {run:async()=>{await handler({target,preventDefault(){},stopImmediatePropagation(){}});return {output,blob:()=>blob,reloaded:()=>reloaded};},target,output};
}
// Reads a saved backup with the same reader the restore uses.
async function entries(blob){const context={window:{},Blob,Response,DataView,DecompressionStream,TextDecoder,TextEncoder,Uint8Array,Map,document:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('public/mikanbox/cloud-zip.js','utf8'),context);return context.window.MikanZip.open(blob);}
function zipOf(files){const context={window:{},Blob,Response,DataView,DecompressionStream,TextDecoder,TextEncoder,Uint8Array,Map,document:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('public/mikanbox/cloud-zip.js','utf8'),context);const zip=new context.window.MikanZip();for(const [name,bytes] of Object.entries(files))zip.add(name,bytes);return zip.blob();}
const restoreForm=output=>({dataset:{cloudbackup:'restore'},querySelector:()=>output,querySelectorAll:()=>[]});
const asFile=blob=>blob.arrayBuffer().then(b=>new File([b],'backup.zip'));
test('the browser saves one ZIP with the data and the media from the public site, and restores it, publishing the media from that file',async()=>{
 const env=environment(),auth=await login(env);await putMedia(env,'one.png',image);await savePage(env,'kept',{title:'Backup',status:'draft'});
 const saved=await browser(env,auth).run(),zip=await entries(saved.blob());
 for(const name of ['data/backup.json','data/settings.json','data/posts/kept.json','media/one.png'])assert.ok(zip.has(name),name);
 assert.deepEqual(Buffer.from(await zip.read('media/one.png')),Buffer.from(image));
 const manifest=JSON.parse(Buffer.from(await zip.read('data/backup.json')).toString());assert.equal(manifest.media[0].key,'one.png');assert.equal(manifest.revisions_included,false);
 await savePage(env,'kept',{title:'Changed',status:'draft'});env.sqlite.exec("DELETE FROM media");
 let published=null;
 const restore=browser(env,auth,{form:restoreForm({}),file:await asFile(saved.blob()),publish:async(rebuild,excluded,mediaOnly,options)=>{published={rebuild,file:await options.source('/media/one.png')};}});
 const done=await restore.run();
 assert.equal(JSON.parse(env.sqlite.prepare("SELECT data FROM posts WHERE id='kept'").get().data).title,'Backup');
 assert.ok(await getMedia(env,'one.png'));assert.equal(published.rebuild,true);assert.deepEqual(Buffer.from(published.file.bytes),Buffer.from(image));assert.equal(done.reloaded(),true);
});
test('history goes into the backup only when asked for',async()=>{
 const env=environment(),auth=await login(env);await savePage(env,'p',{title:'Two',status:'draft'});env.sqlite.prepare('INSERT INTO post_revisions(post_id,data,created_at,editor_id) VALUES(?,?,?,?)').run('p','{"title":"One"}','2026-01-01T00:00:00Z','admin');
 const off=await post(env,auth,{save_action:'download_backup_json'});assert.deepEqual(off.data.manifest.revisions,[]);assert.equal(off.data.manifest.revisions_included,false);
 const on=await post(env,auth,{save_action:'download_backup_json',include_revisions:'1'});assert.ok(on.data.manifest.revisions.length>0);assert.equal(on.data.manifest.revisions_included,true);
});
test('a damaged backup is refused before anything is replaced',async()=>{
 const env=environment(),auth=await login(env);await putMedia(env,'one.png',image);
 const zip=await entries((await browser(env,auth).run()).blob());
 const damaged=zipOf({'data/backup.json':await zip.read('data/backup.json'),'media/one.png':new TextEncoder().encode('changed')});
 await savePage(env,'current',{title:'Current',status:'draft'});
 const output={};await browser(env,auth,{form:restoreForm(output),file:await asFile(damaged)}).run();
 assert.match(output.textContent,/damaged/);assert.ok(env.sqlite.prepare("SELECT id FROM posts WHERE id='current'").get());
 const other={};await browser(env,auth,{form:restoreForm(other),file:new File(['{}'],'backup.json')}).run();
 assert.match(other.textContent,/not a mikanBox backup/);
});

test('JSON backup and restore are available on the authenticated import page and absent from site settings',async()=>{
 const env=environment(),auth=await login(env);const worker=require('../.test-build/src/index.js').default;
 const get=path=>worker.fetch(new Request('https://example.com'+path,{headers:{Cookie:auth.cookie}}),env,{});
 const site=await(await get('/admin?view=site')).text();assert.doesNotMatch(site,/data-cloudbackup="(?:export|restore)"/);assert.match(site,/href="\/admin\?view=import"/);
 const tools=await(await get('/admin?view=import')).text();assert.match(tools,/data-cloudbackup="export"/);assert.match(tools,/data-cloudbackup="restore"/);assert.doesNotMatch(tools,/<div id="settings">/);
 assert.equal((await worker.fetch(new Request('https://example.com/admin?view=import'),env,{})).status,200);
});

for(const publishFailure of [false,true])test('browser confirms a lost restore response'+(publishFailure?' and identifies a separate publication failure':''),async()=>{
 const env=environment(),auth=await login(env);const manifest=(await post(env,auth,{save_action:'download_backup_json'})).data.manifest;await savePage(env,'later',{title:'Later',status:'draft'});
 let commits=0;const output={};const file=await asFile(zipOf({'data/backup.json':new TextEncoder().encode(JSON.stringify(manifest))}));const form=restoreForm(output);
 const intercept=async(data,send)=>{const r=await send();if(data.save_action==='backup_restore_commit'&&++commits===1)throw new Error('Injected lost HTTP response');return r;};
 await browser(env,auth,{form,file,intercept,publish:async()=>{if(publishFailure)throw new Error('Injected publication failure');}}).run();
 assert.equal(commits,2,'the script asked again after the lost response');
 assert.equal(env.sqlite.prepare("SELECT id FROM posts WHERE id='later'").get(),undefined);
 if(publishFailure)assert.match(output.textContent,/data is restored, but publication failed/);else assert.match(output.textContent,/Restore completed/);
});
