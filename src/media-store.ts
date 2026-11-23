import type {Env} from './types';
import {mediaType,validMediaName,isCodeMedia,MEDIA_FILE_LIMIT,MEDIA_COUNT_LIMIT} from './media-policy';
import {imageSize} from './image-size';
import {isPublished} from './publication-state';
/**
 * Media files live only on the public site; D1 keeps what each one is.
 * A file reaches the public site first (published from the browser, or by the server for MCP),
 * and is recorded here only once that publication carries it with the same content.
 */
export interface MediaMeta {key:string;content_type:string;size:number;uploaded:string;etag:string;hash:string;width:number|null;height:number|null;source:string|null}
export interface MediaFile {content_type:string;size:number;etag:string;hash:string;width:number|null;height:number|null}
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
/** Checks a file by its content and works out what is recorded for it. The asset hash is the first 32 hex digits of SHA-256. */
export async function inspectMedia(name:string,bytes:Uint8Array):Promise<MediaFile>{
  if(!validMediaName(name))throw new Error('ファイル名を確認してください。 / Check the filename.');
  if(!bytes.length||bytes.length>MEDIA_FILE_LIMIT)throw new Error('1ファイル10 MB以下のファイルを選んでください。 / Choose a file up to 10 MB.');
  const content_type=mediaType(bytes,name.split('.').pop()!.toLowerCase());
  if(!content_type)throw new Error('JPEG・PNG・GIF・WebP・SVG、またはUTF-8のJS・CSSを選んでください。 / Choose a JPEG, PNG, GIF, WebP, SVG, or UTF-8 JS/CSS file.');
  const etag=hex(await crypto.subtle.digest('SHA-256',bytes as BufferSource));
  const size=isCodeMedia(name)||content_type==='image/svg+xml'?null:imageSize(bytes.subarray(0,131072));
  return {content_type,size:bytes.length,etag,hash:etag.slice(0,32),width:size?.width??null,height:size?.height??null};
}
export async function getMedia(env:Env,key:string):Promise<MediaMeta|null>{
  if(!validMediaName(key))return null;
  return await env.DB.prepare('SELECT key,content_type,size,uploaded,etag,hash,width,height,source FROM media WHERE key=?').bind(key).first<MediaMeta>()||null;
}
/**
 * A name for a new file that is neither recorded nor still published. As in the PHP editions, a taken name
 * gets _1, _2, ... before the extension, so uploading the same name twice never fails.
 */
export async function freeMediaName(env:Env,name:string):Promise<string>{
  const dot=name.lastIndexOf('.'),base=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
  let candidate=name;
  for(let n=1;await getMedia(env,candidate)||await isPublished(env,'/media/'+candidate);n++){
    if(n>MEDIA_COUNT_LIMIT)throw new Error('Could not find a free filename.');
    candidate=`${base}_${n}${ext}`;
  }
  return candidate;
}
/** The hash the last finished publication gave to a path, or null when it did not carry it. */
export async function publishedHash(env:Env,path:string):Promise<string|null>{
  const state=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
  const job=state?JSON.parse(state.value).job:null;if(!job)return null;
  return (await env.DB.prepare('SELECT hash FROM publication_entries WHERE job_id=? AND path=?').bind(job,path).first<{hash:string}>())?.hash||null;
}
/** Records a new file that the public site already serves with this content. */
export async function addMedia(env:Env,key:string,file:MediaFile):Promise<void>{
  if(await publishedHash(env,'/media/'+key)!==file.hash)throw new Error('公開サイトの画像と内容が一致しません。もう一度アップロードしてください。 / The file on the public site does not match. Upload it again.');
  const r=await env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,etag,hash,width,height) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM media)<? ON CONFLICT(key) DO NOTHING`)
    .bind(key,file.content_type,file.size,new Date().toISOString(),file.etag,file.hash,file.width,file.height,MEDIA_COUNT_LIMIT).run();
  if(!r.meta.changes)throw new Error('同名のファイルがあるか、ファイル数の上限です。 / A file with this name exists, or the file limit is reached.');
}
export async function deleteMedia(env:Env,key:string):Promise<boolean>{
  if(!validMediaName(key))return false;
  return !!(await env.DB.prepare('DELETE FROM media WHERE key=?').bind(key).run()).meta.changes;
}
/** A renamed file keeps its content: until the next build it is still served from its old path. */
export function renamedSource(row:Pick<MediaMeta,'key'|'source'>):string{return row.source||'/media/'+row.key;}
/** New content under the same name (a resize): already published at /media/<key>, recorded here once confirmed. */
export async function replaceMedia(env:Env,key:string,file:MediaFile,expectedEtag?:string):Promise<void>{
  const current=await getMedia(env,key);if(!current)throw new Error('Image not found.');
  if(expectedEtag&&expectedEtag.replace(/^"|"$/g,'')!==current.etag)throw new Error('Image changed; reload and retry.');
  if(await publishedHash(env,'/media/'+key)!==file.hash)throw new Error('公開サイトの画像と内容が一致しません。もう一度お試しください。 / The file on the public site does not match. Try again.');
  const uploaded=new Date(Math.max(Date.now(),(Date.parse(current.uploaded)||0)+1)).toISOString();
  const r=await env.DB.prepare('UPDATE media SET content_type=?,size=?,uploaded=?,etag=?,hash=?,width=?,height=?,source=NULL WHERE key=? AND etag=?')
    .bind(file.content_type,file.size,uploaded,file.etag,file.hash,file.width,file.height,key,current.etag).run();
  if(!r.meta.changes)throw new Error('Image changed; reload and retry.');
}
/**
 * Pixel size for a static build (width/height attributes). Recorded at upload; a file recorded without it
 * (restored from a backup, or from before 0.13.0) is measured once from the start of the public file.
 */
export async function mediaDimensions(env:Env,name:string):Promise<{width:number;height:number}|null>{
  const row=await getMedia(env,name);if(!row||row.content_type==='image/svg+xml'||isCodeMedia(name))return null;
  if(row.width&&row.height)return {width:row.width,height:row.height};
  if(!env.PUBLIC_SITE_URL)return null;
  try{
    const response=await fetch(env.PUBLIC_SITE_URL.replace(/\/$/,'')+'/media/'+encodeURIComponent(name),{headers:{Range:'bytes=0-131071'}});
    if(!response.ok||!response.body)return null;
    const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
    while(length<131072){const {value,done}=await reader.read();if(done)break;parts.push(value);length+=value.length;}
    await reader.cancel().catch(()=>{});
    const head=new Uint8Array(Math.min(length,131072));let offset=0;for(const part of parts){head.set(part.subarray(0,head.length-offset),offset);offset+=part.length;if(offset>=head.length)break;}
    const size=imageSize(head);if(!size)return null;
    await env.DB.prepare('UPDATE media SET width=?,height=? WHERE key=? AND etag=?').bind(size.width,size.height,name,row.etag).run();
    return size;
  }catch{return null;}
}
