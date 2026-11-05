// Visual editing (/admin/visual): sign-in and CSRF checks, the page and its globals, saving, history
// (one restore point per editing session), creating pages and images.
const test=require('node:test'),assert=require('node:assert/strict');
const {environment,login,post}=require('./fixtures.cjs');
const worker=require('../.test-build/src/index.js').default;
const ORIGIN='https://cloud.test';
const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64'));
async function setup() {
  const env=environment(),auth=await login(env);
  const put=(id,data)=>env.sqlite.prepare('INSERT INTO posts(id,data,status,sort_order,updated_at) VALUES(?,?,?,0,?)').run(id,JSON.stringify({status:'draft',updated_at:'2026-01-01 00:00:00',...data}),data.status||'draft','2026-01-01 00:00:00');
  put('about',{title:'About',content_md:'# Hello\n\nfirst\n\nsecond\n',css:'p{color:red}\n',revision_tag:'t0'});
  put('crlf',{title:'CRLF',content_md:'a\r\n\r\nb',css:''});
  put('doc',{title:'Doc',is_html:true,content_md:'<!doctype html><html><body><p>x</p></body></html>'});
  const call=(url,{method='GET',body,csrf=auth.csrf_token,cookie=auth.cookie,origin=ORIGIN,headers={}}={})=>{
    const h={...headers};if(cookie)h.Cookie=cookie;if(origin)h.Origin=origin;if(csrf&&method==='POST')h['X-CSRF-Token']=csrf;
    const init={method,headers:h};if(body!==undefined)init.body=body instanceof Uint8Array?body:JSON.stringify(body);
    return worker.fetch(new Request(ORIGIN+url,init),env);
  };
  const api=async(name,body,extra={})=>{const r=await call('/admin/visual?api='+name+(extra.query||''),{method:'POST',body,...extra});return {status:r.status,json:await r.json()};};
  const page=id=>JSON.parse(env.sqlite.prepare('SELECT data FROM posts WHERE id=?').get(id).data);
  return {env,auth,call,api,page,put};
}
const SID='abcdefgh01';

test('sign-in, CSRF and same-origin checks',async()=>{
  const {call,api,auth,page}=await setup();
  const anon=await call('/admin/visual?id=about',{cookie:''});
  assert.equal(anon.status,303);assert.equal(anon.headers.get('Location'),'/admin');
  const anonApi=await call('/admin/visual?api=source&id=about',{cookie:''});
  assert.equal(anonApi.status,401);assert.equal((await anonApi.json()).login,true);
  const write={id:'about',old:'x',new:'y',sid:SID};
  assert.equal((await api('save-md',write,{csrf:''})).status,403,'no CSRF token');
  assert.equal((await api('save-md',write,{csrf:'wrong'})).status,403,'wrong CSRF token');
  assert.equal((await api('save-md',write,{origin:'https://evil.test'})).status,403,'another site');
  const crossSite=await call('/admin/visual?api=save-md',{method:'POST',body:write,origin:'',headers:{'Sec-Fetch-Site':'cross-site'}});
  assert.equal(crossSite.status,403,'cross-site fetch without Origin');
  assert.equal((await api('upload',undefined,{csrf:'',body:PNG})).status,403,'upload needs CSRF too');
  assert.equal((await api('create',{title:'x'},{origin:'https://evil.test'})).status,403);
  assert.equal(page('about').content_md,'# Hello\n\nfirst\n\nsecond\n','nothing was written');
  assert.equal((await call('/admin/visual?api=save-md&id=about',{method:'GET'})).status,405,'GET cannot write');
  assert.ok(auth.csrf_token);
});

test('the page: markers, globals, CSP and scripts',async()=>{
  const {call}=await setup();
  const res=await call('/admin/visual?id=about'),html=await res.text();
  assert.equal(res.status,200);
  const csp=res.headers.get('Content-Security-Policy'),nonce=/script-src 'nonce-([\w-]+)';/.exec(csp)[1];
  assert.ok(!/script-src[^;]*'self'/.test(csp),'same-origin scripts (media, component JS) must not run with the session');
  assert.match(csp,/frame-ancestors 'self'/);assert.match(csp,/object-src 'none'/);
  assert.equal(res.headers.get('Cache-Control'),'no-store');assert.equal(res.headers.get('X-Frame-Options'),'SAMEORIGIN');
  assert.ok(html.includes(`<script nonce="${nonce}" src="/mikanbox/visual.js`));
  assert.match(html,/window\.__VISUAL_PAGE="about"/);assert.match(html,/window\.__VISUAL_DOC=false/);
  assert.match(html,/window\.__VISUAL_CSRF="[\w-]+"/);assert.match(html,/__VISUAL_ADMIN=\{"api":"\/admin\/visual"/);
  assert.ok(html.includes('<!--fv:0-0-->')&&html.includes('<!--fv:4-4-->')&&html.includes('<!--/fv-->'),'blocks are marked');
  assert.ok(html.includes('.fv-css-start')&&html.includes('.fv-css-end'),'CSS range marker');
  assert.ok(!/<p>\s*<!--\/?fv/.test(html),'markers are not wrapped in paragraphs');
  assert.ok(!res.headers.get('Content-Security-Policy').includes('unsafe-eval'));
  const frame=await (await call('/admin/visual?id=about&fv-frame=1')).text();
  assert.ok(!frame.includes('visual.js'),'width frame has no editing code');
  const doc=await (await call('/admin/visual?id=doc')).text();
  assert.match(doc,/window\.__VISUAL_DOC=true/);assert.ok(!doc.includes('<!--fv:'),'documents get no markers');
  assert.equal((await call('/admin/visual?id=missing')).status,404);
  assert.equal((await call('/admin/visual?id=../x')).status,404);
  const picker=await (await call('/admin/visual')).text();
  assert.ok(picker.includes('?id=about')&&picker.includes('About'));
});

test('draft text renders live without writing, and CSS is scoped',async()=>{
  const {api,page}=await setup();
  const r=await api('render',{id:'about',text:'## Live\n\n<div>\n\nx\n\n</div>'});
  assert.equal(r.status,200);assert.ok(r.json.html.includes('<h2>Live</h2>')&&r.json.html.includes('<!--fv:2-6-->'));
  assert.equal(page('about').content_md,'# Hello\n\nfirst\n\nsecond\n');
  const s=await api('scope-css',{css:'p{color:blue}'});
  assert.match(s.json.css,/\.mikan-content-scope p\s*\{/);
  assert.deepEqual((await api('source',{id:'crlf'})).json,{text:'a\n\nb',is_html:false});
  assert.equal((await api('css',{id:'about'})).json.css,'p{color:red}\n');
});

test('saving: old text must match, line endings stay, the admin editor is told',async()=>{
  const {api,page,auth,env}=await setup();
  const stale=await api('save-md',{id:'about',old:'something else',new:'z',sid:SID});
  assert.equal(stale.status,409);
  const ok=await api('save-md',{id:'about',old:'# Hello\n\nfirst\n\nsecond\n',new:'# Hello\n\nchanged\n',sid:SID});
  assert.equal(ok.status,200);assert.equal(page('about').content_md,'# Hello\n\nchanged\n');
  assert.notEqual(page('about').revision_tag,'t0','the admin editor sees the change');
  assert.equal(page('about').title,'About');assert.equal(page('about').updated_at,'2026-01-01 00:00:00');
  const css=await api('save-css',{id:'about',old:'p{color:red}\n',new:'p{color:green}\n',sid:SID});
  assert.equal(css.status,200);assert.equal(page('about').css,'p{color:green}\n');
  assert.equal((await api('save-css',{id:'about',old:'p{color:red}\n',new:'x',sid:SID})).status,409);
  await api('save-md',{id:'crlf',old:'a\n\nb',new:'a\n\nb\n\nc',sid:SID});
  assert.equal(page('crlf').content_md,'a\r\n\r\nb\r\n\r\nc');
  // a stale admin form (older revision tag) is rejected after the visual save; a fresh one goes through
  const admin=(expected_revision)=>post(env,auth,{save_action:'save_page',id:'about',old_id:'about',title:'T',status:'draft',content_md:'from admin',expected_revision});
  assert.equal((await admin('t0')).data.success,false);
  assert.equal((await admin(page('about').revision_tag)).data.success,true);
  // and a visual save never loses to a stale read of the page
  assert.equal((await api('save-md',{id:'about',old:'# Hello\n\nchanged\n',new:'late',sid:SID})).status,409);
});

test('saving a published page says the public site changes only when published',async()=>{
  const {api,env,put}=await setup();
  put('live',{title:'Live',status:'public_static',content_md:'a'});
  const published=await api('save-md',{id:'live',old:'a',new:'b',sid:SID});
  assert.equal(published.status,200);assert.match(published.json.notice,/公開/);
  const draft=await api('save-md',{id:'crlf',old:'a\n\nb',new:'c',sid:SID});
  assert.equal(draft.json.notice,undefined,'drafts need no note');
  assert.equal(env.sqlite.prepare("SELECT status FROM posts WHERE id='live'").get().status,'public_static');
});

test('history: one restore point per editing session, undo/redo, restore',async()=>{
  const {api,page,env}=await setup();
  const rows=()=>env.sqlite.prepare("SELECT COUNT(*) n FROM post_revisions WHERE post_id='about'").get().n;
  let text='# Hello\n\nfirst\n\nsecond\n';
  const edit=async(next,sid)=>{const r=await api('save-md',{id:'about',old:text,new:next,sid});assert.equal(r.status,200);text=next;return r.json;};
  let c=await edit('v1\n',SID);assert.deepEqual([c.undo,c.redo,c.points],[1,0,1]);
  for(const n of [2,3,4,5,6])c=await edit('v'+n+'\n',SID);
  assert.equal(rows(),1,'six saves in one session leave one restore point');
  assert.equal(c.undo,3,'undo keeps the last three states');
  assert.equal(JSON.parse(env.sqlite.prepare("SELECT data FROM post_revisions WHERE post_id='about'").get().data).content_md,'# Hello\n\nfirst\n\nsecond\n','the point is the state before the session');
  const u=await api('undo',{id:'about'});assert.equal(u.json.ok,true);assert.equal(page('about').content_md,'v5\n');assert.deepEqual([u.json.undo,u.json.redo],[2,1]);
  text='v5\n';
  const rd=await api('redo',{id:'about'});assert.equal(page('about').content_md,'v6\n');assert.deepEqual([rd.json.undo,rd.json.redo],[3,0]);
  assert.equal((await api('redo',{id:'about'})).status,409);
  text='v6\n';
  c=await edit('w1\n',SID+'2');assert.equal(rows(),2,'a new session adds one point');assert.equal(c.undo,1,'a new session starts a fresh undo history');
  const pts=(await api('points',{id:'about'})).json.points;assert.equal(pts.length,2);
  assert.equal(JSON.parse(env.sqlite.prepare('SELECT data FROM post_revisions WHERE id=?').get(Number(pts[0].id)).data).content_md,'v6\n');
  const back=await api('restore',{id:'about',point:pts[1].id,sid:SID+'3'});
  assert.equal(back.status,200);assert.equal(page('about').content_md,'# Hello\n\nfirst\n\nsecond\n');assert.equal(page('about').status,'draft','status is kept');
  assert.equal((await api('restore',{id:'about',point:'999999',sid:SID})).status,409);
  assert.equal((await api('restore',{id:'about',point:'x',sid:SID})).status,409);
  const other=await api('restore',{id:'crlf',point:pts[0].id,sid:SID});assert.equal(other.status,409,'another page\'s history cannot be restored');
  assert.equal((await api('history',{id:'about'})).json.points,rows()+0>10?10:rows());
});

test('writes never overwrite a concurrent change, and respect edit locks',async()=>{
  const {api,page,env}=await setup();
  env.sqlite.prepare("INSERT INTO edit_locks(post_id,owner,expires_at) VALUES('about','someone-else',?)").run(Date.now()+60000);
  const locked=await api('save-md',{id:'about',old:'# Hello\n\nfirst\n\nsecond\n',new:'x',sid:SID});
  assert.equal(locked.status,409);assert.equal(page('about').content_md,'# Hello\n\nfirst\n\nsecond\n');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM visual_history').get().n,0,'a refused save leaves no history');
});

test('creating and duplicating pages (always drafts)',async()=>{
  const {api,page,env}=await setup();
  env.sqlite.prepare("UPDATE posts SET status='public_static' WHERE id='about'").run();
  const copy=await api('create',{id:'about-copy',from:'about',title:''});
  assert.equal(copy.status,200);assert.equal(page('about-copy').status,'draft');assert.equal(page('about-copy').content_md,'# Hello\n\nfirst\n\nsecond\n');
  assert.ok(page('about-copy').title.startsWith('About'));
  const fresh=await api('create',{id:'',title:'New one'});assert.equal(fresh.status,200);assert.match(fresh.json.id,/^page_\d+$/);
  assert.equal(page(fresh.json.id).title,'New one');assert.ok(page(fresh.json.id).content_md.length>0);
  assert.equal((await api('create',{id:'about',title:'x'})).status,409);
  assert.equal((await api('create',{id:'bad id!',title:'x'})).status,400);
  assert.equal((await api('create',{id:'admin',title:'x'})).status,400,'reserved');
  assert.equal((await api('create',{id:'media/x',title:'x'})).status,400,'reserved');
  assert.equal((await api('create',{id:'n',from:'missing'})).status,400);
});

test('images: list newest first, upload checks the content',async()=>{
  const {api,env,call}=await setup();
  const up=await api('upload',undefined,{body:PNG});
  assert.equal(up.status,200);assert.match(up.json.name,/^img-\d{8}-\d{6}-[0-9a-f]{4}\.png$/);
  const list=await (await call('/admin/visual?api=media')).json();
  assert.equal(list.base,'/media/');assert.deepEqual(list.items.map(i=>i.name),[up.json.name]);
  const served=await call(list.base+up.json.name);assert.equal(served.status,200);assert.equal(served.headers.get('Content-Type'),'image/png');
  assert.equal((await api('upload',undefined,{body:new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')})).status,400,'svg is not accepted here');
  assert.equal((await api('upload',undefined,{body:new TextEncoder().encode('not an image')})).status,400);
  assert.equal((await api('upload',undefined,{body:new Uint8Array(0)})).status,400);
  const huge=PNG.slice();huge.set([0xff,0xff,0xff,0xff],16);huge.set([0xff,0xff,0xff,0xff],20);
  assert.equal((await api('upload',undefined,{body:huge})).status,400,'too many pixels');
  assert.equal((await api('upload',undefined,{body:new Uint8Array(10_000_001)})).status,400,'over 10 MB');
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media').get().n,1);
});

test('deleting or renaming a page takes its visual history along',async()=>{
  const {api,env,auth}=await setup();
  const count=(table,id)=>env.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE post_id=?`).get(id).n;
  await api('save-md',{id:'about',old:'# Hello\n\nfirst\n\nsecond\n',new:'x',sid:SID});
  assert.deepEqual([count('visual_history','about'),count('visual_sessions','about')],[1,1]);
  const tag=JSON.parse(env.sqlite.prepare("SELECT data FROM posts WHERE id='about'").get().data).revision_tag;
  const renamed=await post(env,auth,{save_action:'save_page',id:'about2',old_id:'about',title:'A',status:'draft',content_md:'y',expected_revision:tag});
  assert.equal(renamed.data.success,true);
  assert.deepEqual([count('visual_history','about'),count('visual_history','about2'),count('visual_sessions','about2')],[0,1,1]);
  const undone=await api('undo',{id:'about2'});assert.equal(undone.json.ok,true,'undo still works under the new id');
  const gone=await post(env,auth,{save_action:'delete_page',id:'about2',old_id:'about2'});
  assert.equal(gone.data.success,true);
  assert.deepEqual([count('visual_history','about2'),count('visual_sessions','about2')],[0,0]);
});
