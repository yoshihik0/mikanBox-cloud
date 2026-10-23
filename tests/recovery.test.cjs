const {test}=require('node:test');const assert=require('node:assert/strict');
const {environment,login}=require('./fixtures.cjs');const {setRecovery,getRecoveryQuestion,resetPassword}=require('../.test-build/src/recovery.js');
const {authenticatedUser}=require('../.test-build/src/accounts.js');const {verifyPassword}=require('../.test-build/src/auth.js');
test('secret answers are normalized and hashed, recovery revokes existing sessions',async()=>{
 const env=environment(),auth=await login(env);await setRecovery(env,'admin','test-password','First pet?',' Mi Kan ');
 assert.equal(await getRecoveryQuestion(env,'admin','ip'),'First pet?');
 const row=await env.DB.prepare('SELECT security_answer_hash FROM users').first();assert.notEqual(row.security_answer_hash,'mikan');
 await assert.rejects(setRecovery(env,'admin','incorrect','q','a'),/current password/);
 await resetPassword(env,'admin','MIKAN','new-password','ip');
 assert.equal(await authenticatedUser(new Request('https://cloud.test/admin',{headers:{Cookie:auth.cookie}}),env),null);
 const user=await env.DB.prepare('SELECT password_hash FROM users').first();assert.equal(await verifyPassword('new-password',user.password_hash),true);
});
test('failed recovery is rate limited and cannot change the password',async()=>{
 const env=environment();await login(env);await setRecovery(env,'admin','test-password','q','answer');
 for(let i=0;i<5;i++)await assert.rejects(resetPassword(env,'admin','wrong','new-password','ip'),/Check username/);
 await assert.rejects(resetPassword(env,'admin','answer','new-password','ip'),/Try again later/);
 const user=await env.DB.prepare('SELECT password_hash FROM users').first();assert.equal(await verifyPassword('test-password',user.password_hash),true);
});
