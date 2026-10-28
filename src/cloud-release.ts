import type {Env} from './types';
import {CLOUD_VERSION} from './version';
export interface CloudRelease {status:'unconfigured'|'available'|'error';version?:string;url?:string;outdated?:boolean}
let cached:{source:string;at:number;value:CloudRelease}|undefined;
export async function latestCloudRelease(env:Env,refresh=false):Promise<CloudRelease>{
 const source=env.CLOUD_RELEASE_MANIFEST_URL || 'https://raw.githubusercontent.com/yoshihik0/mikanBox-cloud/split-prototype/public/mikanbox/cloud-release.json';
 if(!refresh&&cached?.source===source&&Date.now()-cached.at<10*60*1000)return cached.value;
 let value:CloudRelease;
 try{
  if(new URL(source).protocol!=='https:')throw new Error();
  const response=await fetch(source,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok||Number(response.headers.get('Content-Length'))>4096)throw new Error();
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096)throw new Error();chunks.push(part.value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const info=JSON.parse(new TextDecoder().decode(bytes));
  if(info.edition!=='cloud'||typeof info.version!=='string'||!/^v?\d+\.\d+\.\d+$/.test(info.version))throw new Error();
  if(info.url&&new URL(info.url).protocol!=='https:')throw new Error();
  const version=info.version.replace(/^v/,''),next=version.split('.').map(Number),current=CLOUD_VERSION.split('.').map(Number);
  let outdated=false;for(let i=0;i<3;i++){if(next[i]!==current[i]){outdated=next[i]>current[i];break;}}
  value={status:'available',version,url:info.url||undefined,outdated};
 }catch{value={status:'error'};}
 cached={source,at:Date.now(),value};return value;
}
