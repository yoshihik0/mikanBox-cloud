const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const {savePage,saveComponent,saveSettings,loadSettings}=require('../.test-build/src/storage.js');
const {generatePodcastXml}=require('../.test-build/src/feeds.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');
const {transferExport,transferImportData}=require('../.test-build/src/data-transfer.js');
const request=new Request('https://cloud.test/admin');
const decode=new TextDecoder();
function unzip(bytes) {
  const files=new Map();let offset=0;
  while(offset+30<bytes.length) {
    const view=new DataView(bytes.buffer,bytes.byteOffset+offset);
    if(view.getUint32(0,true)!==0x04034b50)break;
    const size=view.getUint32(18,true),length=view.getUint16(26,true),extra=view.getUint16(28,true),start=offset+30+length+extra;
    files.set(decode.decode(bytes.subarray(offset+30,offset+30+length)),bytes.subarray(start,start+size));offset=start+size;
  }
  return files;
}

test('podcast.xml escapes every episode field (B-C2)',async()=>{
  const env=environment();
  const inject='1</x><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script><x>2';
  const fields=['DURATION','EPISODE_NUM','SEASON','EPISODE_TYPE','EXPLICIT'].map(key=>`{{DATA:${key}}}${inject}{{/DATA}}`).join('\n');
  await savePage(env,'ep1',{title:'Episode',status:'public_static',category:'podcast',content_md:`{{DATA:AUDIO_FILE}}ep1.mp3{{/DATA}}\n${fields}`});
  const xml=await generatePodcastXml(env,await loadSettings(env),request);
  assert.match(xml,/<itunes:duration>1&lt;\/x&gt;/);
  assert.doesNotMatch(xml,/<h:script/);
  for(const tag of ['duration','episode','season','episodeType','explicit'])assert.match(xml,new RegExp(`<itunes:${tag}>1&lt;`),tag);
  const ordinary=environment();
  await savePage(ordinary,'ep',{title:'Episode',status:'public_static',category:'podcast',content_md:'{{DATA:AUDIO_FILE}}a.mp3{{/DATA}}\n{{DATA:DURATION}}12:34{{/DATA}}\n{{DATA:EPISODE_NUM}}3{{/DATA}}'});
  const plain=await generatePodcastXml(ordinary,await loadSettings(ordinary),request);
  assert.match(plain,/<itunes:duration>12:34<\/itunes:duration>/);assert.match(plain,/<itunes:episode>3<\/itunes:episode>/);
});

test('an AI document is never published as a wrapper or a card template (B-C3)',async()=>{
  const env=environment();
  await saveComponent(env,'_layout',{html:'<main class="layout">{{CONTENT}}</main>',css:'',is_global:true,is_wrapper:true,is_ai_doc:false});
  await saveComponent(env,'notes.md',{html:'AI-DOC-PRIVATE-BODY {{CONTENT}}',css:'',is_global:false,is_wrapper:false,is_ai_doc:true});
  await savePage(env,'page',{title:'Page',status:'public_static',wrapper_comp:'notes.md',content_md:'Hello'});
  await savePage(env,'cards',{title:'Cards',status:'public_static',wrapper_comp:'__none',content_md:'{{NAV_CARDS::notes.md}}'});
  const settings=await loadSettings(env);
  const page=(await new MikanBoxRenderer(env,settings,new Request('https://cloud.test/page')).render('page')).html;
  assert.doesNotMatch(page,/AI-DOC-PRIVATE-BODY/);assert.match(page,/class="layout"/);assert.match(page,/Hello/);
  const cards=(await new MikanBoxRenderer(env,settings,new Request('https://cloud.test/cards')).render('cards')).html;
  assert.doesNotMatch(cards,/AI-DOC-PRIVATE-BODY/);
});

test('saved files never carry the MCP API key, and reading one keeps the current key (B-C5)',async()=>{
  const env=environment();await saveSettings(env,{site_name:'Site',api_key:'DUMMY-LIVE-MCP-KEY-0123456789',site_id:'site-keep'});
  const saved=await transferExport(env,true);
  assert.equal(saved.settings.site_name,'Site');assert.doesNotMatch(JSON.stringify(saved),/LIVE-MCP-KEY|site-keep/);
  await transferImportData(env,'replace',{settings:{site_name:'Other',api_key:'evil',site_id:'evil'}},'admin');
  const now=await loadSettings(env);
  assert.equal(now.site_name,'Other');assert.equal(now.api_key,'DUMMY-LIVE-MCP-KEY-0123456789','the live key is unchanged');assert.equal(now.site_id,'site-keep');
});
