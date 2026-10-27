const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const script=fs.readFileSync(new URL('../public/mikanbox/cloud-publish.js',`file://${__filename}`),'utf8');
test('completed SQL export posts a capability to the same-origin download endpoint',async()=>{
 let handler,submitted;const form={querySelector:()=>({value:'begin_d1_export'}),querySelectorAll:()=>[]};
 class Form extends FormData{constructor(input){super();if(input===form)this.set('save_action','begin_d1_export');}}
 const document={documentElement:{lang:'ja'},addEventListener:(_,fn)=>handler=fn,querySelector:()=>null,getElementById:()=>null,body:{append(){}},createElement:tag=>tag==='form'?{children:[],append(input){this.children.push(input)},submit(){submitted=this},remove(){}}:{}};
 const window={CSRF_TOKEN:'csrf'};const context={document,window,FormData:Form,File,Blob,Uint8Array,location:{},fetch:async()=>({ok:true,json:async()=>({success:true,capability:'poll-capability',download_capability:'encrypted',export:{status:'complete'}})})};
 vm.runInNewContext(script,context);await handler({target:form,preventDefault(){},stopImmediatePropagation(){}});
 assert.equal(submitted.action,'/admin');assert.equal(submitted.method,'post');assert.equal(submitted.children.find(x=>x.name==='save_action').value,'download_d1_export');assert.equal(submitted.children.find(x=>x.name==='capability').value,'encrypted');
});
