const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {environment,login,call}=require('./fixtures.cjs');
const dir=path.join(__dirname,'../migrations'),LAST='0019_d1_media_only.sql';
function before(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of fs.readdirSync(dir).sort())if(file<LAST)sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'));
 return sqlite;
}
const apply=sqlite=>{sqlite.exec('BEGIN');try{sqlite.exec(fs.readFileSync(path.join(dir,LAST),'utf8'));sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}};
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));

test('update to D1-only media keeps D1 images, and keeps what the previous version still reads',()=>{
 const sqlite=before();
 sqlite.exec("INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count) VALUES('a.png','image/png',3,'2026-01-01T00:00:00.000Z','','u1','e1',1)");
 sqlite.prepare('INSERT INTO media_chunks(upload_id,chunk_index,data) VALUES(?,?,?)').run('u1',0,new Uint8Array([1,2,3]));
 sqlite.exec("INSERT INTO settings(key,value) VALUES('media_storage','d1'),('media_storage_lock','job')");
 sqlite.exec("INSERT INTO media_migrations(id,created_at) VALUES('job',1)");
 sqlite.exec("INSERT INTO media_migration_items(job_id,media_key,snapshot) VALUES('job','a.png','{}')");
 apply(sqlite);
 assert.deepEqual({...sqlite.prepare("SELECT key,size,upload_id FROM media").get()},{key:'a.png',size:3,upload_id:'u1'});
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM media_chunks').get().n,1);
 assert.deepEqual({...sqlite.prepare('SELECT bytes,files FROM media_usage').get()},{bytes:3,files:1});
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'media_storage%'").get().n,0,'an unfinished migration no longer locks media');
 assert.equal(sqlite.prepare('SELECT (SELECT COUNT(*) FROM media_migrations)+(SELECT COUNT(*) FROM media_migration_items) n').get().n,0);
 // The update applies the database change before it deploys the new code. Until then (or if the
 // deployment fails) the previous version keeps running, so every query it makes must still work.
 for(const sql of ["SELECT object_key,content_type,size,etag,upload_id,chunk_count FROM media WHERE key='a.png'",'SELECT COALESCE(SUM(size),0) bytes FROM r2_objects','SELECT id FROM media_migrations LIMIT 1',"SELECT value FROM settings WHERE key='media_storage'",'SELECT target_store FROM backup_sessions','SELECT object_key FROM backup_parts','SELECT object_key FROM backup_images'])assert.doesNotThrow(()=>sqlite.prepare(sql).all(),sql);
 sqlite.exec("DELETE FROM media WHERE key='a.png'");
 assert.deepEqual({...sqlite.prepare('SELECT bytes,files FROM media_usage').get()},{bytes:0,files:0});
});

test('a site that keeps media in R2 is not updated: the migration stops and changes nothing',()=>{
 for(const prepare of [
  sqlite=>sqlite.exec("INSERT INTO media(key,content_type,size,uploaded,data,etag,object_key,chunk_count) VALUES('r.png','image/png',3,'2026-01-01T00:00:00.000Z','','e','objects/x',0)"),
  sqlite=>sqlite.exec("INSERT INTO settings(key,value) VALUES('media_storage','r2')")
 ]){
  const sqlite=before();prepare(sqlite);
  assert.throws(()=>apply(sqlite),/CHECK constraint failed/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='r2_removal_guard'").get().n,0,'nothing is left behind');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM media').get().n+sqlite.prepare("SELECT COUNT(*) n FROM settings WHERE key='media_storage'").get().n,1,'the data is unchanged');
 }
});

test('the media screen shows no usage line, only a warning near the file limit, as in PHP',async()=>{
 const {putMedia}=require('./fixtures.cjs'),{MEDIA_COUNT_LIMIT}=require('../.test-build/src/media-policy.js');
 const env=environment(),auth=await login(env);await putMedia(env,'one.png',png);
 let body=await(await call(env,'/admin?view=media',undefined,auth.cookie)).text();
 assert.doesNotMatch(body,/id="media-usage"|id="media-usage-warning"|400 MB|10,000/);
 env.sqlite.prepare('UPDATE media_usage SET files=? WHERE id=1').run(MEDIA_COUNT_LIMIT*0.9);
 body=await(await call(env,'/admin?view=media',undefined,auth.cookie)).text();assert.match(body,/id="media-usage-warning"/);
 const site=await(await call(env,'/admin?view=site',undefined,auth.cookie)).text();
 assert.match(site,/id="image-storage"/);assert.match(site,/公開サイトに保存|kept on the public site/);assert.doesNotMatch(site,/公開サイトのメディア|Media on the public site/);assert.doesNotMatch(site,/R2|data-media-migration|cleanup_media/);
});

test('page history keeps the newest 10 entries of each page, and the update trims older ones',async()=>{
 const {savePage,loadPage}=require('../.test-build/src/storage.js'),{saveWithRevision,revisions,REVISION_KEEP}=require('../.test-build/src/revisions.js');
 assert.equal(REVISION_KEEP,10);
 const env=environment();await savePage(env,'a',{title:'0',status:'draft'});await savePage(env,'b',{title:'b0',status:'draft'});
 for(let i=1;i<=14;i++){const current=await loadPage(env,'a');await saveWithRevision(env,'a','a',{...current,title:String(i)},'admin',current.revision_tag||'');}
 const other=await loadPage(env,'b');await saveWithRevision(env,'b','b',{...other,title:'b1'},'admin',other.revision_tag||'');
 const kept=await revisions(env,'a');
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM post_revisions WHERE post_id='a'").get().n,10);
 assert.deepEqual(kept.map(row=>JSON.parse(row.data).title),['13','12','11','10','9','8','7','6','5','4']);
 assert.equal((await revisions(env,'b')).length,1,'another page keeps its own history');
 // Existing sites: more than 10 entries before the update.
 const sqlite=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(dir).sort())if(file<'0020_revision_limit.sql')sqlite.exec(fs.readFileSync(path.join(dir,file),'utf8'));
 for(let i=0;i<25;i++)sqlite.prepare("INSERT INTO post_revisions(post_id,data,created_at,editor_id) VALUES(?,?,'t','admin')").run(i%2?'x':'y',String(i));
 sqlite.prepare("INSERT INTO post_revisions(post_id,data,created_at,editor_id) VALUES('z','only','t','admin')").run();
 sqlite.exec(fs.readFileSync(path.join(dir,'0020_revision_limit.sql'),'utf8'));
 assert.deepEqual(sqlite.prepare('SELECT post_id,COUNT(*) n,MIN(CAST(data AS INTEGER)) oldest FROM post_revisions GROUP BY post_id ORDER BY post_id').all().map(row=>({...row})),[{post_id:'x',n:10,oldest:5},{post_id:'y',n:10,oldest:6},{post_id:'z',n:1,oldest:0}]);
});
