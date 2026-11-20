import type {Env} from './types';
/** Site edits: every change to pages, components, media and settings (recorded by the database, migration 0027). */
export const AUDIT_EDIT_EVENTS=['page_status','page_created','page_updated','page_deleted','component_created','component_updated','component_deleted','media_uploaded','media_changed','media_deleted','settings_changed','data_imported'] as const;
/** The events PHP records (lib/security.php mikanBoxAudit), those the Cloud edition has, plus data restores. */
export const AUDIT_EVENTS=['mcp_enabled','mcp_disabled','mcp_key_issued','mcp_key_rotated','login_failed','device_registered','device_revoked','code_issued','invite_issued','recovery','user_deleted','data_restored',...AUDIT_EDIT_EVENTS] as const;
export type AuditEvent=typeof AUDIT_EVENTS[number];
export interface AuditRow {at:string;event:string;actor:string;target:string;from_value:string;to_value:string;ip:string}
/** The three groups of the site screen: important, site edits, failed sign-ins (as PHP's mikanBoxAuditGroup). */
export function auditGroup(event:string):'important'|'edit'|'login'{
  if(event==='login_failed')return 'login';
  return (AUDIT_EDIT_EVENTS as readonly string[]).includes(event)?'edit':'important';
}
/** The "target" column: the item, with a status change (from → to) or a rename (old → new), as PHP. */
export function auditTargetText(e:{target:string;from_value:string;to_value:string}):string{
  const target=e.target||'',from=e.from_value||'',to=e.to_value||'';
  if(from&&to)return `${target} (${from} → ${to})`.trim();
  if(to)return `${target} (${to})`.trim();
  if(from)return `${from} → ${target}`;
  return target.replace(/,/g,', ');
}
/** Repeated saves of the same item by the same person within MERGE_SECONDS become one record (as PHP). */
const MERGED_EVENTS=['page_updated','component_updated','media_changed','settings_changed','data_imported'];
const MERGE_SECONDS=600;
/** The address with its last part hidden, as PHP's mikanBoxMaskedIp(). */
function maskedIp(request?:Request):string{
  const ip=request?.headers.get('CF-Connecting-IP')||'';
  if(/^\d+\.\d+\.\d+\.\d+$/.test(ip))return ip.replace(/\.\d+$/,'.x');
  if(ip.includes(':'))return ip.split(':').slice(0,3).join(':')+':…';
  return '';
}
const clean=(value:unknown)=>{const text=String(value??'');return /^[A-Za-z0-9_\/.:@,-]{0,200}$/.test(text)?text:'';};
type Stored={id:number;at:string;event:string;actor:string;target:string;from_value:string;ip:string;before_hash:string;after_hash:string};
/** The record just before $id, when it is the same change continuing. */
async function mergeTarget(env:Env,id:number|null,row:{event:string;target:string;actor:string;ip:string;at:string}):Promise<Stored|null>{
  if(!MERGED_EVENTS.includes(row.event))return null;
  const last=await env.DB.prepare(`SELECT * FROM audit_events ${id===null?'':'WHERE id<?'} ORDER BY id DESC LIMIT 1`).bind(...(id===null?[]:[id])).first<Stored>();
  if(!last||last.event!==row.event||last.target!==row.target||last.actor!==row.actor||last.ip!==row.ip)return null;
  return Date.parse(row.at)-Date.parse(last.at)<=MERGE_SECONDS*1000?last:null;
}
/** Records an operation. A failure to record never stops the operation itself. */
export async function audit(env:Env,event:AuditEvent,details:{actor?:string;target?:string;from?:string;to?:string;request?:Request}={}):Promise<void>{
  try{
    const row={at:new Date().toISOString(),event,actor:String(details.actor||'system').slice(0,80),target:clean(details.target),ip:maskedIp(details.request)};
    const last=await mergeTarget(env,null,row);
    if(last){await env.DB.prepare('UPDATE audit_events SET at=? WHERE id=?').bind(row.at,last.id).run();return;}
    await env.DB.prepare('INSERT INTO audit_events(at,event,actor,target,from_value,to_value,ip) VALUES(?,?,?,?,?,?,?)')
      .bind(row.at,event,row.actor,row.target,clean(details.from),clean(details.to),row.ip).run();
  }catch{}
}
/** The newest record id, taken before a request that may change the site. */
export async function auditMark(env:Env):Promise<number>{
  try{return Number(await env.DB.prepare('SELECT COALESCE(MAX(id),0) n FROM audit_events').first('n'))||0;}catch{return 0;}
}
async function sha256(text:string):Promise<string>{
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** sha256 of what is stored now for the item a record names ('' when it is gone). */
async function currentHash(env:Env,row:Stored):Promise<string>{
  if(row.event.endsWith('_deleted'))return '';
  if(row.event.startsWith('media_'))return row.after_hash;
  const [sql,key]=row.event.startsWith('page_')?['SELECT data v FROM posts WHERE id=?',row.target]:row.event.startsWith('component_')?['SELECT data v FROM components WHERE id=?',row.target]
    :row.event==='settings_changed'?['SELECT value v FROM settings WHERE key=?',row.target==='cloud_connection'?'cloud_connection':'settings']:['',''];
  if(!sql)return '';
  const value=await env.DB.prepare(sql).bind(key).first<string>('v');
  return typeof value==='string'?sha256(value):'';
}
/**
 * The database records each change by itself, without knowing who made it. After a request, its records
 * get the person (or MCP), the address and the content's sha256 before and after; repeated saves merge.
 */
export async function claimAudit(env:Env,since:number,request:Request,actorOf:()=>Promise<string>):Promise<void>{
  try{
    const rows=(await env.DB.prepare("SELECT * FROM audit_events WHERE id>? AND actor='' ORDER BY id").bind(since).all<Stored>()).results;
    if(!rows.length)return;
    const actor=(await actorOf().catch(()=>''))||'system',ip=maskedIp(request);
    for(const row of rows){
      const kind=row.event.split('_')[0],target=row.from_value&&row.event!=='page_status'?row.from_value:row.target;
      const after=await currentHash(env,row);
      let before=row.before_hash;
      if(!before&&!row.event.endsWith('_created')&&row.event!=='media_uploaded')
        before=String(await env.DB.prepare("SELECT after_hash h FROM audit_events WHERE id<? AND target=? AND substr(event,1,?)=? AND after_hash<>'' ORDER BY id DESC LIMIT 1").bind(row.id,target,kind.length+1,kind+'_').first('h')??'');
      const last=await mergeTarget(env,row.id,{...row,actor,ip});
      if(last){
        await env.DB.batch([env.DB.prepare('UPDATE audit_events SET at=?,after_hash=? WHERE id=?').bind(row.at,after,last.id),env.DB.prepare('DELETE FROM audit_events WHERE id=?').bind(row.id)]);
        continue;
      }
      await env.DB.prepare('UPDATE audit_events SET actor=?,ip=?,before_hash=?,after_hash=? WHERE id=?').bind(actor.slice(0,80),ip,before,after,row.id).run();
    }
  }catch{}
}
/** Kept per group by the trigger audit_events_keep: important 50, site edits 500, failed sign-ins 50. */
export async function recentAudit(env:Env):Promise<AuditRow[]>{
  try{return (await env.DB.prepare('SELECT at,event,actor,target,from_value,to_value,ip FROM audit_events ORDER BY id DESC LIMIT 600').all<AuditRow>()).results;}catch{return [];}
}
