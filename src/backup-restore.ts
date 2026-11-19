import type {Env,Settings} from './types';
import {validId} from './validation';
import {validMediaName,isCodeMedia,CODE_MEDIA_TYPES,MEDIA_FILE_LIMIT,MEDIA_COUNT_LIMIT} from './media-policy';

type Row=Record<string,unknown>;
export interface BackupMedia {key:string;content_type:string;size:number;uploaded:string;etag:string|null;source?:string|null;}
/** The backup ZIP's data/backup.json. revisions_included=false: saved without history (restoring it leaves history empty). */
export interface CloudBackupManifest {format:'mikanbox-cloud-json';version:3;created_at:string;revisions_included?:boolean;settings:Settings;pages:Row[];components:Row[];users:Row[];revisions:Row[];static_pages:Row[];media:BackupMedia[];}
const MAX_DOCUMENT=20_000_000, SESSION_AGE=24*60*60*1000;
function fail(message:string):never {throw new Error(message);}
function jsonBytes(value:unknown):number{return new TextEncoder().encode(JSON.stringify(value)).length;}
async function rows(env:Env,sql:string):Promise<Row[]>{return (await env.DB.prepare(sql).all<Row>()).results;}
/** The MCP API key never leaves in a backup (0.10.3); a restore keeps the installation's current key. */
function withoutApiKey(settings:Record<string,unknown>):Record<string,unknown>{const copy={...settings};if('api_key' in copy)copy.api_key='';return copy;}
/** What is downloaded: the snapshot without the MCP API key. */
export async function exportBackupManifest(env:Env,options:{revisions?:boolean}={}):Promise<CloudBackupManifest>{
 const manifest=await snapshotManifest(env),revisions=options.revisions!==false;
 return {...manifest,version:3,revisions_included:revisions,revisions:revisions?manifest.revisions:[],settings:withoutApiKey(manifest.settings as Record<string,unknown>)} as CloudBackupManifest;
}
/** The complete snapshot, used internally to detect concurrent changes during a restore. */
async function snapshotManifest(env:Env):Promise<CloudBackupManifest>{
 const [settings,pages,components,users,revisions,static_pages,media]=await Promise.all([
 rows(env,"SELECT value FROM settings WHERE key='settings'"),rows(env,'SELECT * FROM posts ORDER BY id'),rows(env,'SELECT * FROM components ORDER BY id'),rows(env,'SELECT * FROM users ORDER BY username'),rows(env,'SELECT * FROM post_revisions ORDER BY id'),rows(env,'SELECT id,html,built_at,path,md FROM static_pages ORDER BY id'),rows(env,'SELECT key,content_type,size,uploaded,etag,source FROM media ORDER BY key')]);
 const result:CloudBackupManifest={format:'mikanbox-cloud-json',version:3,created_at:new Date().toISOString(),settings:settings[0]?JSON.parse(String(settings[0].value)):{},pages,components,users,revisions,static_pages,media:media as unknown as BackupMedia[]};
 if(jsonBytes(result)>MAX_DOCUMENT)fail('Backup metadata exceeds 20 MB; split content before export.');return result;
}
/** Call after the browser has read every media file from the public site. A changed source invalidates the export. */
export async function validateExportSnapshot(env:Env,manifest:CloudBackupManifest):Promise<void>{
 validate(manifest);const current=await exportBackupManifest(env,{revisions:manifest.revisions_included!==false});
 for(const key of ['settings','pages','components','users','revisions','static_pages','media'] as const)
 if(JSON.stringify(current[key])!==JSON.stringify(manifest[key]))fail('Content changed during backup export; restart export.');
}
function validate(document:CloudBackupManifest){
 if(!document||document.format!=='mikanbox-cloud-json'||document.version!==3||jsonBytes(document)>MAX_DOCUMENT)fail('Unsupported or oversized backup.');
 if(!document.settings||typeof document.settings!=='object'||Array.isArray(document.settings)||jsonBytes(document.settings)>800_000)fail('Invalid backup settings.');
 for(const list of [document.pages,document.components,document.users,document.revisions,document.static_pages,document.media])if(!Array.isArray(list))fail('Incomplete backup.');
 const unique=(list:Row[],key:string)=>{const s=new Set();for(const r of list){if(!r||typeof r!=='object'||s.has(r[key]))fail('Duplicate or invalid backup record.');s.add(r[key]);if(jsonBytes(r)>900_000)fail('Backup record exceeds D1 value limit.');}};
 for(const [list,key] of [[document.pages,'id'],[document.components,'id'],[document.users,'username'],[document.revisions,'id'],[document.static_pages,'id'],[document.media,'key']] as [Row[],string][])unique(list,key);
 for(const p of document.pages){if(typeof p.id!=='string'||!validId(p.id))fail('Invalid page ID.');let d;try{d=JSON.parse(String(p.data));}catch{fail('Invalid page JSON.');}if(!['public','public_static','public_dynamic','pending','draft','db'].includes(String(p.status))||d.status!==p.status||typeof d.title!=='string')fail('Invalid page data.');}
 for(const c of document.components){if(typeof c.id!=='string'||!validId(c.id,true))fail('Invalid component ID.');let d;try{d=JSON.parse(String(c.data));}catch{fail('Invalid component JSON.');}if(typeof d.html!=='string')fail('Invalid component data.');}
 for(const u of document.users)if(typeof u.username!=='string'||!u.username||typeof u.display_name!=='string')fail('Invalid account data.');
 for(const r of document.revisions){if(!Number.isSafeInteger(r.id)||Number(r.id)<1||typeof r.post_id!=='string'||!validId(r.post_id)||typeof r.data!=='string'||typeof r.editor_id!=='string'||typeof r.created_at!=='string')fail('Invalid revision.');try{JSON.parse(r.data);}catch{fail('Invalid revision JSON.');}}
 for(const p of document.static_pages)if(typeof p.id!=='string'||!validId(p.id)||typeof p.html!=='string'||typeof p.built_at!=='string'||(p.path!==undefined&&p.path!==null&&typeof p.path!=='string')||(p.md!==undefined&&p.md!==null&&typeof p.md!=='string'))fail('Invalid static snapshot.');
 for(const m of document.media){if(!validMediaName(m.key)||(isCodeMedia(m.key)&&CODE_MEDIA_TYPES[m.key.split('.').pop()!.toLowerCase()]!==m.content_type)||!Number.isInteger(m.size)||m.size<1||m.size>MEDIA_FILE_LIMIT||!['image/png','image/jpeg','image/gif','image/webp','image/svg+xml',...Object.values(CODE_MEDIA_TYPES)].includes(m.content_type)||typeof m.uploaded!=='string'||typeof m.etag!=='string'||!/^[a-f0-9]{64}$/.test(m.etag))fail('Invalid image metadata.');}
 if(document.media.length>MEDIA_COUNT_LIMIT)fail('Backup exceeds the file limit.');
}
function records(d:CloudBackupManifest):Array<{kind:string;id:string;value:string}>{
 const out:Array<{kind:string;id:string;value:string}>=[];
 for(const [kind,list,key] of [['posts',d.pages,'id'],['components',d.components,'id'],['users',d.users,'username'],['post_revisions',d.revisions,'id'],['static_pages',d.static_pages,'id'],['media',d.media,'key']] as [string,Row[],string][])
 for(const r of list)out.push({kind,id:String(r[key]),value:JSON.stringify(r)});
 out.push({kind:'settings',id:'settings',value:JSON.stringify({value:JSON.stringify(d.settings)})});return out;
}
export async function createBackupRestore(env:Env,document:CloudBackupManifest,options:{restoreUsers?:boolean}={}):Promise<string>{
 validate(document);if(options.restoreUsers&&!document.users.length)fail('Restoring accounts requires at least one account.');
 await env.DB.prepare('DELETE FROM backup_sessions WHERE created_at<?').bind(Date.now()-SESSION_AGE).run();
 await env.DB.prepare('DELETE FROM backup_restore_results WHERE created_at<?').bind(Date.now()-SESSION_AGE).run();
 const current=await snapshotManifest(env);
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO backup_sessions(id,created_at,restore_users) VALUES(?,?,?)').bind(id,Date.now(),options.restoreUsers?1:0).run();
 try{for(const [phase,d] of [['before',current],['restore',document]] as const){const all=records(d);let group:typeof all=[];let size=0;const flush=async()=>{if(!group.length)return;await env.DB.prepare(`INSERT INTO backup_records(session_id,phase,kind,record_id,value) SELECT ?,?,json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.value') FROM json_each(?)`).bind(id,phase,JSON.stringify(group)).run();group=[];size=0;};for(const r of all){const added=jsonBytes(r)+1;if(added>1_500_000)fail('Backup record exceeds D1 staging value limit.');if(size+added>1_500_000)await flush();group.push(r);size+=added;}await flush();}}catch(e){await abortBackupRestore(env,id);throw e;}return id;
}
async function session(env:Env,id:string){const s=await env.DB.prepare('SELECT * FROM backup_sessions WHERE id=? AND created_at>=?').bind(id,Date.now()-SESSION_AGE).first<{restore_users:number}>();if(!s)fail('Restore session expired or missing.');return s;}
export async function abortBackupRestore(env:Env,id:string):Promise<void>{await env.DB.prepare('DELETE FROM backup_sessions WHERE id=?').bind(id).run();}
export async function commitBackupRestore(env:Env,id:string):Promise<{pages:number;components:number;images:number;accountsRestored:boolean}>{
 const completed=await env.DB.prepare('SELECT result FROM backup_restore_results WHERE id=?').bind(id).first<{result:string}>();
 if(completed)return JSON.parse(completed.result);
 const s=await session(env,id);
 const desired=(await env.DB.prepare("SELECT kind,record_id,value FROM backup_records WHERE session_id=? AND phase='restore'").bind(id).all<Row>()).results;
 const settingsRecord=desired.find(r=>r.kind==='settings');if(!settingsRecord)fail('Incomplete restore session.');
 const existing=await env.DB.prepare("SELECT value FROM settings WHERE key='settings'").first<{value:string}>();const current:Settings=existing?JSON.parse(existing.value):{};
 const restored:Settings=JSON.parse(JSON.parse(String(settingsRecord.value)).value);
 for(const key of ['site_id','api_key']){if(Object.hasOwn(current,key))restored[key]=current[key];else delete restored[key];}
 const columns:Record<string,string[]>={posts:['id','data','status','sort_order','updated_at'],components:['id','data','is_wrapper'],users:['username','display_name','auth_version'],post_revisions:['id','post_id','data','created_at','editor_id'],static_pages:['id','html','built_at','path','md'],media:['key','content_type','size','uploaded','etag']};
 const comparisons=Object.entries(columns).map(([table,fields])=>`((SELECT COUNT(*) FROM ${table})=(SELECT COUNT(*) FROM backup_records WHERE session_id=? AND phase='before' AND kind='${table}') AND NOT EXISTS(SELECT 1 FROM ${table} t WHERE NOT EXISTS(SELECT 1 FROM backup_records r WHERE r.session_id=? AND r.phase='before' AND r.kind='${table}' AND ${fields.map(c=>`t.${c} IS json_extract(r.value,'$.${c}')`).join(' AND ')})))`);
 const binds:unknown[]=[];for(const _ of comparisons)binds.push(id,id);
 const guard=`INSERT INTO backup_commit_guard(session_id,valid) SELECT ?,CASE WHEN ${comparisons.join(' AND ')} AND json(COALESCE((SELECT value FROM settings WHERE key='settings'),'{}'))=json((SELECT json_extract(value,'$.value') FROM backup_records WHERE session_id=? AND phase='before' AND kind='settings')) THEN 1 ELSE 0 END`;
 const statements=[env.DB.prepare(guard).bind(id,...binds,id)];
 for(const table of ['media','post_revisions','static_pages','posts','components','edit_locks','visual_history','visual_sessions'])statements.push(env.DB.prepare('DELETE FROM '+table));
 const input=(kind:string)=>`SELECT value FROM backup_records WHERE session_id=? AND phase='restore' AND kind='${kind}'`;
 for(const table of ['posts','components','post_revisions']){const fields=columns[table];statements.push(env.DB.prepare(`INSERT INTO ${table}(${fields.join(',')}) SELECT ${fields.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM (${input(table)})`).bind(id));}
 // Pages saved with the former "DB" status become public pages with the output format "mikanBox DB".
 statements.push(env.DB.prepare(`UPDATE posts SET status='public_static',data=json_set(json_remove(data,'$.expand_tags'),'$.status','public_static','$.output_format','db') WHERE status='db'`));
 statements.push(env.DB.prepare(`INSERT INTO static_pages(id,html,built_at,path,md) SELECT json_extract(r.value,'$.id'),json_extract(r.value,'$.html'),json_extract(r.value,'$.built_at'),json_extract(r.value,'$.path'),json_extract(r.value,'$.md') FROM backup_records r JOIN posts p ON p.id=json_extract(r.value,'$.id') AND p.status='public_static' WHERE r.session_id=? AND r.phase='restore' AND r.kind='static_pages'`).bind(id));
 // The files go back to the public site with the publication the browser runs right after (from the backup file).
 statements.push(env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,etag,hash) SELECT record_id,json_extract(value,'$.content_type'),json_extract(value,'$.size'),json_extract(value,'$.uploaded'),json_extract(value,'$.etag'),substr(json_extract(value,'$.etag'),1,32) FROM backup_records WHERE session_id=? AND phase='restore' AND kind='media'`).bind(id));
 statements.push(env.DB.prepare("INSERT INTO settings(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(restored)));
 if(s.restore_users){const generation=crypto.getRandomValues(new Uint32Array(1))[0]+Date.now();statements.push(env.DB.prepare('DELETE FROM users'));statements.push(env.DB.prepare(`INSERT INTO users(username,display_name,auth_version) SELECT json_extract(value,'$.username'),json_extract(value,'$.display_name'),? FROM (${input('users')})`).bind(generation,id));statements.push(env.DB.prepare('DELETE FROM login_attempts'));}
 // Older backups may hold dynamic pages; the Cloud edition publishes them statically.
 statements.push(env.DB.prepare("UPDATE posts SET status='public_static',data=json_set(data,'$.status','public_static') WHERE status IN ('public','public_dynamic')"));
 // Devices of users absent from the restored set stop for good, and pending codes are dropped.
 if(s.restore_users)statements.push(env.DB.prepare('UPDATE device_sessions SET revoked_at=? WHERE revoked_at IS NULL AND username NOT IN (SELECT username FROM users)').bind(Date.now()),env.DB.prepare('DELETE FROM device_codes'));
 const result={pages:desired.filter(r=>r.kind==='posts').length,components:desired.filter(r=>r.kind==='components').length,images:desired.filter(r=>r.kind==='media').length,accountsRestored:!!s.restore_users};
 statements.push(env.DB.prepare("INSERT INTO backup_restore_results(id,owner,result,created_at) SELECT id,COALESCE(owner,''),?,? FROM backup_sessions WHERE id=?").bind(JSON.stringify(result),Date.now(),id));
 statements.push(env.DB.prepare('DELETE FROM backup_sessions WHERE id=?').bind(id));statements.push(env.DB.prepare('DELETE FROM backup_commit_guard WHERE session_id=?').bind(id));
 try{await env.DB.batch(statements);}catch{
  let receipt;try{receipt=await env.DB.prepare('SELECT result FROM backup_restore_results WHERE id=?').bind(id).first<{result:string}>();}catch{fail('Restore result could not be confirmed. Reload and check the content before retrying.');}
  if(receipt)return JSON.parse(receipt.result);
  fail('Restore not applied or completion not yet confirmed. Retry the same operation or reload and check the content.');
 }
 return result;
}
