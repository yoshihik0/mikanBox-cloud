const {test}=require('node:test');const assert=require('node:assert/strict');
const {environment,login,post}=require('./fixtures.cjs');
const {issueCode,claimCode}=require('../.test-build/src/devices.js');
test('deleting a user cancels invitations issued by their devices',async()=>{
 const env=environment(),admin=await login(env);await login(env,'removed');
 const device=env.sqlite.prepare('SELECT * FROM device_sessions WHERE username=?').get('removed');
 const code=await issueCode(env,device,true);
 const result=await post(env,admin,{save_action:'delete_user',username:'removed'});assert.equal(result.data.success,true);
 assert.equal(await claimCode(env,code,'new device',new Request('https://cloud.test/admin'),{username:'returning',display_name:'Returning'}),null);
});
