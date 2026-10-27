const {test}=require('node:test');const assert=require('node:assert/strict');
const {renderImportView,renderSiteView}=require('../.test-build/src/admin/views.js');
const t=key=>key;
test('Cloud data management groups D1 and JSON recovery and keeps CSV in one place',()=>{
 const html=renderImportView({t,csrf:'token',lang:'ja',cloudReady:true});
 assert.ok(html.indexOf('id="cloud-d1-backup"')<html.indexOf('id="cloud-json-backup"'));
 assert.ok(html.indexOf('id="cloud-d1-backup"')<html.indexOf('id="cloud-d1-restore"'));
 assert.ok(html.indexOf('id="cloud-json-backup"')<html.indexOf('id="cloud-json-restore"'));
 assert.match(html,/SQLファイルを復元することはできません/);assert.match(html,/ファイルは暗号化されず/);
 assert.match(html,/現在のサイトの内容がバックアップの内容に置き換わります/);
 for(const id of ['csv-import','cloud-d1-backup','cloud-d1-restore','cloud-json-backup','cloud-json-restore','static-zip'])assert.match(html,new RegExp(`id="${id}" class="data-tool-card"`));
 assert.match(html,/material-symbols-outlined icon">database/);assert.match(html,/material-symbols-outlined icon">archive/);
 const site=renderSiteView({t,csrf:'token',lang:'ja',settings:{},helpFile:'#',users:[],username:'admin'});
 assert.doesNotMatch(site,/id="csv-import"|begin_d1_export|get_ai_context|公開ヘルプ用/);
 assert.ok(site.indexOf('id="cloud-connection"')<site.indexOf('id="image-storage"'));assert.match(site,/Cloudflare公開設定/);
});
