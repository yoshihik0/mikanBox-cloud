import type {Env} from './types';
import {imageType,MEDIA_FILE_LIMIT,MEDIA_TOTAL_LIMIT,MEDIA_CHUNK_SIZE,validMediaName} from './media-policy';
export async function replaceMediaImage(env:Env,key:string,bytes:Uint8Array,expectedEtag?:string){
 if(!validMediaName(key)||!bytes.length||bytes.length>MEDIA_FILE_LIMIT)throw new Error('Invalid image.');
 const type=imageType(bytes,key.split('.').pop()!.toLowerCase());if(!type)throw new Error('Image extension and format must match.');
 const current=await env.DB.prepare('SELECT etag,uploaded,upload_id,size FROM media WHERE key=?').bind(key).first<{etag:string;uploaded:string;upload_id:string|null;size:number}>();if(!current)throw new Error('Image not found.');
 if(expectedEtag&&expectedEtag.replace(/^"|"$/g,'')!==String(current.etag))throw new Error('Image changed; reload and retry.');
 const id=crypto.randomUUID(),count=Math.ceil(bytes.length/MEDIA_CHUNK_SIZE),etag=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(v=>v.toString(16).padStart(2,'0')).join(''),uploaded=new Date(Math.max(Date.now(),(Date.parse(current.uploaded)||0)+1)).toISOString();
 const guard='key=? AND upload_id IS ? AND etag IS ? AND (SELECT bytes FROM media_usage WHERE id=1)-size+?<=?';const args=[key,current.upload_id,current.etag,bytes.length,MEDIA_TOTAL_LIMIT];
 const statements=[env.DB.prepare('DELETE FROM media_chunks WHERE upload_id=? AND EXISTS(SELECT 1 FROM media WHERE '+guard+')').bind(current.upload_id,...args),env.DB.prepare('UPDATE media SET size=?,uploaded=?,content_type=?,data=?,upload_id=?,etag=?,chunk_count=? WHERE '+guard).bind(bytes.length,uploaded,type,'',id,etag,count,...args)];
 for(let i=0;i<count;i++)statements.push(env.DB.prepare('INSERT INTO media_chunks(upload_id,chunk_index,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM media WHERE upload_id=?)').bind(id,i,bytes.slice(i*MEDIA_CHUNK_SIZE,(i+1)*MEDIA_CHUNK_SIZE).buffer,id));
 const result=await env.DB.batch(statements);if(!result[1].meta.changes)throw new Error('Image changed or quota exceeded; reload and retry.');
}
