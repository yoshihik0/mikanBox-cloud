const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const script=fs.readFileSync(new URL('../public/mikanbox/cloud-publish.js',`file://${__filename}`),'utf8');
async function submit(name,{published=true,configured=true,count=1,choice='update',fail=false,sameName=false}={}){
 const calls=[],publications=[],dialogs=[];let handler;const handlers=new Map();
 const dialog={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),close(){},showModal(){dialogs.push('rename');handlers.get('click')({target:{closest:()=>({dataset:{renameChoice:choice}})}});}};
 const form={querySelector:()=>({value:name}),querySelectorAll:()=>[]};
 class Form extends FormData{constructor(input){super();if(input===form){this.set('save_action',name);this.set('file','old.png');this.set('new_name',sameName?'old.png':'new.png');}}}
 const context={FormData:Form,File,Uint8Array,Blob,crypto:globalThis.crypto,confirm:()=>true,location:{reload:()=>calls.push({name:'reload'})},window:{CSRF_TOKEN:'csrf',cloudPrepareMediaForm:async data=>{calls.push({name:'prepare'});data.set('new_filename',sameName?'old.png':'old.webp');return data;}},document:{documentElement:{lang:'en'},addEventListener:(_,fn)=>handler=fn,querySelector:()=>null,getElementById:id=>id==='rename-confirm-dialog'?dialog:id==='rename-dialog-message'?{}:{showModal:()=>dialogs.push('connection')}},fetch:async(_,init)=>{const action=init.body.get('save_action');calls.push({name:action,confirmed:init.body.get('confirmed')});const result=action==='media_reference_status'?{success:true,published,publicationConfigured:configured,count,message:'Used references'}:{success:!fail,message:'failure'};return {ok:true,json:async()=>result};}};
 vm.runInNewContext(script,context);context.window.cloudPublish=async(rebuild,excluded)=>publications.push({rebuild,excluded});
 await handler({target:form,preventDefault(){},stopImmediatePropagation(){}});return {calls,publications,dialogs};
}
test('media operations on unpublished images do not require a static publication connection',async()=>{
 for(const name of ['rename_media','convert_media_webp']){const r=await submit(name,{published:false,configured:false});assert.ok(r.calls.some(c=>c.name===name));assert.deepEqual(r.dialogs,name==='rename_media'?['rename']:[]);assert.equal(r.publications.length,0);}
});
test('rename confirmation can cancel, rename alone, or update references',async()=>{
 const cancelled=await submit('rename_media',{choice:'cancel'});assert.equal(cancelled.publications.length,0);assert.equal(cancelled.calls.length,1);
 for(const [choice,confirmed] of [['only','0'],['update','1']]){const r=await submit('rename_media',{published:false,choice});assert.equal(r.calls.find(c=>c.name==='rename_media').confirmed,confirmed);assert.equal(r.publications.length,0);}
});
test('a published image is withdrawn from the delivery target before its source changes',async()=>{
 // One button: withdraw the static file, then delete or rename the source.
 for(const name of ['delete_media','rename_media']){
  const r=await submit(name,{choice:'update'});
  assert.equal(r.publications.length,1);assert.equal(r.publications[0].rebuild,true);
  assert.deepEqual([...r.publications[0].excluded],['/media/old.png']);
  const order=r.calls.map(c=>c.name);assert.ok(order.indexOf(name)>0);assert.ok(order.includes('reload'));
 }
});
test('a published image keeping its name is replaced in place without withdrawal',async()=>{
 const r=await submit('edit_media',{published:true,sameName:true});
 assert.equal(r.publications.length,0);assert.ok(r.calls.some(c=>c.name==='edit_media'));
});
test('unused unpublished images can be renamed without a publication connection',async()=>{
 const r=await submit('rename_media',{published:false,configured:false,count:0});assert.deepEqual(r.dialogs,[]);assert.ok(r.calls.some(c=>c.name==='rename_media'));assert.equal(r.publications.length,0);
});
test('WebP conversion prepares image bytes and withdraws the replaced filename',async()=>{
 const r=await submit('convert_media_webp');assert.deepEqual(r.calls.map(c=>c.name),['media_reference_status','prepare','convert_media_webp','reload']);
 assert.equal(r.publications.length,1);assert.equal(r.publications[0].rebuild,true);
 assert.deepEqual([...r.publications[0].excluded],['/media/old.png']);
 const unpublished=await submit('convert_media_webp',{published:false});assert.equal(unpublished.publications.length,0);
});
test('a failed rename does not reload, and an unpublished one does not publish',async()=>{
 const r=await submit('rename_media',{published:false,fail:true});assert.equal(r.publications.length,0);assert.ok(!r.calls.some(c=>c.name==='reload'));
 const published=await submit('rename_media',{fail:true});assert.ok(!published.calls.some(c=>c.name==='reload'));
});
