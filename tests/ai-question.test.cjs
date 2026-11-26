const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {environment,call,login,publicView}=require('./fixtures.cjs');
const {savePage,saveSettings,saveComponent,loadComponent,listPages,listComponents}=require('../.test-build/src/storage.js');
const {standardDefaults}=require('../.test-build/src/defaults.js');
const worker=require('../.test-build/src/index.js').default;
test('there is no public help MCP',async()=>{
 const env=environment();
 for(const path of ['/public-mcp','/public-mcp?action=get_product_info','/mikanBox/public-mcp.php'])assert.equal((await call(env,path)).status,404,path);
 assert.equal((await call(env,'/mcp')).status,401);
});
test('Cloud question boxes render public sources; the removed help-section form shows nothing',async()=>{
 const env=environment();env.PUBLIC_SITE_URL='https://public.test';
 await savePage(env,'question',{title:'AI',status:'public_dynamic',content_md:[
  '{{AI_QUESTION:section-1}}','{{AI_QUESTION}}',
  '{{AI_QUESTION:sources=https://public.test/faq.md?x=1&y=2 | https://docs.test/guide/}}',
  '```\n{{AI_QUESTION}}\n```',
 ].join('\n\n')});
 const h=await(await publicView(env,'/question')).text();
 assert.equal((h.match(/data-mikanbox-ai-question/g)||[]).length,2);
 assert.equal((h.match(/src="\/mikanbox\/ai-question.js"/g)||[]).length,1);
 assert.doesNotMatch(h,/webmcp|data-mcp-endpoint|data-section|section-1/);
 assert.match(h,/data-page-url="https:\/\/public.test\/question\/"/);
 assert.match(h,/data-sources="https:\/\/public.test\/faq.md\?x=1&amp;y=2 \| https:\/\/docs.test\/guide\/"/);
 assert.match(h,/<code>[\s\S]*\{\{AI_QUESTION\}\}/);
});
test('editable question component is initialized in HTML and omitted from Markdown and data',async()=>{
 const env=environment();env.PUBLIC_SITE_URL='https://public.test';
 const request=new Request('https://public.test/');
 await saveComponent(env,'_ai_question',standardDefaults('ja').components._ai_question);
 await savePage(env,'question',{title:'Question',status:'public_static',output_format:'html_md',
  content_md:'{{COMPONENT:_ai_question}}',md_footer_comps:['_ai_question']});
 await savePage(env,'question-data',{title:'Data',status:'public_static',output_format:'txt',expand_tags:true,
  content_md:'Before{{COMPONENT:_ai_question}}After'});
 await require('../.test-build/src/ssg.js').buildStatic(env,request);
 const {readPublicationEntry}=require('../.test-build/src/static-publication.js');
 const read=async path=>new TextDecoder().decode((await readPublicationEntry(env,request,path)).body);
 const html=await read('/question.html');
 assert.match(html,/<template data-ai-prompt-template>[\s\S]*%QUESTION%[\s\S]*%SOURCE_URLS%[\s\S]*資料としてだけ使ってください/);
 assert.match(html,/data-page-url="https:\/\/public.test\/question\/"/);
 assert.match(html,/ai-question\.js" data-page-url=/);
 assert.match(html,/data-ai-send="https:\/\/chatgpt.com\/\?q="/);
 const markdown=await read('/question.md');
 assert.match(markdown,/title: "Question"/);
 assert.doesNotMatch(markdown,/data-ai-input|%QUESTION%/);
 assert.equal(await read('/question-data.txt'),'BeforeAfter');
});
test('question box migrations change only the shipped stock component',async()=>{
 const stock={html:'{{AI_QUESTION}}',css:'',is_global:true,is_wrapper:false,is_ai_doc:false,
  memo:'公開ページにAI質問ボックスを配置するパーツです。ページ本文へ {{COMPONENT:_ai_question}} と記述して使います。質問、現在のページ、公式公開マニュアルだけを外部AIへ渡し、APIキーや非公開情報は扱いません。'};
 const migration=fs.readFileSync('migrations/0031_editable_ai_question.sql','utf8')+fs.readFileSync('migrations/0032_ai_question_protective_default.sql','utf8');
 const env=environment();
 await saveComponent(env,'_ai_question',{...stock,css:'.question { color: red; }'});
 const authored=await loadComponent(env,'_ai_question');
 env.sqlite.exec(migration);
 assert.deepEqual(await loadComponent(env,'_ai_question'),authored);
 await saveComponent(env,'_ai_question',stock);
 env.sqlite.exec(migration);
 assert.deepEqual(await loadComponent(env,'_ai_question'),standardDefaults('ja').components._ai_question);
});
test('the browser script registers no WebMCP tools and calls no endpoint',async()=>{
 const tools=[],requests=[],callbacks=[];
 const doc={baseURI:'https://cloud.test/admin',currentScript:{src:'https://cloud.test/mikanbox/ai-question.js',dataset:{}},documentElement:{lang:'ja'},readyState:'loading',addEventListener:(event,callback)=>callbacks.push(callback),getElementById:()=>true,querySelectorAll:()=>[],body:{},modelContext:{registerTool:t=>tools.push(t)}};
 const ctx={window:{},document:doc,URL,Promise,MutationObserver:class{observe(){}},fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({})};}};
 const source=fs.readFileSync('public/mikanbox/ai-question.js','utf8');
 vm.runInNewContext(source,ctx);callbacks[0]();
 assert.deepEqual(tools,[]);assert.deepEqual(requests,[]);
 assert.match(source,/https:\/\/yoshihiko\.com\/mikanbox\/help_' \+ lang \+ '\.md'/);
 assert.match(source,/https:\/\/yoshihiko\.com\/mikanbox\/spec_' \+ lang \+ '\.md'/);
 assert.doesNotMatch(source,/modelContext|public-mcp/);
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
 const auth=await login(env);queries=0;const rss=await call(env,'/rss.xml',undefined,auth.cookie);assert.equal(rss.status,200);assert.ok(queries<14,'feed queries: '+queries);
 queries=0;await require('../.test-build/src/ssg.js').buildStatic(env,new Request('https://cloud.test/'));assert.ok(queries<10);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM static_pages').get().n,env.sqlite.prepare("SELECT COUNT(*) n FROM posts WHERE status LIKE 'public%'").get().n); // the search page is public too
});

