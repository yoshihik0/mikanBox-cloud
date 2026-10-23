const {test}=require('node:test'),assert=require('node:assert/strict');
const {r2Environment}=require('./r2-fixture.cjs');
const {environment,login,post,call}=require('./fixtures.cjs');
const {uploadMedia,getMediaObject,deleteMedia,savePage}=require('../.test-build/src/storage.js');
const {replaceMediaImage:replaceMedia}=require('../.test-build/src/media-transform.js');
const {renameMediaReferences}=require('../.test-build/src/content-operations.js');
const migration=require('../.test-build/src/media-migration.js');
const backup=require('../.test-build/src/backup-restore.js');
const {cleanMediaObjects}=require('../.test-build/src/r2-media.js');
const image=new Uint8Array([137,80,78,71,13,10,26,10]),webp=new TextEncoder().encode('RIFFxxxxWEBPbytes');
async function read(env,key){return new Uint8Array(await(await getMediaObject(env,key)).arrayBuffer());}
async function migrate(env){const job=await migration.beginMediaMigration(env);let status;do{status=await migration.copyMediaMigrationImage(env,job.id);}while(status.copied<status.total);await migration.finishMediaMigration(env,job.id);return job;}
test('R2 stores bytes outside D1, keeps filenames stable and does not retain the D1 400MB quota',async()=>{
 const env=r2Environment();env.sqlite.prepare('UPDATE media_usage SET bytes=400000000').run();assert.equal(await uploadMedia(env,'one.png',image.buffer,'image/png'),true);
 const row=env.sqlite.prepare('SELECT * FROM media').get();assert.ok(row.object_key.startsWith('objects/'));assert.equal(row.data,'');assert.equal(row.chunk_count,0);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,0);assert.deepEqual(await read(env,'one.png'),image);
 env.STATIC_DELIVERY='true';assert.deepEqual(new Uint8Array(await(await call(env,'/media/one.png')).arrayBuffer()),image);
 assert.equal(await uploadMedia(env,'one.png',image.buffer,'image/png'),false);assert.equal(env.MEDIA.objects.size,1);
});
test('R2 replacement and reference rename use atomic pointers and preserve previous objects until cleanup',async()=>{
 const env=r2Environment();await uploadMedia(env,'one.png',image.buffer,'image/png');await savePage(env,'p',{title:'p',status:'draft',content_md:'<img src="/media/one.png">'});
 const original=env.sqlite.prepare('SELECT object_key,etag FROM media').get();await renameMediaReferences(env,'one.png','one.webp','admin',{bytes:webp,expectedEtag:original.etag});
 assert.equal(await getMediaObject(env,'one.png'),null);assert.deepEqual(await read(env,'one.webp'),webp);assert.match(env.sqlite.prepare("SELECT data FROM posts WHERE id='p'").get().data,/one.webp/);assert.ok(env.MEDIA.objects.has(original.object_key));
 await assert.rejects(replaceMedia(env,'one.webp',webp,'wrong'),/changed/);assert.deepEqual(await read(env,'one.webp'),webp);
 await deleteMedia(env,'one.webp');assert.equal(await getMediaObject(env,'one.webp'),null);env.sqlite.exec('UPDATE r2_objects SET created_at=0');assert.equal(await cleanMediaObjects(env),2);assert.equal(env.MEDIA.objects.size,0);
});
test('failed R2 writes leave D1 metadata and existing bytes intact',async()=>{
 const env=r2Environment();await uploadMedia(env,'one.png',image.buffer,'image/png');const row=env.sqlite.prepare('SELECT * FROM media').get();env.MEDIA.put=async()=>{throw new Error('R2 unavailable');};
 await assert.rejects(replaceMedia(env,'one.png',image,row.etag),/unavailable/);assert.deepEqual(env.sqlite.prepare('SELECT * FROM media').get(),row);assert.deepEqual(await read(env,'one.png'),image);
});
test('D1 migration locks writes, verifies all images, then cuts over once without changing URLs',async()=>{
 const env=r2Environment('d1');await uploadMedia(env,'one.png',image.buffer,'image/png');const job=await migration.beginMediaMigration(env);
 await assert.rejects(deleteMedia(env,'one.png'),/migration/);await assert.rejects(migration.finishMediaMigration(env,job.id));assert.deepEqual(await read(env,'one.png'),image);
 const copied=await migration.copyMediaMigrationImage(env,job.id);assert.equal(copied.copied,1);assert.equal(env.sqlite.prepare('SELECT object_key FROM media').get().object_key,null);assert.deepEqual(await read(env,'one.png'),image);
 await migration.finishMediaMigration(env,job.id);assert.equal(env.sqlite.prepare("SELECT value FROM settings WHERE key='media_storage'").get().value,'r2');assert.deepEqual(await read(env,'one.png'),image);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,0);assert.equal(await migration.migrationStatus(env),null);
});
test('migration corruption, R2 failure and cancellation retain D1 as the active source',async()=>{
 const env=r2Environment('d1');await uploadMedia(env,'one.png',image.buffer,'image/png');const job=await migration.beginMediaMigration(env);const original=env.sqlite.prepare('SELECT data FROM media_chunks').get().data;
 env.sqlite.prepare('UPDATE media_chunks SET data=?').run(new Uint8Array(image.length));await assert.rejects(migration.copyMediaMigrationImage(env,job.id),/checksum/);env.sqlite.prepare('UPDATE media_chunks SET data=?').run(original);
 const put=env.MEDIA.put;env.MEDIA.put=async()=>{throw new Error('R2 unavailable');};await assert.rejects(migration.copyMediaMigrationImage(env,job.id),/unavailable/);env.MEDIA.put=put;
 await migration.copyMediaMigrationImage(env,job.id);await migration.cancelMediaMigration(env,job.id);assert.deepEqual(await read(env,'one.png'),image);assert.equal(env.sqlite.prepare('SELECT object_key FROM media').get().object_key,null);await migrate(env);assert.deepEqual(await read(env,'one.png'),image);
});
test('migration handles legacy images and rejects changes immediately before cutover',async()=>{
 const env=r2Environment('d1');env.sqlite.prepare('INSERT INTO media(key,content_type,size,uploaded,data) VALUES(?,?,?,?,?)').run('old.png','image/png',image.length,'now',Buffer.from(image).toString('base64'));const job=await migration.beginMediaMigration(env);await migration.copyMediaMigrationImage(env,job.id);
 env.sqlite.exec("UPDATE media SET uploaded='changed'");await assert.rejects(migration.finishMediaMigration(env,job.id));assert.equal(env.sqlite.prepare('SELECT object_key FROM media').get().object_key,null);await migration.cancelMediaMigration(env,job.id);await migrate(env);
 const object=await getMediaObject(env,'old.png');assert.match(object.httpEtag,/^["]\w{64}["]$/);await replaceMedia(env,'old.png',image,object.httpEtag);assert.deepEqual(await read(env,'old.png'),image);
});
test('portable backups restore between D1 and R2 without copying runtime storage choices',async()=>{
 const source=r2Environment();const body=new Uint8Array(500010);body.set(image);await uploadMedia(source,'big.png',body.buffer,'image/png');await savePage(source,'private',{title:'Private',status:'draft'});
 const manifest=await backup.exportBackupManifest(source);for(const target of [environment(),r2Environment()]){
 const id=await backup.createBackupRestore(target,manifest);await backup.stageBackupMediaPart(target,id,await backup.exportBackupMediaPart(source,'big.png',0));await assert.rejects(backup.commitBackupRestore(target,id));
 await backup.stageBackupMediaPart(target,id,await backup.exportBackupMediaPart(source,'big.png',1));await backup.commitBackupRestore(target,id);assert.deepEqual(await read(target,'big.png'),body);
 if(target.MEDIA)assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,0);else assert.equal(target.sqlite.prepare('SELECT object_key FROM media').get().object_key,null);
 }
});
test('R2 restore rollback, abort and cleanup preserve current referenced images',async()=>{
 const env=r2Environment();await uploadMedia(env,'one.png',image.buffer,'image/png');const original=env.sqlite.prepare('SELECT object_key FROM media').get().object_key,manifest=await backup.exportBackupManifest(env),id=await backup.createBackupRestore(env,manifest);
 await backup.stageBackupMediaPart(env,id,await backup.exportBackupMediaPart(env,'one.png',0));env.sqlite.exec('UPDATE r2_objects SET created_at=0');assert.equal(await cleanMediaObjects(env),0);
 await savePage(env,'new',{title:'Concurrent',status:'draft'});await assert.rejects(backup.commitBackupRestore(env,id),/not applied/);assert.equal(env.sqlite.prepare('SELECT object_key FROM media').get().object_key,original);await backup.abortBackupRestore(env,id);assert.equal(await cleanMediaObjects(env),2);assert.ok(env.MEDIA.objects.has(original));assert.deepEqual(await read(env,'one.png'),image);
});
test('migration menu requires R2 setup; empty D1 sites can also switch',async()=>{
 const env=r2Environment('d1'),auth=await login(env);
 const begin=await post(env,auth,{save_action:'begin_media_migration'});assert.equal(begin.data.success,true);await post(env,auth,{save_action:'finish_media_migration',migration_id:begin.data.migration.id});assert.equal(env.sqlite.prepare("SELECT value FROM settings WHERE key='media_storage'").get().value,'r2');
 const noR2=environment();await assert.rejects(migration.beginMediaMigration(noR2),/MEDIA/);
});
test('R2 restore cannot publish an assembly whose part snapshot changed concurrently',async()=>{
 const env=r2Environment();await uploadMedia(env,'one.png',image.buffer,'image/png');const manifest=await backup.exportBackupManifest(env),part=await backup.exportBackupMediaPart(env,'one.png',0),id=await backup.createBackupRestore(env,manifest);
 const put=env.MEDIA.put;let calls=0;env.MEDIA.put=async(...args)=>{const result=await put(...args);if(++calls===2)env.sqlite.prepare('UPDATE backup_parts SET sha256=? WHERE session_id=?').run('concurrently changed',id);return result;};
 await assert.rejects(backup.stageBackupMediaPart(env,id,part),/parts changed/);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM backup_images').get().n,0);await assert.rejects(backup.commitBackupRestore(env,id),/not applied/);assert.deepEqual(await read(env,'one.png'),image);
});
test('legacy D1 images can be edited before migration without a stored checksum',async()=>{
 const env=environment();env.sqlite.prepare('INSERT INTO media(key,content_type,size,uploaded,data) VALUES(?,?,?,?,?)').run('old.png','image/png',image.length,'now',Buffer.from(image).toString('base64'));
 await replaceMedia(env,'old.png',image,'"null"');assert.deepEqual(await read(env,'old.png'),image);
});
test('an upload begun before migration cannot write D1 bytes after the cutover',async()=>{
 const env=r2Environment('d1'),batch=env.DB.batch.bind(env.DB);let release,entered;const blocked=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);let first=true;
 env.DB.batch=async statements=>{if(first){first=false;entered();await blocked;}return batch(statements);};
 const uploading=uploadMedia(env,'late.png',image.buffer,'image/png');await ready;await migrate(env);release();assert.equal(await uploading,false);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM media').get().n,0);
});
