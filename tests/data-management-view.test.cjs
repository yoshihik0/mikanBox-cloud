const {test}=require('node:test');const assert=require('node:assert/strict');
const {renderImportView,renderSiteView}=require('../.test-build/src/admin/views.js');
const t=key=>key;
test('Cloud data tool: site export and SQL export, then backup and restore; CSV conversion sits in the site screen as in PHP',()=>{
 const html=renderImportView({t,csrf:'token',lang:'ja',cloudReady:true});
 assert.ok(html.indexOf('id="cloud-d1-backup"')<html.indexOf('id="cloud-json-backup"'));
 assert.ok(html.indexOf('id="cloud-d1-backup"')<html.indexOf('id="cloud-d1-restore"'));
 assert.ok(html.indexOf('id="cloud-json-backup"')<html.indexOf('id="cloud-json-restore"'));
 assert.ok(html.indexOf('id="site-export"')<html.indexOf('id="cloud-d1-backup"'));assert.match(html,/現状の公開サイトを、そのままZIPでダウンロードします/);assert.match(html,/wrangler d1 execute/);
 assert.match(html,/ファイルは暗号化されず/);assert.match(html,/今の内容（画像を含む）を消して/);assert.doesNotMatch(html,/450 MB|HTMLファイルの構造|static-zip/);
 for(const id of ['site-export','cloud-d1-backup','cloud-d1-restore','cloud-json-backup','cloud-json-restore'])assert.match(html,new RegExp(`id="${id}" class="data-tool-card"`));
 assert.match(html,/material-symbols-outlined icon">database/);assert.match(html,/material-symbols-outlined icon">archive/);
 const site=renderSiteView({t,csrf:'token',lang:'ja',settings:{},helpFile:'#',users:[],username:'admin'});
 assert.doesNotMatch(html,/id="csv-import"/);assert.match(site,/id="csv-import"/);assert.ok(site.indexOf('id="mcp-key"')<site.indexOf('id="csv-import"')&&site.indexOf('id="csv-import"')<site.indexOf('id="backup"'));
 assert.doesNotMatch(site,/begin_d1_export|get_ai_context|公開ヘルプ用/);
 assert.ok(site.indexOf('id="cloud-connection"')<site.indexOf('id="image-storage"'));assert.match(site,/Cloudflare公開設定/);
});
