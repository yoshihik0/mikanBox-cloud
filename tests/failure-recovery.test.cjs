const {test}=require('node:test');
const assert=require('node:assert/strict');
const {r2Environment}=require('./r2-fixture.cjs');
const {savePage,loadPage,uploadMedia,getMediaObject}=require('../.test-build/src/storage.js');
const {exportBackupManifest,exportBackupMediaPart,createBackupRestore,stageBackupMediaPart,commitBackupRestore}=require('../.test-build/src/backup-restore.js');
const pixel=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
async function scenario(mode){
 const env=r2Environment(mode);
 await savePage(env,'restored',{title:'Backup',status:'draft',content_md:'backup content'});
 await uploadMedia(env,'original.png',pixel.buffer,'image/png');
 const manifest=await exportBackupManifest(env),part=await exportBackupMediaPart(env,'original.png',0);
 await savePage(env,'restored',{title:'Current',status:'draft',content_md:'current content'});
 return {env,manifest,part};
}
for(const mode of ['d1','r2']){
 test(mode+': interrupted part transfer can retry the same part and commit safely',async()=>{
  const {env,manifest,part}=await scenario(mode),stage=await createBackupRestore(env,manifest);
  await stageBackupMediaPart(env,stage,part); // accepted, but pretend its response was lost
  assert.equal((await loadPage(env,'restored')).title,'Current');
  await stageBackupMediaPart(env,stage,part);
  const result=await commitBackupRestore(env,stage);
  assert.equal((await loadPage(env,'restored')).title,'Backup');
  assert.deepEqual(new Uint8Array(await(await getMediaObject(env,'original.png')).arrayBuffer()),pixel);
  await savePage(env,'after',{title:'Edit after completion',status:'draft'});
  assert.deepEqual(await commitBackupRestore(env,stage),result); // lost final HTTP response
  assert.ok(await loadPage(env,'after')); // retry must never restore a second time
 });
 test(mode+': database error after deletion rolls back all data and the same restore can retry',async()=>{
  const {env,manifest,part}=await scenario(mode),stage=await createBackupRestore(env,manifest);await stageBackupMediaPart(env,stage,part);
  env.sqlite.exec("CREATE TRIGGER injected_restore_failure BEFORE INSERT ON posts BEGIN SELECT RAISE(ABORT,'Injected restore failure'); END;");
  await assert.rejects(commitBackupRestore(env,stage),/not applied/);
  assert.equal((await loadPage(env,'restored')).title,'Current');
  assert.deepEqual(new Uint8Array(await(await getMediaObject(env,'original.png')).arrayBuffer()),pixel);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM backup_restore_results').get().n,0);
  env.sqlite.exec('DROP TRIGGER injected_restore_failure');await commitBackupRestore(env,stage);
  assert.equal((await loadPage(env,'restored')).title,'Backup');
 });
 test(mode+': lost D1 acknowledgement after successful commit returns recorded completion',async()=>{
  const {env,manifest,part}=await scenario(mode),stage=await createBackupRestore(env,manifest);await stageBackupMediaPart(env,stage,part);
  const batch=env.DB.batch.bind(env.DB);env.DB.batch=async statements=>{await batch(statements);throw new Error('Injected lost database acknowledgement');};
  const result=await commitBackupRestore(env,stage);assert.equal(result.images,1);assert.equal((await loadPage(env,'restored')).title,'Backup');
  env.DB.batch=batch;assert.deepEqual(await commitBackupRestore(env,stage),result);
 });
}
