const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment,call,login}=require('./fixtures.cjs');
const {savePage,saveSettings,loadSettings,listPages,sortPagesForAdmin,pageSortParam}=require('../.test-build/src/storage.js');

// PHP 2.20.0: the admin page list orders like the public side by default (pending, index, display
// order, newest update, ID) and can be sorted by update date, ID or title (sort=). Index is always first.
const pages=[
  ['index',{title:'Home',status:'public_static',sort_order:0,updated_at:'2026-01-01 00:00:00'}],
  ['a',{title:'Zeta',status:'public_static',sort_order:0,updated_at:'2026-01-05 00:00:00'}],
  ['b',{title:'あ',status:'public_static',sort_order:0,updated_at:'2026-01-03 00:00:00'}],
  ['c',{title:'い',status:'public_static',sort_order:0,updated_at:'2026-01-04 00:00:00'}],
  ['d',{title:'う',status:'public_static',sort_order:0,updated_at:'2026-01-02 00:00:00'}],
  ['e',{title:'えび',status:'public_static',sort_order:0,updated_at:''}],
  ['p',{title:'Pending',status:'pending',sort_order:5,updated_at:'2026-01-06 00:00:00'}],
  ['z',{title:'',status:'draft',sort_order:-1,updated_at:'2026-01-07 00:00:00'}],
].map(([id,data])=>({id,data:{category:'srt',content_md:'x',...data}}));
const ids=(sort)=>sortPagesForAdmin(pages,sort).map(p=>p.id).join(',');

test('sort rules: default is pending, index, display order, newest update, ID; other orders keep index first',()=>{
  // Default: pending first, index, then sort_order (z=-1 first), then the newest update, then ID (e has no date: oldest).
  assert.equal(ids(''),'p,index,z,a,c,b,d,e');
  assert.equal(ids('updated_desc'),'index,z,p,a,c,b,d,e');
  assert.equal(ids('updated_asc'),'index,e,d,b,c,a,p,z');
  assert.equal(ids('id'),'index,a,b,c,d,e,p,z');
  // Title order: an empty title uses the ID; Japanese collation (Latin before kana here).
  const byTitle=sortPagesForAdmin(pages,'title').map(p=>p.data.title||p.id);
  assert.deepEqual(byTitle.slice(0,1),['Home']);
  assert.deepEqual(byTitle.slice(1),[...byTitle.slice(1)].sort(new Intl.Collator('ja').compare));
  assert.ok(byTitle.indexOf('あ')<byTitle.indexOf('い')&&byTitle.indexOf('い')<byTitle.indexOf('う')&&byTitle.indexOf('う')<byTitle.indexOf('えび'));
  // Ties end with the ID, and the input is not changed.
  const same=['m','k','l'].map(id=>({id,data:{title:'T',status:'draft',sort_order:0,updated_at:'2026-01-01 00:00:00'}}));
  assert.equal(sortPagesForAdmin(same,'').map(p=>p.id).join(''),'klm');assert.equal(same.map(p=>p.id).join(''),'mkl');
  assert.equal(pageSortParam('title'),'title');assert.equal(pageSortParam('nope'),'');assert.equal(pageSortParam(null),'');
});

async function setup(perPage=30){
  const env=environment(),auth=await login(env);
  for(const {id,data} of pages)await savePage(env,id,data);
  await saveSettings(env,{...await loadSettings(env),pages_per_page:perPage});
  const list=async(query)=>{const html=await(await call(env,'/admin?view=pages&cat=srt'+query,undefined,auth.cookie)).text();return {html,ids:[...html.matchAll(/<tr data-page-id="([^"]+)">/g)].map(m=>m[1])};};
  return {env,auth,list};
}

test('the list follows sort= for every order, before paging, together with the output-format filter',async()=>{
  const {list}=await setup(3);
  assert.deepEqual((await list('')).ids,['p','index','z'],'default, page 1 of 3');
  assert.deepEqual((await list('&p_pages=2')).ids,['a','c','b']);
  assert.deepEqual((await list('&sort=updated_desc')).ids,['index','z','p']);
  assert.deepEqual((await list('&sort=updated_asc&p_pages=3')).ids,['p','z'],'ordering is applied before the page split');
  assert.deepEqual((await list('&sort=id')).ids,['index','a','b']);
  assert.deepEqual((await list('&sort=title&fmt=html')).ids.slice(0,1),['index']);
  assert.deepEqual((await list('&sort=bogus')).ids,['p','index','z'],'an unknown order is the default');
});

test('the selector sits right of the output-format filter, keeps its value, and sort is carried by paging, search and editor links',async()=>{
  const {list}=await setup(3);
  const {html}=await list('&sort=updated_desc&fmt=html');
  assert.ok(html.indexOf('id="page-format-filter"')<html.indexOf('id="page-sort-order"'));
  const select=html.match(/<select class="select-auto list-filter-select" id="page-sort-order"[^>]*>[^]*?<\/select>/)[0];
  assert.match(select,/aria-label="並び順"/);assert.match(select,/title="「表示順」は公開側の一覧と同じ並び/);
  assert.deepEqual([...select.matchAll(/<option value="([^"]*)" (selected)?[^>]*>([^<]+)</g)].map(m=>[m[1],!!m[2],m[3]]),
    [['',false,'表示順'],['updated_desc',true,'更新が新しい順'],['updated_asc',false,'更新が古い順'],['id',false,'ID順'],['title',false,'タイトル順']]);
  assert.match(html,/<input type="hidden" name="sort" value="updated_desc">/);
  assert.match(html,/href="\?view=pages&amp;p_pages=2[^"]*sort=updated_desc[^"]*#pages"/);
  assert.match(html,/href="\?view=pages&amp;edit=index[^"]*sort=updated_desc[^"]*#page-editor"/);
  assert.match(html,/pageSortOrder\.addEventListener\('change', \(\) => applyListParam\('sort', pageSortOrder\.value, 'p_pages', 'pages', refreshPageList\)\)/);
});
