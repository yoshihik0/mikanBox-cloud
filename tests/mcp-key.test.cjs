// The MCP API key is stored only as its fingerprint and shown once, when it is issued (as PHP 2.28.0).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {mcpKey,environment,call,login,post}=require('./fixtures.cjs');
const {saveSettings,loadSettings}=require('../.test-build/src/storage.js');
const worker=require('../.test-build/src/index.js').default;
const mcp=(env,key)=>worker.fetch(new Request('https://cloud.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env);

test('an issued key is stored as its fingerprint, works, and is never shown again',async()=>{
 const env=environment(),auth=await login(env);
 const key=(await post(env,auth,{save_action:'generate_api_key'})).data.mcp_api_key;
 assert.equal((await loadSettings(env)).api_key,mcpKey(key));
 assert.doesNotMatch(JSON.stringify(env.sqlite.prepare('SELECT value FROM settings').all()),new RegExp(key),'the key itself is stored nowhere');
 assert.equal((await mcp(env,key)).status,200);
 assert.equal((await mcp(env,key.slice(0,-1)+(key.endsWith('0')?'1':'0'))).status,401,'a wrong key is refused');
 assert.equal((await mcp(env,mcpKey(key))).status,401,'the stored fingerprint is not a key');
 const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.ok(!site.includes(key)&&!site.includes(mcpKey(key).slice(7)),'neither the key nor its fingerprint is shown');
});

test('a plain key in settings is not accepted, and the update retires it',async()=>{
 const env=environment();await saveSettings(env,{...await loadSettings(env),api_key:'plain-old-key'});
 assert.equal((await mcp(env,'plain-old-key')).status,401);
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(path.join(__dirname,'../migrations')).sort()){
  if(file==='0029_mcp_key_fingerprint.sql')db.prepare("INSERT INTO settings(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({site_name:'S',api_key:'plain-old-key'}));
  db.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
 }
 const settings=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='settings'").get().value);
 assert.equal(settings.api_key,'');assert.equal(settings.site_name,'S');
});
