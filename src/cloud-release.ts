import type {Env} from './types';
import {CLOUD_VERSION} from './version';
export interface CloudRelease {status:'unconfigured'|'available'|'error';version?:string;url?:string;notes?:string;outdated?:boolean}
let cached:{source:string;at:number;value:CloudRelease}|undefined;
// Published releases only: GitHub's release feed lists releases (pre-releases included, drafts never),
// so a push to a branch alone cannot change what the admin screen announces. The update workflow
// picks the same release. CLOUD_RELEASE_MANIFEST_URL may point at a JSON manifest instead (tests, mirrors).
const RELEASE_FEED='https://github.com/yoshihik0/mikanBox-cloud/releases.atom';
const RELEASE_TAG_URL=/https:\/\/github\.com\/yoshihik0\/mikanBox-cloud\/releases\/tag\/(v?\d+\.\d+\.\d+)(?=["'<\s])/i;
const LIMIT=512*1024;
function releaseInfo(text:string):{version:string;url?:string;notes?:string}{
 if(text.trimStart().startsWith('{')){
  const info=JSON.parse(text);
  if(info.edition!=='cloud'||typeof info.version!=='string'||!/^v?\d+\.\d+\.\d+$/.test(info.version))throw new Error();
  if(info.url&&new URL(info.url).protocol!=='https:')throw new Error();
  return {version:info.version,url:info.url||undefined,notes:typeof info.notes==='string'?info.notes.slice(0,8000):undefined};
 }
 // The newest entry comes first in the feed.
 const match=text.match(RELEASE_TAG_URL);if(!match)throw new Error();
 const entry=text.slice(text.lastIndexOf('<entry',match.index),text.indexOf('</entry>',match.index));
 const content=entry.match(/<content\b[^>]*>([\s\S]*?)<\/content>/)?.[1]||'';
 // Atom carries HTML as escaped text. The admin view HTML-escapes the resulting plain text.
 const notes=content.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').trim().slice(0,8000);
 return {version:match[1],url:match[0],notes};
}
export async function latestCloudRelease(env:Env,refresh=false):Promise<CloudRelease>{
 const source=env.CLOUD_RELEASE_MANIFEST_URL || RELEASE_FEED;
 if(!refresh&&cached?.source===source&&Date.now()-cached.at<10*60*1000)return cached.value;
 let value:CloudRelease;
 try{
  if(new URL(source).protocol!=='https:')throw new Error();
  const response=await fetch(source,{headers:{Accept:'application/atom+xml, application/json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok||Number(response.headers.get('Content-Length'))>LIMIT)throw new Error();
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>LIMIT)throw new Error();chunks.push(part.value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const info=releaseInfo(new TextDecoder().decode(bytes));
  const version=info.version.replace(/^v/,''),next=version.split('.').map(Number),current=CLOUD_VERSION.split('.').map(Number);
  let outdated=false;for(let i=0;i<3;i++){if(next[i]!==current[i]){outdated=next[i]>current[i];break;}}
  value={status:'available',version,url:info.url,notes:info.notes,outdated};
 }catch{value={status:'error'};}
 cached={source,at:Date.now(),value};return value;
}

export function cloudUpdateUrl(repository:unknown):string {
 const value=String(repository||'').trim();
 return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)&&!value.split('/').some(x=>x==='.'||x==='..')?`https://github.com/${value}/actions/workflows/update-cloud.yml`:'';
}
