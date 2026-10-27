const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,login,call}=require('./fixtures.cjs');

test('the build button says what is missing when the Cloudflare token is not set, and stays quiet once it is',async()=>{
 const env=environment(),auth=await login(env);
 const before=await (await call(env,'/admin',undefined,auth.cookie)).text();
 assert.match(before,/class="publish-box mt-10" id="publish-box"/);
 assert.match(before,/class="publish-setup"[^>]*>[^<]*<a href="\/admin\?view=site#cloud-connection" data-open-cloud-connection>/);
 env.CLOUDFLARE_API_TOKEN='x'.repeat(40);
 const after=await (await call(env,'/admin',undefined,auth.cookie)).text();
 assert.doesNotMatch(after,/class="publish-setup"/);
});
