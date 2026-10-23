import type {Env} from './types';
import {loadSettings,saveSettings} from './storage';
// Device authentication: no passwords. A browser holds a random session token in an
// HttpOnly cookie; D1 keeps only its SHA-256. Entry is limited to SETUP_TOKEN (first
// device and recovery) and one-time codes issued from an already trusted device.
export const DEVICE_COOKIE='device_session';
export const EXPIRY_CHOICES=[30,90,180] as const;
export const CODE_HOURS=3;
// A device younger than this cannot stop other devices, so a stolen add code cannot
// be used to lock the original owner out before they notice the new device.
export const PROBATION_DAYS=3;
const DAY=86400_000,RENEW_EVERY=3600_000;
export interface Device {id:string;username:string;name:string;created_at:number;last_used_at:number;expires_at:number;revoked_at:number|null;seen_until:number;user_agent:string}
export interface DeviceCode {code_hash:string;username:string;display_name:string;created_by:string;created_at:number;expires_at:number;used_at:number|null}
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
export const sha256=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
function randomToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function hmac(secret:string,text:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))).slice(0,32);}
export async function expiryDays(env:Env){const days=Number((await loadSettings(env)).device_expiry_days);return (EXPIRY_CHOICES as readonly number[]).includes(days)?days:30;}
export function deviceCookie(token:string){return `${DEVICE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400*86400}`;}
export function clearDeviceCookie(){return `${DEVICE_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;}
function readCookie(request:Request){return request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([A-Za-z0-9_-]{43})(?:;|$)`))?.[1]||null;}

export async function createDevice(env:Env,username:string,name:string,request:Request){
 const token=randomToken(),now=Date.now(),id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO device_sessions(id,username,token_hash,name,created_at,last_used_at,expires_at,seen_until,user_agent) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(id,username,await sha256(token),deviceName(name),now,now,now+await expiryDays(env)*DAY,now,(request.headers.get('User-Agent')||'').slice(0,200)).run();
 return {id,cookie:deviceCookie(token)};
}
const deviceName=(name:string)=>name.trim().slice(0,60)||'—';

/** The signed-in device, renewed while in use. The CSRF token is derived from the session, not stored. */
export async function deviceSession(request:Request,env:Env){
 const token=readCookie(request);if(!token)return null;
 const hash=await sha256(token),now=Date.now();
 const device=await env.DB.prepare('SELECT d.* FROM device_sessions d JOIN users u ON u.username=d.username WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>?').bind(hash,now).first<Device>();
 if(!device)return null;
 if(now-device.last_used_at>RENEW_EVERY)await env.DB.prepare('UPDATE device_sessions SET last_used_at=?,expires_at=? WHERE id=? AND revoked_at IS NULL').bind(now,now+await expiryDays(env)*DAY,device.id).run();
 return {device,csrf:await hmac(env.JWT_SECRET,'csrf:'+hash)};
}

// ---- One-time codes for adding a device or inviting a user ----
const ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const normalizeCode=(code:string)=>code.toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
export async function issueCode(env:Env,creator:Device,invite?:{username:string;display_name:string}){
 const bytes=crypto.getRandomValues(new Uint8Array(10));let code='';for(const b of bytes)code+=ALPHABET[b&31];
 if(invite&&(!/^[A-Za-z0-9_-]{1,80}$/.test(invite.username)||!invite.display_name.trim()||invite.display_name.length>120))throw new Error('ユーザー名・表示名を確認してください。 / Check username and display name.');
 if(invite&&await env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(invite.username).first())throw new Error('そのユーザー名は使われています。 / That username is taken.');
 const now=Date.now();
 await env.DB.prepare('INSERT INTO device_codes(code_hash,username,display_name,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)')
  .bind(await sha256(code),invite?.username||creator.username,invite?.display_name.trim()||'',creator.id,now,now+CODE_HOURS*3600_000).run();
 return code.slice(0,5)+'-'+code.slice(5);
}
/** Use a code once. An invite code creates its user; a plain code adds a device for the issuer's user. */
export async function claimCode(env:Env,code:string,name:string,request:Request){
 const hash=await sha256(normalizeCode(code)),now=Date.now();
 const row=await env.DB.prepare('SELECT * FROM device_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?').bind(hash,now).first<DeviceCode>();
 if(!row)return null;
 const used=await env.DB.prepare('UPDATE device_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL').bind(now,hash).run();
 if(!used.meta.changes)return null;
 // An invite must create its own user; never attach a device to an account that appeared meanwhile.
 if(row.display_name&&!(await env.DB.prepare("INSERT INTO users(username,display_name,password_hash,auth_version) VALUES(?,?,'',1) ON CONFLICT(username) DO NOTHING").bind(row.username,row.display_name).run()).meta.changes)return null;
 if(!await env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(row.username).first())return null;
 return createDevice(env,row.username,name,request);
}
export async function listCodes(env:Env){return (await env.DB.prepare('SELECT * FROM device_codes WHERE used_at IS NULL AND expires_at>? ORDER BY created_at').bind(Date.now()).all<DeviceCode>()).results;}
export async function cancelCode(env:Env,hash:string){await env.DB.prepare('DELETE FROM device_codes WHERE code_hash=? AND used_at IS NULL').bind(hash).run();}

// ---- Device list ----
export async function listDevices(env:Env){return (await env.DB.prepare('SELECT * FROM device_sessions WHERE revoked_at IS NULL AND expires_at>? ORDER BY created_at').bind(Date.now()).all<Device>()).results;}
export function onProbation(device:Device){return Date.now()-device.created_at<PROBATION_DAYS*DAY;}
export async function revokeDevice(env:Env,actor:Device,id:string){
 if(id!==actor.id&&onProbation(actor))throw new Error(`追加から${PROBATION_DAYS}日間は、ほかの端末を止められません。 / A device added within ${PROBATION_DAYS} days cannot stop other devices.`);
 await env.DB.prepare('UPDATE device_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),id).run();
}
/** Devices registered since this one last looked, then mark them seen. */
export async function unseenDevices(env:Env,device:Device){
 const rows=(await env.DB.prepare('SELECT * FROM device_sessions WHERE created_at>? AND id<>? AND revoked_at IS NULL ORDER BY created_at').bind(device.seen_until,device.id).all<Device>()).results;
 if(rows.length)await env.DB.prepare('UPDATE device_sessions SET seen_until=? WHERE id=?').bind(Date.now(),device.id).run();
 return rows;
}
export async function setExpiryDays(env:Env,days:number){
 if(!(EXPIRY_CHOICES as readonly number[]).includes(days))throw new Error('Invalid expiry.');
 const settings=await loadSettings(env);settings.device_expiry_days=days;if(!await saveSettings(env,settings))throw new Error('Settings changed; retry.');
}

// ---- SETUP_TOKEN: first device and recovery ----
/** Each SETUP_TOKEN value works once. Recovery means setting a new value with wrangler. */
export async function setupTokenUsable(env:Env,token:string){
 if(!env.SETUP_TOKEN||token.length!==env.SETUP_TOKEN.length)return false;
 let diff=0;for(let i=0;i<token.length;i++)diff|=token.charCodeAt(i)^env.SETUP_TOKEN.charCodeAt(i);
 if(diff)return false;
 const used=await env.DB.prepare("SELECT value FROM settings WHERE key='setup_token_used'").first<{value:string}>();
 return used?.value!==await sha256(env.SETUP_TOKEN);
}
/** Recovery starts over: every device, unused code and the MCP key are cleared. */
export async function consumeSetupToken(env:Env,recovery:boolean){
 const statements=[env.DB.prepare("INSERT INTO settings(key,value) VALUES('setup_token_used',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(await sha256(env.SETUP_TOKEN))];
 if(recovery)statements.push(env.DB.prepare('UPDATE device_sessions SET revoked_at=? WHERE revoked_at IS NULL').bind(Date.now()),env.DB.prepare('DELETE FROM device_codes'),env.DB.prepare('DELETE FROM edit_locks'));
 await env.DB.batch(statements);
 if(recovery){const settings=await loadSettings(env);if(settings.api_key){settings.api_key='';await saveSettings(env,settings);}}
}
