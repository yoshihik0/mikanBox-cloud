import type {Env} from './types';
// Static files bypass the Worker. Published files must be withdrawn before
// changing their source to private or deleting it.
export async function publishedPaths(env:Env):Promise<string[]> {
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
  return row?JSON.parse(row.value).paths||[]:[];
}
export async function isPublished(env:Env,path:string):Promise<boolean> {
  return (await publishedPaths(env)).includes(path);
}
export async function assertNotPublished(env:Env,paths:string[]) {
  const published=await publishedPaths(env);
  if(!published.length)return;
  if(paths.some(path=>published.includes(path)))throw new Error('公開ファイルを先に配信先から取り下げてください。 / Withdraw the published file before deleting or making it private.');
}
export async function checkPublicationLock(env:Env,lease='') {
 const row=await env.DB.prepare("SELECT value FROM settings WHERE key='publication_lock'").first<{value:string}>();
 if(!row)return;const lock=JSON.parse(row.value);
 if(lock.expires>Date.now()&&lock.lease!==lease)throw new Error('配信更新中です。少し待って再試行してください。 / Publication is in progress; try again shortly.');
}
