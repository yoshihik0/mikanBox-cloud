// Every change to pages, components, media and settings leaves a record, whichever way it was made
// (admin screen, MCP, data import), with who made it and the content's sha256 (as PHP 2.26.0).
const test=require('node:test'),assert=require('node:assert/strict');
const {mcpKey,environment,call,login,post}=require('./fixtures.cjs');
const {handleMcp}=require('../.test-build/src/mcp.js');
const {loadPage,saveSettings,loadSettings}=require('../.test-build/src/storage.js');
const rows=env=>env.sqlite.prepare('SELECT * FROM audit_events ORDER BY id').all();
const last=env=>rows(env).at(-1);
const savePage=async(env,auth,id,fields)=>{const current=await loadPage(env,id);return post(env,auth,{save_action:'save_page',old_id:current?id:'',id,title:id,status:'draft',content_md:'',expected_revision:current?.revision_tag||'',...fields});};

test('page edits through the admin screen are recorded with who made them and the content hashes',async()=>{
 const env=environment(),auth=await login(env);
 await savePage(env,auth,'p1',{status:'public_static',content_md:'a'});
 const created=last(env);
 assert.equal(created.event,'page_created');assert.equal(created.target,'p1');assert.equal(created.to_value,'public_static');assert.equal(created.actor,'admin');assert.match(created.after_hash,/^[0-9a-f]{64}$/);
 await savePage(env,auth,'p1',{status:'public_static',content_md:'a<script src=x></script>'});
 const updated=last(env);
 assert.equal(updated.event,'page_updated');assert.equal(updated.actor,'admin');assert.equal(updated.before_hash,created.after_hash);assert.notEqual(updated.after_hash,updated.before_hash);
 const count=rows(env).length;
 await savePage(env,auth,'p1',{status:'public_static',content_md:'b'});await savePage(env,auth,'p1',{status:'public_static',content_md:'c'});
 assert.equal(rows(env).length,count,'repeated saves merge into one record');
 assert.equal(last(env).before_hash,created.after_hash,'the merged record keeps the first before');
 await savePage(env,auth,'p1',{status:'draft',content_md:'c'});
 assert.deepEqual(rows(env).slice(-1).map(r=>[r.event,r.from_value,r.to_value]),[['page_status','public_static','draft']],'a status change alone is a status record');
 await post(env,auth,{save_action:'delete_page',id:'p1'});
 assert.equal(last(env).event,'page_deleted');assert.equal(last(env).actor,'admin');
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE actor=''").get().n,0,'every record of a request gets its author');
});

test('components, settings and the Cloudflare connection are recorded; setting values never are',async()=>{
 const env=environment(),auth=await login(env);
 await post(env,auth,{save_action:'save_comp',id:'wrap',comp_type:'wrapper',html:'<main>{{CONTENT}}</main>'});
 await post(env,auth,{save_action:'save_comp',id:'wrap',old_id:'wrap',comp_type:'wrapper',html:'<script>x</script><main>{{CONTENT}}</main>'});
 await post(env,auth,{save_action:'delete_comp',id:'wrap'});
 assert.deepEqual(rows(env).slice(-3).map(r=>[r.event,r.target,r.actor]),[['component_created','wrap','admin'],['component_updated','wrap','admin'],['component_deleted','wrap','admin']]);
 await post(env,auth,{save_action:'save_memo',memo:'SECRET MEMO VALUE'});
 assert.equal(last(env).event,'settings_changed');assert.equal(last(env).target,'memo');
 assert.doesNotMatch(JSON.stringify(rows(env)),/SECRET MEMO VALUE/);
 const n=rows(env).length;
 await post(env,auth,{save_action:'generate_api_key'});
 assert.deepEqual(rows(env).slice(n).map(r=>r.event),['mcp_key_issued'],'the MCP key has its own record, not a settings change');
 env.sqlite.prepare("INSERT INTO settings(key,value) VALUES('cloud_connection','x')").run();
 assert.equal(last(env).target,'cloud_connection');
});

test('MCP edits are recorded as MCP; media changes are recorded with the file hash',async()=>{
 const env=environment();await saveSettings(env,{...await loadSettings(env),api_key:mcpKey('test-mcp-key')});
 const mcp=(name,args)=>handleMcp(new Request('https://cloud.test/mcp',{method:'POST',headers:{Authorization:'Bearer test-mcp-key','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
 const worker=require('../.test-build/src/index.js').default;
 await worker.fetch(new Request('https://cloud.test/mcp',{method:'POST',headers:{Authorization:'Bearer test-mcp-key','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_page',arguments:{id:'m1',title:'M',content_md:'x'}}})}),env);
 assert.equal(last(env).event,'page_created');assert.equal(last(env).actor,'MCP');
 void mcp;
 env.sqlite.prepare("INSERT INTO media(key,content_type,size,uploaded,etag,hash) VALUES('a.js','text/javascript',1,'',?,?)").run('a'.repeat(64),'a'.repeat(32));
 assert.equal(last(env).event,'media_uploaded');assert.equal(last(env).after_hash,'a'.repeat(64));
 env.sqlite.prepare("UPDATE media SET etag=? WHERE key='a.js'").run('b'.repeat(64));
 assert.deepEqual([last(env).event,last(env).before_hash,last(env).after_hash],['media_changed','a'.repeat(64),'b'.repeat(64)]);
 env.sqlite.prepare("DELETE FROM media WHERE key='a.js'").run();
 assert.equal(last(env).event,'media_deleted');
});

test('a data import is one record, and recording resumes after it',async()=>{
 const env=environment(),auth=await login(env);
 const n=rows(env).length;
 const part=ids=>JSON.stringify({pages:ids.map(id=>({id,data:{title:id,status:'draft'}}))});
 await post(env,auth,{save_action:'transfer_import_data',mode:'add',part:part(['i1','i2'])});
 await post(env,auth,{save_action:'transfer_import_data',mode:'add',part:part(['i3'])});
 assert.deepEqual(rows(env).slice(n).map(r=>[r.event,r.target,r.actor]),[['data_imported','add','admin']]);
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM settings WHERE key='audit_quiet'").get().n,0,'the quiet switch never outlives its batch');
 await savePage(env,auth,'after',{});
 assert.equal(last(env).event,'page_created');
 const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.match(site,/データの読み込み|Data imported/);
});
