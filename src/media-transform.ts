import {assertMediaUnlocked,MEDIA_UNLOCKED_SQL} from './media-mode';
import type {Env} from './types';
import {imageType,MEDIA_FILE_LIMIT,validMediaName} from './media-policy';
import {putImmutableImage,discardImage} from './r2-media';
export async function replaceMediaImage(env:Env,key:string,bytes:Uint8Array,expectedEtag?:string){
 await assertMediaUnlocked(env);if(!validMediaName(key)||!bytes.length||bytes.length>MEDIA_FILE_LIMIT)throw new Error('Invalid image.');
 const type=imageType(bytes,key.split('.').pop()!.toLowerCase());if(!type)throw new Error('Image extension and format must match.');
 const current=await env.DB.prepare('SELECT object_key,etag,uploaded,upload_id,size FROM media WHERE key=?').bind(key).first<{object_key:string|null;etag:string;uploaded:string;upload_id:string|null;size:number}>();if(!current)throw new Error('Image not found.');
 if(expectedEtag&&expectedEtag.replace(/^"|"$/g,'')!==String(current.etag))throw new Error('Image changed; reload and retry.');
 if(!current.object_key){
 const id=crypto.randomUUID(),count=Math.ceil(bytes.length/500000),etag=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(v=>v.toString(16).padStart(2,'0')).join(''),uploaded=new Date(Math.max(Date.now(),(Date.parse(current.uploaded)||0)+1)).toISOString();
 const guard=`key=? AND upload_id IS ? AND etag IS ? AND (SELECT bytes FROM media_usage WHERE id=1)-size+?<=400000000 AND ${MEDIA_UNLOCKED_SQL}`;const args=[key,current.upload_id,current.etag,bytes.length];
 const statements=[env.DB.prepare('DELETE FROM media_chunks WHERE upload_id=? AND EXISTS(SELECT 1 FROM media WHERE '+guard+')').bind(current.upload_id,...args),env.DB.prepare('UPDATE media SET size=?,uploaded=?,content_type=?,data=?,upload_id=?,etag=?,chunk_count=? WHERE '+guard).bind(bytes.length,uploaded,type,'',id,etag,count,...args)];
 for(let i=0;i<count;i++)statements.push(env.DB.prepare('INSERT INTO media_chunks(upload_id,chunk_index,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM media WHERE upload_id=?)').bind(id,i,bytes.slice(i*500000,(i+1)*500000).buffer,id));
 const result=await env.DB.batch(statements);if(!result[1].meta.changes)throw new Error('Image changed or quota exceeded; reload and retry.');return;
 }
 const object=await putImmutableImage(env,bytes,type),uploaded=new Date(Math.max(Date.now(),(Date.parse(current.uploaded)||0)+1)).toISOString();
 try{const r=await env.DB.prepare(`UPDATE media SET object_key=?,etag=?,size=?,uploaded=?,content_type=? WHERE key=? AND object_key=? AND etag=? AND ${MEDIA_UNLOCKED_SQL}`).bind(object.objectKey,object.etag,bytes.length,uploaded,type,key,current.object_key,current.etag).run();if(!r.meta.changes)throw new Error('Image changed; reload and retry.');}
 catch(error){await discardImage(env,object.objectKey).catch(()=>{});throw error;}
}
