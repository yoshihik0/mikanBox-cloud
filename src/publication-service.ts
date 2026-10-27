import type {Env} from './types';
import {cloudConfigured,cloudResult,cloudRequest,cloudTarget} from './cloudflare-api';
import {publicationManifest,readPublicationEntry,WORKER_FIRST_ROUTES} from './static-publication';
import {buildStatic} from './ssg';
import {splitMode,publicRequest} from './site-split';
import {validMediaName} from './media-policy';
interface Job {owner:string;version:string;origin:string;excluded:string[];token?:string;completion?:string;pending?:string[];nextVersion?:string;deployed?:boolean;mediaOnly?:string;routing?:{headers:string;redirects:string};publishedAt?:string|null}
const json=(value:unknown)=>JSON.stringify(value);
const post=(value:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:json(value)});
// In split mode the static files go to the public Worker; otherwise to this Worker's own assets.
const root=(env:Env)=>'/workers/scripts/'+(splitMode(env)?env.CLOUDFLARE_PUBLIC_WORKER_NAME:cloudTarget(env).worker);
async function activeVersion(env:Env){const value=await cloudResult(env,root(env)+'/deployments');const versions=value.deployments?.[0]?.versions;if(versions?.length!==1||versions[0].percentage!==100)throw new Error('Gradual deployments are not supported by automatic publication.');return versions[0].version_id as string;}
async function job(env:Env,id:string,owner:string):Promise<Job>{
 const row=await env.DB.prepare('SELECT state FROM publication_jobs WHERE id=?').bind(id).first<{state:string}>();if(!row)throw new Error('Publication job not found.');const state=JSON.parse(row.state) as Job;
 const lock=await env.DB.prepare("SELECT value FROM settings WHERE key='publication_lock'").first<{value:string}>();
 if(state.owner!==owner||!lock||JSON.parse(lock.value).lease!==id||JSON.parse(lock.value).expires<Date.now())throw new Error('Publication lease expired. Restart publication.');
 if(JSON.parse(lock.value).expires-Date.now()<29*60*1000)await env.DB.prepare("UPDATE settings SET value=? WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(json({lease:id,expires:Date.now()+30*60*1000}),id).run();return state;
}
async function saveJob(env:Env,id:string,state:Job){await env.DB.prepare('UPDATE publication_jobs SET state=? WHERE id=?').bind(json(state),id).run();}
export async function beginPublication(env:Env,request:Request,owner:string,rebuild:boolean,excluded:string[]=[],mediaOnly:string=''){
 if(!await cloudConfigured(env))throw new Error('Cloudflare配信用トークンをサイト設定で設定してください。 / Configure the Cloudflare deployment token in Site settings.');
 const version=await activeVersion(env),id=crypto.randomUUID();
 const acquired=await env.DB.prepare("INSERT INTO settings(key,value) VALUES('publication_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.expires')<?").bind(json({lease:id,expires:Date.now()+30*60*1000}),Date.now()).run();if(!acquired.meta.changes)throw new Error('Publication is already running.');
 try {
 if(rebuild)await buildStatic(env,publicRequest(env,request));
 const manifest=await publicationManifest(env),state:Job={owner,version,origin:new URL(request.url).origin,excluded};
 const old=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();const published=old?JSON.parse(old.value):null;const previous=published?.job;
 const known=previous?(await env.DB.prepare('SELECT path,hash,size,source_version FROM publication_entries WHERE job_id=?').bind(previous).all<{path:string;hash:string;size:number;source_version:string}>()).results:[];
 const media=(await env.DB.prepare('SELECT key,etag,upload_id FROM media').all<{key:string;etag:string;upload_id:string}>()).results;
 const fingerprints=new Map(media.map(item=>['/media/'+item.key,item.upload_id||item.etag||'']));
 let entries=manifest.entries.filter(item=>!excluded.includes(item.path)).map(item=>{const source=fingerprints.get(item.path)||'',cached=source&&known.find(old=>old.path===item.path&&old.source_version===source&&old.size===item.size);return {...item,source_version:source,hash:item.hash||(cached?cached.hash:null)};});
 if(mediaOnly){
  if(rebuild||excluded.length||!validMediaName(mediaOnly)||!/\.(?:jpe?g|png|gif|webp|svg)$/i.test(mediaOnly))throw new Error('Invalid image publication request.');
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
  const target=entries.find(item=>item.path==='/media/'+mediaOnly);if(!target)throw new Error('Image not found.');
  entries=[...known.filter(item=>item.path!==target.path),target] as typeof entries;
  state.mediaOnly=mediaOnly;state.routing=routing;state.publishedAt=published.published_at||null;
 }
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
 if(!state.nextVersion&&splitMode(env)){
 // The public Worker has no code and no bindings: a version is just its assets.
 const form=new FormData();form.set('metadata',new Blob([json({compatibility_date:'2026-10-03',assets:{jwt:state.completion,config:{html_handling:'none',not_found_handling:'404-page',_headers:routing.headers,_redirects:rules}}})],{type:'application/json'}));
 if(await activeVersion(env)!==state.version)throw new Error('Worker code changed during publication.');
 state.nextVersion=(await cloudResult(env,root(env)+'/versions',{method:'POST',body:form})).id;await saveJob(env,id,state);
 }
 if(!state.nextVersion){
 const version=await cloudResult(env,root(env)+'/versions/'+state.version),content=await cloudRequest(env,root(env)+'/content/v2');
 if(!content.headers.get('Content-Type')?.startsWith('multipart/'))throw new Error('Worker modules are unavailable.');
 const modules=await content.formData(),main=content.headers.get('cf-entrypoint')||'src/index.js';if(!modules.has(main))throw new Error('Worker entry module is missing.');
 const bindings=version.resources?.bindings;if(!Array.isArray(bindings))throw new Error('Worker bindings are unavailable.');
 const runtime=version.resources.script_runtime;
 modules.set('metadata',new Blob([json({main_module:main,compatibility_date:runtime.compatibility_date.slice(0,10),compatibility_flags:runtime.compatibility_flags||[],bindings:[...bindings.filter((binding:{name:string})=>binding.name!=='ASSETS').map((binding:{name:string})=>({name:binding.name,type:'inherit',version_id:'latest'})),{name:'ASSETS',type:'assets'}],assets:{jwt:state.completion,config:{html_handling:'none',not_found_handling:'none',run_worker_first:WORKER_FIRST_ROUTES,_headers:routing.headers,_redirects:rules}}})],{type:'application/json'}));
 if(await activeVersion(env)!==state.version)throw new Error('Worker code changed during publication.');
 const latest=await cloudResult<{items:Array<{id:string}>}>(env,root(env)+'/versions?per_page=1');
 if(latest.items?.[0]?.id!==state.version)throw new Error('The latest uploaded Worker version is not the deployed version. Deploy the intended version before publishing.');
 state.nextVersion=(await cloudResult(env,root(env)+'/versions?bindings_inherit=strict',{method:'POST',body:modules})).id;await saveJob(env,id,state);
 }
 const paths=(await env.DB.prepare('SELECT path FROM publication_entries WHERE job_id=?').bind(id).all<{path:string}>()).results.map(item=>item.path);
 const previous=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
 await env.DB.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(json({paths:[...new Set([...paths,...(previous?JSON.parse(previous.value).paths||[]:[])])]})).run();
 if(!state.deployed){const beforeDeploy=await activeVersion(env);if(beforeDeploy!==state.version)throw new Error('Worker code changed during publication.');await cloudResult(env,root(env)+'/deployments',post({strategy:'percentage',versions:[{version_id:state.nextVersion,percentage:100}]}));state.deployed=true;await saveJob(env,id,state);}
 await env.DB.batch([env.DB.prepare("UPDATE settings SET value=? WHERE key='static_publication'").bind(json({paths,job:id,published_at:state.mediaOnly?state.publishedAt:new Date().toISOString(),version:state.nextVersion})),env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id)]);
 await env.DB.prepare('DELETE FROM publication_jobs WHERE id<>?').bind(id).run();
 return {published:paths.length,version:state.nextVersion};
}
export async function cancelPublication(env:Env,id:string,owner:string){const state=await job(env,id,owner);if(state.nextVersion&&await activeVersion(env)===state.nextVersion){await finishPublication(env,id,owner);return;}await env.DB.batch([env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id),env.DB.prepare('DELETE FROM publication_jobs WHERE id=?').bind(id)]);}
