const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {environment,call,login,post,publicView}=require('./fixtures.cjs');
const {savePage,loadPage,saveComponent,loadComponent,saveSettings,loadSettings}=require('../.test-build/src/storage.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
const {createTranslator}=require('../.test-build/src/i18n.js');
async function loginForm(env){const page=await call(env,'/admin'),m=page.headers.get('Set-Cookie').match(/login_csrf=([^;]+)/);return {cookie:m[0],csrf:m[1]};}
async function setup(env,extra={},forgeCookie=false){const f=await loginForm(env);return require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:forgeCookie?'login_csrf=other':f.cookie},body:new URLSearchParams({login_action:'setup',csrf_token:f.csrf,setup_token:env.SETUP_TOKEN,username:'admin',display_name:'Admin',device_name:'Laptop',...extra})}),env);}
async function claim(env,code,newUser){const f=await loginForm(env);return require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:f.cookie},body:new URLSearchParams({login_action:'claim',csrf_token:f.csrf,code,device_name:'Phone',...(newUser||{})})}),env);}
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
test('a setup token that ever worked stays dead after a later token was used',async()=>{
  const env=environment();await login(env);
  const first=env.SETUP_TOKEN;
  env.SETUP_TOKEN='second-token-that-is-long-enough-123';
  let r=await setup(env,{username:'admin'});assert.equal(r.status,303,'a new token recovers');
  env.SETUP_TOKEN=first;
  r=await setup(env,{username:'admin'});assert.equal(r.status,400,'the first token is still dead');
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
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.issued_code;
  for(let i=0;i<5;i++)assert.equal((await claim(env,'AAAAA-AAAAA')).status,400);
  assert.equal((await claim(env,code)).status,400);
});
test('a device code adds a device once, and an invite code creates its user',async()=>{
  const env=environment(),auth=await login(env);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.issued_code;
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM device_codes').get().n,1);assert.doesNotMatch(JSON.stringify(env.sqlite.prepare('SELECT * FROM device_codes').all()),new RegExp(code.replace('-','')));
  let r=await claim(env,code.toLowerCase());assert.equal(r.status,303);const phone=r.headers.get('Set-Cookie').split(';')[0];
  assert.doesNotMatch(await(await call(env,'/admin',undefined,phone)).text(),/name="login_action"/);
  assert.equal((await claim(env,code)).status,400);
  const invite=(await post(env,auth,{save_action:'device_code_create',invite:'1'})).data.issued_code;
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM device_codes WHERE username='' AND used_at IS NULL").get().n,1,'an invite names nobody in advance');
  // The invited person chooses their own ID and name; the first step asks for them and spends nothing.
  r=await claim(env,invite);assert.equal(r.status,200);assert.match(await r.text(),/name="display_name"/);
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM device_codes WHERE username='' AND used_at IS NULL").get().n,1);
  r=await claim(env,invite,{username:'bad id!',display_name:'Bad'});assert.equal(r.status,400);
  r=await claim(env,invite,{username:'admin',display_name:'Taken'});assert.equal(r.status,400,'a taken user ID is refused');
  assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM device_codes WHERE username='' AND used_at IS NULL").get().n,1,'refusals keep the code usable');
  r=await claim(env,invite,{username:'second',display_name:'Second'});assert.equal(r.status,303);assert.equal(env.sqlite.prepare("SELECT display_name FROM users WHERE username='second'").get().display_name,'Second');
  assert.equal((await claim(env,invite,{username:'third',display_name:'Third'})).status,400,'a used invite is dead');
});
test('expired codes and expired devices do not work; use extends a device',async()=>{
  const env=environment(),auth=await login(env);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.issued_code;
  env.sqlite.prepare('UPDATE device_codes SET expires_at=?').run(Date.now()-1);assert.equal((await claim(env,code)).status,400);
  env.sqlite.prepare('UPDATE device_sessions SET last_used_at=0').run();await call(env,'/admin',undefined,auth.cookie);
  assert.ok(env.sqlite.prepare('SELECT expires_at FROM device_sessions').get().expires_at>Date.now()+29*86400_000);
  env.sqlite.prepare('UPDATE device_sessions SET expires_at=?').run(Date.now()-1);
  assert.match(await(await call(env,'/admin',undefined,auth.cookie)).text(),/name="login_action"/);
});
test('a new device cannot stop older devices for three days; older devices can stop it',async()=>{
  const env=environment(),auth=await login(env);
  env.sqlite.prepare('UPDATE device_sessions SET created_at=?').run(Date.now()-4*86400_000);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.issued_code;
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
      await savePage(env,'index',page('public_static',content));const response=await publicView(env,'/');const body=await response.text();assert.equal(response.status,200);assert.doesNotMatch(body,/SENSITIVE-SECRET|DATA-SECRET/);
    }
    assert.equal((await call(env,'/api/secret')).status,404);
    for(const feed of ['sitemap.xml','rss.xml','podcast.xml'])assert.doesNotMatch(await(await call(env,'/'+feed)).text(),/SENSITIVE-SECRET|DATA-SECRET|\/secret/);
  }
});
test('the Worker never serves public pages; they reach visitors only as built static files',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'built',page('public_static','Original'));
  assert.equal((await call(env,'/built')).status,404);
  assert.equal((await post(env,auth,{save_action:'build_ssg'})).data.success,true);
  const response=await call(env,'/built');assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/Original/);
  assert.match(env.sqlite.prepare("SELECT html FROM static_pages WHERE id='built'").get().html,/Original/);
});
test('older dynamic statuses are stored as public',async()=>{
  const env=environment();await savePage(env,'old',page('public_dynamic','Body'));await savePage(env,'older',page('public','Body'));
  assert.deepEqual(env.sqlite.prepare("SELECT status FROM posts WHERE id IN ('old','older')").all().map(r=>r.status),['public_static','public_static']);
  assert.equal(JSON.parse(env.sqlite.prepare("SELECT data FROM posts WHERE id='old'").get().data).status,'public_static');
});
test('authenticated preview works and private pages remain uncached',async()=>{
  const env=environment(),auth=await login(env);await savePage(env,'secret',page());
  const r=await call(env,'/secret',undefined,auth.cookie);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(await r.text(),/private-content/);
});
test('component cycles end and JS is emitted once',async()=>{
  const env=environment();await saveComponent(env,'cycle',{html:'{{COMPONENT:cycle}}',js:'window.cycle=1;'});
  await savePage(env,'index',page('public_static','{{COMPONENT:cycle}}{{COMPONENT:cycle}}'));
  const body=await(await publicView(env,'/')).text();assert.match(body,/Infinite loop/);assert.equal((body.match(/window.cycle=1/g)||[]).length,1);
});
test('HTML comments preserve component tags as literals',async()=>{
  const env=environment();await saveComponent(env,'part',{html:'EXPANDED'});await savePage(env,'index',{...page('public_static','<!-- {{COMPONENT:part}} -->'),is_html:true});
  const body=await(await publicView(env,'/')).text();assert.match(body,/<!-- \{\{COMPONENT:part\}\} -->/);assert.doesNotMatch(body,/EXPANDED/);
});
test('external Markdown does not fetch arbitrary URLs',async()=>{
  const env=environment();await savePage(env,'index',page('public_dynamic','{{EXT_MD:https://example.test/private}}'));
  const original=global.fetch;global.fetch=()=>{throw new Error('Must not fetch');};
  try {assert.match(await(await publicView(env,'/')).text(),/EXT_MD is not available in the Cloud edition/);}finally{global.fetch=original;}
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
  for(const section of ['pages','site','design','media','users-mgmt','publish-box'])assert.match(body,new RegExp(`id="${section}"`));
  assert.match(body,/value="pending"/);assert.match(body,/value="public_static"/);assert.doesNotMatch(body,/value="public_dynamic"/);
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
test('Markdown reads nested spans, merged quotes and HTML blocks as the PHP edition does',()=>{
  const {MikanBoxMarkdown}=require('../.test-build/src/markdown.js');const md=new MikanBoxMarkdown();
  assert.equal(md.text('[[save]{.icon} 保存]{.m-btn .m-btn-blue}'),'<p><span class="m-btn m-btn-blue"><span class="icon">save</span> 保存</span></p>','a span inside a span is read from the inside out');
  assert.equal(md.text('> a\n> b'),'<blockquote>a<br>\nb</blockquote>','consecutive quote lines are one blockquote');
  assert.equal(md.text('<div>**x**</div>'),'<div>**x**</div>','a one-line HTML block is left alone');
  assert.equal(md.text('text\n\n<div>\n\n**more**\n\n</div>\n\nafter'),'<p>text</p>\n<div>\n<p><strong>more</strong></p>\n</div>\n<p>after</p>','Markdown inside a multi-line HTML block is read, the block itself adds no empty paragraphs');
  assert.doesNotMatch(md.text('<p>raw</p>\n\n---\n\n<div>x</div>'),/<p>\s*<\/p>/,'raw HTML blocks never leave empty paragraphs');
  assert.equal(md.text('a\n\n| h |\n|---|\n| c |\nnext line'),'<p>a</p>\n<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>\nnext line','the line after a table is not glued to it');
});
test('Markdown link and image URLs are decoded, checked and encoded (as in the PHP edition)',()=>{
  const {MikanBoxMarkdown}=require('../.test-build/src/markdown.js');const md=new MikanBoxMarkdown();
  for(const url of ['javascript:alert(1)','JaVaScRiPt:alert(1)','&#106;avascript:alert(1)','java&Tab;script:alert(1)','data:text/html,x','vbscript:x'])assert.match(md.text(`[x](${url})`),/<a href="#">/,url);
  for(const url of ['https://e.com/a','mailto:a@b.c','tel:+81','page-id','/abs','#a','//cdn.e.com/x'])assert.match(md.text(`[x](${url})`),new RegExp(`<a href="${url.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')}">`),url);
  assert.match(md.text('[x](https://e.com/?a=1&b=2)'),/href="https:\/\/e\.com\/\?a=1&amp;b=2"/);
  assert.match(md.text('[x](https://e.com/?a=1&amp;b=2)'),/href="https:\/\/e\.com\/\?a=1&amp;b=2"/,'an existing &amp; is not doubled');
  const image=md.text('![a" onerror="alert(1)](x" onerror="alert(1))');assert.doesNotMatch(image,/ onerror="/,'a quote cannot end the attribute');assert.match(image,/^<p><img src="[^"]*" alt="[^"]*">\)<\/p>$/,'the image keeps exactly src and alt');
});
test('a paragraph that starts with a tag is still a paragraph; a paragraph that is only a tag is not',async()=>{
  const env=environment();
  await savePage(env,'tags',{...page('public_static','{{TITLE}}|{{SITE_NAME}}\n\n{{TITLE}}'),wrapper_comp:'__none'});
  const {html}=await new MikanBoxRenderer(env,{site_name:'S'},new Request('https://cloud.test/tags')).render('tags');
  assert.match(html,/<p>Test\|S<\/p>/);assert.doesNotMatch(html,/<p>Test<\/p>/);assert.match(html,/Test(?!\|)/);
});
test('URL tags work in Markdown links while code examples stay literal',async()=>{
  const env=environment();
  await savePage(env,'embedded',{...page('public_static','[embedded]({{SITE_URL}}/embedded-target)'),wrapper_comp:'__none'});
  await savePage(env,'tag-links',{...page('public_static','[details]({{SITE_URL}}/about?x=1&y=2)\n\n[base]({{BASE_URL}}/base)\n\n`[example]({{SITE_URL}}/code)`\n\n```\n[example]({{SITE_URL}}/fenced)\n```\n\n{{POST_MD:embedded}}'),wrapper_comp:'__none'});
  const {html}=await new MikanBoxRenderer(env,{ssg_root_url:'https://cloud.test/site'},new Request('https://cloud.test/site/tag-links')).render('tag-links');
  assert.match(html,/href="https:\/\/cloud\.test\/site\/about\?x=1&amp;y=2"/);
  assert.match(html,/href="https:\/\/cloud\.test\/site\/base"/);
  assert.match(html,/href="https:\/\/cloud\.test\/site\/embedded-target"/);
  assert.match(html,/<code>\[example\]\(\{\{SITE_URL\}\}\/code\)<\/code>/);
  assert.match(html,/\[example\]\(\{\{SITE_URL\}\}\/fenced\)/);
});
test('relative page links resolve to the page URL and keep ?query and #fragment; card images load lazily',async()=>{
  const env=environment();
  await savePage(env,'other-page',page('public_static','x'));
  await savePage(env,'src',{...page('public_static','[a](other-page?x=1#frag) [b](Other-Page/) [c](other-page.html) [d](no-such-page) [e](../up) [f](page.pdf)\n\n{{NAV_CARDS:cards}}'),wrapper_comp:'__none'});
  await savePage(env,'card1',{...page('public_static','c'),category:'cards',ogp_image:'pic.png'});
  const {html}=await new MikanBoxRenderer(env,{ssg_root_url:'https://cloud.test'},new Request('https://cloud.test/src')).render('src');
  assert.match(html,/<a href="https:\/\/cloud\.test\/other-page\/?\?x=1#frag">a<\/a>/);
  assert.match(html,/<a href="https:\/\/cloud\.test\/other-page\/?">b<\/a>/);
  assert.match(html,/<a href="https:\/\/cloud\.test\/other-page\/?">c<\/a>/);
  assert.match(html,/<a href="https:\/\/cloud\.test\/no-such-page\/?">d<\/a>/,'a page-ID-shaped link is completed even when the page does not exist yet');
  assert.match(html,/<a href="\.\.\/up">e<\/a>/);assert.match(html,/<a href="page\.pdf">f<\/a>/);
  assert.match(html,/<img src="[^"]*pic\.png" alt="" loading="lazy" decoding="async">/);
});
test('url(media/…) in page CSS and in inline styles points at the media folder from any page',async()=>{
  const env=environment();
  await savePage(env,'deep/page',{...page('public_static','<div style="background:url(\'media/a.jpg\')">x</div>\n\n<p>images/not-a-url.png stays text</p>'),css:'.h{background:url("media/h.jpg")}.i{background:url(images/i.png)}',wrapper_comp:'_layout_t'});
  await saveComponent(env,'_layout_t',{html:'<!DOCTYPE html><html><head>{{HEAD_CSS}}</head><body>{{CONTENT}}</body></html>',css:'',is_global:true,is_wrapper:true});
  const {html}=await new MikanBoxRenderer(env,{ssg_root_url:'https://cloud.test/site'},new Request('https://cloud.test/site/deep/page')).render('deep/page');
  assert.match(html,/url\("\/site\/media\/h\.jpg"\)/,'page CSS: rooted at the site');
  assert.match(html,/url\(\/site\/media\/i\.png\)/);
  assert.match(html,/url\('https:\/\/cloud\.test\/site\/media\/a\.jpg'\)/,'inline style: absolute');
  assert.match(html,/images\/not-a-url\.png stays text/,'text that only looks like a path is left alone');
});
test('the document starts with one <!DOCTYPE html>, even when the layout starts with a comment',async()=>{
  const env=environment();
  await saveComponent(env,'_c_layout',{html:'<!-- layout note -->\n<!DOCTYPE html>\n<html><head></head><body>{{CONTENT}}</body></html>',css:'',is_global:true,is_wrapper:true});
  await savePage(env,'dt',{...page('public_static','x'),wrapper_comp:'_c_layout'});
  const {html}=await new MikanBoxRenderer(env,{},new Request('https://cloud.test/dt')).render('dt');
  assert.match(html,/^<!DOCTYPE html>\n<!-- layout note -->/);assert.equal((html.match(/<!DOCTYPE/gi)||[]).length,1);
});
test('a comment in front of a selector does not hide :root, html or body',()=>{
  const {scopeCss}=require('../.test-build/src/cssScope.js');
  assert.equal(scopeCss('/* grain */\n  body::before{x:y}','.s'),'.s::before{x:y}');
  assert.equal(scopeCss('a{x:y}\n/* note */ :root{--c:1}\n/* two */ /* three */ .a{x:y}','.s'),'.s a{x:y}.s{--c:1}.s .a{x:y}');
  assert.equal(scopeCss('/* m */ @media print{/* i */ body{x:y}}','.s'),'@media print{.s{x:y}}');
});
test(':global(...) leaves the scope, as in the PHP edition',()=>{
  const {scopeCss}=require('../.test-build/src/cssScope.js');
  assert.equal(scopeCss(':global(.hero_box){display:none}','.s'),'.hero_box{display:none}');
  assert.equal(scopeCss(':global(:root){--c:red}','.s'),':root{--c:red}');
  assert.equal(scopeCss(':global(.a),.b{x:y}','.s'),'.a, .s .b{x:y}');
  assert.equal(scopeCss(':global(.a .b){x:y}','.s'),'.a .b{x:y}');
});
test('template tags are upper case only, as in the PHP edition',async()=>{
  const env=environment();
  await savePage(env,'case',{...page('public_static','{{TITLE}}|{{title}}|{{Title}}|{{SITE_NAME}}|{{site_name}}|{{PAGE_URL}}|{{page_url}}|{{UPDATE_DATE}}|{{update_date}}|{{ TITLE }}'),wrapper_comp:'__none'});
  const {html}=await new MikanBoxRenderer(env,{site_name:'S'},new Request('https://cloud.test/case')).render('case');
  assert.match(html,/Test\|\{\{title\}\}\|\{\{Title\}\}\|S\|\{\{site_name\}\}\|https:\/\/cloud\.test\/case\/?\|\{\{page_url\}\}\|[0-9-]{10}\|\{\{update_date\}\}\|Test/);
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
  const env=environment();await savePage(env,'index',{...page('public_static','Hello'),css:'h1{color:red}'});
  const body=await(await publicView(env,'/')).text();assert.match(body,/class="mikan-content-scope"/);assert.match(body,/\.mikan-content-scope h1/);
});
test('literal dollar signs in authored content and JS are preserved',async()=>{
  const env=environment();await savePage(env,'index',{...page('public_static','Dollar $& $1'),js:'window.value="$& $1";'});
  const body=await(await publicView(env,'/')).text();assert.match(body,/Dollar \$& \$1/);assert.match(body,/window.value="\$& \$1"/);
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
test('the search page is a Google site search form that forwards the standard search box',async()=>{
  const env=environment();await saveSettings(env,{ssg_root_url:'https://www.example.test/site'});
  await savePage(env,'matching',page('public_static','needle PUBLIC'));await savePage(env,'secret',page('draft','needle PRIVATE-CONTENT'));
  await savePage(env,'search',page('public_static','{{SEARCH_RESULTS:_search_result_item}}'));
  const body=await(await publicView(env,'/search')).text();
  assert.match(body,/action="https:\/\/www\.google\.com\/search"/);assert.match(body,/name="as_sitesearch" value="www\.example\.test\/site"/);
  assert.match(body,/as_sitesearch:"www\.example\.test\/site"/);assert.doesNotMatch(body,/PRIVATE-CONTENT|PUBLIC|\{\{SEARCH_RESULTS/);
  assert.equal((await call(env,'/index.php?page=search&q=needle')).status,404);
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
  await saveSettings(env,{...await loadSettings(env),tracking_component:'Tracking'});
  let html=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
  assert.ok(html.includes('window.tracking=1;'),'legacy tracking component is offered in the code field');
  let response=await post(env,auth,{save_action:'save_settings',tracking_id:'gtm-abcd12',tracking_head_code:'<script>window.tracking=1;</script>',tracking_body_code:''});
  assert.equal(response.data.success,true);let saved=await loadSettings(env);assert.equal(saved.tracking_id,'GTM-ABCD12');assert.equal(saved.tracking_head_code,'<script>window.tracking=1;</script>');assert.equal(saved.tracking_component,'');
  response=await post(env,auth,{save_action:'save_settings',tracking_id:'not an id',tracking_head_code:'',tracking_body_code:''});
  assert.equal((await loadSettings(env)).tracking_id,'');
  await post(env,auth,{save_action:'save_settings',tracking_id:'gtm-abcd12',tracking_head_code:'',tracking_body_code:''});
  response=await post(env,auth,{save_action:'save_page',id:'ai-page',title:'AI',status:'public_dynamic',wrapper_comp:'__none',is_html:'1',content_md:'<html><head></head><body>AI</body></html>',tracking_option_present:'1',exclude_tracking:'1'});
  assert.equal(response.data.success,true);let data=await loadPage(env,'ai-page');assert.equal(data.wrapper_comp,'__none');assert.equal(data.exclude_tracking,true);
  html=await(await call(env,'/admin?view=pages&edit=ai-page',undefined,auth.cookie)).text();
  assert.ok(html.includes('value="__none" selected'));assert.ok(html.includes('name="exclude_tracking"'));assert.ok(html.includes('tracking-exclusion'));
  response=await post(env,auth,{save_action:'save_page',id:'ai-page',old_id:'ai-page',expected_revision:data.revision_tag,title:'AI',status:'public_dynamic',wrapper_comp:'__none',is_html:'1',content_md:data.content_md,tracking_option_present:'1'});
  assert.equal(response.data.success,true);assert.equal((await loadPage(env,'ai-page')).exclude_tracking,false);
});
test('tracking ID and code settings insert head and body tags and honor page exclusion',async()=>{
  const env=environment();
  const raw='<!DOCTYPE html><html><head><title>T</title></head><body class=original><h1>Body</h1></body></html>';
  const data={...page('public_dynamic',raw),title:'T',wrapper_comp:'__none',is_html:true};
  await savePage(env,'ids',data);
  const render=async settings=>(await new MikanBoxRenderer(env,settings,new Request('https://cloud.test/ids')).render('ids')).html;
  let html=await render({tracking_id:'gtm-abcd12'});
  assert.ok(html.indexOf('gtm.js?id=')>0&&html.indexOf('gtm.js?id=')<html.indexOf('</head>'));
  const ns=html.indexOf('ns.html?id=GTM-ABCD12');assert.ok(ns>html.indexOf('<body')&&ns<html.indexOf('<h1>'));
  html=await render({tracking_id:'G-ABCD12'});assert.ok(html.includes('gtag/js?id=G-ABCD12')&&!html.includes('<noscript>'));
  html=await render({tracking_id:'GTM-ABCD12',tracking_head_code:'<script>window.hc=1;</script>',tracking_body_code:'<noscript>nb</noscript>'});
  assert.ok(html.indexOf('window.hc=1;')<html.indexOf('</head>')&&html.indexOf('<noscript>nb</noscript>')>html.indexOf('<body')&&!html.includes('gtm.js'));
  await savePage(env,'ids',{...data,exclude_tracking:true});
  assert.ok(!(await render({tracking_id:'GTM-ABCD12'})).includes('googletagmanager.com'));
});
test('recreating a deleted username never revives its old devices',async()=>{
  const env=environment(),auth=await login(env),second=await login(env,'second','Second');
  assert.equal((await post(env,auth,{save_action:'delete_user',username:'second'})).data.success,true);
  const invite=(await post(env,auth,{save_action:'device_code_create',invite:'1'})).data.issued_code;
  assert.equal((await claim(env,invite,{username:'second',display_name:'New Second'})).status,303);
  assert.match(await(await call(env,'/admin',undefined,second.cookie)).text(),/name="login_action"/);
});
test('a device on probation cannot take access away from other users',async()=>{
  const env=environment(),auth=await login(env);env.sqlite.prepare('UPDATE device_sessions SET created_at=?').run(Date.now()-4*86400_000);
  const code=(await post(env,auth,{save_action:'device_code_create'})).data.issued_code;
  const cookie=(await claim(env,code)).headers.get('Set-Cookie').split(';')[0];
  const fresh={cookie,csrf_token:(await require('../.test-build/src/devices.js').deviceSession(new Request('https://cloud.test/admin',{headers:{Cookie:cookie}}),env)).csrf};
  await login(env,'other','Other');
  for(const data of [{save_action:'delete_user',username:'other'},{save_action:'update_user',old_username:'other',username:'gone',display_name:'Gone'},{save_action:'restore_d1_time',restore_at:'2026-01-01T00:00'},{save_action:'restore_backup_json',manifest:'{}',restore_users:'1'}])
    assert.match((await post(env,fresh,data)).data.message,/3 days|3日間/,data.save_action);
  assert.ok(env.sqlite.prepare("SELECT 1 FROM users WHERE username='other'").get());
  assert.equal((await post(env,auth,{save_action:'delete_user',username:'other'})).data.success,true);
});
test('the search page only forwards legacy page links within the site',async()=>{
  const env=environment();await savePage(env,'search',page('public_static','{{SEARCH_RESULTS}}'));
  const script=(await(await publicView(env,'/search')).text()).match(/<script>\(function\(\)\{var p=new URLSearchParams[\s\S]*?<\/script>/)[0].slice(8,-9);
  const run=search=>{const location={search,origin:'https://www.example.test',replace(url){this.to=url;}};vm.runInNewContext(script,{location,URL,URLSearchParams});return location.to;};
  assert.equal(run('?page=about'),'https://www.example.test/about');
  for(const evil of ['?page=/evil.example','?page=//evil.example','?page=%2F%2Fevil.example'])assert.equal(run(evil),undefined,evil);
  assert.match(run('?page=search&q=needle'),/^https:\/\/www\.google\.com\/search\?q=needle&as_sitesearch=/);
});

test('save notification is dismissible and does not persist in navigation state',async()=>{
  const env=environment(),auth=await login(env);
  const body=await(await call(env,'/admin?view=site&saved=1',undefined,auth.cookie)).text();
  assert.match(body, /id="admin-toast" class="toast toast-show"/);
  assert.match(body, /#admin-toast \{[^}]*opacity:0; visibility:hidden/);
  const cleanup=body.match(/const currentUrl = new URL\(window\.location\.href\);[\s\S]*?history\.replaceState\(history\.state, '', currentUrl\.href\);\s*}/)?.[0];
  assert.ok(cleanup);
  let replaced='';const history={state:{marker:1},replaceState(state,unused,url){replaced=url;assert.equal(state.marker,1);}};
  vm.runInNewContext(cleanup,{URL,window:{location:{href:'https://cloud.test/admin?view=site&saved=1&cat=news#site'}},history});
  assert.equal(replaced,'https://cloud.test/admin?view=site&cat=news#site');
});

test('package import screen explains directory layout and page IDs in both languages', async()=>{
  const env=environment(),auth=await login(env);
  for (const [lang,label] of [['ja','ZIP内のファイルの置き方'],['en','How to arrange files in the ZIP']]) {
    await saveSettings(env,{system_lang:lang});
    const body=await(await call(env,'/admin?view=import',undefined,auth.cookie)).text();
    assert.ok(body.includes(label));assert.match(body,/posts\/\s+coffee\/\s+index\.json\s+→ coffee\/index/);
  }
});

test('media upload publishes the stored image and offers retry on publication failure',async()=>{
 const env=environment(),auth=await login(env),body=await(await call(env,'/admin',undefined,auth.cookie)).text();
 const start=body.indexOf("    const uploadPublicationStatus = document.getElementById('upload-publication-status');"),end=body.indexOf('    // Keep the viewport stable',start);assert.ok(start>=0&&end>start);
 const script=body.slice(start,end),calls=[],status={textContent:''},retry={hidden:true,style:{display:'none'},addEventListener(name,fn){this.click=fn;}},button={innerHTML:'Upload',disabled:false},fileInput={value:'file'};
 let fail=true;const context={document:{getElementById:id=>({'upload-publication-status':status,'upload-publication-retry':retry,'upload-btn':button}[id]||null)},window:{location:{href:'https://cloud.test/admin'},cloudPublish:async(...args)=>{calls.push(args);if(fail)throw new Error('Unavailable');}},fileInput,FormData,fetch:async()=>({json:async()=>({success:true,uploaded_name:'photo.png',message:'Saved'})}),refreshMediaGrid:async()=>{},showToast:()=>{}};
 vm.runInNewContext(script,context);await context.doMediaUpload(new FormData());assert.equal(calls.length,1);assert.equal(calls[0][0],false);assert.equal(calls[0][2],'photo.png');assert.equal(retry.hidden,false);assert.match(status.textContent,/Unavailable/);
 fail=false;await retry.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(retry.hidden,true);assert.equal(calls.length,2);assert.match(status.textContent,/公開しました|published/i);
});
