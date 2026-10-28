const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cloudUpdateUrl}=require('../.test-build/src/cloud-release.js');
const {renderSiteView}=require('../.test-build/src/admin/views.js');
const account='a'.repeat(32),id='12345678-1234-1234-1234-123456789abc';
const config=()=>({account_id:account,name:'my-admin',d1_databases:[{binding:'DB',database_id:id}]});
const remote=()=>({bindings:[
 {name:'DB',type:'d1',id}, {name:'ASSETS',type:'assets'}, {name:'JWT_SECRET',type:'secret_text'},
 ...Object.entries({CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_WORKER_NAME:'my-admin',CLOUDFLARE_D1_ID:id,CLOUDFLARE_PUBLIC_WORKER_NAME:'my-public'}).map(([name,text])=>({name,type:'plain_text',text}))
]});
test('manual updater refuses mismatched installations or lost bindings before writes',async()=>{
 const {validateUpdateConfig}=await import('../scripts/update-cloud.mjs');
 assert.equal(validateUpdateConfig(config(),remote()).database_id,id);
 const wrong=config();wrong.d1_databases[0].database_id='b'.repeat(36);
 assert.throws(()=>validateUpdateConfig(wrong,remote()),/matching split-site/);
 const r2=remote();r2.bindings.push({name:'MEDIA',type:'r2_bucket',bucket_name:'existing-images'});
 assert.throws(()=>validateUpdateConfig(config(),r2),/bindings differ/);
 const withR2=config();withR2.r2_buckets=[{binding:'MEDIA',bucket_name:'existing-images'}];
 assert.doesNotThrow(()=>validateUpdateConfig(withR2,r2));
 const missing=remote();missing.bindings=missing.bindings.filter(x=>x.name!=='JWT_SECRET');
 assert.throws(()=>validateUpdateConfig(config(),missing),/JWT_SECRET/);
 const extra=remote();extra.bindings.push({name:'KV',type:'kv_namespace'});
 assert.throws(()=>validateUpdateConfig(config(),extra),/additional bindings/);
});
test('update links stay on GitHub and newer versions are visible in both languages',()=>{
 assert.equal(cloudUpdateUrl('user/site'),'https://github.com/user/site/actions/workflows/update-cloud.yml');
 for(const value of ['https://evil.test','user/site?x=1','../site','user/..','user/site/extra','<script>'])assert.equal(cloudUpdateUrl(value),'');
 const base={t:x=>x,csrf:'csrf',settings:{},helpFile:'/public-help.html',users:[],username:'admin',updateRepository:'user/site'};
 for(const lang of ['ja','en']) {
  const html=renderSiteView({...base,lang,release:{status:'available',version:'99.0.0',outdated:true}});
  assert.match(html,/https:\/\/github.com\/user\/site\/actions\/workflows\/update-cloud.yml/);
  assert.match(html,/Run workflow/);
  assert.match(html,lang==='ja'?/新しいバージョンがあります/:/A new version is available/);
  assert.doesNotMatch(renderSiteView({...base,lang,release:{status:'available',outdated:false}}),/新しいバージョンがあります|A new version is available/);
 }
 assert.doesNotMatch(renderSiteView({...base,lang:'en',updateRepository:'bad'}),/href="https:\/\/github.com/);
});
