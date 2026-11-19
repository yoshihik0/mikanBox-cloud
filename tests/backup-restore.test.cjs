const {test}=require('node:test');const assert=require('node:assert/strict');
const {environment,login,putMedia}=require('./fixtures.cjs');
const {savePage,saveComponent,saveSettings,loadSettings}=require('../.test-build/src/storage.js');
const {exportBackupManifest,createBackupRestore,commitBackupRestore,abortBackupRestore,validateExportSnapshot}=require('../.test-build/src/backup-restore.js');
const {getMedia}=require('../.test-build/src/media-store.js');
const image=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
async function source(){const env=environment();await login(env);await saveSettings(env,{site_id:'source',api_key:'source-secret',site_name:'Source'});await savePage(env,'private',{title:'Private',status:'draft',content_md:'all data'});await savePage(env,'public',{title:'Public',status:'public_static',content_md:'hello'});await saveComponent(env,'header',{html:'header'});await putMedia(env,'pixel.png',image);env.sqlite.exec("INSERT INTO static_pages(id,html,built_at) VALUES('public','<p>Hello</p>','today'); INSERT INTO post_revisions(post_id,data,created_at,editor_id) VALUES('private','{\"title\":\"Old\"}','today','admin')");return env;}
test('portable backup restores private content, revisions and the media information while preserving runtime credentials',async()=>{
 const src=await source(),manifest=await exportBackupManifest(src),target=environment();await login(target,'current');await saveSettings(target,{site_id:'target',api_key:'target-secret'});target.sqlite.exec("INSERT INTO settings VALUES('cloud_connection','encrypted-runtime-secret')");
 assert.equal(manifest.settings.api_key,'','the MCP key never leaves in a backup');assert.match(manifest.media[0].etag,/^[0-9a-f]{64}$/);
 const id=await createBackupRestore(target,manifest),result=await commitBackupRestore(target,id);
 assert.deepEqual(result,{pages:manifest.pages.length,components:manifest.components.length,images:1,accountsRestored:false});
 assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM posts').get().n,manifest.pages.length);assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM post_revisions').get().n,1);
 assert.equal(target.sqlite.prepare('SELECT username FROM users').get().username,'current');
 const settings=await loadSettings(target);assert.equal(settings.site_id,'target');assert.equal(settings.api_key,'target-secret');assert.equal(target.sqlite.prepare("SELECT value FROM settings WHERE key='cloud_connection'").get().value,'encrypted-runtime-secret');
 // The file itself goes back to the public site with the publication the browser runs from the backup file.
 const row=await getMedia(target,'pixel.png');assert.equal(row.etag,manifest.media[0].etag);assert.equal(row.hash,row.etag.slice(0,32));
});
test('concurrent changes abort restoration without losing edits',async()=>{
 const src=await source(),manifest=await exportBackupManifest(src),target=environment(),id=await createBackupRestore(target,manifest);
 await savePage(target,'new',{title:'Concurrent',status:'draft'});await assert.rejects(commitBackupRestore(target,id),/not applied/);
 assert.ok(target.sqlite.prepare("SELECT id FROM posts WHERE id='new'").get());assert.equal(await getMedia(target,'pixel.png'),null);
});
test('explicit account restoration changes authentication generation and replaces users',async()=>{
 const src=await source(),manifest=await exportBackupManifest(src);manifest.media=[];const target=environment();await login(target,'current');const id=await createBackupRestore(target,manifest,{restoreUsers:true});const result=await commitBackupRestore(target,id);
 assert.equal(result.accountsRestored,true);assert.deepEqual(target.sqlite.prepare('SELECT username FROM users').all().map(r=>r.username),manifest.users.map(u=>u.username));
});
test('invalid schema, duplicate IDs and unsafe media are rejected before staging',async()=>{
 const src=await source(),manifest=await exportBackupManifest(src),target=environment();
 await assert.rejects(createBackupRestore(target,{...manifest,format:'wrong'}));await assert.rejects(createBackupRestore(target,{...manifest,pages:[...manifest.pages,manifest.pages[0]]}));
 await assert.rejects(createBackupRestore(target,{...manifest,media:[{...manifest.media[0],key:'../x.png'}]}));await assert.rejects(createBackupRestore(target,{...manifest,media:[{...manifest.media[0],etag:'not-a-hash'}]}));
 assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM backup_sessions').get().n,0);
});
test('expired staging is removed on next restore',async()=>{
 const target=environment(),empty=await exportBackupManifest(target),first=await createBackupRestore(target,empty);target.sqlite.prepare('UPDATE backup_sessions SET created_at=0 WHERE id=?').run(first);
 await assert.rejects(commitBackupRestore(target,first),/expired/);await createBackupRestore(target,empty);assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM backup_sessions WHERE id=?').get(first).n,0);
});
test('backup export rejects late source changes',async()=>{
 const src=await source(),manifest=await exportBackupManifest(src);await validateExportSnapshot(src,manifest);
 src.sqlite.prepare('UPDATE media SET etag=? WHERE key=?').run('c'.repeat(64),manifest.media[0].key);await assert.rejects(validateExportSnapshot(src,manifest),/changed/);
});
test('explicit account restore restores user names and rejects concurrent account edits',async()=>{
 const src=await source();src.sqlite.prepare("UPDATE users SET display_name='From backup'").run();const manifest=await exportBackupManifest(src);manifest.media=[];const target=environment();await login(target,'current');let id=await createBackupRestore(target,manifest,{restoreUsers:true});target.sqlite.prepare("UPDATE users SET display_name='Changed'").run();await assert.rejects(commitBackupRestore(target,id),/not applied/);await abortBackupRestore(target,id);id=await createBackupRestore(target,manifest,{restoreUsers:true});await commitBackupRestore(target,id);
 assert.deepEqual(target.sqlite.prepare('SELECT username,display_name FROM users').all().map(r=>({...r})),manifest.users.map(u=>({username:u.username,display_name:'From backup'})));
 // A backup made before 0.12.1 still carries password-era fields; they are ignored.
 const old={...manifest,users:manifest.users.map(u=>({...u,password_hash:'',security_question:'Q',security_answer_hash:'h'}))};id=await createBackupRestore(target,old,{restoreUsers:true});await commitBackupRestore(target,id);assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,manifest.users.length);
});
test('output formats survive backup and restore, and a former DB status is restored as the mikanBox DB format',async()=>{
 const src=environment();await savePage(src,'cat',{title:'Cat',status:'public_static',output_format:'json',expand_tags:false,md_footer_comps:[],content_md:'[]'});await savePage(src,'art',{title:'Art',status:'public_static',output_format:'html_md',md_footer_comps:['_md_footer'],content_md:'x'});
 src.sqlite.exec("INSERT INTO static_pages(id,html,built_at,path,md) VALUES('cat','[]','today','/cat.json',NULL),('art','<p>x</p>','today','/art.html','---\ntitle: \"Art\"\n---\n\nx\n')");
 const manifest=await exportBackupManifest(src);manifest.pages.push({id:'olddb',data:JSON.stringify({title:'Old',status:'db',content_md:''}),status:'db',sort_order:0,updated_at:''});
 const target=environment(),id=await createBackupRestore(target,manifest);await commitBackupRestore(target,id);
 const page=id=>JSON.parse(target.sqlite.prepare('SELECT data FROM posts WHERE id=?').get(id).data);
 assert.equal(page('cat').output_format,'json');assert.equal(page('cat').expand_tags,false);assert.deepEqual(page('art').md_footer_comps,['_md_footer']);
 assert.equal(page('olddb').output_format,'db');assert.equal(target.sqlite.prepare("SELECT status FROM posts WHERE id='olddb'").get().status,'public_static');
 assert.deepEqual(target.sqlite.prepare("SELECT id,path,md IS NOT NULL has_md FROM static_pages ORDER BY id").all().map(r=>({...r})),[{id:'art',path:'/art.html',has_md:1},{id:'cat',path:'/cat.json',has_md:0}]);
});
