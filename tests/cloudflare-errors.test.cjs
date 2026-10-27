const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cloudRequest,cloudResult}=require('../.test-build/src/cloudflare-api.js');
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
test('Cloudflare errors retain codes and messages, with a safe fallback',async()=>{
 const original=global.fetch;
 try {
  global.fetch=async()=>Response.json({success:false,errors:[{code:10021,message:'Invalid asset configuration'}]},{status:400});
  await assert.rejects(cloudRequest(env,'/test',{},'token'),/400.*10021: Invalid asset configuration/);
  global.fetch=async()=>Response.json({success:false,errors:[{code:10000,message:'Authentication error'}]});
  await assert.rejects(cloudResult(env,'/test',{},'token'),/10000: Authentication error/);
  global.fetch=async()=>new Response('not json',{status:502});
  await assert.rejects(cloudRequest(env,'/test',{},'token'),/Cloudflare operation failed \(502\)/);
 } finally {global.fetch=original;}
});
