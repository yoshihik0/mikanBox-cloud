const {test}=require('node:test');
const assert=require('node:assert/strict');
const {environment,putMedia}=require('./fixtures.cjs');
const {savePage,loadPage}=require('../.test-build/src/storage.js');
const {getMedia}=require('../.test-build/src/media-store.js');
const {exportBackupManifest,createBackupRestore,commitBackupRestore}=require('../.test-build/src/backup-restore.js');
const pixel=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
async function scenario(){
 const env=environment();
 await savePage(env,'restored',{title:'Backup',status:'draft',content_md:'backup content'});
 await putMedia(env,'original.png',pixel);
 const manifest=await exportBackupManifest(env);
 await savePage(env,'restored',{title:'Current',status:'draft',content_md:'current content'});
 return {env,manifest};
}
for(const mode of ['restore']){
 test(mode+': a repeated commit after a lost response never restores twice',async()=>{
  const {env,manifest}=await scenario(mode),stage=await createBackupRestore(env,manifest);
  assert.equal((await loadPage(env,'restored')).title,'Current');
  const result=await commitBackupRestore(env,stage);
  assert.equal((await loadPage(env,'restored')).title,'Backup');
  assert.ok(await getMedia(env,'original.png'));
  await savePage(env,'after',{title:'Edit after completion',status:'draft'});
  assert.deepEqual(await commitBackupRestore(env,stage),result); // lost final HTTP response
  assert.ok(await loadPage(env,'after')); // retry must never restore a second time
 });
 test(mode+': database error after deletion rolls back all data and the same restore can retry',async()=>{
  const {env,manifest}=await scenario(mode),stage=await createBackupRestore(env,manifest);
  env.sqlite.exec("CREATE TRIGGER injected_restore_failure BEFORE INSERT ON posts BEGIN SELECT RAISE(ABORT,'Injected restore failure'); END;");
  await assert.rejects(commitBackupRestore(env,stage),/not applied/);
  assert.equal((await loadPage(env,'restored')).title,'Current');
  assert.ok(await getMedia(env,'original.png'));
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM backup_restore_results').get().n,0);
  env.sqlite.exec('DROP TRIGGER injected_restore_failure');await commitBackupRestore(env,stage);
  assert.equal((await loadPage(env,'restored')).title,'Backup');
 });
 test(mode+': lost D1 acknowledgement after successful commit returns recorded completion',async()=>{
  const {env,manifest}=await scenario(mode),stage=await createBackupRestore(env,manifest);
  const batch=env.DB.batch.bind(env.DB);env.DB.batch=async statements=>{await batch(statements);throw new Error('Injected lost database acknowledgement');};
  const result=await commitBackupRestore(env,stage);assert.equal(result.images,1);assert.equal((await loadPage(env,'restored')).title,'Backup');
  env.DB.batch=batch;assert.deepEqual(await commitBackupRestore(env,stage),result);
 });
}
