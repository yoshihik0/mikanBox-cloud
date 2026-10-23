import type {Env} from './types';
import {mediaBucket,putImmutableImage,discardImage,imageHash} from './r2-media';
import {mediaStorageMode,MEDIA_MODE_SQL} from './media-mode';
import {getMediaObject} from './storage';
type ImageRow={key:string;content_type:string;size:number;uploaded:string;upload_id:string|null;etag:string|null;chunk_count:number;object_key:string|null};
const fields=['key','content_type','size','uploaded','upload_id','etag','chunk_count','object_key'];
export async function migrationStatus(env:Env){
 const job=await env.DB.prepare('SELECT id FROM media_migrations LIMIT 1').first<{id:string}>();
 if(!job)return null;
 const counts=await env.DB.prepare('SELECT COUNT(*) total,COALESCE(SUM(object_key IS NOT NULL),0) copied FROM media_migration_items WHERE job_id=?').bind(job.id).first<{total:number;copied:number}>();return {id:job.id,...counts!};
}
export async function beginMediaMigration(env:Env){
 mediaBucket(env);if(await mediaStorageMode(env)==='r2')throw new Error('Images are already stored in R2.');
 const current=await migrationStatus(env);if(current)return current;
 await env.DB.prepare('DELETE FROM backup_sessions WHERE created_at<?').bind(Date.now()-24*60*60*1000).run();
 if(await env.DB.prepare('SELECT id FROM backup_sessions LIMIT 1').first())throw new Error('Finish or cancel the backup restore before migrating images.');
 const id=crypto.randomUUID();
 const result=await env.DB.batch([
 env.DB.prepare(`INSERT INTO media_migration_guard(id,valid) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM backup_sessions) AND (${MEDIA_MODE_SQL})='d1' THEN 1 ELSE 0 END`).bind(id),
 env.DB.prepare("INSERT INTO settings(key,value) VALUES('media_storage_lock',?) ON CONFLICT(key) DO NOTHING").bind(id),
 env.DB.prepare("INSERT INTO media_migrations(id,created_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE key='media_storage_lock' AND value=?) AND NOT EXISTS(SELECT 1 FROM backup_sessions)").bind(id,Date.now(),id),
 env.DB.prepare(`INSERT INTO media_migration_items(job_id,media_key,snapshot) SELECT ?,key,json_object(${fields.map(f=>`'${f}',${f}`).join(',')}) FROM media WHERE EXISTS(SELECT 1 FROM media_migrations WHERE id=?)`).bind(id,id),env.DB.prepare('DELETE FROM media_migration_guard WHERE id=?').bind(id)]);
 if(!result[1].meta.changes)throw new Error('Another image migration is active.');return (await migrationStatus(env))!;
}
async function requireJob(env:Env,id:string){
 if(!id||!await env.DB.prepare("SELECT id FROM media_migrations WHERE id=? AND EXISTS(SELECT 1 FROM settings WHERE key='media_storage_lock' AND value=?)").bind(id,id).first())throw new Error('Image migration is not active.');
}
export async function copyMediaMigrationImage(env:Env,id:string){
 await requireJob(env,id);
 const item=await env.DB.prepare('SELECT media_key,snapshot FROM media_migration_items WHERE job_id=? AND object_key IS NULL ORDER BY media_key LIMIT 1').bind(id).first<{media_key:string;snapshot:string}>();
 if(!item)return (await migrationStatus(env))!;
 const snapshot=JSON.parse(item.snapshot) as ImageRow;
 const source=await getMediaObject(env,item.media_key);if(!source||source.size!==snapshot.size)throw new Error('Source image changed or is missing.');
 const bytes=new Uint8Array(await source.arrayBuffer());if(bytes.length!==snapshot.size)throw new Error('Source image is incomplete.');
 if(snapshot.etag&&/^[a-f0-9]{64}$/.test(snapshot.etag)&&await imageHash(bytes)!==snapshot.etag)throw new Error('Source image checksum mismatch.');
 const object=await putImmutableImage(env,bytes,snapshot.content_type);
 try{
 const copied=await mediaBucket(env).get(object.objectKey);if(!copied||copied.size!==bytes.length||await imageHash(new Uint8Array(await copied.arrayBuffer()))!==object.etag)throw new Error('R2 image verification failed.');
 const result=await env.DB.prepare(`UPDATE media_migration_items SET object_key=?,etag=? WHERE job_id=? AND media_key=? AND object_key IS NULL AND EXISTS(SELECT 1 FROM settings WHERE key='media_storage_lock' AND value=?) AND EXISTS(SELECT 1 FROM media t WHERE ${fields.map(f=>`t.${f} IS json_extract(snapshot,'$.${f}')`).join(' AND ')})`).bind(object.objectKey,object.etag,id,item.media_key,id).run();
 if(!result.meta.changes)throw new Error('Image migration changed; retry.');
 }catch(error){await discardImage(env,object.objectKey).catch(()=>{});throw error;}
 return (await migrationStatus(env))!;
}
export async function finishMediaMigration(env:Env,id:string):Promise<void>{
 await requireJob(env,id);
 const guard=`INSERT INTO media_migration_guard(id,valid) SELECT ?,CASE WHEN
 (SELECT COUNT(*) FROM media)=(SELECT COUNT(*) FROM media_migration_items WHERE job_id=?)
 AND NOT EXISTS(SELECT 1 FROM media_migration_items i WHERE i.job_id=? AND (i.object_key IS NULL OR NOT EXISTS(SELECT 1 FROM media t WHERE ${fields.map(f=>`t.${f} IS json_extract(i.snapshot,'$.${f}')`).join(' AND ')})))
 AND EXISTS(SELECT 1 FROM settings WHERE key='media_storage_lock' AND value=?)
 AND NOT EXISTS(SELECT 1 FROM backup_sessions) THEN 1 ELSE 0 END`;
 await env.DB.batch([
 env.DB.prepare(guard).bind(id,id,id,id),
 env.DB.prepare('DELETE FROM media_chunks'),
 env.DB.prepare("UPDATE media SET object_key=(SELECT object_key FROM media_migration_items i WHERE i.job_id=? AND i.media_key=media.key),etag=(SELECT etag FROM media_migration_items i WHERE i.job_id=? AND i.media_key=media.key),data='',upload_id=NULL,chunk_count=0").bind(id,id),
 env.DB.prepare("INSERT INTO settings(key,value) VALUES('media_storage','r2') ON CONFLICT(key) DO UPDATE SET value='r2'"),
 env.DB.prepare("DELETE FROM settings WHERE key='media_storage_lock' AND value=?").bind(id),
 env.DB.prepare('DELETE FROM media_migrations WHERE id=?').bind(id),
 env.DB.prepare('DELETE FROM media_migration_guard WHERE id=?').bind(id)]);
}
export async function cancelMediaMigration(env:Env,id:string):Promise<void>{
 await requireJob(env,id);await env.DB.batch([env.DB.prepare("DELETE FROM settings WHERE key='media_storage_lock' AND value=?").bind(id),env.DB.prepare('DELETE FROM media_migrations WHERE id=?').bind(id)]);
}
