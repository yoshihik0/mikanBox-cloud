const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,login,post,call}=require('./fixtures.cjs');

test('a code for adding your own device is valid for 3 hours; an invitation code for 6 hours, and the panel says so',async()=>{
 const env=environment(),auth=await login(env);
 await post(env,auth,{save_action:'device_code_create'});
 await post(env,auth,{save_action:'device_code_create',invite:'1'});
 const rows=env.sqlite.prepare('SELECT username,created_at,expires_at FROM device_codes ORDER BY created_at,rowid').all();
 const own=rows.find(r=>r.username!==''),invite=rows.find(r=>r.username==='');
 assert.equal((own.expires_at-own.created_at)/3600_000,3);
 assert.equal((invite.expires_at-invite.created_at)/3600_000,6);
 const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.match(site,/data-issued-code-slot="own"[^>]*data-note="[^"]*3/);assert.match(site,/data-issued-code-slot="invite"[^>]*data-note="[^"]*6/);
});
