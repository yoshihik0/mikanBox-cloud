import type {Env} from './types';
import {cloudConfigured,cloudResult} from './cloudflare-api';
import {publicationManifest,readPublicationEntry} from './static-publication';
import {buildStatic} from './ssg';
import {publicRequest,assertPublicWorker} from './site-split';
import {validMediaName,imageType,isCodeMedia,MEDIA_FILE_LIMIT,MEDIA_COUNT_LIMIT} from './media-policy';
/** A media file published before it is recorded in D1 (upload, resize, conversion): the browser or MCP holds its bytes. */
export interface NewMedia {name:string;hash:string;size:number;content_type:string}
interface Job {owner:string;version:string;origin:string;excluded:string[];token?:string;completion?:string;pending?:string[];nextVersion?:string;deployed?:boolean;mediaOnly?:string;routing?:{headers:string;redirects:string};publishedAt?:string|null}
const json=(value:unknown)=>JSON.stringify(value);
const post=(value:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:json(value)});
// The static files go to the public Worker, never to this one.
// Every deployment call goes through here, so a missing public Worker stops them all.
const root=(env:Env)=>{assertPublicWorker(env);return '/workers/scripts/'+env.CLOUDFLARE_PUBLIC_WORKER_NAME;};
async function activeVersion(env:Env){const value=await cloudResult(env,root(env)+'/deployments');const versions=value.deployments?.[0]?.versions;if(versions?.length!==1||versions[0].percentage!==100)throw new Error('Gradual deployments are not supported by automatic publication.');return versions[0].version_id as string;}
async function job(env:Env,id:string,owner:string):Promise<Job>{
 const row=await env.DB.prepare('SELECT state FROM publication_jobs WHERE id=?').bind(id).first<{state:string}>();if(!row)throw new Error('Publication job not found.');const state=JSON.parse(row.state) as Job;
 const lock=await env.DB.prepare("SELECT value FROM settings WHERE key='publication_lock'").first<{value:string}>();
 if(state.owner!==owner||!lock||JSON.parse(lock.value).lease!==id||JSON.parse(lock.value).expires<Date.now())throw new Error('Publication lease expired. Restart publication.');
 if(JSON.parse(lock.value).expires-Date.now()<29*60*1000)await env.DB.prepare("UPDATE settings SET value=? WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(json({lease:id,expires:Date.now()+30*60*1000}),id).run();return state;
}
async function saveJob(env:Env,id:string,state:Job){await env.DB.prepare('UPDATE publication_jobs SET state=? WHERE id=?').bind(json(state),id).run();}
/**
 * extra: media published before they are recorded. One file with mediaOnly (an upload or an edit), or a list
 * with a full build (files read by the data tool, src/data-transfer.ts).
 */
export async function beginPublication(env:Env,request:Request,owner:string,rebuild:boolean,excluded:string[]=[],mediaOnly:string='',extraInput:NewMedia|NewMedia[]|null=null){
 const list=Array.isArray(extraInput)?extraInput:null,extra:NewMedia|null=Array.isArray(extraInput)?null:extraInput;
 assertPublicWorker(env);
 if(!await cloudConfigured(env))throw new Error('Cloudflare配信用トークンをサイト設定で設定してください。 / Configure the Cloudflare deployment token in Site settings.');
 const version=await activeVersion(env),id=crypto.randomUUID();
 const acquired=await env.DB.prepare("INSERT INTO settings(key,value) VALUES('publication_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.expires')<?").bind(json({lease:id,expires:Date.now()+30*60*1000}),Date.now()).run();if(!acquired.meta.changes)throw new Error('Publication is already running.');
 try {
 const validNew=(item:NewMedia)=>!!item&&validMediaName(item.name)&&/^[a-f0-9]{32}$/.test(item.hash)&&Number.isInteger(item.size)&&item.size>=1&&item.size<=MEDIA_FILE_LIMIT&&/\.(?:jpe?g|png|gif|webp|svg|js|css)$/i.test(item.name);
 if(extra&&(!validNew(extra)||extra.name!==mediaOnly))throw new Error('Invalid media publication request.');
 if(list&&(!rebuild||mediaOnly||list.length>MEDIA_COUNT_LIMIT||!list.every(validNew)))throw new Error('Invalid media publication request.');
 const firstPublication=!(await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first());
 // The first file of a site that was never published goes out with a full build.
 if(mediaOnly&&firstPublication){rebuild=true;}
 if(rebuild)await buildStatic(env,publicRequest(env,request));
 const manifest=await publicationManifest(env),state:Job={owner,version,origin:new URL(request.url).origin,excluded};
 const old=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();const published=old?JSON.parse(old.value):null;const previous=published?.job;
 const known=previous?(await env.DB.prepare('SELECT path,hash,size,source_version FROM publication_entries WHERE job_id=?').bind(previous).all<{path:string;hash:string;size:number;source_version:string}>()).results:[];
 const fresh=(item:NewMedia)=>({path:'/media/'+item.name,kind:'media' as const,id:item.name,size:item.size,hash:item.hash,source:'',source_version:''});
 const newEntry=extra?fresh(extra):null,newEntries=list?list.map(fresh):newEntry?[newEntry]:[],newPaths=new Set(newEntries.map(item=>item.path));
 let entries=[...manifest.entries.filter(item=>!excluded.includes(item.path)&&!newPaths.has(item.path)).map(item=>({...item,source_version:''})),...newEntries];
 if(mediaOnly&&!firstPublication){
  if(rebuild||excluded.length||!validMediaName(mediaOnly)||!/\.(?:jpe?g|png|gif|webp|svg|js|css)$/i.test(mediaOnly))throw new Error('Invalid image publication request.');
  if(!previous||published.version!==version||!known.length||known.some(item=>!item.hash||item.size===null))throw new Error('画像を自動公開する前に、サイトを一度ビルドしてください。 / Build the site once before automatic image publication.');
  const prior=await env.DB.prepare('SELECT state FROM publication_jobs WHERE id=?').bind(previous).first<{state:string}>();
  const priorState=prior?JSON.parse(prior.state):null;
  let routing=priorState?.routing;
  if(!routing){
   if(!priorState || !Array.isArray(priorState.excluded))throw new Error('画像を自動公開する前に、サイトを一度ビルドしてください。 / Build the site once before automatic image publication.');
   // Older releases did not save the routing text. Reconstruct it only when
   // both hashes prove it is identical to the active publication.
   const h=await readPublicationEntry(env,request,'/_headers'),r=await readPublicationEntry(env,request,'/_redirects');
   const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
   if(!h||!r||known.find(x=>x.path==='/_headers')?.hash!==await hash(h.body)||known.find(x=>x.path==='/_redirects')?.hash!==await hash(r.body))throw new Error('画像を自動公開する前に、サイトを一度ビルドしてください。 / Build the site once before automatic image publication.');
   routing={headers:new TextDecoder().decode(h.body),redirects:new TextDecoder().decode(r.body).split('\n').filter(line=>!priorState.excluded.includes(line.split(/\s+/)[1])).join('\n')};
  }
  const target=newEntry||entries.find(item=>item.path==='/media/'+mediaOnly);if(!target)throw new Error('Image not found.');
  entries=[...known.filter(item=>item.path!==target.path),target] as typeof entries;
  state.mediaOnly=mediaOnly;state.routing=routing;state.publishedAt=published.published_at||null;
 } else if(mediaOnly&&!newEntry&&!entries.some(item=>item.path==='/media/'+mediaOnly))throw new Error('Image not found.');
 const statements=[env.DB.prepare('INSERT INTO publication_jobs(id,state) VALUES(?,?)').bind(id,json(state))];
 for(let i=0;i<entries.length;i+=1000)statements.push(env.DB.prepare("INSERT INTO publication_entries(job_id,path,hash,size,source_version) SELECT ?,json_extract(value,'$.path'),json_extract(value,'$.hash'),json_extract(value,'$.size'),json_extract(value,'$.source_version') FROM json_each(?)").bind(id,json(entries.slice(i,i+1000))));
 if(statements.length>41)throw new Error('Too many publication files.');await env.DB.batch(statements);
 return {job:id,entries};
 }catch(error){await env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id).run();throw error;}
}
export async function hashPublicationFiles(env:Env,id:string,owner:string,items:Array<{path:string;hash:string;size:number;contentType:string}>){
 await job(env,id,owner);if(items.length>40)throw new Error('Too many files per step.');
 for(const item of items)if(!/^([a-f0-9]{32})$/.test(item.hash)||!Number.isInteger(item.size)||item.size<0||item.size>25*1024*1024||!item.contentType||item.contentType.length>100)throw new Error('Invalid asset metadata.');
 const statements=items.map(item=>env.DB.prepare('UPDATE publication_entries SET hash=?,size=?,content_type=? WHERE job_id=? AND path=?').bind(item.hash,item.size,item.contentType,id,item.path));if(statements.length)await env.DB.batch(statements);
}
export async function preparePublication(env:Env,id:string,owner:string){
 const state=await job(env,id,owner),entries=(await env.DB.prepare('SELECT path,hash,size FROM publication_entries WHERE job_id=?').bind(id).all<{path:string;hash:string|null;size:number}>()).results;
 if(entries.some(item=>!item.hash))throw new Error('Publication files are not ready.');
 const manifest=Object.fromEntries(entries.filter(item=>!['/_headers','/_redirects'].includes(item.path)).map(item=>[item.path,{hash:item.hash,size:item.size}]));
 const result=await cloudResult(env,root(env)+'/assets-upload-session',post({manifest}));
 if(!result.jwt||!Array.isArray(result.buckets))throw new Error('Invalid upload session.');
 state.token=result.jwt;state.pending=[...new Set<string>(result.buckets.flat())];if(!state.pending.length)state.completion=result.jwt;
 await saveJob(env,id,state);return {uploads:state.pending.map(hash=>entries.find(item=>item.hash===hash)),count:state.pending.length};
}
export async function uploadPublicationFile(env:Env,id:string,owner:string,hash:string,file:File){
 const state=await job(env,id,owner),item=await env.DB.prepare('SELECT path,size,content_type FROM publication_entries WHERE job_id=? AND hash=? LIMIT 1').bind(id,hash).first<{path:string;size:number;content_type:string}>();
 if(!item||!state.pending?.includes(hash)||!state.token||file.size!==4*Math.ceil(item.size/3))throw new Error('Invalid upload file.');
 // A media file is checked by its first bytes against its extension before it reaches the public site.
 if(item.path.startsWith('/media/')){
  const name=item.path.slice(7),ext=name.split('.').pop()!.toLowerCase();
  let head:Uint8Array;try{head=Uint8Array.from(atob(await file.slice(0,8192).text()),c=>c.charCodeAt(0));}catch{throw new Error('Invalid upload file.');}
  if(!validMediaName(name)||(isCodeMedia(name)?head.includes(0):!imageType(head,ext)))throw new Error('Image extension and format must match.');
 }
 const form=new FormData();form.set(hash,new Blob([await file.arrayBuffer()],{type:file.type||item.content_type||'application/octet-stream'}),hash);
 const result=await cloudResult<{jwt?:string}>(env,'/workers/assets/upload?base64=true',{method:'POST',body:form},state.token);
 state.pending=state.pending.filter(value=>value!==hash);if(result?.jwt)state.completion=result.jwt;
 await saveJob(env,id,state);return {remaining:state.pending.length};
}
export async function finishPublication(env:Env,id:string,owner:string){
 const state=await job(env,id,owner);if(state.pending?.length||!state.completion)throw new Error('Assets are not uploaded.');
 const active=await activeVersion(env);if(active===state.nextVersion)state.deployed=true;
 if(active!==(state.deployed?state.nextVersion:state.version))throw new Error('Worker code changed during publication. Restart publication.');
 const request=new Request(state.origin+'/admin');
 const headers=await readPublicationEntry(env,request,'/_headers'),redirects=await readPublicationEntry(env,request,'/_redirects');
 if(!headers||!redirects)throw new Error('Static routing configuration is missing.');
 const routing=state.routing||{headers:new TextDecoder().decode(headers.body),redirects:new TextDecoder().decode(redirects.body).split('\n').filter(line=>!state.excluded.includes(line.split(/\s+/)[1])).join('\n')};
 const rules=routing.redirects;state.routing=routing;
 if(!state.nextVersion){
 // The public Worker has no code and no bindings: a version is just its assets.
 const form=new FormData();form.set('metadata',new Blob([json({compatibility_date:'2026-10-03',assets:{jwt:state.completion,config:{html_handling:'none',not_found_handling:'404-page',_headers:routing.headers,_redirects:rules}}})],{type:'application/json'}));
 if(await activeVersion(env)!==state.version)throw new Error('Worker code changed during publication.');
 state.nextVersion=(await cloudResult(env,root(env)+'/versions',{method:'POST',body:form})).id;await saveJob(env,id,state);
 }
 const paths=(await env.DB.prepare('SELECT path FROM publication_entries WHERE job_id=?').bind(id).all<{path:string}>()).results.map(item=>item.path);
 const previous=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
 await env.DB.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(json({paths:[...new Set([...paths,...(previous?JSON.parse(previous.value).paths||[]:[])])]})).run();
 if(!state.deployed){const beforeDeploy=await activeVersion(env);if(beforeDeploy!==state.version)throw new Error('Worker code changed during publication.');await cloudResult(env,root(env)+'/deployments',post({strategy:'percentage',versions:[{version_id:state.nextVersion,percentage:100}]}));state.deployed=true;await saveJob(env,id,state);}
 await env.DB.batch([env.DB.prepare("UPDATE settings SET value=? WHERE key='static_publication'").bind(json({paths,job:id,published_at:state.mediaOnly?state.publishedAt:new Date().toISOString(),version:state.nextVersion})),env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id),
  // Renamed files are now served from their own path.
  env.DB.prepare("UPDATE media SET source=NULL WHERE source IS NOT NULL AND '/media/'||key IN (SELECT value FROM json_each(?))").bind(json(paths))]);
 await env.DB.prepare('DELETE FROM publication_jobs WHERE id<>?').bind(id).run();
 return {published:paths.length,version:state.nextVersion};
}
export async function cancelPublication(env:Env,id:string,owner:string){const state=await job(env,id,owner);if(state.nextVersion&&await activeVersion(env)===state.nextVersion){await finishPublication(env,id,owner);return;}await env.DB.batch([env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id),env.DB.prepare('DELETE FROM publication_jobs WHERE id=?').bind(id)]);}
/**
 * Publishes one media file from the server (MCP upload): the caller already holds its Base64 content.
 * Only that file may need uploading; when Cloudflare asks for others too, a build from the admin screen
 * (which fetches them from the public site) has to run first.
 */
export async function publishMediaFromServer(env:Env,request:Request,file:NewMedia,base64:string){
 if(!(await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first()))throw new Error('画像を公開する前に、管理画面でサイトを一度ビルドしてください。 / Build the site once from the admin screen before publishing images.');
 const owner='mcp',begin=await beginPublication(env,request,owner,false,[],file.name,file);
 try{
  if(begin.entries.some(item=>!item.hash))throw new Error('Publication files are not ready.');
  const prepared=await preparePublication(env,begin.job,owner);
  if(prepared.uploads.some(item=>item?.hash!==file.hash))throw new Error('公開サイトのファイルの送り直しが必要です。管理画面でサイトをビルドしてから、もう一度お試しください。 / Files of the public site must be sent again. Build the site from the admin screen, then try again.');
  for(const item of prepared.uploads)await uploadPublicationFile(env,begin.job,owner,item!.hash as string,new File([base64],item!.hash as string,{type:file.content_type}));
  return await finishPublication(env,begin.job,owner);
 }catch(error){await cancelPublication(env,begin.job,owner).catch(()=>{});throw error;}
}

