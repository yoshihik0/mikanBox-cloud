// The tamper check and the unusual-record highlighting (Cloud 0.17.0), and the cheaper history (migration 0028).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {environment,call,login,post}=require('./fixtures.cjs');
const {loadPage}=require('../.test-build/src/storage.js');
const {integrityPlan}=require('../.test-build/src/integrity.js');
const {recentAudit,auditUnusual}=require('../.test-build/src/audit.js');
// The browser part, loaded as the page would load it.
const sandbox={crypto:globalThis.crypto,TextEncoder,document:{getElementById:()=>null,documentElement:{lang:'en'}}};sandbox.window=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/mikanbox/cloud-integrity.js'),'utf8'),sandbox);
const browser=sandbox.MikanIntegrity;
const savePage=async(env,auth,id,fields)=>{const current=await loadPage(env,id);return post(env,auth,{save_action:'save_page',old_id:current?id:'',id,title:id,status:'draft',content_md:'',expected_revision:current?.revision_tag||'',...fields});};
const rows=env=>env.sqlite.prepare('SELECT * FROM audit_events ORDER BY id').all();
async function dataFindings(env){const plan=await integrityPlan(env);return {plan,...await browser.checkData(plan)};}
const flat=found=>Object.entries(found).flatMap(([kind,list])=>list.map(item=>kind+':'+item)).sort();

test('the "before" lookup uses an index, and old records are removed once in 50 records',async()=>{
 const env=environment();
 const plan=env.sqlite.prepare("EXPLAIN QUERY PLAN SELECT after_hash h FROM audit_events WHERE id<? AND target=? AND substr(event,1,?)=? AND after_hash<>'' ORDER BY id DESC LIMIT 1").all(1,'p',5,'page_').map(r=>r.detail).join('|');
 assert.match(plan,/audit_events_target/);assert.doesNotMatch(plan,/SCAN audit_events(?! USING)/);
 const count=()=>env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE event='login_failed'").get().n;
 for(let i=0;i<49;i++)env.sqlite.prepare("INSERT INTO audit_events(at,event) VALUES('2026-01-01T00:00:00Z','login_failed')").run();
 assert.equal(count(),49);
 for(let i=0;i<60;i++)env.sqlite.prepare("INSERT INTO audit_events(at,event) VALUES('2026-01-01T00:00:00Z','login_failed')").run();
 // The trigger ran when id 50 and 100 were inserted (and only then): 109 inserted, the newest 50 stayed at id 100; ids 101..109 came after.
 assert.equal(count(),50+9,'trimmed at id 100, not on every record');
 for(let i=0;i<500;i++)env.sqlite.prepare("INSERT INTO audit_events(at,event) VALUES('2026-01-01T00:00:00Z','page_updated')").run();
 assert.ok(env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE event='page_updated'").get().n<=549);
 const shown=await recentAudit(env);
 assert.equal(shown.filter(r=>r.event==='login_failed').length,50,'the site screen shows exactly the newest 50');
 assert.equal(shown.filter(r=>r.event==='page_updated').length,500,'and 500 edits');
});

test('data saved through the admin screen matches its record; a time-only save does not change that',async()=>{
 const env=environment(),auth=await login(env);
 await savePage(env,auth,'p1',{status:'public_static',content_md:'a'});
 await post(env,auth,{save_action:'save_comp',id:'wrap',comp_type:'wrapper',html:'<main>{{CONTENT}}</main>'});
 await post(env,auth,{save_action:'save_memo',memo:'m'});
 await post(env,auth,{save_action:'generate_api_key'});
 let result=await dataFindings(env);
 assert.deepEqual(flat(result.found),[],'nothing found');
 assert.ok(result.plan.data.some(i=>i.key==='page:p1')&&result.plan.data.some(i=>i.key==='component:wrap')&&result.plan.data.some(i=>i.key==='settings'));
 assert.ok(!JSON.stringify(result.plan).includes(JSON.parse(env.sqlite.prepare("SELECT value FROM settings WHERE key='settings'").get().value).api_key),'the MCP key is never sent to the browser');
 // Only updated_at moves.
 env.sqlite.prepare("UPDATE posts SET data=json_set(data,'$.updated_at','2031-01-01 00:00:00') WHERE id='p1'").run();
 result=await dataFindings(env);assert.deepEqual(flat(result.found),[],'a changed time is not a change');
 const page=result.plan.data.find(i=>i.key==='page:p1');
 assert.equal(await browser.sha256(new TextEncoder().encode(browser.canonicalItem(page.value))),page.after,'the browser computes the Worker\'s fingerprint');
});

test('content changed straight in the database is found; accepting clears it and is an important event',async()=>{
 const env=environment(),auth=await login(env);
 await savePage(env,auth,'p1',{status:'public_static',content_md:'a'});
 await post(env,auth,{save_action:'save_comp',id:'wrap',comp_type:'wrapper',html:'<main>{{CONTENT}}</main>'});
 await post(env,auth,{save_action:'save_memo',memo:'m'});
 env.sqlite.prepare("UPDATE posts SET data=json_set(data,'$.content_md','<script src=//evil.example></script>') WHERE id='p1'").run();
 env.sqlite.prepare("UPDATE components SET data=json_set(data,'$.html','<script>x</script>') WHERE id='wrap'").run();
 env.sqlite.prepare("UPDATE settings SET value=json_set(value,'$.memo','injected') WHERE key='settings'").run();
 let result=await dataFindings(env);
 assert.deepEqual(flat(result.found),['changed:component:wrap','changed:page:p1','changed:settings']);
 // The direct edits left records without a person.
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE actor='' AND event IN ('page_updated','component_updated','settings_changed')").get().n,3);
 env.sqlite.prepare("DELETE FROM posts WHERE id='p1'").run();
 result=await dataFindings(env);assert.ok(result.plan.unusual.some(r=>r.event==='page_deleted'&&r.actor===''),'a deletion straight in the database is a record without a person');
 // With the database's own recording switched off (the import's way), the page is simply gone: found as missing.
 await savePage(env,auth,'p2',{status:'draft',content_md:'b'});
 env.sqlite.prepare("INSERT INTO settings(key,value) VALUES('audit_quiet','1')").run();env.sqlite.prepare("DELETE FROM posts WHERE id='p2'").run();env.sqlite.prepare("DELETE FROM settings WHERE key='audit_quiet'").run();
 result=await dataFindings(env);assert.ok(flat(result.found).includes('missing:page:p2'),'a page removed without a record is found');
 const findings={public:{},data:Object.fromEntries([...result.found.changed,...result.found.missing,...result.found.unrecorded].map(key=>[key,result.current[key]||'']))};
 const before=rows(env).length;
 const accepted=await post(env,auth,{save_action:'integrity_accept',findings:JSON.stringify(findings)});
 assert.equal(accepted.data.success,true);
 const event=rows(env).at(-1);assert.equal(event.event,'integrity_accepted');assert.equal(event.actor,'admin');assert.equal(event.target,'data');
 assert.equal(require('../.test-build/src/audit.js').auditGroup('integrity_accepted'),'important');
 assert.equal(rows(env).length,before+1+0);
 result=await dataFindings(env);assert.deepEqual(flat(result.found),[],'acceptance clears the findings');
 env.sqlite.prepare("UPDATE settings SET value=json_set(value,'$.memo','again') WHERE key='settings'").run();
 result=await dataFindings(env);assert.deepEqual(flat(result.found),['changed:settings'],'a further change is found again');
});

test('public files are compared with the fingerprints recorded at publication',async()=>{
 const env=environment(),auth=await login(env);
 env.sqlite.prepare("INSERT INTO publication_jobs(id,state) VALUES('j1','{}')").run();
 env.sqlite.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?)").run(JSON.stringify({job:'j1',paths:[]}));
 const sha=text=>require('node:crypto').createHash('sha256').update(text).digest('hex').slice(0,32);
 const files={'/index.html':'<h1>top</h1>','/about.html':'<h1>about</h1>','/media/app.js':'console.log(1)','/gone.html':'x','/restored.html':'y'};
 for(const [p,body] of Object.entries(files))env.sqlite.prepare("INSERT INTO publication_entries(job_id,path,hash,size) VALUES('j1',?,?,1)").run(p,p==='/restored.html'?null:sha(body));
 for(const p of ['/media/photo.jpg','/_headers','/_redirects'])env.sqlite.prepare("INSERT INTO publication_entries(job_id,path,hash,size) VALUES('j1',?,?,1)").run(p,'a'.repeat(32));
 const plan=await integrityPlan(env);
 assert.deepEqual(plan.files.map(f=>f.path).sort(),['/about.html','/gone.html','/index.html','/media/app.js','/restored.html'],'images and routing files are not compared');
 const serve=served=>async p=>{if(served[p]===undefined)return {status:404,bytes:null};if(served[p]==='ERR')throw new Error('network');return {status:200,bytes:new TextEncoder().encode(served[p])};};
 let result=await browser.checkPublic(plan,serve({...files,'/gone.html':undefined}));
 assert.deepEqual(flat(result.found),['missing:/gone.html'].sort());assert.equal(result.unverified,1);
 result=await browser.checkPublic(plan,serve({...files,'/index.html':files['/index.html']+'<script src=//evil.example></script>','/media/app.js':'console.log(1);evil()','/about.html':'ERR'}));
 assert.deepEqual(flat(result.found),['changed:/index.html','changed:/media/app.js']);assert.equal(result.unreachable,1);
 // Accept: the differences are remembered by the Worker.
 const findings={public:Object.fromEntries([...result.found.changed,...result.found.missing].map(p=>[p,result.current[p]||''])),data:{}};
 await post(env,auth,{save_action:'integrity_accept',findings:JSON.stringify(findings)});
 assert.equal(rows(env).at(-1).target,'public');
 const again=await integrityPlan(env);
 result=await browser.checkPublic(again,serve({...files,'/index.html':files['/index.html']+'<script src=//evil.example></script>','/media/app.js':'console.log(1);evil()'}));
 assert.deepEqual(flat(result.found),[],'accepted differences are not reported again');
 result=await browser.checkPublic(again,serve({...files,'/index.html':'changed again','/media/app.js':'console.log(1);evil()'}));
 assert.deepEqual(flat(result.found),['changed:/index.html']);
 // Nothing published yet.
 const fresh=environment();assert.equal((await integrityPlan(fresh)).published,false);
});

test('unusual records: a new person and address range, or no person; none on a fresh install',async()=>{
 assert.deepEqual(auditUnusual([{actor:'a',ip:'1.1.1.x'}]),[],'the first record is not unusual');
 assert.deepEqual(auditUnusual([{actor:'a',ip:'1.1.1.x'},{actor:'a',ip:'1.1.1.x'},{actor:'a',ip:'2.2.2.x'},{actor:'b',ip:'1.1.1.x'},{actor:'a',ip:'2.2.2.x'}]),[2,3]);
 assert.deepEqual(auditUnusual([{actor:'a',ip:'1.1.1.x'},{actor:'',ip:'1.1.1.x'}]),[1]);
 const env=environment(),auth=await login(env);
 const view=async()=>await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.doesNotMatch(await view(),/class="audit-unusual"/,'a fresh install highlights nothing');
 await savePage(env,auth,'p1',{status:'draft',content_md:'a'});
 assert.doesNotMatch(await view(),/class="audit-unusual"/,'the usual person and address are not highlighted');
 // A change straight in D1: no person.
 env.sqlite.prepare("UPDATE posts SET data=json_set(data,'$.content_md','x') WHERE id='p1'").run();
 const html=await view();
 assert.match(html,/class="audit-unusual"/,'a record without a person is highlighted');
 const plan=await integrityPlan(env);
 assert.ok(plan.unusual.some(r=>r.actor===''&&r.event==='page_updated'),'and listed under unusual operations');
 // Another person from the same address, and the same person from a new address range.
 env.sqlite.prepare("INSERT INTO audit_events(at,event,actor,target,ip) VALUES(?,?,?,?,?)").run(new Date().toISOString(),'page_updated','stranger','p1','203.0.113.x');
 assert.ok((await integrityPlan(env)).unusual.some(r=>r.actor==='stranger'));
 // Older than 30 days: not listed.
 env.sqlite.prepare("INSERT INTO audit_events(at,event,actor,target,ip) VALUES('2020-01-01T00:00:00.000Z','page_updated','old','p1','198.51.100.x')").run();
 assert.ok(!(await integrityPlan(env)).unusual.some(r=>r.actor==='old'));
});

test('the Site screen has the button above the version row, and the program check is said to be not applicable',async()=>{
 const env=environment(),auth=await login(env);
 const html=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.ok(html.indexOf('id="integrity-run"')>0&&html.indexOf('id="integrity-run"')<html.indexOf('id="cloud-version-row"'));
 assert.match(html,/cloud-integrity\.js/);assert.match(html,/integrity_found&quot;:&quot;[^&]*%s/,'the time placeholder reaches the browser');assert.match(html,/integrity_cloud_program_na/);
 const hostile=await call(env,'/admin',{save_action:'integrity_plan',csrf_token:'wrong',ajax_request:'1'},auth.cookie);
 assert.equal(hostile.status,403,'CSRF protected');
 const anonymous=await call(env,'/admin',{save_action:'integrity_plan',ajax_request:'1'});
 assert.doesNotMatch(await anonymous.text(),/"success":true|"files"/,'admin only');
});

test('records up to an acceptance are no longer unusual; later ones still are (as PHP)',async()=>{
 const {auditUnusual}=require('../.test-build/src/audit.js');
 const rows=[{actor:'a',ip:'1',at:'2026-11-01T00:00:00Z'},{actor:'b',ip:'1',at:'2026-11-02T00:00:00Z'},{actor:'c',ip:'1',at:'2026-11-04T00:00:00Z'}];
 assert.deepEqual(auditUnusual(rows),[1,2]);
 assert.deepEqual(auditUnusual(rows,'2026-11-03T00:00:00Z'),[2]);
 const {environment}=require('./fixtures.cjs'),{integrityAccept,integrityPlan}=require('../.test-build/src/integrity.js');
 const env=environment();
 env.sqlite.prepare("INSERT INTO audit_events(at,event,actor,target,ip) VALUES(?,?,?,?,?)").run(new Date(Date.now()-3600e3).toISOString(),'page_updated','admin','x','1.1.1.x');
 env.sqlite.prepare("INSERT INTO audit_events(at,event,actor,target,ip) VALUES(?,?,?,?,?)").run(new Date(Date.now()-1800e3).toISOString(),'page_updated','','y','');
 assert.ok((await integrityPlan(env)).unusual.length>=1,'a record without a person is listed');
 await integrityAccept(env,{unusual:true},'admin',new Request('https://cloud.test/admin'));
 assert.equal((await integrityPlan(env)).unusual.length,0,'accepting stops listing what was looked at');
});
