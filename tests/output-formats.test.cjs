// Output formats (PHP 2.17.0–2.18.1) in the Cloud edition: Markdown versions, data formats,
// mikanBox DB, the /id.<extension> URL rules, static publication, admin screens and MCP.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment,call,login,post}=require('./fixtures.cjs');
const {savePage,saveComponent,saveSettings,loadPage,listPages,sortPagesForAdmin}=require('../.test-build/src/storage.js');
const {buildStatic}=require('../.test-build/src/ssg.js');
const {publicationManifest,readPublicationEntry}=require('../.test-build/src/static-publication.js');
const {generateSitemapXml,generateRssXml}=require('../.test-build/src/feeds.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
const {handleMcp}=require('../.test-build/src/mcp.js');
const formats=require('../.test-build/src/output-formats.js');
const request=new Request('https://cloud.test/admin'),decode=new TextDecoder();
const site={site_name:'Site',description:'',ssg_root_url:'https://www.example.test'};

function env(){const value=environment();value.ASSETS={fetch:async r=>new Response('public:'+new URL(r.url).pathname)};return value;}
async function sample(value){
  await saveSettings(value,{...site});
  await saveComponent(value,'_layout',{html:'<html><head></head><body>{{CONTENT}}</body></html>',is_wrapper:true});
  await saveComponent(value,'json_item',{html:'{"title":"{{TITLE}}","url":"{{PAGE_URL}}"}'});
  await saveComponent(value,'_md_footer',{html:'## Related\n{{NAV_LINKS:@same}}'});
  await savePage(value,'index',{title:'Home',status:'public_static',content_md:'<script src="{{PAGE_URL:site}}"></script> {{NAV_LINKS:news}}',updated_at:'2026-11-01 00:00:00'});
  await savePage(value,'article',{title:'Article',status:'public_static',category:'news, _nav',output_format:'html_md',md_footer_comps:['_md_footer'],content_md:'# Article\n\nSee [notes](notes) and ![p](p.png).',updated_at:'2026-11-03 00:00:00'});
  await savePage(value,'notes',{title:'Notes',status:'public_static',category:'news',output_format:'md',content_md:'Plain notes',updated_at:'2026-11-02 00:00:00'});
  await savePage(value,'list',{title:'List',status:'public_static',output_format:'json',content_md:'[{{NAV_CARDS:news:json_item:sort=new:sep=,}}]'});
  await savePage(value,'site',{title:'Site JS',status:'public_static',output_format:'js',content_md:"const t='{{TITLE}}';"});
  await savePage(value,'shop',{title:'Shop',status:'public_static',output_format:'db',content_md:'{{DATAROW:a}}{{DATA:price}}10{{/DATA}}{{/DATAROW}}'});
  await savePage(value,'secret',{title:'Secret',status:'draft',output_format:'txt',content_md:'draft text'});
}

test('format helpers follow the PHP rules',()=>{
  assert.equal(formats.pageOutputFormat({status:'db'}),'db');
  assert.equal(formats.pageOutputFormat({status:'draft',output_format:'bogus'}),'html');
  assert.deepEqual(formats.normalizeLegacyPage({title:'x',status:'db',expand_tags:true}),{title:'x',status:'public_static',output_format:'db'});
  assert.equal(formats.pageExpandsTags({status:'draft',output_format:'js'}),false);
  assert.equal(formats.pageExpandsTags({status:'draft',output_format:'json'}),true);
  assert.deepEqual(formats.visibleCategories('a, _b, c'),['a','c']);
  const t=(key,...a)=>key+(a.length?':'+a.join(','):'');
  assert.equal(formats.validatePageSave('a.b','',{},t),'err_page_id_dot:a.b');
  assert.equal(formats.validatePageSave('a.b','a.b',{},t),null);
  assert.equal(formats.validatePageSave('x','',{category:'@same'},t),'err_category_reserved:@same');
  assert.equal(formats.validatePageSave('404','',{output_format:'md'},t),'err_output_format_404');
  assert.equal(formats.validatePageSave('rss','',{output_format:'xml'},t),'err_output_format_reserved:rss.xml');
  assert.equal(formats.validatePageSave('rss','',{output_format:'json'},t),null);
  assert.equal(formats.publishedPath('index',{output_format:'md'}),'/index.md');
  assert.equal(formats.publishedPath('shop',{output_format:'db'}),'/api/shop.json');
});

test('static build publishes Markdown, data and API files with their content types and hashed PAGE_URL',async()=>{
  const value=env();await sample(value);await buildStatic(value,request);
  const paths=(await publicationManifest(value)).entries.map(e=>e.path);
  for(const path of ['/index.html','/article.html','/article.md','/notes.md','/list.json','/site.js','/api/shop.json'])assert.ok(paths.includes(path),path);
  assert.ok(!paths.includes('/notes.html')&&!paths.includes('/secret.txt'));
  const read=async path=>{const e=await readPublicationEntry(value,request,path);return e&&{type:e.contentType,body:decode.decode(e.body)};};
  assert.equal((await read('/article.md')).type,'text/markdown; charset=utf-8');
  assert.equal((await read('/notes.md')).type,'text/markdown; charset=utf-8');
  assert.equal((await read('/list.json')).type,'application/json; charset=utf-8');
  assert.equal((await read('/site.js')).type,'text/javascript; charset=utf-8');
  assert.equal((await read('/api/shop.json')).type,'application/json; charset=utf-8');
  assert.equal(await read('/secret.txt'),null);assert.equal(await read('/notes.html'),null);assert.equal(await read('/list.md'),null);
  // The JS page is published as it is (tags not expanded by default); the JSON page escapes for JSON.
  assert.equal((await read('/site.js')).body,"const t='{{TITLE}}';");
  assert.deepEqual(JSON.parse((await read('/list.json')).body),[{title:'Article',url:'https://www.example.test/article/'},{title:'Notes',url:'https://www.example.test/notes.md'}]);
  assert.deepEqual(JSON.parse((await read('/api/shop.json')).body),{id:'shop',title:'Shop',fields:{},rows:[{id:'a',price:'10'}]});
  // PAGE_URL:ID of a data page carries the hash of the built file.
  const hash=await MikanBoxRenderer.dataHash((await read('/site.js')).body);
  assert.match((await read('/index.html')).body,new RegExp(`<script src="https://www\\.example\\.test/site\\.js\\?v=${hash}"></script>`));
  // The HTML of an HTML + Markdown page announces its Markdown version.
  assert.match((await read('/article.html')).body,/<link rel="alternate" type="text\/markdown" href="https:\/\/www\.example\.test\/article\.md">/);
  const md=(await read('/article.md')).body;
  assert.match(md,/^---\ntitle: "Article"\ndate: 2026-11-03\nurl: "https:\/\/www\.example\.test\/article\/"\ncategories: "news"\n---\n\n# Article/);
  assert.match(md,/\[notes\]\(https:\/\/www\.example\.test\/notes\.md\)/);assert.match(md,/!\[p\]\(https:\/\/www\.example\.test\/media\/p\.png\)/);
  assert.match(md,/## Related\n- \[Notes\]\(https:\/\/www\.example\.test\/notes\.md\)\n$/);
});

test('_redirects: Markdown-only pages answer /id and /id/ with .md, data pages get no alias, DB pages alias /api/ID',async()=>{
  const value=env();await sample(value);await buildStatic(value,request);
  const rules=decode.decode((await readPublicationEntry(value,request,'/_redirects')).body).trim().split('\n');
  for(const rule of ['/notes /notes.md 200','/notes/ /notes.md 200','/article /article.html 200','/ /index.html 200','/api/shop /api/shop.json 200'])assert.ok(rules.includes(rule),rule);
  assert.ok(!rules.some(r=>r.startsWith('/list ')||r.startsWith('/site ')||r.includes('/article.md')));
  // HTML + Markdown adds a file, not an alias: the count equals two per page plus root and API.
  assert.equal(rules.length,2*3+1+1);
});

test('_headers types every text output with charset=utf-8: wildcard rules per extension, exact rules for aliases and XML',async()=>{
  const value=env();await sample(value);await savePage(value,'feed',{title:'Feed',status:'public_static',output_format:'xml',content_md:'<a/>'});await buildStatic(value,request);
  const headers=decode.decode((await readPublicationEntry(value,request,'/_headers')).body);
  const cors='  Access-Control-Allow-Origin: *\n';
  const rule=(path,type,withCors=!type.startsWith('text/html')&&!['/sitemap.xml','/rss.xml'].includes(path))=>assert.ok(headers.includes(`\n${path}\n  Content-Type: ${type}\n${withCors?cors:''}\n`)||headers.endsWith(`\n${path}\n  Content-Type: ${type}\n${withCors?cors:''}`),path);
  for(const [ext,type] of [['html','text/html'],['md','text/markdown'],['txt','text/plain'],['csv','text/csv'],['js','text/javascript'],['css','text/css'],['json','application/json']])rule('/*.'+ext,type+'; charset=utf-8');
  // Cloudflare matches the requested path, not the rewrite target: aliases need their own rule.
  rule('/notes','text/markdown; charset=utf-8');rule('/notes/','text/markdown; charset=utf-8');rule('/api/shop','application/json; charset=utf-8');
  rule('/feed.xml','application/xml; charset=utf-8');rule('/sitemap.xml','application/xml; charset=utf-8');rule('/rss.xml','application/rss+xml; charset=utf-8');
  // No wildcard for XML (feeds have their own types) and no rule for HTML aliases.
  assert.doesNotMatch(headers,/\*\.xml|\n\/article\n|\n\/\n/);
  // Each path gets at most one Content-Type rule apart from the wildcard (two would be comma-joined).
  const exact=[...headers.matchAll(/\n(\/[^\n*]*)\n  Content-Type:/g)].map(m=>m[1]);assert.equal(new Set(exact).size,exact.length);
  // Markdown and data outputs allow cross-origin reads (as in PHP); HTML and feeds do not, and no path gets the header twice.
  assert.equal((headers.match(/Access-Control-Allow-Origin/g)||[]).length,(headers.match(/\n\/(?:\*\.(?:md|txt|csv|js|css|json)|notes\/?|api\/shop|feed\.xml)\n/g)||[]).length);
  assert.ok(headers.split(/\n(?=\/)/).length<=100);
});

test('a page that becomes a draft or changes format leaves the publication after the next build',async()=>{
  const value=env();await sample(value);await buildStatic(value,request);
  await savePage(value,'list',{...await loadPage(value,'list'),status:'draft'});
  await savePage(value,'notes',{...await loadPage(value,'notes'),output_format:'txt'});
  await buildStatic(value,request);
  const paths=(await publicationManifest(value)).entries.map(e=>e.path);
  assert.ok(!paths.includes('/list.json')&&!paths.includes('/notes.md')&&paths.includes('/notes.txt'));
  assert.ok(!decode.decode((await readPublicationEntry(value,request,'/_redirects')).body).includes('/notes '));
});

test('sitemap and RSS leave out data and DB pages and point Markdown-only pages at /id.md',async()=>{
  const value=env();await sample(value);
  const sitemap=await generateSitemapXml(value,site,request),rss=await generateRssXml(value,site,request);
  for(const xml of [sitemap,rss]){
    assert.match(xml,/https:\/\/www\.example\.test\/notes\.md/);assert.match(xml,/https:\/\/www\.example\.test\/article</);
    assert.doesNotMatch(xml,/list|site\.js|shop|secret/);
  }
});

test('legacy DB status reads as output format db, and a migration-free save stores the new form',async()=>{
  const value=env();
  value.sqlite.prepare("INSERT INTO posts(id,data,status) VALUES('old','{\"title\":\"Old\",\"status\":\"db\",\"content_md\":\"{{DATA:a}}1{{/DATA}}\"}','db')").run();
  const page=await loadPage(value,'old');assert.equal(page.status,'public_static');assert.equal(page.output_format,'db');
  await savePage(value,'old',page);
  assert.equal(value.sqlite.prepare("SELECT status FROM posts WHERE id='old'").get().status,'public_static');
});

test('Worker preview and development routing follow the /id.<extension> rules',async()=>{
  const value=env();await sample(value);const auth=await login(value);
  const get=async path=>{const r=await call(value,path,undefined,auth.cookie);return {status:r.status,type:r.headers.get('Content-Type'),body:await r.text()};};
  let r=await get('/notes.md');assert.equal(r.status,200);assert.equal(r.type,'text/markdown; charset=utf-8');assert.match(r.body,/^---\ntitle: "Notes"/);
  r=await get('/notes');assert.equal(r.type,'text/markdown; charset=utf-8');
  r=await get('/notes.html');assert.equal(r.status,404);
  r=await get('/list.json');assert.equal(r.type,'application/json; charset=utf-8');assert.match(r.body,/"title":"Article"/);
  r=await get('/list');assert.equal(r.status,404);assert.match(r.type,/text\/html/);
  r=await get('/list.xml');assert.equal(r.status,404);assert.equal(r.type,'text/plain; charset=utf-8');
  r=await get('/article.md');assert.equal(r.type,'text/markdown; charset=utf-8');
  r=await get('/index.md');assert.equal(r.status,404);
  r=await get('/secret.txt');assert.equal(r.status,200);assert.equal(r.body,'draft text');
  r=await get('/preview/notes.md');assert.equal(r.type,'text/markdown; charset=utf-8');
  // Visitors never get pages from the Worker; the API answers both /api/ID.json and /api/ID, and a draft API stops.
  assert.equal((await call(value,'/notes.md')).status,404);
  const api=await call(value,'/api/shop.json'),alias=await call(value,'/api/shop');
  assert.equal(api.headers.get('Content-Type'),'application/json; charset=utf-8');assert.equal(api.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(await api.text(),await alias.text());
  await savePage(value,'shop',{...await loadPage(value,'shop'),status:'draft'});
  assert.equal((await call(value,'/api/shop.json')).status,403);assert.equal((await call(value,'/api/shop')).status,403);
  assert.equal((await call(value,'/api/list.json')).status,404);
});

test('admin page list puts index first, labels formats, greys out visual editing and previews text as UTF-8',async()=>{
  const value=env();await sample(value);const auth=await login(value);
  await savePage(value,'aaa',{title:'AAA',status:'draft',sort_order:-5,category:'_hidden, x'});
  await savePage(value,'waiting',{title:'Waiting',status:'pending',sort_order:9});
  assert.deepEqual(sortPagesForAdmin(await listPages(value)).slice(0,3).map(p=>p.id),['waiting','index','aaa']);
  const html=await(await call(value,'/admin?view=pages',undefined,auth.cookie)).text();
  const order=['waiting','index','aaa'].map(id=>html.indexOf(`<code>${id}</code>`));
  assert.ok(order[0]>0&&order[0]<order[1]&&order[1]<order[2],'pending, index, display order');
  assert.match(html,/class="format-badge format-md"[^>]*>\+MD</);assert.match(html,/class="format-badge format-md"[^>]*>MD</);
  assert.match(html,/class="format-badge format-data"[^>]*>JSON</);assert.match(html,/class="format-badge format-data"[^>]*>DB</);
  assert.match(html,/<span class="btn btn-sm btn-gray btn-disabled" aria-disabled="true"/);
  assert.match(html,/href="\/admin\?page_preview=notes"/);assert.match(html,/<span class="category-structural">_hidden<\/span>/);
  assert.match(html,/category-cloud-tag[^"]*is-structural/);
  assert.doesNotMatch(html,/<option value="db"/,'the DB status is gone from the status select');
  const preview=await call(value,'/admin?page_preview=notes',undefined,auth.cookie);
  assert.equal(preview.headers.get('Content-Type'),'text/plain; charset=utf-8');assert.match(await preview.text(),/Plain notes/);
  const draft=await call(value,'/admin?page_preview=secret',undefined,auth.cookie);assert.equal(await draft.text(),'draft text');
  assert.equal((await call(value,'/admin?page_preview=notes')).headers.get('Content-Type').startsWith('text/plain'),false,'login required');
});

test('page editor: ID, output format, category order, field visibility and saving the format fields',async()=>{
  const value=env();await sample(value);const auth=await login(value);
  const html=await(await call(value,'/admin?view=pages&edit=list',undefined,auth.cookie)).text();
  const pos=['name="id"','id="output-format-select"','name="category"','name="wrapper_comp"'].map(x=>html.indexOf(x));
  assert.ok(pos.every((p,i)=>p>0&&(i===0||p>pos[i-1])),'ID → output format → category → design');
  assert.match(html,/<option value="json" data-expand="1" selected/);assert.match(html,/<option value="db"\s*>mikanBox DB \(\/api\/\*\.json\)/);
  assert.match(html,/<label id="content-label" data-labels="[^"]+">本文 \(JSON\)<\/label>/);
  assert.match(html,/id="editor-visual-btn" class="btn btn-sm editor-visual-btn btn-gray btn-disabled"/);
  assert.match(html,/data-formats="json xml csv txt js css"/);assert.match(html,/data-static-base="https:\/\/www\.example\.test"/);
  let saved=await post(value,auth,{save_action:'save_page',old_id:'list',id:'list',title:'List',status:'public_static',output_format:'csv',expand_tags_present:'1',md_footer_comps:'',content_md:'a,b',expected_revision:(await loadPage(value,'list')).revision_tag||''});
  assert.equal(saved.data.success,true,saved.data.message);
  let page=await loadPage(value,'list');assert.equal(page.output_format,'csv');assert.equal(page.expand_tags,false);
  saved=await post(value,auth,{save_action:'save_page',old_id:'',id:'rss',title:'Feed',status:'draft',output_format:'xml',content_md:'x'});
  assert.equal(saved.data.success,false);assert.match(saved.data.message,/rss\.xml/);
  saved=await post(value,auth,{save_action:'save_page',old_id:'',id:'note2',title:'N',status:'draft',output_format:'md',md_footer_comps:'_md_footer, _layout, missing',content_md:'x'});
  assert.equal(saved.data.success,true,saved.data.message);assert.deepEqual((await loadPage(value,'note2')).md_footer_comps,['_md_footer']);
});

test('MCP: format fields, validation, legacy db status and updated_at kept when editing a published page',async()=>{
  const value=env();await sample(value);await saveSettings(value,{...site,api_key:'test-mcp-key'});
  const mcp=async(name,args)=>{const r=await handleMcp(new Request('https://cloud.test/mcp',{method:'POST',headers:{Authorization:'Bearer test-mcp-key','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),value);const j=await r.json();return {error:j.result.isError,text:j.result.content[0].text};};
  const list=JSON.parse((await mcp('list_pages',{})).text);assert.equal(list.pages.find(p=>p.id==='notes').output_format,'md');
  const got=JSON.parse((await mcp('get_page',{id:'site'})).text);assert.equal(got.output_format,'js');assert.equal(got.expand_tags,false);assert.deepEqual(got.md_footer_comps,[]);
  const before=(await loadPage(value,'article')).updated_at;
  assert.equal((await mcp('update_page',{id:'article',content_md:'Edited'})).error,false);
  assert.equal((await loadPage(value,'article')).updated_at,before,'editing a published page keeps its date');
  await mcp('update_page',{id:'secret',status:'public_static'});
  assert.notEqual((await loadPage(value,'secret')).updated_at,undefined);
  assert.equal((await mcp('create_page',{id:'feed2',title:'F',output_format:'xml',expand_tags:false,md_footer_comps:['_md_footer']})).error,false);
  const feed=await loadPage(value,'feed2');assert.equal(feed.output_format,'xml');assert.equal(feed.expand_tags,false);
  assert.match((await mcp('create_page',{id:'sitemap',title:'S',output_format:'xml'})).text,/sitemap\.xml/);
  assert.equal((await mcp('create_page',{id:'bad',title:'B',output_format:'html5'})).error,true);
  await mcp('create_page',{id:'legacy',title:'L',status:'db',content_md:'{{DATA:a}}1{{/DATA}}'});
  const legacy=await loadPage(value,'legacy');assert.equal(legacy.status,'public_static');assert.equal(legacy.output_format,'db');
  const context=JSON.parse((await mcp('get_ai_context',{})).text);assert.match(context.output_formats,/\/api\/ID\.json/);
});

test('content imports keep the format fields and read the former DB status',async()=>{
  const value=env();const auth=await login(value);
  const payload={pages:[{id:'cat',data:{title:'Cat',status:'public_dynamic',output_format:'json',expand_tags:false,content_md:'[]'}},{id:'olddb',data:{title:'Old',status:'db',content_md:''}},{id:'art',data:{title:'Art',status:'draft',output_format:'html_md',md_footer_comps:['_md_footer'],content_md:'x'}}]};
  const r=await post(value,auth,{save_action:'content_import_package',import_payload:JSON.stringify(payload)});assert.equal(r.data.success,true,r.data.message);
  assert.equal((await loadPage(value,'cat')).expand_tags,false);assert.equal((await loadPage(value,'olddb')).output_format,'db');
  assert.equal(value.sqlite.prepare("SELECT status FROM posts WHERE id='olddb'").get().status,'public_static');
  assert.deepEqual((await loadPage(value,'art')).md_footer_comps,['_md_footer']);
});

test('the page list keeps its category filter when a page editor is opened, and a new page takes that category',async()=>{
  const value=env();await sample(value);const auth=await login(value);
  const list=await (await call(value,'/admin?view=pages&cat=news#pages',undefined,auth.cookie)).text();
  assert.match(list,/href="\?view=pages&amp;edit=article&amp;cat=news#page-editor"/);
  assert.match(list,/href="\?view=pages&amp;new=1&amp;cat=news#page-editor"/);
  const editor=await (await call(value,'/admin?view=pages&edit=article&cat=news',undefined,auth.cookie)).text();
  // The list beside the editor stays filtered, and the way back keeps the filter.
  assert.match(editor,/category-cloud-tag active[^"]*"[^>]*>news</);assert.match(editor,/edit=notes/);assert.doesNotMatch(editor,/edit=list\b/);
  assert.match(editor,/href="\/admin\?cat=news#pages" class="btn btn-gray"/);
  assert.match(editor,/window\.location\.href='\/admin\?cat=news#pages'/);
  const fresh=await (await call(value,'/admin?view=pages&new=1&cat=news',undefined,auth.cookie)).text();
  assert.match(fresh,/name="category" value="news"/);
});
