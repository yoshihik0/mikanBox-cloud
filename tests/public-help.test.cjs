const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {environment,call,login,publicView}=require('./fixtures.cjs');
const {savePage,saveSettings,saveComponent,listPages,listComponents}=require('../.test-build/src/storage.js');
const {helpSections}=require('../.test-build/src/public-help.js');
const worker=require('../.test-build/src/index.js').default;
test('public help has only four read-only tools and never exposes private data',async()=>{
 const env=environment();await saveSettings(env,{api_key:'secret-key',memo:'PRIVATE_TEST_PAYLOAD_9d3b_SETTING'});
 await savePage(env,'help_ja',{title:'Help',status:'draft',content_md:'## PRIVATE_TEST_PAYLOAD_9d3b_DRAFT\nprivate-help'});
 await savePage(env,'help_en/index',{title:'Fake fallback',status:'public_dynamic',content_md:'## WRONG_DIRECTORY'});
 const rpc=async(name,args={})=>{const r=await worker.fetch(new Request('https://cloud.test/public-mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:name==='tools/list'?name:'tools/call',params:{name,arguments:args}})}),env);return r.json();};
 let r=await rpc('tools/list');assert.equal(r.result.tools.length,4);assert.ok(r.result.tools.every(t=>t.annotations.readOnlyHint));
 r=await rpc('search_help',{query:'画像',language:'ja'});assert.ok(JSON.parse(r.result.content[0].text).results.length);
 const data=await(await call(env,'/public-mcp?action=get_help_section&id=section-1')).text();assert.doesNotMatch(data,/PRIVATE_TEST_PAYLOAD_9d3b|private-help/);
 const help=await(await call(env,'/public-help.html?language=en')).text();assert.doesNotMatch(help,/WRONG_DIRECTORY|PRIVATE_TEST_PAYLOAD_9d3b/);
 r=await rpc('get_settings');assert.equal(r.result.isError,true);
 assert.equal((await call(env,'/mcp')).status,401);
 const cross=await worker.fetch(new Request('https://cloud.test/public-mcp?action=get_product_info',{headers:{Origin:'https://evil.test'}}),env);assert.equal(cross.status,403);
 await savePage(env,'help_ja',{title:'Help',status:'public_dynamic',content_md:'## Safe manual {#safe}\nPUBLIC_HELP'});
 r=await rpc('get_help_section',{id:'safe'});assert.match(r.result.content[0].text,/PUBLIC_HELP/);
 r=await rpc('search_help',{query:'x',extra:'secret'});assert.equal(r.result.isError,true);
});
test('help headings in fenced examples do not become sections',()=>{
 const sections=helpSections('## One {#one}\n```md\n## Fake\n```\n## Two');assert.deepEqual(sections.map(s=>s.id),['one','section-2']);
});
test('AI question tag and WebMCP script are rendered once with Cloud endpoints',async()=>{
 const env=environment();await savePage(env,'question',{title:'AI',status:'public_dynamic',content_md:'{{AI_QUESTION:section-1}}\n{{AI_QUESTION}}\n\n```\n{{AI_QUESTION}}\n```'});
 const h=await(await publicView(env,'/question')).text();assert.equal((h.match(/data-mikanbox-ai-question/g)||[]).length,2);assert.equal((h.match(/src="\/mikanbox\/ai-question.js"/g)||[]).length,1);assert.match(h,/data-mcp-endpoint="\/public-mcp"/);assert.match(h,/data-section="section-1"/);assert.match(h,/<code>[\s\S]*\{\{AI_QUESTION\}\}/);
});
test('browser script registers and executes four WebMCP tools with no admin key',async()=>{
 const tools=[],requests=[],callbacks=[];
 const doc={baseURI:'https://cloud.test/admin',currentScript:{src:'https://cloud.test/mikanbox/ai-question.js',dataset:{mcpEndpoint:'/public-mcp',publicMcp:'/public-mcp',helpJa:'/public-help.html?language=ja'}},documentElement:{lang:'ja'},readyState:'loading',addEventListener:(event,callback)=>callbacks.push(callback),getElementById:()=>true,querySelectorAll:()=>[],body:{},modelContext:{registerTool:t=>tools.push(t)}};
 const ctx={window:{},document:doc,URL,Promise,MutationObserver:class{observe(){}},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({product:'Cloud'})};}};
 vm.runInNewContext(fs.readFileSync('public/mikanbox/ai-question.js','utf8'),ctx);callbacks[0]();assert.equal(tools.length,4);assert.ok(tools.every(t=>t.annotations.readOnlyHint));
 const result=await tools.find(t=>t.name==='get_product_info').execute({});assert.equal(result.structuredContent.product,'Cloud');assert.match(requests[0].url,/^https:\/\/cloud.test\/public-mcp\?action=get_product_info/);assert.equal(requests[0].options.headers.Authorization,undefined);
});
test('admin list acquisition has constant query count as content grows',async()=>{
 const env=environment();const auth=await login(env);
 for(let i=0;i<80;i++){await savePage(env,'many'+i,{title:'Page',status:'draft'});await saveComponent(env,'part'+i,{html:'Part'});}
 let queries=0;const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=(...args)=>{queries++;return prepare(...args);};
 assert.ok((await listPages(env)).length>=80);assert.ok((await listComponents(env)).length>=80);assert.equal(queries,2);
 queries=0;const response=await call(env,'/admin',undefined,auth.cookie);assert.equal(response.status,200);assert.ok(queries<20,`Used ${queries} queries`);
});
test('navigation, search, feeds and static builds stay within Free D1 query limits with many pages',async()=>{
 const env=environment();await saveSettings(env,{site_name:'Many'});await saveComponent(env,'_layout',{html:'<html><head>{{HEAD_CSS}}{{HEAD_JS}}</head><body>{{NAV_LINKS:all}}{{NAV_CARDS:all}}{{CONTENT}}</body></html>'});
 for(let i=0;i<80;i++)await savePage(env,'page'+i,{title:'Find me '+i,status:'public_static',content_md:'Content'});
 await savePage(env,'search',{title:'Search',status:'public_dynamic',content_md:'{{SEARCH_RESULTS}}'});
 const prepare=env.DB.prepare.bind(env.DB);let queries=0;env.DB.prepare=(...args)=>{queries++;return prepare(...args);};
 queries=0;const rss=await call(env,'/rss.xml');assert.equal(rss.status,200);assert.ok(queries<10);
 queries=0;await require('../.test-build/src/ssg.js').buildStatic(env,new Request('https://cloud.test/'));assert.ok(queries<10);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM static_pages').get().n,81); // the search page is public too
});
