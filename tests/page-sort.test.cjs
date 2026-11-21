const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment,call,login,post}=require('./fixtures.cjs');
const {savePage,saveSettings,loadSettings,listPages,loadPage,sortPagesForAdmin,pageSortParam}=require('../.test-build/src/storage.js');

const pages=[
  ['index',{title:'Welcome',status:'public_static',sort_order:0,updated_at:'2026-01-01 00:00:00'}],
  ['a',{title:'Zeta',status:'public_static',sort_order:0,updated_at:'2026-01-05 00:00:00'}],
  ['b',{title:'あ',status:'public_static',sort_order:0,updated_at:'2026-01-03 00:00:00'}],
  ['c',{title:'い',status:'public_static',sort_order:0,updated_at:'2026-01-04 00:00:00'}],
  ['d',{title:'う',status:'public_static',sort_order:0,updated_at:'2026-01-02 00:00:00'}],
  ['e',{title:'えび',status:'public_static',sort_order:0,updated_at:''}],
  ['p',{title:'Pending', description:'Overview needle', keywords:'keywords-only',status:'pending',sort_order:5,updated_at:'2026-01-06 00:00:00'}],
  ['z',{title:'',status:'draft',sort_order:-1,updated_at:'2026-01-07 00:00:00'}],
].map(([id,data])=>({id,data:{category:'srt',content_md:'x',...data}}));
const ids=(sort)=>sortPagesForAdmin(pages,sort).map(p=>p.id).join(',');

test('sort rules: index and pending only lead the default order',()=>{
  // The default ties display order by newest update and then ID.
  assert.equal(ids(''),'index,p,z,a,c,b,d,e');
  assert.equal(ids('updated_desc'),'z,p,a,c,b,d,index,e');
  assert.equal(ids('updated_asc'),'e,index,d,b,c,a,p,z');
  assert.equal(ids('id'),'a,b,c,d,e,index,p,z');
  // Title order: an empty title uses the ID; Japanese collation (Latin before kana here).
  const byTitle=sortPagesForAdmin(pages,'title').map(p=>p.data.title||p.id);
  assert.deepEqual(byTitle,[...byTitle].sort(new Intl.Collator('ja').compare));
  assert.ok(byTitle.indexOf('Pending')<byTitle.indexOf('Welcome'));
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
  assert.deepEqual((await list('')).ids,['index','p','z'],'default, page 1 of 3');
  assert.deepEqual((await list('&p_pages=2')).ids,['a','c','b']);
  assert.deepEqual((await list('&sort=updated_desc')).ids,['z','p','a']);
  assert.deepEqual((await list('&sort=updated_asc&p_pages=3')).ids,['p','z'],'ordering is applied before the page split');
  assert.deepEqual((await list('&sort=id')).ids,['a','b','c']);
  assert.deepEqual((await list('&sort=title&fmt=html')).ids.slice(0,1),['p']);
  assert.deepEqual((await list('&sort=bogus')).ids,['index','p','z'],'an unknown order is the default');
});

test('the selector sits right of the output-format filter, keeps its value, and sort is carried by paging, search and editor links',async()=>{
  const {list}=await setup(3);
  const {html}=await list('&sort=updated_desc&fmt=html');
  assert.ok(html.indexOf('id="page-format-filter"')<html.indexOf('id="page-sort-order"'));
  const select=html.match(/<select class="select-auto list-filter-select" id="page-sort-order"[^>]*>[^]*?<\/select>/)[0];
  assert.match(select,/aria-label="並び順"/);assert.match(select,/title="「表示順」では index、承認待ちページ/);
  assert.deepEqual([...select.matchAll(/<option value="([^"]*)" (selected)?[^>]*>([^<]+)</g)].map(m=>[m[1],!!m[2],m[3]]),
    [['',false,'表示順'],['updated_desc',true,'更新が新しい順'],['updated_asc',false,'更新が古い順'],['id',false,'ID順'],['title',false,'タイトル順']]);
  assert.match(html,/<input type="hidden" name="sort" value="updated_desc">/);
  assert.match(html,/href="\?view=pages&amp;p_pages=2[^"]*sort=updated_desc[^"]*#pages"/);
  assert.match(html,/href="\?view=pages&amp;edit=z[^"]*sort=updated_desc[^"]*#page-editor"/);
  assert.match(html,/pageSortOrder\.addEventListener\('change', \(\) => applyListParam\('sort', pageSortOrder\.value, 'p_pages', 'pages', refreshPageList\)\)/);
});

test('management search matches the summary and excludes keywords and category',async()=>{
  const {list}=await setup();
  assert.deepEqual((await list('&q=OVERVIEW')).ids,['p']);
  assert.deepEqual((await list('&q=keywords-only')).ids,[]);
  assert.deepEqual((await list('&q=srt')).ids,[]);
});

test('first publication from the list sets the date and later publication preserves it',async()=>{
  const env=environment(),auth=await login(env);
  const id='publication-date';
  await savePage(env,id,{title:'Draft',status:'draft',updated_at:'2000-01-01 00:00:00'});
  const change=async(status)=>assert.equal((await post(env,auth,{save_action:'save_page_status',id,status})).data.success,true);
  await change('public_static');
  const published=await loadPage(env,id);
  assert.notEqual(published.updated_at,'2000-01-01 00:00:00');
  assert.equal(published.updated_at,published.first_published_at);
  await change('draft');
  await savePage(env,id,{...await loadPage(env,id),updated_at:'2001-01-01 00:00:00'});
  await change('public_static');
  const republished=await loadPage(env,id);
  assert.equal(republished.updated_at,'2001-01-01 00:00:00');
  assert.equal(republished.first_published_at,published.first_published_at);
});
