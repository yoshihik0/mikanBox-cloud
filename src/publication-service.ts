import type {Env} from './types';
import {cloudConfigured,cloudResult,cloudRequest,cloudTarget} from './cloudflare-api';
import {publicationManifest,readPublicationEntry,WORKER_FIRST_ROUTES} from './static-publication';
import {buildStatic} from './ssg';
interface Job {owner:string;version:string;origin:string;excluded:string[];token?:string;completion?:string;pending?:string[];nextVersion?:string;deployed?:boolean}
const json=(value:unknown)=>JSON.stringify(value);
const post=(value:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:json(value)});
const root=(env:Env)=>'/workers/scripts/'+cloudTarget(env).worker;
async function activeVersion(env:Env){const value=await cloudResult(env,root(env)+'/deployments');const versions=value.deployments?.[0]?.versions;if(versions?.length!==1||versions[0].percentage!==100)throw new Error('Gradual deployments are not supported by automatic publication.');return versions[0].version_id as string;}
async function job(env:Env,id:string,owner:string):Promise<Job>{
 const row=await env.DB.prepare('SELECT state FROM publication_jobs WHERE id=?').bind(id).first<{state:string}>();if(!row)throw new Error('Publication job not found.');const state=JSON.parse(row.state) as Job;
 const lock=await env.DB.prepare("SELECT value FROM settings WHERE key='publication_lock'").first<{value:string}>();
 if(state.owner!==owner||!lock||JSON.parse(lock.value).lease!==id||JSON.parse(lock.value).expires<Date.now())throw new Error('Publication lease expired. Restart publication.');
 if(JSON.parse(lock.value).expires-Date.now()<29*60*1000)await env.DB.prepare("UPDATE settings SET value=? WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(json({lease:id,expires:Date.now()+30*60*1000}),id).run();return state;
}
async function saveJob(env:Env,id:string,state:Job){await env.DB.prepare('UPDATE publication_jobs SET state=? WHERE id=?').bind(json(state),id).run();}
export async function beginPublication(env:Env,request:Request,owner:string,rebuild:boolean,excluded:string[]=[]){
 if(!await cloudConfigured(env))throw new Error('Cloudflare配信用トークンをサイト設定で設定してください。 / Configure the Cloudflare deployment token in Site settings.');
 const version=await activeVersion(env),id=crypto.randomUUID();
 const acquired=await env.DB.prepare("INSERT INTO settings(key,value) VALUES('publication_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.expires')<?").bind(json({lease:id,expires:Date.now()+30*60*1000}),Date.now()).run();if(!acquired.meta.changes)throw new Error('Publication is already running.');
 try {
 if(rebuild)await buildStatic(env,request);
 const manifest=await publicationManifest(env),state:Job={owner,version,origin:new URL(request.url).origin,excluded};
 const old=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();const previous=old?JSON.parse(old.value).job:null;
 const known=previous?(await env.DB.prepare('SELECT path,hash,size,source_version FROM publication_entries WHERE job_id=?').bind(previous).all<{path:string;hash:string;size:number;source_version:string}>()).results:[];
 const media=(await env.DB.prepare('SELECT key,etag,upload_id FROM media').all<{key:string;etag:string;upload_id:string}>()).results;
 const fingerprints=new Map(media.map(item=>['/media/'+item.key,item.upload_id||item.etag||'']));
 const entries=manifest.entries.filter(item=>!excluded.includes(item.path)).map(item=>{const source=fingerprints.get(item.path)||'',cached=source&&known.find(old=>old.path===item.path&&old.source_version===source&&old.size===item.size);return {...item,source_version:source,hash:cached?cached.hash:null};});
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
 const response=await cloudRequest(env,'/workers/assets/upload?base64=true',{method:'POST',body:form},state.token);
 const result=await response.json() as {success:boolean;result?:{jwt?:string}};if(!result.success)throw new Error('Asset upload failed.');
 state.pending=state.pending.filter(value=>value!==hash);if(result.result?.jwt)state.completion=result.result.jwt;
 await saveJob(env,id,state);return {remaining:state.pending.length};
}
export async function finishPublication(env:Env,id:string,owner:string){
 const state=await job(env,id,owner);if(state.pending?.length||!state.completion)throw new Error('Assets are not uploaded.');
 const active=await activeVersion(env);if(active===state.nextVersion)state.deployed=true;
 if(active!==(state.deployed?state.nextVersion:state.version))throw new Error('Worker code changed during publication. Restart publication.');
 const request=new Request(state.origin+'/admin'),headers=await readPublicationEntry(env,request,'/_headers'),redirects=await readPublicationEntry(env,request,'/_redirects');
 if(!headers||!redirects)throw new Error('Static routing configuration is missing.');
 const rules=new TextDecoder().decode(redirects.body).split('\n').filter(line=>!state.excluded.includes(line.split(/\s+/)[1])).join('\n');
 if(!state.nextVersion){
 const version=await cloudResult(env,root(env)+'/versions/'+state.version),content=await cloudRequest(env,root(env)+'/content/v2');
 if(!content.headers.get('Content-Type')?.startsWith('multipart/'))throw new Error('Worker modules are unavailable.');
 const modules=await content.formData(),main=content.headers.get('cf-entrypoint')||'src/index.js';if(!modules.has(main))throw new Error('Worker entry module is missing.');
 const bindings=version.resources?.bindings;if(!Array.isArray(bindings))throw new Error('Worker bindings are unavailable.');
 const runtime=version.resources.script_runtime;
 modules.set('metadata',new Blob([json({main_module:main,compatibility_date:runtime.compatibility_date.slice(0,10),compatibility_flags:runtime.compatibility_flags||[],bindings:[...bindings.filter((binding:{name:string})=>binding.name!=='ASSETS').map((binding:{name:string})=>({name:binding.name,type:'inherit',version_id:state.version})),{name:'ASSETS',type:'assets'}],assets:{jwt:state.completion,config:{html_handling:'none',not_found_handling:'none',run_worker_first:WORKER_FIRST_ROUTES,_headers:new TextDecoder().decode(headers.body),_redirects:rules}}})],{type:'application/json'}));
 if(await activeVersion(env)!==state.version)throw new Error('Worker code changed during publication.');
 state.nextVersion=(await cloudResult(env,root(env)+'/versions?bindings_inherit=strict',{method:'POST',body:modules})).id;await saveJob(env,id,state);
 }
 const paths=(await env.DB.prepare('SELECT path FROM publication_entries WHERE job_id=?').bind(id).all<{path:string}>()).results.map(item=>item.path);
 const previous=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
 await env.DB.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(json({paths:[...new Set([...paths,...(previous?JSON.parse(previous.value).paths||[]:[])])]})).run();
 if(!state.deployed){const beforeDeploy=await activeVersion(env);if(beforeDeploy!==state.version)throw new Error('Worker code changed during publication.');await cloudResult(env,root(env)+'/deployments',post({strategy:'percentage',versions:[{version_id:state.nextVersion,percentage:100}]}));state.deployed=true;await saveJob(env,id,state);}
 await env.DB.batch([env.DB.prepare("UPDATE settings SET value=? WHERE key='static_publication'").bind(json({paths,job:id,published_at:new Date().toISOString(),version:state.nextVersion})),env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id)]);
 await env.DB.prepare('DELETE FROM publication_jobs WHERE id<>?').bind(id).run();
 return {published:paths.length,version:state.nextVersion};
}
export async function cancelPublication(env:Env,id:string,owner:string){const state=await job(env,id,owner);if(state.nextVersion&&await activeVersion(env)===state.nextVersion){await finishPublication(env,id,owner);return;}await env.DB.batch([env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(id),env.DB.prepare('DELETE FROM publication_jobs WHERE id=?').bind(id)]);}
