import type {Env} from './types';
import {audit,auditUnusual,canonicalSettings} from './audit';
/**
 * "Check for tampering" (0.17.0). It stays inside Cloudflare Free's limits (10 ms CPU and 50 subrequests per request,
 * 5,000,000 D1 rows read per day): the Worker only reads D1 with a few indexed queries and hands the browser what it needs;
 * the browser fetches the public files (they answer cross-origin reads), hashes them and the stored data, and compares.
 * Rows read per check: about the number of history records (up to ~800) + the items they name (at most one row each) +
 * the files of the last publication (one row each, images skipped in the query, not in the read).
 * Nothing here runs for a page view.
 */
const KEY=/^(?:page|component):[A-Za-z0-9_\/.-]{1,200}$|^settings$/;
export interface IntegrityPlan {
  success:true;at:string;public_url:string;published:boolean;
  files:Array<{path:string;hash:string|null}>;files_truncated:boolean;
  data:Array<{key:string;after:string;deleted:boolean;value:string|null}>;
  accepted:{public:Record<string,string>;data:Record<string,string>};
  unusual:Array<{at:string;event:string;actor:string;target:string;from_value:string;to_value:string;ip:string}>;
}
const FILE_LIMIT=3000;
async function acceptedState(env:Env):Promise<{public:Record<string,string>;data:Record<string,string>}>{
  try{
    const row=await env.DB.prepare("SELECT value FROM settings WHERE key='integrity'").first<{value:string}>();
    const value=row?JSON.parse(row.value):{};
    return {public:value.public&&typeof value.public==='object'?value.public:{},data:value.data&&typeof value.data==='object'?value.data:{}};
  }catch{return {public:{},data:{}};}
}
export async function integrityPlan(env:Env):Promise<IntegrityPlan>{
  const records=(await env.DB.prepare('SELECT id,at,event,actor,target,from_value,to_value,ip,after_hash FROM audit_events ORDER BY id').all<{id:number;at:string;event:string;actor:string;target:string;from_value:string;to_value:string;ip:string;after_hash:string}>()).results;
  // The last known fingerprint of each item: records without one (a change made straight in the database) do not count.
  const last=new Map<string,{after:string;deleted:boolean}>();
  for(const row of records){
    const m=row.event.match(/^(page|component)_(created|updated|status|deleted)$/);
    if(m){
      if(m[2]==='deleted')last.set(m[1]+':'+row.target,{after:'',deleted:true});
      else if(row.after_hash)last.set(m[1]+':'+row.target,{after:row.after_hash,deleted:false});
    }else if(row.event==='settings_changed'&&row.target!=='cloud_connection'&&row.after_hash)last.set('settings',{after:row.after_hash,deleted:false});
  }
  // A renamed item: the record names the new id; the old one is gone (its own deletion is not recorded separately).
  for(const row of records)if(row.event.endsWith('_updated')&&row.from_value){const kind=row.event.split('_')[0];if(last.has(kind+':'+row.from_value)&&row.from_value!==row.target)last.set(kind+':'+row.from_value,{after:'',deleted:true});}
  const data:IntegrityPlan['data']=[];
  const wanted={page:[] as string[],component:[] as string[]};
  for(const key of last.keys())if(key!=='settings'&&KEY.test(key))wanted[key.startsWith('page:')?'page':'component'].push(key.slice(key.indexOf(':')+1));
  const values=new Map<string,string>();
  const statements:Array<{kind:'page'|'component'|'settings';statement:D1PreparedStatement}>=[];
  for(const kind of ['page','component'] as const){
    const table=kind==='page'?'posts':'components';
    for(let i=0;i<wanted[kind].length;i+=90){
      const ids=wanted[kind].slice(i,i+90);
      statements.push({kind,statement:env.DB.prepare(`SELECT id,data FROM ${table} WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids)});
    }
  }
  statements.push({kind:'settings',statement:env.DB.prepare("SELECT 'settings' id,value data FROM settings WHERE key='settings'")});
  const results=await env.DB.batch(statements.map(s=>s.statement));
  results.forEach((result,i)=>{for(const row of result.results as Array<{id:string;data:string}>)values.set(statements[i].kind==='settings'?'settings':statements[i].kind+':'+row.id,statements[i].kind==='settings'?canonicalSettings(row.data):row.data);});
  for(const [key,entry] of last)if(KEY.test(key))data.push({key,after:entry.after,deleted:entry.deleted,value:values.get(key)??null});
  // Unusual records of the last 30 days (the rule of the history tables).
  const flagged=new Set(auditUnusual(records));
  const since=Date.now()-30*86400_000;
  const unusual=records.filter((row,i)=>flagged.has(i)&&Date.parse(row.at)>=since).reverse().slice(0,100).map(({at,event,actor,target,from_value,to_value,ip})=>({at,event,actor,target,from_value,to_value,ip}));
  // The files the public site was last published with (the fingerprints recorded at publication).
  let files:IntegrityPlan['files']=[],truncated=false,published=false;
  const publication=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
  const job=publication?String(JSON.parse(publication.value).job||''):'';
  if(job){
    published=true;
    const rows=(await env.DB.prepare(`SELECT path,hash FROM publication_entries WHERE job_id=? AND path NOT IN ('/_headers','/_redirects') AND NOT (path GLOB '*.jpg' OR path GLOB '*.jpeg' OR path GLOB '*.png' OR path GLOB '*.gif' OR path GLOB '*.webp') LIMIT ?`).bind(job,FILE_LIMIT+1).all<{path:string;hash:string|null}>()).results;
    truncated=rows.length>FILE_LIMIT;
    files=rows.slice(0,FILE_LIMIT).map(({path,hash})=>({path,hash:hash&&/^[0-9a-f]{32}$/.test(hash)?hash:null}));
  }
  return {success:true,at:new Date().toISOString(),public_url:(env.PUBLIC_SITE_URL||'').replace(/\/$/,''),published,files,files_truncated:truncated,data,accepted:await acceptedState(env),unusual};
}
/** "This is my change": the differences the browser found become the accepted state (kept in D1 settings, recorded as an important event). */
export async function integrityAccept(env:Env,input:{public?:Record<string,string>;data?:Record<string,string>},actor:string,request:Request):Promise<void>{
  const cleanPublic:Record<string,string>={},cleanData:Record<string,string>={};
  for(const [path,hash] of Object.entries(input.public||{}).slice(0,5000))if(/^\/[^\s\\?#]{0,300}$/.test(path)&&/^(?:[0-9a-f]{32})?$/.test(String(hash)))cleanPublic[path]=String(hash);
  for(const [key,hash] of Object.entries(input.data||{}).slice(0,5000))if(KEY.test(key)&&/^(?:[0-9a-f]{64})?$/.test(String(hash)))cleanData[key]=String(hash);
  const previous=await acceptedState(env);
  const value=JSON.stringify({public:{...previous.public,...cleanPublic},data:{...previous.data,...cleanData},at:new Date().toISOString()});
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('integrity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(value).run();
  const parts=[Object.keys(cleanPublic).length?'public':'',Object.keys(cleanData).length?'data':''].filter(Boolean).join(',');
  await audit(env,'integrity_accepted',{actor,target:parts,request});
}
