const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {environment,call,login,post}=require('./fixtures.cjs');
const {saveCloudToken}=require('../.test-build/src/cloudflare-api.js');
const runtime=require('../.test-build/src/version.js');

const current=runtime.CLOUD_VERSION;
const parts=current.split('.').map(Number);
const target=`${parts[0]}.${parts[1]}.${parts[2]+1}`;
const commit='c'.repeat(40);
const token='local-test-cloudflare-token';
const account='a'.repeat(32);
const database='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const file='index.js';
const main='export default {fetch(){return new Response("updated")}};';
const asset={path:'/mikanbox/test.js',type:'text/javascript; charset=utf-8',content:'YWJj',size:3,hash:'e'.repeat(32)};
const migration={
  name:'0031_integration_test.sql',
  statements:[
    'CREATE TABLE integration_update(value TEXT NOT NULL)',
    "INSERT INTO integration_update(value) VALUES('retained on retry')",
  ],
};

async function installation(t) {
  const env=environment();
  const {sqlite}=env;
  Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_D1_ID:database});
  sqlite.exec(`
    CREATE TABLE d1_migrations(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    INSERT INTO d1_migrations(name) VALUES('0029_mcp_key_fingerprint.sql'),('0030_page_publication_audit.sql');
  `);
  const packageText=JSON.stringify({
    version:target,
    main:{name:file,content:main},
    assets:[asset],
    migrations:[
      {name:'0029_mcp_key_fingerprint.sql',statements:['INVALID SQL ON PURPOSE']},
      {name:'0030_page_publication_audit.sql',statements:['INVALID SQL ON PURPOSE']},
      migration,
    ],
  });
  const manifest={
    edition:'cloud',version:target,minimum_version:current,commit,
    compatibility_date:'2026-10-03',
    migrations:JSON.parse(packageText).migrations.map(({name})=>name),
    sha256:createHash('sha256').update(packageText).digest('hex'),
  };
  const cloud={
    active:'original-version',latest:'original-version',annotations:{},
    corrupt:false,wrongBinding:false,denyUpload:false,failDeployment:false,
    deploymentCalls:0,versionUploads:0,assetUploads:0,requests:[],
  };
  const result=value=>Response.json({success:true,result:value});
  const reject=status=>Response.json({success:false,errors:[{message:`Private upstream detail ${token}`}]},{status});
  const fetchBefore=global.fetch;
  global.fetch=async(input,init={})=>{
    const url=new URL(String(input?.url||input));
    const authorization=new Headers(init.headers).get('Authorization');
    const method=init.method||'GET';
    cloud.requests.push({url:url.href,method});
    const githubRelease=`https://github.com/yoshihik0/mikanBox-cloud/releases/download/v${target}/`;
    if(url.host==='github.com'||url.host==='api.github.com'){
      assert.equal(authorization,null);
      if(url.href===githubRelease+'mikanbox-cloud-update.json')return Response.json(manifest);
      if(url.href===githubRelease+'mikanbox-cloud-update-package.json')return new Response(packageText+(cloud.corrupt?' ':''));
      if(url.href===`https://api.github.com/repos/yoshihik0/mikanBox-cloud/commits/v${target}`){
        assert.equal(new Headers(init.headers).get('Accept'),'application/vnd.github.sha');
        return new Response(commit);
      }
      if(url.pathname.endsWith('releases.atom'))return Response.json({edition:'cloud',version:target});
      assert.fail(`Unexpected GitHub request ${url.href}`);
    }
    const cloudBase=`/client/v4/accounts/${account}/workers`;
    assert.equal(url.host,'api.cloudflare.com');
    assert.ok(url.pathname.startsWith(cloudBase));
    const path=url.pathname.slice(cloudBase.length);
    if(path==='/assets/upload'){
      assert.equal(authorization,'Bearer asset-upload-jwt');
      assert.equal(url.searchParams.get('base64'),'true');
      const uploaded=init.body.get(asset.hash);
      assert.equal(await uploaded.text(),asset.content);
      assert.equal(uploaded.type,asset.type);
      cloud.assetUploads++;
      return result({jwt:'asset-completion-jwt'});
    }
    assert.equal(authorization,`Bearer ${token}`);
    if(path===`/scripts/${env.CLOUDFLARE_PUBLIC_WORKER_NAME}/deployments`){
      assert.equal(method,'GET');
      return result({deployments:[]});
    }
    const scriptPath=`/scripts/${env.CLOUDFLARE_WORKER_NAME}`;
    assert.ok(path.startsWith(scriptPath));
    switch(path.slice(scriptPath.length)){
      case '/settings':
        return result({bindings:[
          ...['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_D1_ID','CLOUDFLARE_WORKER_NAME','CLOUDFLARE_PUBLIC_WORKER_NAME']
            .map(name=>({name,type:'plain_text',text:env[name]})),
          {name:'JWT_SECRET',type:'secret_text'},
          {name:'ASSETS',type:'assets'},
          {name:'DB',type:'d1',id:cloud.wrongBinding?'wrong-database':database},
        ]});
      case '/assets-upload-session':
        assert.deepEqual(JSON.parse(init.body),{manifest:{[asset.path]:{hash:asset.hash,size:asset.size}}});
        return result({jwt:'asset-upload-jwt',buckets:[[asset.hash]]});
      case '/versions':
        if(method==='GET')return result({items:[{id:cloud.latest}]});
        if(cloud.denyUpload)return reject(403);
        cloud.versionUploads++;
        cloud.latest='candidate-version';
        {
          const form=init.body;
          const metadata=JSON.parse(await form.get('metadata').text());
          assert.deepEqual(metadata.assets,{jwt:'asset-completion-jwt',config:{run_worker_first:true}});
          assert.ok(metadata.keep_bindings.includes('secret_text'));
          assert.ok(metadata.bindings.some(b=>b.type==='d1'&&b.id===database));
          assert.equal(metadata.main_module,file);
          assert.equal(await form.get(file).text(),main);
          assert.doesNotMatch(JSON.stringify(metadata),new RegExp(token));
          cloud.annotations=metadata.annotations;
        }
        return result({id:cloud.latest});
      case `/versions/${cloud.latest}`:
        return result({id:cloud.latest,annotations:cloud.annotations});
      case '/deployments':
        if(method==='GET')return result({deployments:[{versions:[{version_id:cloud.active,percentage:100}]}]});
        cloud.deploymentCalls++;
        if(cloud.failDeployment)return reject(503);
        {
          const versions=JSON.parse(init.body).versions;
          assert.deepEqual(versions,[{version_id:cloud.latest,percentage:100}]);
          cloud.active=cloud.latest;
        }
        return result({});
      default:
        assert.fail(`Unexpected Cloudflare request ${method} ${url.href}`);
    }
  };
  t.after(()=>{
    runtime.CLOUD_VERSION=current;
    global.fetch=fetchBefore;
    sqlite.close();
  });
  await saveCloudToken(env,token);
  assert.doesNotMatch(sqlite.prepare("SELECT value FROM settings WHERE key='cloud_connection'").get().value,new RegExp(token));
  cloud.requests.length=0;
  const auth=await login(env);
  const ledger=()=>sqlite.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row=>row.name);
  const step=async(owner)=>{
    const {data}=await post(env,auth,{save_action:'cloud_update_step',target_version:target,job_id:owner});
    const response=JSON.stringify(data);
    for(const secret of [token,env.JWT_SECRET,'asset-upload-jwt','asset-completion-jwt','Private upstream detail']){
      assert.equal(response.includes(secret),false);
    }
    return data;
  };
  return {env,cloud,ledger,step};
}

async function advance(step,stop,owner=randomUUID()) {
  for(let attempt=0;attempt<12;attempt++){
    const result=await step(owner);
    if(!result.success||stop(result))return {result,owner};
  }
  assert.fail('Update did not reach expected phase.');
}

test('the management update preserves site data and records a single new Worker version',async t=>{
  const {env,cloud,ledger,step}=await installation(t);
  const {sqlite}=env;
  const unauthenticated=await call(env,'/admin',{save_action:'cloud_update_step',target_version:target,ajax_request:'1'});
  assert.ok([302,303,400,401,403].includes(unauthenticated.status));
  assert.equal(cloud.versionUploads,0);
  sqlite.prepare("INSERT INTO posts(id,data) VALUES('retained',?)").run(JSON.stringify({title:'A retained article'}));
  sqlite.prepare("INSERT INTO settings(key,value) VALUES('retained_setting','site data')").run();
  const article=()=>sqlite.prepare("SELECT data FROM posts WHERE id='retained'").get().data;
  const before=article();
  const storedVersion=()=>sqlite.prepare("SELECT value FROM settings WHERE key='cloud_version'").get()?.value;
  const {result,owner}=await advance(step,data=>data.stage==='verifying');
  assert.ok(result.success,result.message);
  assert.equal(storedVersion(),current);
  assert.equal(cloud.active,'candidate-version');
  assert.equal(cloud.versionUploads,1);
  assert.equal(cloud.assetUploads,1);
  assert.equal(cloud.deploymentCalls,1);
  assert.equal(ledger().filter(name=>name===migration.name).length,1);
  runtime.CLOUD_VERSION=target;
  const done=await step(owner);
  assert.equal(done.stage,'succeeded');
  assert.equal(done.status,'complete');
  assert.equal(storedVersion(),target);
  assert.equal(article(),before);
  assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key='retained_setting'").get().value,'site data');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE event='system_update_started' AND to_value=?").get(target).n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE event='system_updated' AND to_value=?").get(target).n,1);
  assert.equal(cloud.requests.some(({url})=>url.includes('/scripts/cloud-public/')),false);
});

test('hash mismatch, live binding mismatch, and rejected write permission stop before migration',async t=>{
  for(const [flag,message] of [
    ['corrupt',/verification/i],
    ['wrongBinding',/Verify the management Worker/i],
    ['denyUpload',/Workers Scripts Edit/],
  ]){
    await t.test(flag,async sub=>{
      const {env,cloud,ledger,step}=await installation(sub);
      const applied=ledger();
      cloud[flag]=true;
      const {result}=await advance(step,()=>false);
      assert.equal(result.success,false);
      assert.match(result.message,message);
      assert.deepEqual(ledger(),applied);
      assert.equal(env.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='integration_update'").get(),undefined);
      assert.equal(cloud.active,'original-version');
      assert.equal(cloud.deploymentCalls,0);
      assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE event='system_update_failed' AND to_value=?").get(target).n,1);
    });
  }
});

test('a deployment failure retries after migration without repeating its SQL',async t=>{
  const {env,cloud,ledger,step}=await installation(t);
  cloud.failDeployment=true;
  const failure=await advance(step,()=>false);
  assert.equal(failure.result.success,false);
  assert.ok(ledger().includes(migration.name));
  assert.equal(cloud.active,'original-version');
  cloud.failDeployment=false;
  const retry=await advance(step,data=>data.stage==='verifying');
  assert.equal(retry.result.success,true,retry.result.message);
  assert.equal(cloud.active,'candidate-version');
  assert.equal(cloud.versionUploads,1);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM integration_update').get().n,1);
  assert.equal(ledger().filter(name=>name===migration.name).length,1);
});

test('a concurrent unrelated Worker version prevents automatic deployment',async t=>{
  const {cloud,ledger,step}=await installation(t);
  const ledgerBefore=ledger();
  cloud.latest='unrelated-version';
  const {result}=await advance(step,()=>false);
  assert.equal(result.success,false);
  assert.match(result.message,/Worker version changed/i);
  assert.deepEqual(ledger(),ledgerBefore);
  assert.equal(cloud.deploymentCalls,0);
});

test('a change to the active deployment stops before D1 migrations',async t=>{
  const {cloud,ledger,step}=await installation(t);
  const ledgerBefore=ledger();
  const planned=await advance(step,data=>data.stage==='migrating');
  assert.equal(planned.result.success,true,planned.result.message);
  cloud.active='unrelated-version';
  const result=await step(planned.owner);
  assert.equal(result.success,false);
  assert.match(result.message,/Worker version changed/i);
  assert.deepEqual(ledger(),ledgerBefore);
  assert.equal(cloud.deploymentCalls,0);
});
