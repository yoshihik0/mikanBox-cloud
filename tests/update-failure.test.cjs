const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const account='a'.repeat(32),id='12345678-1234-1234-1234-123456789abc';
for(const failure of ['build','migration','deploy','deploy-response'])test('manual update recovers after '+failure+' failure without replacing content',async()=>{
 const {updateCloud}=await import('../scripts/update-cloud.mjs');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mikanbox-update-failure-')),cwd=process.cwd();
 const variables=['CLOUDFLARE_API_TOKEN','MIKANBOX_UPDATE_CONFIG','MIKANBOX_UPDATE_REPOSITORY'];const previous=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(path.join(root,'migrations/0001_initial.sql'),'utf8'));
 db.exec("CREATE TABLE audit_migrations(name TEXT PRIMARY KEY); INSERT INTO audit_migrations VALUES('0001_initial.sql'); INSERT INTO posts VALUES('keep','{\"title\":\"Private original\",\"status\":\"draft\"}','draft',0,''); INSERT INTO media VALUES('keep.png','image/png',3,'now','AQID');");
 const calls=[];let failed=false,deployed=false;
 const remote={bindings:[{name:'DB',type:'d1',id},{name:'JWT_SECRET',type:'secret_text'},...Object.entries({CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_WORKER_NAME:'my-admin',CLOUDFLARE_D1_ID:id,CLOUDFLARE_PUBLIC_WORKER_NAME:'my-public'}).map(([name,text])=>({name,text,type:'plain_text'}))]};
 const dependencies={fetch:async()=>Response.json({success:true,result:remote}),run:async args=>{
  const step=args.includes('--dry-run')?'build':args[0]==='d1'?'migration':'deploy';calls.push(step);
  if(step==='migration'){
   let applied=0;
   for(const file of fs.readdirSync(path.join(root,'migrations')).sort()){
    if(db.prepare('SELECT 1 FROM audit_migrations WHERE name=?').get(file))continue;
    if(failure==='migration'&&!failed&&applied>0){failed=true;throw new Error('Injected migration interruption');}
    db.exec('BEGIN');try{db.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'));db.prepare('INSERT INTO audit_migrations VALUES(?)').run(file);db.exec('COMMIT');applied++;}catch(e){db.exec('ROLLBACK');throw e;}
   }
  }
  if(step===failure&&!failed){failed=true;throw new Error('Injected '+step+' interruption');}
  if(step==='deploy'){deployed=true;if(failure==='deploy-response'&&!failed){failed=true;throw new Error('Injected lost deployment response');}}
 }};
 try{
  fs.copyFileSync(path.join(root,'wrangler.production.example.json'),path.join(temp,'wrangler.production.example.json'));
  process.chdir(temp);process.env.CLOUDFLARE_API_TOKEN='synthetic-test-token';process.env.MIKANBOX_UPDATE_CONFIG=JSON.stringify({account_id:account,name:'my-admin',d1_databases:[{binding:'DB',database_id:id}]});process.env.MIKANBOX_UPDATE_REPOSITORY='test/site';
  await assert.rejects(updateCloud(dependencies),/Injected/);assert.equal(fs.existsSync('wrangler.update.json'),false);
  assert.equal(db.prepare("SELECT data FROM posts WHERE id='keep'").get().data,'{"title":"Private original","status":"draft"}');assert.equal(db.prepare("SELECT data FROM media WHERE key='keep.png'").get().data,'AQID');
  if(failure==='build')assert.deepEqual(calls,['build']);if(failure==='migration'){assert.deepEqual(calls,['build','migration']);assert.ok(db.prepare('SELECT COUNT(*) n FROM audit_migrations').get().n>1);}
  if(failure==='deploy-response')assert.equal(deployed,true);
  await updateCloud(dependencies);assert.equal(deployed,true);assert.equal(fs.existsSync('wrangler.update.json'),false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_migrations').get().n,fs.readdirSync(path.join(root,'migrations')).length);
  assert.equal(db.prepare("SELECT data FROM posts WHERE id='keep'").get().data,'{"title":"Private original","status":"draft"}');assert.equal(db.prepare("SELECT data FROM media WHERE key='keep.png'").get().data,'AQID');
 }finally{process.chdir(cwd);for(const key of variables){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}db.close();fs.rmSync(temp,{recursive:true,force:true});}
});
