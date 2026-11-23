const {test}=require('node:test');
const assert=require('node:assert/strict');
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
test('the updater runs only the release commit the workflow resolved',async()=>{
 const {verifyReleaseCommit}=await import('../scripts/update-cloud.mjs');
 const sha='0123456789abcdef0123456789abcdef01234567';
 assert.doesNotThrow(()=>verifyReleaseCommit(undefined,''),'a manual run without the workflow is unchanged');
 assert.doesNotThrow(()=>verifyReleaseCommit(sha,sha));
 assert.throws(()=>verifyReleaseCommit(sha,'f'.repeat(40)),/not the release commit/);
 assert.throws(()=>verifyReleaseCommit('v0.10.3',sha),/Invalid release commit/);
 const fs=require('node:fs'),workflow=fs.readFileSync(require('node:path').join(__dirname,'../.github/workflows/update-cloud.yml'),'utf8');
 for(const line of workflow.split('\n').filter(line=>/^\s*-?\s*uses:/.test(line)))assert.match(line,/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,'actions are pinned to a commit: '+line.trim());
 assert.match(workflow,/ref: \$\{\{ steps\.release\.outputs\.sha \}\}/,'the checkout uses the resolved commit, not the tag');
 assert.match(workflow,/git rev-parse HEAD/);
 assert.ok(workflow.indexOf('Verify the checked-out commit')<workflow.indexOf('npm ci'),'the commit is verified before npm ci');
 assert.match(workflow,/MIKANBOX_UPDATE_COMMIT: \$\{\{ steps\.release\.outputs\.sha \}\}/);
});
test('update links stay on GitHub and newer versions are visible in both languages',()=>{
 const base={t:x=>x,csrf:'csrf',settings:{},helpFile:'/public-help.html',users:[],username:'admin'};
 for(const lang of ['ja','en']) {
  const html=renderSiteView({...base,lang,release:{status:'available',version:'99.0.0',outdated:true}});
  assert.doesNotMatch(html,/Run workflow|save_cloud_update_repository/);
  assert.match(html,lang==='ja'?/新しいバージョンがあります/:/A new version is available/);
  assert.doesNotMatch(renderSiteView({...base,lang,release:{status:'available',outdated:false}}),/新しいバージョンがあります|A new version is available/);
 }
});

test('Cloud update previews escaped release notes and requires a configured trusted device',()=>{
 const base={t:key=>key,csrf:'csrf',lang:'en',settings:{cloud_connection_ready:true},helpFile:'/public-help.html?language=en',
  release:{status:'available',version:'99.0.0',outdated:true,notes:'Fix <img src=x onerror=alert(1)>'}};
 const html=renderSiteView({...base,updateDeviceAllowed:true});
 assert.match(html,/Release notes · v99\.0\.0/);
 assert.match(html,/Fix &lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/Fix <img/);
 assert.match(html,/data-version="99\.0\.0"/);
 assert.match(html,/data-cloud-update-start>/);
 assert.match(html,/value="cloud_update_step"/);
 assert.match(html,/href="\/public-help\.html\?language=en#cloud-update-recovery"/);
 const unconfigured=renderSiteView({...base,settings:{},updateDeviceAllowed:true});
 assert.match(unconfigured,/Set a Cloudflare API token/);
 assert.doesNotMatch(unconfigured,/data-cloud-update-start/);
 const probation=renderSiteView({...base,updateDeviceAllowed:false});
 assert.match(probation,/trusted device/);
 assert.doesNotMatch(probation,/data-cloud-update-start/);
});
