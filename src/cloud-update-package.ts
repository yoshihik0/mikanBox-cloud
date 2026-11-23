import type {CloudUpdateMigration} from './cloud-update-state';
import {CLOUD_VERSION} from './version';

export class CloudUpdateError extends Error {}
export const officialRepository = 'yoshihik0/mikanBox-cloud';
export const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export function compareVersions(left:string, right:string) {
  const a=left.split('.').map(Number), b=right.split('.').map(Number);
  return a[0]-b[0] || a[1]-b[1] || a[2]-b[2];
}

export interface UpdateManifest {
  edition:string; version:string; minimum_version:string; commit:string; compatibility_date:string;
  migrations:string[]; sha256:string;
}
export interface UpdateAsset { path:string; type:string; content:string; hash:string; size:number }
export interface UpdatePackage {
  version:string; main:{name:string;content:string}; assets:UpdateAsset[]; migrations:CloudUpdateMigration[];
}

const invalid = () => new CloudUpdateError('更新ファイルの検証に失敗しました。 / Release verification failed.');
const unavailable = () => new CloudUpdateError('公式リリースの更新ファイルを取得できません。 / The official update package is unavailable.');
async function download(url:string,limit:number,accept='*/*'):Promise<Uint8Array<ArrayBuffer>> {
  const response=await fetch(url,{headers:{'User-Agent':'mikanBox-Cloud-Updater',Accept:accept},signal:AbortSignal.timeout(25000)});
  if(!response.ok || !response.body || Number(response.headers.get('Content-Length'))>limit)throw unavailable();
  const chunks:Uint8Array[]=[];
  const reader=response.body.getReader();
  let size=0;
  try {
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.length;
      if(size>limit)throw invalid();
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
const assetUrl=(version:string,file:string)=>`https://github.com/${officialRepository}/releases/download/v${version}/${file}`;
export async function updateManifest(version:string):Promise<UpdateManifest> {
  if(!versionPattern.test(version))throw invalid();
  const bytes=await download(assetUrl(version,'mikanbox-cloud-update.json'),64*1024);
  const m:UpdateManifest=JSON.parse(new TextDecoder().decode(bytes));
  if(m.edition!=='cloud'||m.version!==version||!versionPattern.test(m.minimum_version)||!/^[\da-f]{40}$/.test(m.commit)||
     !/^[\da-f]{64}$/.test(m.sha256)||!/^\d{4}-\d\d-\d\d$/.test(m.compatibility_date)||!Array.isArray(m.migrations))throw invalid();
  if(compareVersions(CLOUD_VERSION,m.minimum_version)<0)throw new CloudUpdateError('この版への更新には手動更新を使ってください。 / This release requires a manual update from your installed version.');
  const ref=await download(`https://api.github.com/repos/${officialRepository}/commits/v${version}`,64,'application/vnd.github.sha');
  if(new TextDecoder().decode(ref).trim()!==m.commit)throw invalid();
  return m;
}

export async function updatePackage(manifest:UpdateManifest):Promise<UpdatePackage> {
  const bytes=await download(assetUrl(manifest.version,'mikanbox-cloud-update-package.json'),12*1024*1024);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  if(Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')!==manifest.sha256)throw invalid();
  const p:UpdatePackage=JSON.parse(new TextDecoder().decode(bytes));
  if(p.version!==manifest.version||!p.main?.content||!/^[-\w.]+\.m?js$/.test(p.main.name)||
     !Array.isArray(p.assets)||!p.assets.length||!Array.isArray(p.migrations)||
     JSON.stringify(p.migrations.map(m=>m.name))!==JSON.stringify(manifest.migrations))throw invalid();
  const paths=new Set<string>();
  for(const a of p.assets){
    if(!a.path.startsWith('/')||paths.has(a.path)||!/^[a-f0-9]{32}$/.test(a.hash)||!Number.isSafeInteger(a.size)||a.size<0||
       typeof a.content!=='string'||a.content.length!==4*Math.ceil(a.size/3)||!a.type)throw invalid();
    paths.add(a.path);
  }
  return p;
}
