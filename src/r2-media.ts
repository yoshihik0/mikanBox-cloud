import type {Env} from './types';
export function mediaBucket(env:Env):R2Bucket {
 if(!env.MEDIA)throw new Error('画像保存用のR2が未設定です。初期設定のR2接続を確認してください。 / Configure the MEDIA R2 binding before using images.');
 return env.MEDIA;
}
export async function imageHash(bytes:Uint8Array):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(v=>v.toString(16).padStart(2,'0')).join('');}
/** Register before writing; unreferenced objects can be reclaimed after interruptions. */
export async function putImmutableImage(env:Env,bytes:Uint8Array,type:string):Promise<{objectKey:string;etag:string}> {
 const bucket=mediaBucket(env),objectKey='objects/'+crypto.randomUUID(),etag=await imageHash(bytes);
 await env.DB.prepare('INSERT INTO r2_objects(object_key,size,created_at) VALUES(?,?,?)').bind(objectKey,bytes.length,Date.now()).run();
 try{await bucket.put(objectKey,bytes,{httpMetadata:{contentType:type}});}catch(error){await discardImage(env,objectKey).catch(()=>{});throw error;}
 return {objectKey,etag};
}
export async function discardImage(env:Env,objectKey:string):Promise<void>{
 await mediaBucket(env).delete(objectKey);await env.DB.prepare('DELETE FROM r2_objects WHERE object_key=?').bind(objectKey).run();
}
/** Only old, unreferenced immutable objects are removed. Active/restoring images stay readable. */
export async function cleanMediaObjects(env:Env):Promise<number>{
 mediaBucket(env);
 await env.DB.prepare('DELETE FROM backup_sessions WHERE created_at<?').bind(Date.now()-24*60*60*1000).run();
 const rows=await env.DB.prepare(`SELECT object_key FROM r2_objects WHERE created_at<?
 AND object_key NOT IN(SELECT object_key FROM media WHERE object_key IS NOT NULL)
 AND object_key NOT IN(SELECT object_key FROM backup_parts)
 AND object_key NOT IN(SELECT object_key FROM backup_images)
 AND object_key NOT IN(SELECT object_key FROM media_migration_items WHERE object_key IS NOT NULL) LIMIT 20`).bind(Date.now()-24*60*60*1000).all<{object_key:string}>();
 let removed=0;for(const row of rows.results){await discardImage(env,row.object_key);removed++;}return removed;
}
