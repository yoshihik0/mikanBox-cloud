const test=require('node:test');
const assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const {saveSettings,savePage,loadPage,saveComponent,loadComponent,getMediaObject}=require('../.test-build/src/storage.js');
const {handleMcp}=require('../.test-build/src/mcp.js');
async function client(settings={}) {
  const env=environment();await saveSettings(env,{api_key:'test-mcp-key',site_id:'site-test',...settings});
  async function rpc(method,params={}) {
    const response=await handleMcp(new Request('https://cloud.test/mcp',{method:'POST',headers:{Authorization:'Bearer test-mcp-key','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env);
    return (await response.json()).result;
  }
  const tool=async(name,args={})=>{const result=await rpc('tools/call',{name,arguments:args});return {error:result.isError,data:result.isError?result.content[0].text:JSON.parse(result.content[0].text)};};
  return {env,rpc,tool};
}
test('MCP discovers SQLite tools and accepts flat and legacy page field arguments',async()=>{
  const {env,rpc,tool}=await client();
  const init=await rpc('initialize');assert.match(init.instructions,/get_site_info.*get_ai_context/);
  const tools=(await rpc('tools/list')).tools,names=tools.map(t=>t.name);
  assert.equal(tools.find(t=>t.name==='get_ai_context').annotations.untrustedContentHint,true);
  assert.equal(tools.find(t=>t.name==='create_component').annotations.destructiveHint,false);
  assert.equal(tools.find(t=>t.name==='update_page').annotations.idempotentHint,true);
  for(const name of ['create_component','get_settings','get_ai_context','list_ai_docs','get_ai_doc','update_ai_doc','upload_media'])assert.ok(names.includes(name));
  assert.equal((await tool('create_page',{id:'news/item',title:'News',category:'stories',js:'window.news=1;',content_md:'Before'})).error,false);
  assert.equal((await tool('update_page',{id:'news/item',content_md:'After'})).error,false);
  let page=await loadPage(env,'news/item');assert.equal(page.title,'News');assert.equal(page.category,'stories');assert.equal(page.js,'window.news=1;');assert.equal(page.content_md,'After');
  assert.equal((await tool('update_page',{id:'news/item',data:{css:'.page{}'}})).error,false);
  assert.equal((await tool('get_page',{id:'news/item'})).data.id,'news/item');
  const listed=(await tool('list_pages')).data;assert.equal(listed.count,1);assert.equal(listed.pages[0].id,'news/item');assert.equal(listed.pages[0].content_md,undefined);
  assert.equal((await tool('update_page',{id:'news/item',content_md:'Ambiguous',data:{content_md:'Other'}})).error,true);
  assert.equal((await tool('update_page',{id:'news/item',data:{password:'bad'}})).error,true);
  assert.equal((await tool('update_page',{id:'news/item',js:7})).error,true);
  assert.equal((await tool('create_page',{id:'empty'})).error,true);
});
test('MCP page mutations use exact IDs rather than public directory aliases',async()=>{
  const {env,tool}=await client();
  await savePage(env,'test/index',{title:'Nested',status:'draft',content_md:'Keep'});
  assert.equal((await tool('update_page',{id:'test',title:'Wrong'})).error,true);
  assert.equal((await loadPage(env,'test/index')).title,'Nested');
  assert.equal((await tool('create_page',{id:'test',title:'Exact'})).error,false);
  assert.equal((await loadPage(env,'test')).title,'Exact');
});
test('MCP component creation refuses collisions and partial updates preserve fields',async()=>{
  const {env,tool}=await client();
  assert.equal((await tool('create_component',{id:'card',html:'<b>Before</b>',css:'b{}',js:'x()',is_global:true})).error,false);
  assert.equal((await tool('create_component',{id:'card',html:'Overwrite'})).error,true);
  assert.equal((await tool('update_component',{id:'card',html:'After'})).error,false);
  const current=await loadComponent(env,'card');assert.equal(current.css,'b{}');assert.equal(current.js,'x()');assert.equal(current.is_global,true);assert.equal(current.html,'After');
  assert.equal((await tool('update_component',{id:'missing',html:'Absent'})).error,true);
  assert.equal((await tool('update_component',{id:'legacy',data:{html:'Legacy'}})).error,false);
  const listed=(await tool('list_components')).data;assert.equal(listed.count,2);assert.equal(listed.components[0].id,'card');
});
test('MCP AI documents match SQLite suffix, context, byte count, and protected type semantics',async()=>{
  const {env,tool}=await client();await saveComponent(env,'ordinary.md',{html:'Keep',is_ai_doc:false});
  assert.equal((await tool('update_ai_doc',{id:'ordinary',html:'Overwrite'})).error,true);
  assert.equal((await tool('get_ai_doc',{id:'ordinary'})).error,true);
  assert.equal((await tool('update_ai_doc',{id:'DESIGN',html:'日本語',css:'body{}'})).error,false);
  assert.equal((await tool('update_ai_doc',{id:'DESIGN.md',html:'更新'})).error,false);
  const doc=(await tool('get_ai_doc',{id:'DESIGN'})).data;assert.equal(doc.id,'DESIGN.md');assert.equal(doc.css,'body{}');assert.equal(doc.is_ai_doc,true);
  const context=(await tool('get_ai_context')).data;assert.deepEqual(context.documents,[{id:'DESIGN.md',content_md:'更新'}]);assert.equal(context.count,1);assert.match(context.component_naming,/leading _.*ordinary new or duplicated/);
  assert.deepEqual((await tool('list_ai_docs')).data,{ai_docs:[{id:'DESIGN.md',html_length:6}],count:1});
});
test('MCP settings exclude credentials and demo mode blocks every new write',async()=>{
  let {tool}=await client({password_hash:'secret',mcp_api_key:'other-secret',jwt_secret:'hidden',setup_token:'hidden',memo:'Private',site_name:'Visible'});
  const settings=(await tool('get_settings')).data;assert.equal(settings.site_name,'Visible');
  for(const key of ['api_key','mcp_api_key','password_hash','jwt_secret','setup_token','memo'])assert.equal(settings[key],undefined);
  ({tool}=await client({demo_mode:true}));
  for(const [name,args] of [['create_component',{id:'x'}],['update_ai_doc',{id:'DESIGN',html:'x'}],['upload_media',{filename:'x.png',content_base64:'AAAA'}]])assert.match((await tool(name,args)).data,/Demo mode/);
});
test('MCP uploads genuine image bytes through D1 and rejects duplicate names and malformed media',async()=>{
  const {env,tool}=await client();
  const image=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  const args={filename:'mcp.png',content_base64:image.toString('base64'),category:'news'};
  const uploaded=await tool('upload_media',args);assert.equal(uploaded.error,false);assert.equal(uploaded.data.filename,'news_mcp.png');
  assert.deepEqual(Buffer.from(await(await getMediaObject(env,'news_mcp.png')).arrayBuffer()),image);
  assert.equal((await tool('upload_media',args)).error,true);
  const large=Buffer.alloc(10_000_000,123);image.copy(large);
  assert.equal((await tool('upload_media',{filename:'blocks.png',content_base64:large.toString('base64')})).error,false);
  assert.deepEqual(Buffer.from(await(await getMediaObject(env,'blocks.png')).arrayBuffer()),large);
  for(const incoming of [{...args,filename:'../x.png'},{...args,content_base64:'bad!'},{...args,filename:'x.jpg'},{...args,category:'../bad'},{filename:'audio.mp3',content_base64:'AAAA'}])assert.equal((await tool('upload_media',incoming)).error,true);
});
