import type {Env} from './types';
/** The events PHP records (lib/security.php mikanBoxAudit), those the Cloud edition has, plus data restores. */
export const AUDIT_EVENTS=['mcp_enabled','mcp_disabled','mcp_key_issued','mcp_key_rotated','page_status','login_failed','device_registered','device_revoked','code_issued','invite_issued','recovery','user_deleted','data_restored'] as const;
export type AuditEvent=typeof AUDIT_EVENTS[number];
export interface AuditRow {at:string;event:string;actor:string;target:string;from_value:string;to_value:string;ip:string}
/** The address with its last part hidden, as PHP's mikanBoxMaskedIp(). */
function maskedIp(request?:Request):string{
  const ip=request?.headers.get('CF-Connecting-IP')||'';
  if(/^\d+\.\d+\.\d+\.\d+$/.test(ip))return ip.replace(/\.\d+$/,'.x');
  if(ip.includes(':'))return ip.split(':').slice(0,3).join(':')+':…';
  return '';
}
const clean=(value:unknown)=>{const text=String(value??'');return /^[A-Za-z0-9_\/.:@-]{0,200}$/.test(text)?text:'';};
/** Records an operation. A failure to record never stops the operation itself. */
export async function audit(env:Env,event:AuditEvent,details:{actor?:string;target?:string;from?:string;to?:string;request?:Request}={}):Promise<void>{
  try{
    await env.DB.prepare('INSERT INTO audit_events(at,event,actor,target,from_value,to_value,ip) VALUES(?,?,?,?,?,?,?)')
      .bind(new Date().toISOString(),event,String(details.actor||'system').slice(0,80),clean(details.target),clean(details.from),clean(details.to),maskedIp(details.request)).run();
  }catch{}
}
export async function recentAudit(env:Env):Promise<AuditRow[]>{
  try{return (await env.DB.prepare('SELECT at,event,actor,target,from_value,to_value,ip FROM audit_events ORDER BY id DESC LIMIT 50').all<AuditRow>()).results;}catch{return [];}
}
