import {mediaStorageMode,assertMediaUnlocked,MEDIA_UNLOCKED_SQL,MEDIA_MODE_SQL} from './media-mode';
import {mediaBucket,putImmutableImage,discardImage} from './r2-media';
import type {Env,Settings} from './types';
import {validId} from './validation';
import {validMediaName,imageType,mediaType,isCodeMedia,CODE_MEDIA_TYPES,MEDIA_CHUNK_SIZE,MEDIA_FILE_LIMIT,MEDIA_TOTAL_LIMIT,MEDIA_COUNT_LIMIT} from './media-policy';

type Row=Record<string,unknown>;
export interface BackupMedia {key:string;content_type:string;size:number;uploaded:string;etag:string|null;chunk_count:number;upload_id?:string|null;object_key?:string|null;}
export interface CloudBackupManifest {format:'mikanbox-cloud-json';version:1|2;created_at:string;settings:Settings;pages:Row[];components:Row[];users:Row[];revisions:Row[];static_pages:Row[];media:BackupMedia[];}
export interface BackupMediaPart {key:string;index:number;content_base64:string;sha256:string;}
const MAX_DOCUMENT=20_000_000, SESSION_AGE=24*60*60*1000;
function fail(message:string):never {throw new Error(message);}
function jsonBytes(value:unknown):number{return new TextEncoder().encode(JSON.stringify(value)).length;}
function bytes(value:unknown):Uint8Array {return value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):Uint8Array.from(value as number[]);}
function encode(value:Uint8Array):string {let s='';for(let i=0;i<value.length;i+=32768)s+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(s);}
function decode(s:string):Uint8Array {if(typeof s!=='string'||s.length>Math.ceil(MEDIA_CHUNK_SIZE/3)*4||s.length%4)fail('Invalid image part.');let v:string;try{v=atob(s);}catch{fail('Invalid image base64.');}const b=Uint8Array.from(v!,c=>c.charCodeAt(0));if(encode(b)!==s)fail('Invalid image base64.');return b;}
async function hash(b:Uint8Array):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');}
async function rows(env:Env,sql:string):Promise<Row[]>{return (await env.DB.prepare(sql).all<Row>()).results;}
export async function exportBackupManifest(env:Env):Promise<CloudBackupManifest>{
 const [settings,pages,components,users,revisions,static_pages,media]=await Promise.all([
 rows(env,"SELECT value FROM settings WHERE key='settings'"),rows(env,'SELECT * FROM posts ORDER BY id'),rows(env,'SELECT * FROM components ORDER BY id'),rows(env,'SELECT * FROM users ORDER BY username'),rows(env,'SELECT * FROM post_revisions ORDER BY id'),rows(env,'SELECT * FROM static_pages ORDER BY id'),rows(env,'SELECT key,content_type,size,uploaded,etag,chunk_count,upload_id,object_key FROM media ORDER BY key')]);
 const result:CloudBackupManifest={format:'mikanbox-cloud-json',version:2,created_at:new Date().toISOString(),settings:settings[0]?JSON.parse(String(settings[0].value)):{},pages,components,users,revisions,static_pages,media:media.map(r=>({...r,chunk_count:Math.ceil(Number(r.size)/MEDIA_CHUNK_SIZE)} as unknown as BackupMedia))};
 if(jsonBytes(result)>MAX_DOCUMENT)fail('Backup metadata exceeds 20 MB; split content before export.');return result;
}
/** Call after downloading every media part. A changed source invalidates the entire export. */
export async function validateExportSnapshot(env:Env,manifest:CloudBackupManifest):Promise<void>{
 validate(manifest);const current=await exportBackupManifest(env);
 for(const key of ['settings','pages','components','users','revisions','static_pages','media'] as const)
 if(JSON.stringify(current[key])!==JSON.stringify(manifest[key]))fail('Content changed during backup export; restart export.');
}
export async function exportBackupMediaPart(env:Env,key:string,index:number,expected?:Pick<BackupMedia,'upload_id'|'etag'|'size'|'uploaded'>):Promise<BackupMediaPart>{
 if(!validMediaName(key)||!Number.isInteger(index)||index<0)fail('Invalid image part.');
 const row=await env.DB.prepare('SELECT size,object_key,upload_id,etag,uploaded FROM media WHERE key=?').bind(key).first<{size:number;object_key:string|null;upload_id:string|null;etag:string;uploaded:string}>();
 if(!row||index>=Math.ceil(row.size/MEDIA_CHUNK_SIZE))fail('Image part not found.');
 if(expected&&(row.upload_id!==expected.upload_id||row.etag!==expected.etag||row.size!==expected.size||row.uploaded!==expected.uploaded))fail('Image changed during backup export; restart export.');
 if(!row.object_key){
  let b:Uint8Array;
  if(row.upload_id){const part=await env.DB.prepare('SELECT data FROM media_chunks WHERE upload_id=? AND chunk_index=?').bind(row.upload_id,index).first<{data:unknown}>();if(!part)fail('Image part missing.');b=bytes(part.data);}
  else{const legacy=await env.DB.prepare('SELECT data FROM media WHERE key=?').bind(key).first<{data:string}>();if(!legacy)fail('Image missing.');b=Uint8Array.from(atob(legacy.data),c=>c.charCodeAt(0)).slice(index*MEDIA_CHUNK_SIZE,(index+1)*MEDIA_CHUNK_SIZE);}
  return {key,index,content_base64:encode(b),sha256:await hash(b)};
 }
 const object=await mediaBucket(env).get(row.object_key,{range:{offset:index*MEDIA_CHUNK_SIZE,length:Math.min(MEDIA_CHUNK_SIZE,row.size-index*MEDIA_CHUNK_SIZE)}});if(!object)fail('Image part missing.');
 const b=new Uint8Array(await object.arrayBuffer());if(b.length!==Math.min(MEDIA_CHUNK_SIZE,row.size-index*MEDIA_CHUNK_SIZE))fail('Image part size mismatch.');
 return {key,index,content_base64:encode(b),sha256:await hash(b)};
}
function validate(document:CloudBackupManifest){
 if(!document||document.format!=='mikanbox-cloud-json'||![1,2].includes(document.version)||jsonBytes(document)>MAX_DOCUMENT)fail('Unsupported or oversized backup.');
 if(!document.settings||typeof document.settings!=='object'||Array.isArray(document.settings)||jsonBytes(document.settings)>800_000)fail('Invalid backup settings.');
 for(const list of [document.pages,document.components,document.users,document.revisions,document.static_pages,document.media])if(!Array.isArray(list))fail('Incomplete backup.');
 const unique=(list:Row[],key:string)=>{const s=new Set();for(const r of list){if(!r||typeof r!=='object'||s.has(r[key]))fail('Duplicate or invalid backup record.');s.add(r[key]);if(jsonBytes(r)>900_000)fail('Backup record exceeds D1 value limit.');}};
 for(const [list,key] of [[document.pages,'id'],[document.components,'id'],[document.users,'username'],[document.revisions,'id'],[document.static_pages,'id'],[document.media,'key']] as [Row[],string][])unique(list,key);
 for(const p of document.pages){if(typeof p.id!=='string'||!validId(p.id))fail('Invalid page ID.');let d;try{d=JSON.parse(String(p.data));}catch{fail('Invalid page JSON.');}if(!['public','public_static','public_dynamic','pending','draft','db'].includes(String(p.status))||d.status!==p.status||typeof d.title!=='string')fail('Invalid page data.');}
 for(const c of document.components){if(typeof c.id!=='string'||!validId(c.id,true))fail('Invalid component ID.');let d;try{d=JSON.parse(String(c.data));}catch{fail('Invalid component JSON.');}if(typeof d.html!=='string')fail('Invalid component data.');}
 for(const u of document.users)if(typeof u.username!=='string'||!u.username||typeof u.display_name!=='string'||typeof u.password_hash!=='string'||!u.password_hash)fail('Invalid account data.');
 for(const r of document.revisions){if(!Number.isSafeInteger(r.id)||Number(r.id)<1||typeof r.post_id!=='string'||!validId(r.post_id)||typeof r.data!=='string'||typeof r.editor_id!=='string'||typeof r.created_at!=='string')fail('Invalid revision.');try{JSON.parse(r.data);}catch{fail('Invalid revision JSON.');}}
 for(const p of document.static_pages)if(typeof p.id!=='string'||!validId(p.id)||typeof p.html!=='string'||typeof p.built_at!=='string')fail('Invalid static snapshot.');
 let total=0;for(const m of document.media){if(!validMediaName(m.key)||(isCodeMedia(m.key)&&CODE_MEDIA_TYPES[m.key.split('.').pop()!.toLowerCase()]!==m.content_type)||!Number.isInteger(m.size)||m.size<1||m.size>MEDIA_FILE_LIMIT||m.chunk_count!==Math.ceil(m.size/MEDIA_CHUNK_SIZE)||!['image/png','image/jpeg','image/gif','image/webp','image/svg+xml',...Object.values(CODE_MEDIA_TYPES)].includes(m.content_type)||typeof m.uploaded!=='string')fail('Invalid image metadata.');total+=m.size;}
 if(total>MEDIA_TOTAL_LIMIT||document.media.length>MEDIA_COUNT_LIMIT)fail('Backup exceeds image quota.');
}
function records(d:CloudBackupManifest):Array<{kind:string;id:string;value:string}>{
 const out:Array<{kind:string;id:string;value:string}>=[];
 for(const [kind,list,key] of [['posts',d.pages,'id'],['components',d.components,'id'],['users',d.users,'username'],['post_revisions',d.revisions,'id'],['static_pages',d.static_pages,'id'],['media',d.media,'key']] as [string,Row[],string][])
 for(const r of list)out.push({kind,id:String(r[key]),value:JSON.stringify(r)});
 out.push({kind:'settings',id:'settings',value:JSON.stringify({value:JSON.stringify(d.settings)})});return out;
}
export async function createBackupRestore(env:Env,document:CloudBackupManifest,options:{restoreUsers?:boolean}={}):Promise<string>{
 await assertMediaUnlocked(env);
 const targetStore=await mediaStorageMode(env);if(targetStore==='r2')mediaBucket(env);
 validate(document);if(options.restoreUsers&&!document.users.length)fail('Restoring accounts requires at least one account.');
 await env.DB.prepare('DELETE FROM backup_sessions WHERE created_at<?').bind(Date.now()-SESSION_AGE).run();
 const current=await exportBackupManifest(env);

 if(targetStore==='d1'){
 const staged=await env.DB.prepare('SELECT COALESCE(SUM(length(data)),0) n FROM backup_chunks').first<{n:number}>();
 const incoming=document.media.reduce((n,m)=>n+m.size,0);if(incoming>400000000)fail('Backup exceeds the D1 image quota. Migrate to R2 first.');
 if(current.media.reduce((n,m)=>n+m.size,0)+incoming+(staged?.n||0)>450000000)fail('Insufficient free D1 staging space for atomic image restore (450 MB safety limit).');
 }
 const id=crypto.randomUUID();const inserted=await env.DB.prepare(`INSERT INTO backup_sessions(id,created_at,restore_users,target_store) SELECT ?,?,?,? WHERE ${MEDIA_UNLOCKED_SQL} AND (${MEDIA_MODE_SQL})=?`).bind(id,Date.now(),options.restoreUsers?1:0,targetStore,targetStore).run();if(!inserted.meta.changes)fail('Image migration started; finish or cancel it first.');
 try{for(const [phase,d] of [['before',current],['restore',document]] as const){const all=records(d);let group:typeof all=[];let size=0;const flush=async()=>{if(!group.length)return;await env.DB.prepare(`INSERT INTO backup_records(session_id,phase,kind,record_id,value) SELECT ?,?,json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.value') FROM json_each(?)`).bind(id,phase,JSON.stringify(group)).run();group=[];size=0;};for(const r of all){const added=jsonBytes(r)+1;if(added>1_500_000)fail('Backup record exceeds D1 staging value limit.');if(size+added>1_500_000)await flush();group.push(r);size+=added;}await flush();}}catch(e){await abortBackupRestore(env,id);throw e;}return id;
}
async function session(env:Env,id:string){const s=await env.DB.prepare('SELECT * FROM backup_sessions WHERE id=? AND created_at>=?').bind(id,Date.now()-SESSION_AGE).first<{restore_users:number;target_store:'d1'|'r2'}>();if(!s)fail('Restore session expired or missing.');return s;}
export async function stageBackupMediaPart(env:Env,id:string,part:BackupMediaPart):Promise<void>{
 const state=await session(env,id);if(!part||!validMediaName(part.key)||!Number.isInteger(part.index)||part.index<0)fail('Invalid image part.');
 const row=await env.DB.prepare("SELECT value FROM backup_records WHERE session_id=? AND phase='restore' AND kind='media' AND record_id=?").bind(id,part.key).first<{value:string}>();if(!row)fail('Unexpected image.');const m=JSON.parse(row.value) as BackupMedia;
 const b=decode(part.content_base64);if(part.index>=m.chunk_count||b.length!==Math.min(MEDIA_CHUNK_SIZE,m.size-part.index*MEDIA_CHUNK_SIZE)||await hash(b)!==part.sha256)fail('Image part checksum or size mismatch.');
 if(part.index===0&&!isCodeMedia(m.key)&&imageType(b,m.key.split('.').pop()!.toLowerCase())!==m.content_type)fail('Image signature does not match metadata.');
 if(state.target_store==='d1'){
 await env.DB.prepare('INSERT INTO backup_chunks(session_id,media_key,chunk_index,data) VALUES(?,?,?,?) ON CONFLICT(session_id,media_key,chunk_index) DO UPDATE SET data=excluded.data').bind(id,part.key,part.index,b).run();
 if(isCodeMedia(m.key)) {
  const parts=(await env.DB.prepare('SELECT chunk_index,data FROM backup_chunks WHERE session_id=? AND media_key=? ORDER BY chunk_index').bind(id,part.key).all<{chunk_index:number;data:number[]|Uint8Array}>()).results;
  if(parts.length===m.chunk_count) {
   const full=new Uint8Array(m.size);let offset=0;
   for(let i=0;i<parts.length;i++){if(parts[i].chunk_index!==i)fail('Incomplete code file.');const data=new Uint8Array(parts[i].data);if(offset+data.length>full.length)fail('Invalid code file size.');full.set(data,offset);offset+=data.length;}
   if(offset!==m.size||mediaType(full,m.key.split('.').pop()!.toLowerCase())!==m.content_type){await env.DB.prepare('DELETE FROM backup_chunks WHERE session_id=? AND media_key=?').bind(id,part.key).run();fail('Invalid UTF-8 code file.');}
  }
 }
 return;
 }
 const object=await putImmutableImage(env,b,'application/octet-stream');
 try{await env.DB.batch([
 env.DB.prepare('DELETE FROM backup_images WHERE session_id=? AND media_key=?').bind(id,part.key),
 env.DB.prepare('INSERT INTO backup_parts(session_id,media_key,chunk_index,object_key,size,sha256) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,media_key,chunk_index) DO UPDATE SET object_key=excluded.object_key,size=excluded.size,sha256=excluded.sha256').bind(id,part.key,part.index,object.objectKey,b.length,part.sha256)]);}catch(error){await discardImage(env,object.objectKey).catch(()=>{});throw error;}
 const parts=(await env.DB.prepare('SELECT chunk_index,object_key,size,sha256 FROM backup_parts WHERE session_id=? AND media_key=? ORDER BY chunk_index').bind(id,part.key).all<{chunk_index:number;object_key:string;size:number;sha256:string}>()).results;
 if(parts.length===m.chunk_count){
  const full=new Uint8Array(m.size);let offset=0;
  for(let i=0;i<parts.length;i++){const p=parts[i];if(p.chunk_index!==i)fail('Incomplete image.');const object=await mediaBucket(env).get(p.object_key);if(!object)fail('Image part missing.');const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==p.size||await hash(bytes)!==p.sha256)fail('Image part checksum mismatch.');full.set(bytes,offset);offset+=bytes.length;}
  if(offset!==m.size||mediaType(full,m.key.split('.').pop()!.toLowerCase())!==m.content_type)fail('Image format or size mismatch.');
  const ready=await putImmutableImage(env,full,m.content_type);
  try{
   const snapshot=JSON.stringify(parts);
   const saved=await env.DB.prepare(`INSERT INTO backup_images(session_id,media_key,object_key,size,etag) SELECT ?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM backup_parts WHERE session_id=? AND media_key=?)=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) p WHERE NOT EXISTS(SELECT 1 FROM backup_parts b WHERE b.session_id=? AND b.media_key=? AND b.chunk_index=json_extract(p.value,'$.chunk_index') AND b.object_key=json_extract(p.value,'$.object_key') AND b.sha256=json_extract(p.value,'$.sha256')))
    ON CONFLICT(session_id,media_key) DO UPDATE SET object_key=excluded.object_key,size=excluded.size,etag=excluded.etag`).bind(id,part.key,ready.objectKey,m.size,ready.etag,id,part.key,parts.length,snapshot,id,part.key).run();
   if(!saved.meta.changes)fail('Restore image parts changed; retry staging.');
  }catch(error){await discardImage(env,ready.objectKey).catch(()=>{});throw error;}
 }
}
export async function abortBackupRestore(env:Env,id:string):Promise<void>{await env.DB.prepare('DELETE FROM backup_sessions WHERE id=?').bind(id).run();}
export async function commitBackupRestore(env:Env,id:string):Promise<{pages:number;components:number;images:number;accountsRestored:boolean}>{
 const s=await session(env,id);
 const desired=(await env.DB.prepare("SELECT kind,record_id,value FROM backup_records WHERE session_id=? AND phase='restore'").bind(id).all<Row>()).results;
 const settingsRecord=desired.find(r=>r.kind==='settings');if(!settingsRecord)fail('Incomplete restore session.');
 const existing=await env.DB.prepare("SELECT value FROM settings WHERE key='settings'").first<{value:string}>();const current:Settings=existing?JSON.parse(existing.value):{};
 const restored:Settings=JSON.parse(JSON.parse(String(settingsRecord.value)).value);
 for(const key of ['site_id','api_key','password_hash']){if(Object.hasOwn(current,key))restored[key]=current[key];else delete restored[key];}
 const columns:Record<string,string[]>={posts:['id','data','status','sort_order','updated_at'],components:['id','data','is_wrapper'],users:['username','display_name','password_hash','auth_version','security_question','security_answer_hash'],post_revisions:['id','post_id','data','created_at','editor_id'],static_pages:['id','html','built_at'],media:['key','content_type','size','uploaded','etag','upload_id','object_key']};
 const comparisons=Object.entries(columns).map(([table,fields])=>`((SELECT COUNT(*) FROM ${table})=(SELECT COUNT(*) FROM backup_records WHERE session_id=? AND phase='before' AND kind='${table}') AND NOT EXISTS(SELECT 1 FROM ${table} t WHERE NOT EXISTS(SELECT 1 FROM backup_records r WHERE r.session_id=? AND r.phase='before' AND r.kind='${table}' AND ${fields.map(c=>`t.${c} IS json_extract(r.value,'$.${c}')`).join(' AND ')})))`);
 const binds:unknown[]=[];for(const _ of comparisons)binds.push(id,id);
 const ready=s.target_store==='r2'?`NOT EXISTS(SELECT 1 FROM backup_records r WHERE r.session_id=? AND r.phase='restore' AND r.kind='media' AND NOT EXISTS(SELECT 1 FROM backup_images i WHERE i.session_id=r.session_id AND i.media_key=r.record_id AND i.size=json_extract(r.value,'$.size')))`:`NOT EXISTS(SELECT 1 FROM backup_records r WHERE r.session_id=? AND r.phase='restore' AND r.kind='media' AND ((SELECT COUNT(*) FROM backup_chunks c WHERE c.session_id=r.session_id AND c.media_key=r.record_id)!=json_extract(r.value,'$.chunk_count') OR (SELECT COALESCE(SUM(length(c.data)),0) FROM backup_chunks c WHERE c.session_id=r.session_id AND c.media_key=r.record_id)!=json_extract(r.value,'$.size')))`;
 const guard=`INSERT INTO backup_commit_guard(session_id,valid) SELECT ?,CASE WHEN ${comparisons.join(' AND ')} AND json(COALESCE((SELECT value FROM settings WHERE key='settings'),'{}'))=json((SELECT json_extract(value,'$.value') FROM backup_records WHERE session_id=? AND phase='before' AND kind='settings')) AND ${ready} AND ${MEDIA_UNLOCKED_SQL} AND (${MEDIA_MODE_SQL})=? THEN 1 ELSE 0 END`;
 const statements=[env.DB.prepare(guard).bind(id,...binds,id,id,s.target_store)];
 for(const table of ['media_chunks','media','post_revisions','static_pages','posts','components','edit_locks'])statements.push(env.DB.prepare('DELETE FROM '+table));
 const input=(kind:string)=>`SELECT value FROM backup_records WHERE session_id=? AND phase='restore' AND kind='${kind}'`;
 for(const table of ['posts','components','post_revisions']){const fields=columns[table];statements.push(env.DB.prepare(`INSERT INTO ${table}(${fields.join(',')}) SELECT ${fields.map(c=>`json_extract(value,'$.${c}')`).join(',')} FROM (${input(table)})`).bind(id));}
 statements.push(env.DB.prepare(`INSERT INTO static_pages(id,html,built_at) SELECT json_extract(r.value,'$.id'),json_extract(r.value,'$.html'),json_extract(r.value,'$.built_at') FROM backup_records r JOIN posts p ON p.id=json_extract(r.value,'$.id') AND p.status='public_static' WHERE r.session_id=? AND r.phase='restore' AND r.kind='static_pages'`).bind(id));
 if(s.target_store==='r2'){
 statements.push(env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count,object_key) SELECT r.record_id,json_extract(r.value,'$.content_type'),i.size,json_extract(r.value,'$.uploaded'),'',NULL,i.etag,0,i.object_key FROM backup_records r JOIN backup_images i ON i.session_id=r.session_id AND i.media_key=r.record_id WHERE r.session_id=? AND r.phase='restore' AND r.kind='media'`).bind(id));
 }else{
 statements.push(env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count) SELECT record_id,json_extract(value,'$.content_type'),json_extract(value,'$.size'),json_extract(value,'$.uploaded'),'',?||':'||record_id,?||':'||record_id,json_extract(value,'$.chunk_count') FROM backup_records WHERE session_id=? AND phase='restore' AND kind='media'`).bind(id,id,id));
 statements.push(env.DB.prepare(`INSERT INTO media_chunks(upload_id,chunk_index,data) SELECT ?||':'||media_key,chunk_index,data FROM backup_chunks WHERE session_id=?`).bind(id,id));
 }
 statements.push(env.DB.prepare("INSERT INTO settings(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(restored)));
 if(s.restore_users){const generation=crypto.getRandomValues(new Uint32Array(1))[0]+Date.now();statements.push(env.DB.prepare('DELETE FROM users'));statements.push(env.DB.prepare(`INSERT INTO users(username,display_name,password_hash,auth_version,security_question,security_answer_hash) SELECT json_extract(value,'$.username'),json_extract(value,'$.display_name'),json_extract(value,'$.password_hash'),?,COALESCE(json_extract(value,'$.security_question'),''),COALESCE(json_extract(value,'$.security_answer_hash'),'') FROM (${input('users')})`).bind(generation,id));statements.push(env.DB.prepare('DELETE FROM login_attempts'));}
 statements.push(env.DB.prepare('DELETE FROM backup_sessions WHERE id=?').bind(id));statements.push(env.DB.prepare('DELETE FROM backup_commit_guard WHERE session_id=?').bind(id));
 try{await env.DB.batch(statements);}catch{fail('Restore was not applied: incomplete images, concurrent edits, or D1 capacity. Existing data remains unchanged.');}
 return {pages:desired.filter(r=>r.kind==='posts').length,components:desired.filter(r=>r.kind==='components').length,images:desired.filter(r=>r.kind==='media').length,accountsRestored:!!s.restore_users};
}
