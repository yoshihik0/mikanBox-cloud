const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {environment,login,post}=require('./fixtures.cjs');
const {savePage,uploadMedia,getMediaObject}=require('../.test-build/src/storage.js');
test('admin backup restores staged original bytes through authenticated actions',async()=>{
 const env=environment(),auth=await login(env),image=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
 await uploadMedia(env,'original.png',image.buffer,'image/png');
 const manifest=(await post(env,auth,{save_action:'download_backup_json'})).data.manifest;
 const part=(await post(env,auth,{save_action:'backup_media_part',file:'original.png',index:'0',expected:JSON.stringify(manifest.media[0])})).data.part;
 await savePage(env,'later',{title:'Later',status:'draft'});
 const stage=(await post(env,auth,{save_action:'restore_backup_json',manifest:JSON.stringify(manifest)})).data.stage;
 assert.ok(stage);assert.equal((await post(env,auth,{save_action:'backup_restore_part',stage,part:JSON.stringify(part)})).data.success,true);
 const result=await post(env,auth,{save_action:'backup_restore_commit',stage});assert.equal(result.data.success,true);
 assert.equal(env.sqlite.prepare("SELECT id FROM posts WHERE id='later'").get(),undefined);
 assert.deepEqual(new Uint8Array(await(await getMediaObject(env,'original.png')).arrayBuffer()),image);
});
test('browser creates a standard JSON file and streams it back through restore actions',async()=>{
 const source=fs.readFileSync('public/mikanbox/cloud-backup.js','utf8');let handler,download,blob,downloadUrl;const calls=[];
 const part={key:'one.png',index:0,content_base64:'AAAA',sha256:'hash'},manifest={media:[{key:'one.png',chunk_count:1}]};
 const context={FormData,File,Blob,TextDecoder,Uint8Array,URL:{createObjectURL(value){blob=value;return downloadUrl='blob:test';},revokeObjectURL(){}},setTimeout(){},confirm:()=>true,location:{reload(){}},window:{CSRF_TOKEN:'csrf'},document:{documentElement:{lang:'en'},addEventListener(name,callback){handler=callback;},createElement(){return download={click(){}};}},fetch:async(url,init)=>{const name=init.body.get('save_action');calls.push({name,body:init.body});let result={success:true};if(name==='download_backup_json')result.manifest=manifest;if(name==='backup_media_part')result.part=part;if(name==='restore_backup_json')result.stage='stage';return {ok:true,json:async()=>result};}};
 vm.runInNewContext(source,context);
 async function submit(kind,file){const data=new FormData();data.set('current_password','pw');if(file)data.set('backup_file',file);const output={};const form={dataset:{cloudbackup:kind},querySelector:()=>output,querySelectorAll:()=>[]};context.FormData=class extends FormData{constructor(input){super();if(input===form)for(const [k,v] of data)this.set(k,v);}};await handler({target:form,preventDefault(){},stopImmediatePropagation(){}});return output;}
 await submit('export');assert.equal(download.href,downloadUrl);const text=await blob.text();assert.deepEqual(JSON.parse(text),{manifest,parts:[part]});
 const output=await submit('restore',new File([text],'backup.json',{type:'application/json'}));assert.match(output.textContent,/completed/);
 const staged=calls.find(call=>call.name==='backup_restore_part');assert.deepEqual(JSON.parse(staged.body.get('part')),part);assert.ok(calls.some(call=>call.name==='backup_restore_commit'));
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
 let handler,commits=0,stage,reloaded=false;const output={};const file=new File(['{"manifest":'+JSON.stringify(manifest)+',\n"parts":[\n]}\n'],'backup.json');const form={dataset:{cloudbackup:'restore'},querySelector:()=>output,querySelectorAll:()=>[]};
 class Fields extends FormData{constructor(input){super();if(input===form)this.set('backup_file',file);}}
 const context={FormData:Fields,File,Blob,TextDecoder,Uint8Array,confirm:()=>true,location:{reload(){reloaded=true;}},window:{CSRF_TOKEN:auth.csrf_token,showToast(){},cloudPublish:async()=>{if(publishFailure)throw new Error('Injected publication failure');}},document:{documentElement:{lang:'en'},addEventListener(_,h){handler=h;}},fetch:async(_,init)=>{
  const data=Object.fromEntries(init.body),name=data.save_action;const response=await post(env,auth,data);if(name==='restore_backup_json')stage=response.data.stage;if(name==='backup_restore_commit'&&++commits===1)throw new Error('Injected lost HTTP response');return {ok:response.response.ok,json:async()=>response.data};
 }};
 vm.runInNewContext(fs.readFileSync('public/mikanbox/cloud-backup.js','utf8'),context);await handler({target:form,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(commits,2);assert.equal(env.sqlite.prepare("SELECT id FROM posts WHERE id='later'").get(),undefined);
 if(publishFailure){assert.match(output.textContent,/Restore completed, but publication failed/);assert.equal(reloaded,false);}else{assert.match(output.textContent,/Restore completed/);assert.equal(reloaded,true);}
 const other=await login(env,'another-editor');assert.equal((await post(env,other,{save_action:'backup_restore_commit',stage})).data.success,false);
});
