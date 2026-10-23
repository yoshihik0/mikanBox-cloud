const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {environment,call,login,post}=require('./fixtures.cjs');
const {savePage,loadPage,saveComponent,loadComponent,saveSettings,loadSettings}=require('../.test-build/src/storage.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
const {createTranslator}=require('../.test-build/src/i18n.js');
async function loginForm(env){const page=await call(env,'/admin'),m=page.headers.get('Set-Cookie').match(/login_csrf=([^;]+)/);return {cookie:m[0],csrf:m[1]};}
async function setup(env,extra={},forgeCookie=false){const f=await loginForm(env);return require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:forgeCookie?'login_csrf=other':f.cookie},body:new URLSearchParams({login_action:'setup',csrf_token:f.csrf,setup_token:env.SETUP_TOKEN,username:'admin',display_name:'Admin',device_name:'Laptop',...extra})}),env);}
async function claim(env,code){const f=await loginForm(env);return require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:f.cookie},body:new URLSearchParams({login_action:'claim',csrf_token:f.csrf,code,device_name:'Phone'})}),env);}
const page=(status='draft',content_md='private-content')=>({title:'Test',status,content_md,wrapper_comp:'layout'});

test('initial setup requires its token and a used token never works again',async()=>{
  const env=environment();
  let r=await setup(env,{setup_token:'wrong'});assert.equal(r.status,400);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,0);
  r=await setup(env,{csrf_token:'forged'},true);assert.equal(r.status,403);
  await saveSettings(env,{password_hash:'$2y$imported'});
  r=await setup(env);assert.equal(r.status,400);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,0);
});
test('setup registers one device; the same token cannot register another',async()=>{
  const env=environment();await login(env);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM device_sessions').get().n,1);
  assert.equal(env.sqlite.prepare("SELECT password_hash FROM users").get().password_hash,'');
  const r=await setup(env,{username:'admin'});assert.equal(r.status,400);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM device_sessions WHERE revoked_at IS NULL').get().n,1);
});
test('CSRF and cross-origin writes are rejected; unknown action never succeeds',async()=>{
  const env=environment(),auth=await login(env);
  let result=await post(env,{...auth,csrf_token:'bad'},{save_action:'save_memo',memo:'bad'});assert.equal(result.response.status,403);
  result=await post(env,auth,{save_action:'not-real'});assert.equal(result.data.success,false);assert.equal(result.response.status,400);
  const response=await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Origin:'https://other.test',Cookie:auth.cookie},body:new URLSearchParams({save_action:'save_memo',csrf_token:auth.csrf_token})}),env);
  assert.equal(response.status,403);
});
test('five wrong device codes lock out another attempt',async()=>{
  const env=environment(),auth=await login(env);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.message.match(/[0-9A-Z]{5}-[0-9A-Z]{5}/)[0];
  for(let i=0;i<5;i++)assert.equal((await claim(env,'AAAAA-AAAAA')).status,400);
  assert.equal((await claim(env,code)).status,400);
});
test('a device code adds a device once, and an invite code creates its user',async()=>{
  const env=environment(),auth=await login(env);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.message.match(/[0-9A-Z]{5}-[0-9A-Z]{5}/)[0];
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM device_codes').get().n,1);assert.doesNotMatch(JSON.stringify(env.sqlite.prepare('SELECT * FROM device_codes').all()),new RegExp(code.replace('-','')));
  let r=await claim(env,code.toLowerCase());assert.equal(r.status,303);const phone=r.headers.get('Set-Cookie').split(';')[0];
  assert.doesNotMatch(await(await call(env,'/admin',undefined,phone)).text(),/name="login_action"/);
  assert.equal((await claim(env,code)).status,400);
  const invite=(await post(env,auth,{save_action:'device_code_create',invite:'1',username:'second',display_name:'Second'})).data.message.match(/[0-9A-Z]{5}-[0-9A-Z]{5}/)[0];
  r=await claim(env,invite);assert.equal(r.status,303);assert.equal(env.sqlite.prepare("SELECT display_name FROM users WHERE username='second'").get().display_name,'Second');
  assert.equal((await post(env,auth,{save_action:'device_code_create',invite:'1',username:'second',display_name:'Again'})).data.success,false);
});
test('expired codes and expired devices do not work; use extends a device',async()=>{
  const env=environment(),auth=await login(env);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.message.match(/[0-9A-Z]{5}-[0-9A-Z]{5}/)[0];
  env.sqlite.prepare('UPDATE device_codes SET expires_at=?').run(Date.now()-1);assert.equal((await claim(env,code)).status,400);
  env.sqlite.prepare('UPDATE device_sessions SET last_used_at=0').run();await call(env,'/admin',undefined,auth.cookie);
  assert.ok(env.sqlite.prepare('SELECT expires_at FROM device_sessions').get().expires_at>Date.now()+29*86400_000);
  env.sqlite.prepare('UPDATE device_sessions SET expires_at=?').run(Date.now()-1);
  assert.match(await(await call(env,'/admin',undefined,auth.cookie)).text(),/name="login_action"/);
});
test('a new device cannot stop older devices for three days; older devices can stop it',async()=>{
  const env=environment(),auth=await login(env);
  env.sqlite.prepare('UPDATE device_sessions SET created_at=?').run(Date.now()-4*86400_000);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.message.match(/[0-9A-Z]{5}-[0-9A-Z]{5}/)[0];
  const cookie=(await claim(env,code)).headers.get('Set-Cookie').split(';')[0];
  const csrf=(await require('../.test-build/src/devices.js').deviceSession(new Request('https://cloud.test/admin',{headers:{Cookie:cookie}}),env)).csrf,newer={cookie,csrf_token:csrf};
  const [old,fresh]=env.sqlite.prepare('SELECT id FROM device_sessions ORDER BY created_at').all().map(row=>row.id);
  assert.equal((await post(env,newer,{save_action:'device_revoke',device_id:old})).data.success,false);
  assert.match(await(await call(env,'/admin?view=site',undefined,auth.cookie)).text(),/New device registered|新しい端末が登録されました/);
  assert.equal((await post(env,auth,{save_action:'device_revoke',device_id:fresh})).data.success,true);
  assert.match(await(await call(env,'/admin',undefined,cookie)).text(),/name="login_action"/);
  const out=await call(env,'/admin',{save_action:'logout',csrf_token:auth.csrf_token},auth.cookie);assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.match(await(await call(env,'/admin',undefined,auth.cookie)).text(),/name="login_action"/);
});
test('recovery with a new SETUP_TOKEN stops every device and clears codes and the MCP key',async()=>{
  const env=environment(),auth=await login(env);await saveSettings(env,{...await loadSettings(env),api_key:'mcp-secret'});
  await post(env,auth,{save_action:'device_code_create'});
  assert.equal((await setup(env,{username:'admin'})).status,400);
  env.SETUP_TOKEN='new-setup-token-value';
  assert.equal((await setup(env,{username:'nobody'})).status,400);
  const r=await setup(env,{username:'admin'});assert.equal(r.status,303);
  assert.match(await(await call(env,'/admin',undefined,auth.cookie)).text(),/name="login_action"/);
  assert.doesNotMatch(await(await call(env,'/admin',undefined,r.headers.get('Set-Cookie').split(';')[0])).text(),/name="login_action"/);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM device_codes').get().n,0);assert.equal((await loadSettings(env)).api_key,'');
  assert.equal((await setup(env,{username:'admin'})).status,400);
});
test('page saves retain HTML mode, JS, memo, pending and preview token',async()=>{
  const env=environment(),auth=await login(env);
  const r=await post(env,auth,{save_action:'save_page',id:'news/item',title:'Item',status:'pending',is_html:'1',content_md:'<h2>Pending</h2>',js:'window.item=1;',memo:'Memo',css:'h2{color:red}',wrapper_comp:'layout'});
  assert.equal(r.data.success,true);const stored=await loadPage(env,'news/item');assert.equal(stored.is_html,true);assert.equal(stored.memo,'Memo');assert.equal(stored.js,'window.item=1;');assert.ok(stored.preview_token);
  assert.equal((await call(env,'/news/item')).status,404);
  const response=await call(env,`/news/item?preview=${stored.preview_token}`);assert.equal(response.status,200);assert.match(await response.text(),/<h2>Pending<\/h2>/);
});
test('update makes history, stale edits fail, rename collisions roll back',async()=>{
  const env=environment(),auth=await login(env);
  const base={save_action:'save_page',id:'first',title:'First',status:'draft',content_md:'one'};
  assert.equal((await post(env,auth,base)).data.success,true);const initial=await loadPage(env,'first');
  const update={...base,old_id:'first',expected_revision:initial.revision_tag,content_md:'two'};
  assert.equal((await post(env,auth,update)).data.success,true);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM post_revisions').get().n,1);
  assert.equal((await post(env,auth,update)).data.success,false);
  await savePage(env,'occupied',page());const current=await loadPage(env,'first');
  assert.equal((await post(env,auth,{...update,id:'occupied',expected_revision:current.revision_tag})).data.success,false);
  assert.equal((await loadPage(env,'first')).content_md,'two');assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM post_revisions').get().n,1);
});
test('unsafe and reserved IDs are rejected without rewriting into another record',async()=>{
  const env=environment(),auth=await login(env);
  const initialCount=env.sqlite.prepare('SELECT COUNT(*) n FROM posts').get().n;
  for(const id of ['../secret','a/../b','a b','mikanBox/anything','media/a','a//b'])assert.equal((await post(env,auth,{save_action:'save_page',id,title:'X',status:'draft'})).data.success,false,id);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM posts').get().n,initialCount);
});
test('hierarchical directory fallback is supported',async()=>{
  const env=environment();await savePage(env,'coffee/index',page('public_dynamic','Coffee'));
  assert.equal((await loadPage(env,'coffee')).content_md,'Coffee');
});
test('component type, scope, JS and memo survive roundtrip',async()=>{
  const env=environment(),auth=await login(env);
  const r=await post(env,auth,{save_action:'save_comp',id:'instruction',comp_type:'ai_doc',html:'## Write',js:'window.x=1',memo:'Note',use_scope:'1'});
  assert.equal(r.data.success,true);const stored=await loadComponent(env,'instruction');assert.equal(stored.is_ai_doc,true);assert.equal(stored.is_global,false);assert.equal(stored.memo,'Note');
});
test('draft and pending are excluded from direct access, embedding, feeds, nav and API',async()=>{
  const env=environment();
  for(const status of ['draft','pending']) {
    await savePage(env,'secret',page(status,'SENSITIVE-SECRET\n{{DATA:key}}DATA-SECRET{{/DATA}}'));
    assert.equal((await call(env,'/secret')).status,404);
    for(const content of ['{{POST_MD:secret}}','{{POST_MD:secret:key}}','{{POST_MD:secret#row:key}}','{{NAV_LINKS}}']) {
      await savePage(env,'index',page('public_dynamic',content));const response=await call(env,'/');const body=await response.text();assert.equal(response.status,200);assert.doesNotMatch(body,/SENSITIVE-SECRET|DATA-SECRET/);
    }
    assert.equal((await call(env,'/api/secret')).status,404);
    for(const feed of ['sitemap.xml','rss.xml','podcast.xml'])assert.doesNotMatch(await(await call(env,'/'+feed)).text(),/SENSITIVE-SECRET|DATA-SECRET|\/secret/);
  }
});
test('static publication preserves built snapshot until rebuilt and hides status changes',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'built',page('public_static','Original'));
  assert.equal((await call(env,'/built')).status,404);
  assert.equal((await post(env,auth,{save_action:'build_ssg'})).data.success,true);assert.match(await(await call(env,'/built')).text(),/Original/);
  await savePage(env,'built',page('public_static','Edited'));assert.match(await(await call(env,'/built')).text(),/Original/);
  await savePage(env,'built',page('draft','Private'));assert.equal((await call(env,'/built')).status,404);
});
test('authenticated preview works and private pages remain uncached',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'secret',page());
  const r=await call(env,'/secret',undefined,auth.cookie);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(await r.text(),/private-content/);
});
test('component cycles end and JS is emitted once',async()=>{
  const env=environment();await saveComponent(env,'cycle',{html:'{{COMPONENT:cycle}}',js:'window.cycle=1;'});
  await savePage(env,'index',page('public_dynamic','{{COMPONENT:cycle}}{{COMPONENT:cycle}}'));
  const body=await(await call(env,'/')).text();assert.match(body,/Infinite loop/);assert.equal((body.match(/window.cycle=1/g)||[]).length,1);
});
test('HTML comments preserve component tags as literals',async()=>{
  const env=environment();await saveComponent(env,'part',{html:'EXPANDED'});await savePage(env,'index',{...page('public_dynamic','<!-- {{COMPONENT:part}} -->'),is_html:true});
  const body=await(await call(env,'/')).text();assert.match(body,/<!-- \{\{COMPONENT:part\}\} -->/);assert.doesNotMatch(body,/EXPANDED/);
});
test('external Markdown does not fetch arbitrary URLs',async()=>{
  const env=environment();await savePage(env,'index',page('public_dynamic','{{EXT_MD:https://example.test/private}}'));
  const original=global.fetch;global.fetch=()=>{throw new Error('Must not fetch');};
  try {assert.match(await(await call(env,'/')).text(),/not yet supported/);}finally{global.fetch=original;}
});
test('generated scripts parse in Japanese and English and escape saved prompts',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'example',{...page(),memo:'Memo',js:'window.x=1;'});await saveComponent(env,'layout',{html:'{{CONTENT}}',is_wrapper:true});
  for(const lang of ['ja','en']) {
    await saveSettings(env,{system_lang:lang,ai_prompt:'</script><script>attack()</script>'});
    for(const url of ['/admin','/admin?view=pages&edit=example','/admin?view=components&edit=layout']) {
      const response=await call(env,url,undefined,auth.cookie);assert.equal(response.status,200);
      const body=await response.text();assert.doesNotMatch(body,/<script>attack\(\)<\/script>/);
      for(const match of body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
    }
  }
});
test('SQLite workflow fields and sections exist in the Cloud editor',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'one',page());
  const body=await(await call(env,'/admin?view=pages&edit=one',undefined,auth.cookie)).text();
  for(const name of ['memo','js','is_html','expected_revision','content_md','category','wrapper_comp'])assert.match(body,new RegExp(`name="${name}"`));
  for(const section of ['pages','site','design','media','users-mgmt','ssg-accordion'])assert.match(body,new RegExp(`id="${section}"`));
  assert.match(body,/value="pending"/);assert.match(body,/value="public_static"/);assert.match(body,/value="public_dynamic"/);
});
test('user deletion stops its devices and cannot delete the current account',async()=>{
  const env=environment(),auth=await login(env);
  assert.equal((await post(env,auth,{save_action:'delete_user',username:'admin'})).data.success,false);
  const second=await login(env,'second','Second');
  assert.equal((await post(env,auth,{save_action:'delete_user',username:'second'})).data.success,true);
  assert.match(await(await call(env,'/admin',undefined,second.cookie)).text(),/name="login_action"/);
});
test('translations come from current shared JSON copies',()=>{
  const ja=require('../lang/ja.json'),en=require('../lang/en.json');assert.equal(createTranslator('ja')('nav_pages'),ja.nav_pages);assert.equal(createTranslator('en')('label_raw_html'),en.label_raw_html);
});
test('MCP requires a key, identifies this isolated site, and preserves unspecified fields',async()=>{
  const env=environment();await saveSettings(env,{api_key:'test-api-key',site_id:'cloud-isolated',site_name:'Cloud Test'});
  const worker=require('../.test-build/src/index.js').default;
  const rpc=async(name,args={},key='test-api-key')=>{
    const response=await worker.fetch(new Request('https://cloud.test/mcp',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
    return {response,body:await response.json()};
  };
  assert.equal((await rpc('get_site_info',{},'bad')).response.status,401);
  let result=await rpc('get_site_info');assert.equal(JSON.parse(result.body.result.content[0].text).site_id,'cloud-isolated');
  await savePage(env,'one',{...page('public_dynamic','Before'),category:'news',memo:'Keep'});
  result=await rpc('update_page',{id:'one',data:{content_md:'After'}});assert.equal(result.body.result.isError,false);
  const stored=await loadPage(env,'one');assert.equal(stored.content_md,'After');assert.equal(stored.category,'news');assert.equal(stored.memo,'Keep');
  assert.equal((await rpc('update_page',{id:'one',data:{status:'unknown'}})).body.result.isError,true);
  assert.equal((await rpc('get_page',{id:'../one'})).body.result.isError,true);
});
test('fenced Markdown preserves tables, tags and inline syntax as literal code',()=>{
  const {MikanBoxMarkdown}=require('../.test-build/src/markdown.js'),parser=new MikanBoxMarkdown();
  const source='~~~md\n|a|b|\n|--|--|\n|one|two|\n**bold**\n~~~';
  const result=parser.text(source);assert.match(result,/<pre><code class="language-md">/);assert.doesNotMatch(result,/<table>|<strong>/);assert.match(result,/\*\*bold\*\*/);
  assert.match(parser.text('```\n<unsafe>'),/&lt;unsafe&gt;<\/code><\/pre>/);
});
test('Markdown URLs reject script schemes and escape attributes',()=>{
  const {MikanBoxMarkdown}=require('../.test-build/src/markdown.js'),parser=new MikanBoxMarkdown();
  assert.doesNotMatch(parser.text('[click](javascript:alert(1))'),/href="javascript:/);
  assert.match(parser.text('![" onerror="evil](safe.png)'),/alt="&quot; onerror=&quot;evil"/);
});
test('a second user cannot acquire a held edit lock',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'one',page());
  assert.equal((await post(env,auth,{save_action:'acquire_lock',id:'one'})).data.success,true);
  const other=await login(env,'second','Second');
  assert.equal((await post(env,other,{save_action:'acquire_lock',id:'one'})).data.success,false);
  assert.equal((await post(env,other,{save_action:'save_page',id:'one',old_id:'one',status:'draft',title:'Other'})).data.success,false);
});
test('CSS scope handles functional selectors, media groups, strings and keyframes',()=>{
  const {scopeCss}=require('../.test-build/src/cssScope.js');
  const result=scopeCss(':is(.a,.b), .c { content:"{";color:red } @media(min-width:1px){.d:not(.x,.y){color:blue}} @keyframes turn{from{opacity:0}to{opacity:1}}','.scope');
  assert.match(result,/\.scope :is\(\.a,\.b\), \.scope \.c/);
  assert.match(result,/\.scope \.d:not\(\.x,\.y\)/);
  assert.match(result,/@keyframes turn\{from\{opacity:0\}to\{opacity:1\}\}/);
  assert.match(result,/content:"\{"/);
});
test('page CSS is isolated to the page content',async()=>{
  const env=environment();await savePage(env,'index',{...page('public_dynamic','Hello'),css:'h1{color:red}'});
  const body=await(await call(env,'/')).text();assert.match(body,/class="mikan-content-scope"/);assert.match(body,/\.mikan-content-scope h1/);
});
test('literal dollar signs in authored content and JS are preserved',async()=>{
  const env=environment();await savePage(env,'index',{...page('public_dynamic','Dollar $& $1'),js:'window.value="$& $1";'});
  const body=await(await call(env,'/')).text();assert.match(body,/Dollar \$& \$1/);assert.match(body,/window.value="\$& \$1"/);
});


test('stale settings cannot restore a revoked API key',async()=>{
  const env=environment();assert.equal(await saveSettings(env,{api_key:'old-key',memo:'before'}),true);
  const keyChange=await loadSettings(env),memoChange=await loadSettings(env);
  keyChange.api_key='new-key';assert.equal(await saveSettings(env,keyChange),true);
  memoChange.memo='after';assert.equal(await saveSettings(env,memoChange),false);
  assert.equal((await loadSettings(env)).api_key,'new-key');
  const fresh=await loadSettings(env);fresh.memo='after';assert.equal(await saveSettings(env,fresh),true);
  assert.equal((await loadSettings(env)).memo,'after');
  // Reusing an object after a successful save uses the new snapshot.
  fresh.memo='again';assert.equal(await saveSettings(env,fresh),true);
  const empty=environment(),a=await loadSettings(empty),b=await loadSettings(empty);
  a.api_key='first';b.api_key='second';assert.equal(await saveSettings(empty,a),true);assert.equal(await saveSettings(empty,b),false);
});
test('a rename race leaves the page and all its history at the original ID',async()=>{
  const {saveWithRevision}=require('../.test-build/src/revisions.js');
  const env=environment();await saveWithRevision(env,'original','',page(),'admin','');
  let current=await loadPage(env,'original');
  await saveWithRevision(env,'original','original',{...current,content_md:'second'},'admin',current.revision_tag);
  current=await loadPage(env,'original');
  const originalBatch=env.DB.batch;
  env.DB.batch=async statements=>{
    // Another request saves after the optimistic read but before the transaction.
    await savePage(env,'original',{...current,content_md:'concurrent',revision_tag:'another-request'});
    return originalBatch(statements);
  };
  await assert.rejects(saveWithRevision(env,'renamed','original',{...current,content_md:'rename'},'admin',current.revision_tag),/Concurrent update/);
  assert.equal((await loadPage(env,'original')).content_md,'concurrent');assert.equal(await loadPage(env,'renamed'),null);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM post_revisions WHERE post_id='original'").get().n,1);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM post_revisions WHERE post_id='renamed'").get().n,0);
  env.DB.batch=originalBatch;current=await loadPage(env,'original');
  await saveWithRevision(env,'renamed','original',current,'admin',current.revision_tag);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM post_revisions WHERE post_id='renamed'").get().n,2);
});

test('deployment without R2 offers D1 image uploads and usage information',async()=>{
  const env=environment();env.SITE_ENVIRONMENT='staging';const auth=await login(env);
  assert.equal((await loadSettings(env)).site_environment,'staging');
  const body=await(await call(env,'/admin?view=media',undefined,auth.cookie)).text();
  assert.match(body,/id="upload-form"/);assert.match(body,/id="drop-zone"/);assert.match(body,/400 MB/);
  const result=await post(env,auth,{save_action:'upload_media'});assert.equal(result.data.success,false);assert.match(result.data.message,/10 MB/);
});

test('fresh setup installs standard content and AI instruction IDs without overwriting edits',async()=>{
  const {installDefaults}=require('../.test-build/src/defaults.js');
  const env=environment();await login(env);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM posts').get().n,8);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM components').get().n,11);
  assert.equal((await loadComponent(env,'DESIGN_sample.md')).is_ai_doc,true);
  assert.equal((await loadComponent(env,'_layout')).is_wrapper,true);
  await savePage(env,'index',{...await loadPage(env,'index'),content_md:'My homepage'});
  await installDefaults(env,'ja');assert.equal((await loadPage(env,'index')).content_md,'My homepage');
  assert.equal(await saveComponent(env,'DESIGN.md',{html:'Private AI instructions',is_ai_doc:true}),true);
  assert.equal((await loadComponent(env,'DESIGN.md')).html,'Private AI instructions');
  assert.equal(await loadComponent(env,'../DESIGN.md'),null);
});
test('standard search form route renders public results and excludes private and DB content',async()=>{
  const env=environment();await login(env);
  await savePage(env,'matching',page('public_dynamic','needle <script>alert(1)</script>'));
  for(const status of ['draft','pending','db'])await savePage(env,'secret-'+status,{...page(status,'needle PRIVATE-CONTENT'),title:'SECRET-'+status});
  const response=await call(env,'/index.php?page=search&q=needle');assert.equal(response.status,200);
  const body=await response.text();assert.match(body,/search-results-list/);assert.match(body,/matching\/#:~:text=needle/);assert.match(body,/<strong class="search-highlight">needle<\/strong>/);
  assert.doesNotMatch(body,/SECRET-|PRIVATE-CONTENT|<script>alert\(1\)<\/script>|\{\{SEARCH_RESULTS/);
});


test('D1 image upload validates content, authentication and duplicates, then serves exact bytes',async()=>{
  const env=environment(),auth=await login(env);
  const image=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
  const upload=async(name,bytes,credentials=auth)=>{
    const form=new FormData();form.set('save_action','upload_media');form.set('csrf_token',credentials.csrf_token||'');form.set('ajax_request','1');form.set('image',new File([bytes],name,{type:'image/png'}));
    const response=await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:credentials.cookie||''},body:form}),env);
    return {response,data:response.headers.get('content-type').includes('application/json')?await response.json():null};
  };
  assert.equal((await upload('actual.png',image,{...auth,csrf_token:'bad'})).response.status,403);
  await upload('actual.png',image,{});assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media').get().n,0);
  assert.equal((await upload('actual.png',new TextEncoder().encode('<html>not an image</html>'))).data.success,false);
  assert.equal((await upload('actual.png',image)).data.success,true);
  assert.equal((await upload('actual.png',image)).data.success,false);
  const response=await call(env,'/media/actual.png');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),image);
  const etag=response.headers.get('etag');
  const worker=require('../.test-build/src/index.js').default;
  const head=await worker.fetch(new Request('https://cloud.test/media/actual.png',{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await worker.fetch(new Request('https://cloud.test/media/actual.png',{headers:{'If-None-Match':etag}}),env)).status,304);
  assert.equal((await post(env,auth,{save_action:'delete_media',file:'actual.png'})).data.success,true);
  assert.equal((await call(env,'/media/actual.png')).status,404);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,0);
  assert.equal(env.sqlite.prepare('SELECT bytes FROM media_usage').get().bytes,0);
  const different=new Uint8Array(image);different[different.length-1]^=1;assert.equal((await upload('actual.png',different)).data.success,true);
  assert.notEqual((await call(env,'/media/actual.png')).headers.get('etag'),etag);
});
test('chunked D1 media handles large images, quota boundaries, atomic rollback and rename',async()=>{
  const {uploadMedia,getMediaObject,deleteMedia,renameMedia,mediaUsage,buildMediaBackupZip}=require('../.test-build/src/storage.js');
  const {MEDIA_FILE_LIMIT,MEDIA_COUNT_LIMIT,MEDIA_ZIP_LIMIT}=require('../.test-build/src/media-policy.js');
  const env=environment(),large=new Uint8Array(MEDIA_FILE_LIMIT);large.set([137,80,78,71,13,10,26,10]);large[large.length-1]=42;
  assert.equal(await uploadMedia(env,'large.png',large.buffer,'image/png'),true);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,20);
  assert.equal(env.sqlite.prepare('SELECT MAX(length(data)) n FROM media_chunks').get().n,500000);
  const object=await getMediaObject(env,'large.png');assert.deepEqual(new Uint8Array(await object.arrayBuffer()),large);
  assert.equal(await uploadMedia(env,'too-large.png',new ArrayBuffer(MEDIA_FILE_LIMIT+1),'image/png'),false);
  assert.equal(await renameMedia(env,'large.png','renamed.png'),true);assert.equal(await getMediaObject(env,'large.png'),null);assert.equal((await getMediaObject(env,'renamed.png')).size,large.length);
  const one=Uint8Array.of(1).buffer;
  const MEDIA_TOTAL_LIMIT=400_000_000;
  env.sqlite.prepare('UPDATE media_usage SET bytes=?').run(MEDIA_TOTAL_LIMIT);
  assert.equal(await uploadMedia(env,'full.png',one,'image/png'),false);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media').get().n,1);
  env.sqlite.prepare('UPDATE media_usage SET bytes=?,files=1').run(MEDIA_TOTAL_LIMIT-1);
  assert.equal(await uploadMedia(env,'last.png',one,'image/png'),true);assert.equal((await mediaUsage(env)).bytes,MEDIA_TOTAL_LIMIT);
  env.sqlite.prepare('UPDATE media_usage SET bytes=0,files=?').run(MEDIA_COUNT_LIMIT);assert.equal(await uploadMedia(env,'count.png',one,'image/png'),false);
  env.sqlite.prepare('UPDATE media_usage SET bytes=?,files=2').run(large.length+1);
  assert.equal(await deleteMedia(env,'renamed.png'),true);assert.equal((await mediaUsage(env)).bytes,1);
  const broken=environment();broken.sqlite.exec("CREATE TRIGGER reject_chunk BEFORE INSERT ON media_chunks BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal(await uploadMedia(broken,'fail.png',one,'image/png'),false);assert.equal((await mediaUsage(broken)).files,0);
  assert.equal(broken.sqlite.prepare('SELECT COUNT(*) n FROM media').get().n,0);
  env.sqlite.prepare('UPDATE media SET size=? WHERE key=?').run(MEDIA_ZIP_LIMIT+1,'last.png');await assert.rejects(buildMediaBackupZip(env),/20 MB/);
});

test('directory index URLs resolve both dynamic pages and static snapshots with exact-page precedence',async()=>{
  const {buildStatic}=require('../.test-build/src/ssg.js');
  const env=environment();
  for(const status of ['public_dynamic','public_static']) {
    await savePage(env,'test/index',{...page(status,'DIRECTORY-PAGE-MARKER'),title:'Directory test'});
    if(status==='public_static')await buildStatic(env,new Request('https://cloud.test/admin'));
    for(const path of ['/test/index.html','/test/index/','/test/','/test']) {
      const response=await call(env,path);assert.equal(response.status,200,path);assert.match(await response.text(),/DIRECTORY-PAGE-MARKER/);
    }
  }
  await savePage(env,'test',page('public_static','EXACT-PAGE-MARKER'));
  const notBuilt=await call(env,'/test/');assert.equal(notBuilt.status,404);assert.doesNotMatch(await notBuilt.text(),/DIRECTORY-PAGE-MARKER/);
  await buildStatic(env,new Request('https://cloud.test/admin'));
  assert.match(await(await call(env,'/test/')).text(),/EXACT-PAGE-MARKER/);
  await savePage(env,'test',page('draft','PRIVATE-PAGE-MARKER'));
  const privatePage=await call(env,'/test/');assert.equal(privatePage.status,404);assert.doesNotMatch(await privatePage.text(),/PRIVATE-PAGE-MARKER|DIRECTORY-PAGE-MARKER/);
});


test('CSS uses first marker or real head closing tag with prefix fallback', async()=>{
  const env=environment();
  await savePage(env,'css-placement',{...page('public_dynamic','CSS body'),wrapper_comp:'CssPlacement',css:'p{color:rebeccapurple}'});
  const layouts=[
    '<html><head><!-- first -->{{ HEAD_CSS }}<!-- after -->{{head_css}}</head><body>{{CONTENT}}</body></html>',
    '<html><head><!-- </head> {{HEAD_CSS}} --><script>const x="</head> {{HEAD_CSS}}";</script><style>/* </head> */</style><textarea></head></textarea><title></head></title><!-- actual --></HEAD ><body>{{CONTENT}}</body></html>',
    '<section>{{CONTENT}}</section>'
  ];
  for(const [index,html] of layouts.entries()){
    await saveComponent(env,'CssPlacement',{html,css:'body{margin:0}',is_global:true});
    for(const staticMode of [false,true]){
      const renderer=new MikanBoxRenderer(env,{},new Request('https://cloud.test/css-placement'));
      let result=await renderer.render('css-placement');
      if(staticMode){
        const data=await loadPage(env,'css-placement');
        await savePage(env,'css-placement',{...data,status:'public_static'});
        await require('../.test-build/src/ssg.js').buildStatic(env,new Request('https://cloud.test/admin'));
        result={html:env.sqlite.prepare('SELECT html FROM static_pages WHERE id=?').get('css-placement').html};
        await savePage(env,'css-placement',{...data,status:'public_dynamic'});
      }
      assert.equal((result.html.match(/rebeccapurple/g)||[]).length,1);
      if(index===0){assert.match(result.html,/<!-- first --><style>/);assert.match(result.html,/<\/style><!-- after --><\/head>/);}
      else if(index===1){assert.match(result.html,/<!-- actual --><style>/);assert.match(result.html,/<\/style><\/HEAD >/);assert.ok(result.html.includes('const x="</head> {{HEAD_CSS}}";'));}
      else assert.ok(result.html.includes('<head>') && result.html.indexOf('<style>') < result.html.indexOf('</head>'));
    }
  }
});


test('common head preserves AI metadata, supplies missing values, and respects tracking exclusions',async()=>{
  const env=environment();
  await saveComponent(env,'Tracking',{html:'<script>window.tracking=1;</script>',is_global:true});
  const settings={tracking_component:'Tracking',site_name:'日本語 Site',description:'CMS description'};
  const raw='<!DOCTYPE html><html><head><!-- <title>Fake</title> --><script>const fake="<meta name=viewport> <body class=fake>";</script><title>AI title</title><meta name="description" content="AI description"></head><body class=original><h1>AI body</h1></body></html>';
  const data={...page('public_static',raw),title:'日本語 & English',wrapper_comp:'__none',is_html:true,css:'h1{color:red}'};
  await savePage(env,'common-head',data);await saveSettings(env,settings);
  const render=async()=>new MikanBoxRenderer(env,settings,new Request('https://cloud.test/common-head')).render('common-head');
  const dynamic=(await render()).html;
  await require('../.test-build/src/ssg.js').buildStatic(env,new Request('https://cloud.test/admin'));
  const built=env.sqlite.prepare('SELECT html FROM static_pages WHERE id=?').get('common-head').html;
  for(const html of [dynamic,built]){
    assert.ok(html.includes('<title>AI title</title>'));assert.ok(html.includes('content="AI description"'));assert.ok(!html.includes('CMS description'));
    assert.ok(html.includes('<meta charset="UTF-8">'));assert.ok(html.includes('width=device-width, initial-scale=1.0'));
    assert.equal((html.match(/window.tracking=1;/g)||[]).length,1);assert.ok(html.indexOf('window.tracking=1;')<html.indexOf('</head>'));
    assert.ok(html.includes('original mikan-content-scope'));assert.ok(!html.includes('<div class="mikan-content-scope"><!DOCTYPE'));
  }
  await savePage(env,'common-head',{...data,exclude_tracking:true});assert.ok(!(await render()).html.includes('window.tracking=1;'));
  await savePage(env,'common-head',{...data,content_md:'<html><head>{{COMPONENT:Tracking}}</head><body>Body</body></html>'});
  let html=(await render()).html;assert.equal((html.match(/window.tracking=1;/g)||[]).length,1);assert.ok(html.includes('<title>日本語 &amp; English - 日本語 Site</title>'));
  await savePage(env,'common-head',{...data,exclude_tracking:true,content_md:'<html><head>{{COMPONENT:Tracking}}</head><body>Body</body></html>'});assert.ok(!(await render()).html.includes('window.tracking=1;'));
});


test('admin stores tracking selection and page exclusion without changing wrapper choice',async()=>{
  const env=environment(),auth=await login(env);
  await saveComponent(env,'Tracking',{html:'<script>window.tracking=1;</script>',is_global:true});
  let response=await post(env,auth,{save_action:'save_settings',tracking_component:'Tracking'});
  assert.equal(response.data.success,true);assert.equal((await loadSettings(env)).tracking_component,'Tracking');
  response=await post(env,auth,{save_action:'save_page',id:'ai-page',title:'AI',status:'public_dynamic',wrapper_comp:'__none',is_html:'1',content_md:'<html><head></head><body>AI</body></html>',tracking_option_present:'1',exclude_tracking:'1'});
  assert.equal(response.data.success,true);let data=await loadPage(env,'ai-page');assert.equal(data.wrapper_comp,'__none');assert.equal(data.exclude_tracking,true);
  const html=await(await call(env,'/admin?view=pages&edit=ai-page',undefined,auth.cookie)).text();
  assert.ok(html.includes('value="__none" selected'));assert.ok(html.includes('name="exclude_tracking"'));assert.ok(html.includes('tracking-exclusion'));
  response=await post(env,auth,{save_action:'save_page',id:'ai-page',old_id:'ai-page',expected_revision:data.revision_tag,title:'AI',status:'public_dynamic',wrapper_comp:'__none',is_html:'1',content_md:data.content_md,tracking_option_present:'1'});
  assert.equal(response.data.success,true);assert.equal((await loadPage(env,'ai-page')).exclude_tracking,false);
});
