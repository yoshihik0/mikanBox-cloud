// Code spans are hidden from tag processing and put back in one pass (a pass per span made long pages quadratic).
const test=require('node:test'),assert=require('node:assert/strict');
const {environment,publicView}=require('./fixtures.cjs');
test('many code spans and fenced blocks come back intact, in order',async()=>{
  const env=environment();
  const spans=Array.from({length:1500},(_,i)=>'`c'+i+'`').join(' ');
  const md='```\n{{SITE_NAME}} stays literal\n```\n\n'+spans+'\n\n`{{SITE_NAME}}` and `x`';
  env.sqlite.prepare("INSERT INTO posts(id,data,status,sort_order,updated_at) VALUES('index',?,'public_static',0,'')").run(JSON.stringify({title:'T',status:'public_static',content_md:md,wrapper_comp:'__none'}));
  const html=await (await publicView(env,'/')).text();
  assert.ok(html.includes('{{SITE_NAME}} stays literal'),'tags inside a fenced block are not expanded');
  assert.ok(html.includes('<code>{{SITE_NAME}}</code>'),'tags inside a code span are not expanded');
  for(const i of [0,1,9,10,11,100,1499])assert.ok(html.includes('<code>c'+i+'</code>'),'span '+i);
  assert.ok(!html.includes('___CODEBLOCK'),'no placeholder is left');
});
