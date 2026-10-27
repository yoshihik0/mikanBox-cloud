const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,call}=require('./fixtures.cjs');
const worker=require('../.test-build/src/index.js').default;

test('an upgraded site (users, no devices) offers the setup token form, and it registers the first device', async()=>{
 const env=environment();
 env.sqlite.prepare("INSERT INTO users(username,display_name,password_hash,auth_version) VALUES('admin','Admin','',1)").run();
 const page=await call(env,'/admin'),html=await page.text();
 assert.match(html,/name="login_action" value="setup"/);
 assert.match(html,/name="setup_token"/);
 assert.doesNotMatch(html,/name="login_action" value="claim"/);
 const csrf=page.headers.get('Set-Cookie').match(/login_csrf=([^;]+)/);
 const response=await worker.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:csrf[0]},body:new URLSearchParams({login_action:'setup',csrf_token:csrf[1],setup_token:env.SETUP_TOKEN,username:'admin',device_name:'Laptop'})}),env);
 assert.equal(response.status,303);
 assert.match(response.headers.get('Set-Cookie'),/;/);
 // Once a device exists, the ordinary code form comes back.
 const later=await (await call(env,'/admin')).text();
 assert.match(later,/name="login_action" value="claim"/);
});
