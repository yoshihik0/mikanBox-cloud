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

test('the MCP API key is generated in place, and the token steps are written next to the form that needs it',async()=>{
 const {post}=require('./fixtures.cjs');
 const env=environment(),auth=await login(env);
 const page=await (await call(env,'/admin',undefined,auth.cookie)).text();
 assert.match(page,/id="mcp-key-issued" style="display:none;"/);
 assert.match(page,/id="mcp-key-generate" data-mcp-key-form>/);
 assert.match(page,/class="token-guide"/);
 assert.match(page,/Workers スクリプト/);
 const first=await post(env,auth,{save_action:'generate_api_key'});
 assert.equal(first.data.success,true);assert.match(first.data.mcp_api_key,/^[0-9a-f]{64}$/);
 const shown=await (await call(env,'/admin',undefined,auth.cookie)).text();
 assert.ok(shown.includes(first.data.mcp_api_key));assert.match(shown,/id="mcp-key-generate" data-mcp-key-form style="display:none;"/);
 const second=await post(env,auth,{save_action:'generate_api_key'});
 assert.notEqual(second.data.mcp_api_key,first.data.mcp_api_key);
});
