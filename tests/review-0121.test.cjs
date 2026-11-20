const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment,login,call,post}=require('./fixtures.cjs');
const {savePage,loadPage,loadSettings,saveSettings,saveComponent}=require('../.test-build/src/storage.js');
const worker=require('../.test-build/src/index.js').default;

test('a category in use is deleted only after confirmation, and leaves its pages',async()=>{
 const env=environment(),auth=await login(env);
 await saveSettings(env,{...await loadSettings(env),category_candidates:'news, spare'});
 await savePage(env,'a',{title:'A',status:'draft',category:'news, other'});
 let r=await post(env,auth,{save_action:'delete_category',category:'news'});
 assert.equal(r.data.require_confirm,true);assert.match(r.data.message,/1/);assert.equal((await loadPage(env,'a')).category,'news, other');
 r=await post(env,auth,{save_action:'delete_category',category:'news',confirmed:'1'});
 assert.equal(r.data.success,true);assert.equal((await loadPage(env,'a')).category,'other');assert.equal((await loadSettings(env)).category_candidates,'spare');
 r=await post(env,auth,{save_action:'delete_category',category:'spare'});assert.equal(r.data.require_confirm,undefined);assert.equal((await loadSettings(env)).category_candidates,'');
 const html=await(await call(env,'/admin',undefined,auth.cookie)).text();
 assert.match(html,/class="category-cloud-tag btn-toggle-del-cat"/);assert.match(html,/<span class="category-delete-badge" data-category="other"/);
});

test('MCP can be stopped like in PHP; the key stays and the last use is shown',async()=>{
 const env=environment(),auth=await login(env);const key=(await post(env,auth,{save_action:'generate_api_key'})).data.mcp_api_key;
 const stored=(await loadSettings(env)).api_key;assert.match(stored,/^sha256:[0-9a-f]{64}$/,'only the fingerprint is stored');
 const mcp=(headers)=>worker.fetch(new Request('https://cloud.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env);
 assert.equal((await mcp({'X-API-Key':key})).status,200,'X-API-Key works as in PHP');
 let site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.match(site,/name="mcp_enabled" value="1" checked/);assert.doesNotMatch(site,/id="mcp-last-used">記録なし|id="mcp-last-used">No record/);
 await post(env,auth,{save_action:'set_mcp_enabled'});
 assert.equal((await mcp({Authorization:'Bearer '+key})).status,403);assert.equal((await loadSettings(env)).api_key,stored);
 site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();assert.match(site,/name="mcp_enabled" value="1" >/);
 await post(env,auth,{save_action:'set_mcp_enabled',mcp_enabled:'1'});assert.equal((await mcp({Authorization:'Bearer '+key})).status,200);
});

test('the index page ID can be changed, as in PHP',async()=>{
 const env=environment(),auth=await login(env);await savePage(env,'index',{title:'Top',status:'draft'});
 const html=await(await call(env,'/admin?view=pages&edit=index',undefined,auth.cookie)).text();
 assert.match(html,/<input type="text" name="id" value="index" placeholder="profile"/);
 const r=await post(env,auth,{save_action:'save_page',old_id:'index',id:'index-old',title:'Top',status:'draft',content_md:'',expected_revision:(await loadPage(env,'index')).revision_tag||''});
 assert.equal(r.data.success,true);assert.equal(await loadPage(env,'index'),null);assert.ok(await loadPage(env,'index-old'));
});

test('the design list puts AI instructions first and has a search field instead of the category filter',async()=>{
 const env=environment(),auth=await login(env);
 await saveComponent(env,'zz_ai',{html:'',is_ai_doc:true,memo:'guide'});await saveComponent(env,'aa_part',{html:''});await saveComponent(env,'mm_page',{html:'{{CONTENT}}',is_wrapper:true});
 const html=await(await call(env,'/admin?view=design',undefined,auth.cookie)).text();
 const at=id=>html.indexOf(`data-component-id="${id}"`);
 assert.ok(at('zz_ai')<at('mm_page')&&at('mm_page')<at('aa_part'));
 assert.match(html,/id="admin-component-search"/);assert.doesNotMatch(html,/<option value="category">/);assert.match(html,/data-component-memo="guide"/);
 assert.equal((html.match(/コンポーネントの識別記号です|component identifier/g)||[]).length<=1,true);
});

test('the leftover R2, password and site-URL data are gone after the update',()=>{
 const env=environment();
 const names=env.sqlite.prepare('SELECT name FROM sqlite_master').all().map(r=>r.name).join(' ');
 assert.doesNotMatch(names,/r2_|media_migration|backup_/,'no R2 tables, and no staging of the former JSON restore (0024)');
 for(const [table,column] of [['media','object_key'],['users','password_hash'],['users','security_question']])
  assert.doesNotMatch(env.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql,new RegExp(column));
});

test('recent operations: MCP, keys, page status, devices and failed sign-ins are recorded and shown, keeping the newest 50 of each group',async()=>{
 const env=environment(),auth=await login(env);
 await post(env,auth,{save_action:'generate_api_key'});await post(env,auth,{save_action:'generate_api_key'});
 await post(env,auth,{save_action:'set_mcp_enabled'});await post(env,auth,{save_action:'set_mcp_enabled',mcp_enabled:'1'});
 await savePage(env,'p',{title:'P',status:'draft'});const current=await loadPage(env,'p');
 await post(env,auth,{save_action:'save_page',old_id:'p',id:'p',title:'P',status:'public_static',content_md:'',expected_revision:current.revision_tag||''});
 await post(env,auth,{save_action:'device_code_create'});
 const events=env.sqlite.prepare('SELECT event,actor,target,from_value,to_value FROM audit_events ORDER BY id').all().map(r=>r.event);
 for(const event of ['device_registered','mcp_key_issued','mcp_key_rotated','mcp_disabled','mcp_enabled','page_status','code_issued'])assert.ok(events.includes(event),event);
 const status=env.sqlite.prepare("SELECT * FROM audit_events WHERE event='page_status'").get();assert.equal(status.target,'p');assert.equal(status.from_value,'draft');assert.equal(status.to_value,'public_static');assert.equal(status.actor,'admin');
 const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.match(site,/最近の操作記録|Recent operations/);assert.match(site,/p \(draft → public_static\)/);
 const {AUDIT_EDIT_EVENTS}=require('../.test-build/src/audit.js'),edits='('+AUDIT_EDIT_EVENTS.map(e=>"'"+e+"'").join(',')+')';
 const count=where=>env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE "+where).get().n;
 const before=count("event<>'login_failed' AND event NOT IN "+edits),editsBefore=count('event IN '+edits);
 for(let i=0;i<210;i++)env.sqlite.prepare("INSERT INTO audit_events(at,event) VALUES('2026-01-01T00:00:00Z','login_failed')").run();
 assert.ok(count("event='login_failed'")>=50&&count("event='login_failed'")<100,'failed sign-ins keep at least the newest 50 (removed once in 50 records)');
 assert.equal(count("event<>'login_failed' AND event NOT IN "+edits),before,'a run of failed sign-ins does not push out the important records');
 assert.equal(count('event IN '+edits),editsBefore,'nor the site edits');
 for(let i=0;i<520;i++)env.sqlite.prepare("INSERT INTO audit_events(at,event) VALUES('2026-01-01T00:00:00Z','page_updated')").run();
 assert.ok(count('event IN '+edits)>=500&&count('event IN '+edits)<550,'site edits keep at least the newest 500');
 assert.equal(count("event<>'login_failed' AND event NOT IN "+edits),before,'edits do not push out the important records');
});
