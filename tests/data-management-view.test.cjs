const {test}=require('node:test');const assert=require('node:assert/strict');
const {renderImportView,renderSiteView}=require('../.test-build/src/admin/views.js');
const t=key=>key;
test('Cloud data tool: full backup, its restore, D1 SQL export, D1 time restore, then the public site; CSV conversion sits in the site screen as in PHP',()=>{
 const html=renderImportView({t,csrf:'token',lang:'ja',cloudReady:true});
 const order=['cloud-json-backup','cloud-json-restore','cloud-d1-backup','cloud-d1-restore','site-export'].map(id=>html.indexOf(`id="${id}"`));
 assert.ok(order.every((at,i)=>at>0&&(i===0||order[i-1]<at)),String(order));
 assert.match(html,/1つのZIPファイルに保存します/);assert.match(html,/name="include_revisions" value="1"/);assert.doesNotMatch(html,/name="include_revisions" value="1" checked/);
 assert.match(html,/accept="application\/zip,\.zip"/);assert.match(html,/バックアップに無い画像は消えます/);
 assert.match(html,/公開サイトは変わらないので、復元にはサイトをビルドしてください/);
 assert.match(html,/現状の公開サイトを、そのままZIPでダウンロードします/);assert.match(html,/wrangler d1 execute/);assert.doesNotMatch(html,/450 MB|HTMLファイルの構造|static-zip/);
 for(const id of ['site-export','cloud-d1-backup','cloud-d1-restore','cloud-json-backup','cloud-json-restore'])assert.match(html,new RegExp(`id="${id}" class="data-tool-card"`));
 assert.match(html,/material-symbols-outlined icon">database/);assert.match(html,/material-symbols-outlined icon">archive/);
 const site=renderSiteView({t,csrf:'token',lang:'ja',settings:{},helpFile:'#',users:[],username:'admin'});
 assert.doesNotMatch(html,/id="csv-import"/);assert.match(site,/id="csv-import"/);assert.ok(site.indexOf('id="mcp-key"')<site.indexOf('id="csv-import"')&&site.indexOf('id="csv-import"')<site.indexOf('id="backup"'));
 assert.doesNotMatch(site,/begin_d1_export|get_ai_context|公開ヘルプ用/);
 assert.ok(site.indexOf('id="cloud-connection"')<site.indexOf('id="image-storage"'));assert.match(site,/Cloudflare公開設定/);
});
