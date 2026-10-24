// ==========================================
// mikanBox Storage Layer (D1 / R2)
// ==========================================

import type { Env, PageData, ComponentData, Settings } from './types';
import {mediaStorageMode,assertMediaUnlocked,MEDIA_UNLOCKED_SQL,MEDIA_MODE_SQL} from './media-mode';
import {mediaBucket,putImmutableImage,discardImage} from './r2-media';
import { validId } from './validation';
import { MEDIA_FILE_LIMIT,MEDIA_COUNT_LIMIT,MEDIA_CHUNK_SIZE,MEDIA_ZIP_LIMIT,validMediaName } from './media-policy';

// Both published modes and the legacy public status are publicly visible.
export function isPublicStatus(status: string): boolean {
  return status === 'public' || status === 'public_dynamic' || status === 'public_static';
}
// The Cloud edition publishes statically only: every public status is stored as
// 'public_static'. Older values still arrive from MCP clients, imports and backups.
export function normalizeStatus<T extends string>(status: T): T | 'public_static' {
  return isPublicStatus(status) ? 'public_static' : status;
}

function sanitizeId(id: string): string {
  return validId(id) ? id : '';
}

// ---- Settings ----

// Keep the exact read snapshot outside the JSON payload for optimistic locking.
const settingsSnapshots = new WeakMap<Settings, string | null>();
export async function loadSettings(env: Env): Promise<Settings> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('settings').first<{ value: string }>();
  let data: Settings = {};
  if (row) { try { data = JSON.parse(row.value); } catch {} }
  settingsSnapshots.set(data, row?.value ?? null);
  return data;
}

export async function saveSettings(env: Env, data: Settings): Promise<boolean> {
  try {
    let expected = settingsSnapshots.get(data);
    if (expected === undefined) {
      const current = await loadSettings(env);
      expected = settingsSnapshots.get(current)!;
    }
    const json = JSON.stringify(data, null, 2);
    const result = expected === null
      ? await env.DB.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind('settings', json).run()
      : await env.DB.prepare('UPDATE settings SET value=? WHERE key=? AND value=?').bind(json, 'settings', expected).run();
    if (!result.meta.changes) return false;
    settingsSnapshots.set(data, json);
    return true;
  } catch { return false; }
}

// ---- Pages (posts) ----

export async function loadPage(env: Env, id: string): Promise<PageData | null> {
  const clean = sanitizeId(id);
  if (!clean) return null;
  let row = await env.DB.prepare('SELECT data FROM posts WHERE id = ?').bind(clean).first<{ data: string }>();
  if (!row) {
    // ディレクトリ型: coffee → coffee/index
    row = await env.DB.prepare('SELECT data FROM posts WHERE id = ?').bind(`${clean}/index`).first<{ data: string }>();
  }
  if (!row) return null;
  try { return JSON.parse(row.data) as PageData; } catch { return null; }
}

export async function savePage(env: Env, id: string, data: PageData): Promise<boolean> {
  const clean = sanitizeId(id);
  if (!clean) return false;
  try {
    data = { ...data, status: normalizeStatus(data.status || 'draft') };
    const json = JSON.stringify(data, null, 2);
    const status = data.status;
    const sortOrder = typeof data.sort_order === 'number' ? data.sort_order : 0;
    const updatedAt = data.updated_at || '';
    await env.DB.prepare(
      'INSERT INTO posts (id, data, status, sort_order, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, status = excluded.status, sort_order = excluded.sort_order, updated_at = excluded.updated_at'
    ).bind(clean, json, status, sortOrder, updatedAt).run();
    return true;
  } catch { return false; }
}

export async function deletePage(env: Env, id: string): Promise<boolean> {
  const clean = sanitizeId(id);
  if (!clean) return false;
  try {
    await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(clean).run();
    return true;
  } catch { return false; }
}

export async function listPageIds(env: Env): Promise<string[]> {
  const result = await env.DB.prepare('SELECT id FROM posts').all<{ id: string }>();
  return result.results.map(r => r.id);
}

export async function listPages(env:Env):Promise<Array<{id:string,data:PageData}>> {
  const rows=await env.DB.prepare('SELECT id,data FROM posts ORDER BY sort_order,updated_at DESC,id').all<{id:string,data:string}>();
  return rows.results.flatMap(row=>{try{return [{id:row.id,data:JSON.parse(row.data) as PageData}];}catch{return [];}});
}
export async function listComponents(env:Env):Promise<Array<{id:string,data:ComponentData}>> {
  const rows=await env.DB.prepare('SELECT id,data FROM components ORDER BY id').all<{id:string,data:string}>();
  return rows.results.flatMap(row=>{try{return [{id:row.id,data:JSON.parse(row.data) as ComponentData}];}catch{return [];}});
}

// ---- Components ----

export async function loadComponent(env: Env, id: string): Promise<ComponentData | null> {
  const clean = validId(id,true) ? id : '';
  if (!clean) return null;
  const row = await env.DB.prepare('SELECT data FROM components WHERE id = ?').bind(clean).first<{ data: string }>();
  if (!row) return null;
  try { return JSON.parse(row.data) as ComponentData; } catch { return null; }
}

export async function saveComponent(env: Env, id: string, data: ComponentData): Promise<boolean> {
  const clean = validId(id,true) ? id : '';
  if (!clean) return false;
  try {
    const json = JSON.stringify(data, null, 2);
    const isWrapper = data.is_wrapper ? 1 : 0;
    await env.DB.prepare(
      'INSERT INTO components (id, data, is_wrapper) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, is_wrapper = excluded.is_wrapper'
    ).bind(clean, json, isWrapper).run();
    return true;
  } catch { return false; }
}

export async function deleteComponent(env: Env, id: string): Promise<boolean> {
  const clean = validId(id,true) ? id : '';
  if (!clean) return false;
  try {
    await env.DB.prepare('DELETE FROM components WHERE id = ?').bind(clean).run();
    return true;
  } catch { return false; }
}

export async function listComponentIds(env: Env): Promise<string[]> {
  const result = await env.DB.prepare('SELECT id FROM components ORDER BY id').all<{ id: string }>();
  return result.results.map(r => r.id);
}

// ---- Sorted page list ----

export async function getSortedPageIds(env: Env): Promise<string[]> {
  const result = await env.DB.prepare(
    `SELECT id FROM posts ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, CASE WHEN id = 'index' THEN 0 ELSE 1 END, sort_order ASC, id ASC`
  ).all<{ id: string }>();
  return result.results.map(r => r.id);
}

// ---- Image storage: D1 starter mode, R2 after verified cutover ----
export async function listMediaFiles(env:Env):Promise<Array<{key:string;size:number;uploaded:Date;customMetadata?:Record<string,string>}>> {
 const result=await env.DB.prepare('SELECT key,size,uploaded FROM media ORDER BY uploaded DESC').all<{key:string;size:number;uploaded:string}>();
 return result.results.map(r=>({key:r.key,size:r.size,uploaded:new Date(r.uploaded)}));
}
export async function mediaUsage(env:Env):Promise<{bytes:number;files:number}> {
 return await env.DB.prepare('SELECT bytes,files FROM media_usage WHERE id=1').first<{bytes:number;files:number}>()||{bytes:0,files:0};
}
export async function getMediaObject(env:Env,key:string):Promise<{body:ReadableStream<Uint8Array>;httpMetadata:{contentType:string};httpEtag:string;size:number;arrayBuffer():Promise<ArrayBuffer>}|null>{
 if(!validMediaName(key))return null;
 const row=await env.DB.prepare('SELECT object_key,content_type,size,etag,upload_id,chunk_count FROM media WHERE key=?').bind(key).first<{object_key:string|null;content_type:string;size:number;etag:string|null;upload_id:string|null;chunk_count:number}>();if(!row)return null;
 if(row.object_key){const object=await mediaBucket(env).get(row.object_key);if(!object||object.size!==row.size)return null;return {body:object.body,httpMetadata:{contentType:row.content_type},httpEtag:'"'+row.etag+'"',size:row.size,arrayBuffer:()=>object.arrayBuffer()};}
 if(!row.upload_id){const legacy=await env.DB.prepare('SELECT data FROM media WHERE key=?').bind(key).first<{data:string}>();if(!legacy)return null;const bytes=Uint8Array.from(atob(legacy.data),c=>c.charCodeAt(0));return {body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),size:bytes.length,httpMetadata:{contentType:row.content_type},httpEtag:'"'+row.etag+'"',arrayBuffer:async()=>bytes.buffer};}
 const stream=()=>{let index=0;return new ReadableStream<Uint8Array>({async pull(controller){if(index>=row.chunk_count){controller.close();return;}const part=await env.DB.prepare('SELECT data FROM media_chunks WHERE upload_id=? AND chunk_index=?').bind(row.upload_id,index++).first<{data:number[]|ArrayBuffer|Uint8Array}>();if(!part){controller.error(new Error('Media chunk missing.'));return;}controller.enqueue(part.data instanceof Uint8Array?part.data:new Uint8Array(part.data as ArrayBuffer));}},{highWaterMark:0});};
 return {body:stream(),size:row.size,httpMetadata:{contentType:row.content_type},httpEtag:'"'+row.etag+'"',arrayBuffer:()=>new Response(stream()).arrayBuffer()};
}
export async function uploadMedia(env:Env,key:string,body:ArrayBuffer,contentType:string,metadata?:Record<string,string>):Promise<boolean>{
 if(!validMediaName(key)||!body.byteLength||body.byteLength>MEDIA_FILE_LIMIT)return false;
 await assertMediaUnlocked(env);
 if(await mediaStorageMode(env)==='d1'){
  const id=crypto.randomUUID(),count=Math.ceil(body.byteLength/MEDIA_CHUNK_SIZE);
  const etag=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const statements=[env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,data,upload_id,etag,chunk_count)
   SELECT ?,?,?,?,'',?,?,? FROM media_usage WHERE id=1 AND bytes+?<=400000000 AND files<? AND ${MEDIA_UNLOCKED_SQL} AND (${MEDIA_MODE_SQL})='d1' ON CONFLICT(key) DO NOTHING`).bind(key,contentType,body.byteLength,new Date().toISOString(),id,etag,count,body.byteLength,MEDIA_COUNT_LIMIT)];
  for(let i=0;i<count;i++)statements.push(env.DB.prepare('INSERT INTO media_chunks(upload_id,chunk_index,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM media WHERE upload_id=?)').bind(id,i,body.slice(i*MEDIA_CHUNK_SIZE,(i+1)*MEDIA_CHUNK_SIZE),id));
  try{const r=await env.DB.batch(statements);return !!r[0].meta.changes;}catch{return false;}
 }
 mediaBucket(env);
 if(await env.DB.prepare('SELECT key FROM media WHERE key=?').bind(key).first())return false;
 const bytes=new Uint8Array(body),object=await putImmutableImage(env,bytes,contentType);
 try{
 const r=await env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,data,etag,object_key,chunk_count)
 SELECT ?,?,?,?,'',?,?,0 WHERE (SELECT COUNT(*) FROM media)<? AND ${MEDIA_UNLOCKED_SQL} ON CONFLICT(key) DO NOTHING`)
 .bind(key,contentType,bytes.length,new Date().toISOString(),object.etag,object.objectKey,MEDIA_COUNT_LIMIT).run();
 if(!r.meta.changes){await discardImage(env,object.objectKey);return false;}return true;
 }catch{await discardImage(env,object.objectKey).catch(()=>{});return false;}
}
export async function deleteMedia(env:Env,key:string):Promise<boolean>{
 if(!validMediaName(key))return false;await assertMediaUnlocked(env);
 try{const result=await env.DB.batch([
 env.DB.prepare(`DELETE FROM media_chunks WHERE upload_id IN(SELECT upload_id FROM media WHERE key=?) AND ${MEDIA_UNLOCKED_SQL}`).bind(key),
 env.DB.prepare(`DELETE FROM media WHERE key=? AND ${MEDIA_UNLOCKED_SQL}`).bind(key)]);return !!result[1].meta.changes;}catch{return false;}
}
export async function renameMedia(env:Env,old:string,name:string):Promise<boolean>{
 if(!validMediaName(old)||!validMediaName(name)||old.split('.').pop()!==name.split('.').pop())return false;await assertMediaUnlocked(env);
 try{return !!(await env.DB.prepare(`UPDATE media SET key=? WHERE key=? AND ${MEDIA_UNLOCKED_SQL}`).bind(name,old).run()).meta.changes;}catch{return false;}
}

// ---- ZIP for backup ----

export async function buildDataBackupZip(env: Env): Promise<Uint8Array> {
  const files: Array<{ name: string; data: Uint8Array }> = [];

  const settings = await loadSettings(env);
  files.push({ name: 'data/settings.json', data: new TextEncoder().encode(JSON.stringify(settings, null, 2)) });

  for (const {id,data} of await listPages(env)) {
    files.push({ name: `data/posts/${id}.json`, data: new TextEncoder().encode(JSON.stringify(data, null, 2)) });
  }

  for (const {id,data} of await listComponents(env)) {
    files.push({ name: `data/components/${id}.json`, data: new TextEncoder().encode(JSON.stringify(data, null, 2)) });
  }

  return createZip(files);
}

export async function buildMediaBackupZip(env: Env): Promise<Uint8Array> {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const mediaList = await listMediaFiles(env);
  if(mediaList.reduce((total,file)=>total+file.size,0)>MEDIA_ZIP_LIMIT)throw new Error('画像ZIPは合計20 MBまでで、枚数にも制限があります。画像を個別に保存してください。 / Media ZIP is limited to 20 MB and a bounded number of files; download images individually.');
  const metadata=(await env.DB.prepare('SELECT object_key,upload_id,chunk_count FROM media').all<{object_key:string|null;upload_id:string|null;chunk_count:number}>()).results;
  const queries=metadata.reduce((total,row)=>total+(row.object_key?1:row.upload_id?1+row.chunk_count:2),2);
  if(queries>45)throw new Error('画像ZIPは枚数にも制限があります。画像を個別に保存してください。 / Too many images for one ZIP request; download images individually.');
  for (const item of mediaList) {
    const obj = await getMediaObject(env, item.key);
    if (obj) {
      const buf = await obj.arrayBuffer();
      files.push({ name: `media/${item.key}`, data: new Uint8Array(buf) });
    }
  }
  return createZip(files);
}

// ---- Simple ZIP writer (no compression) ----

export function createZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const now = new Date();
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    localHeaders.push(local);
    localHeaders.push(data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centralHeaders.push(central);
    offset += local.length + data.length;
  }

  const centralStart = offset;
  const centralSize = centralHeaders.reduce((s, h) => s + h.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  const all = [...localHeaders, ...centralHeaders, eocd];
  const total = all.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const a of all) { result.set(a, pos); pos += a.length; }
  return result;
}

function crc32(data: Uint8Array): number {
  const table = makeCrc32Table();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}
