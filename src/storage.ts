// ==========================================
// mikanBox Storage Layer (D1)
// ==========================================

import type { Env, PageData, ComponentData, Settings } from './types';
import { validId } from './validation';
import { normalizeLegacyPage } from './output-formats';

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
  try { return normalizeLegacyPage(JSON.parse(row.data) as PageData); } catch { return null; }
}

export async function savePage(env: Env, id: string, data: PageData): Promise<boolean> {
  const clean = sanitizeId(id);
  if (!clean) return false;
  try {
    data = normalizeLegacyPage({ ...data });
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
  return rows.results.flatMap(row=>{try{return [{id:row.id,data:normalizeLegacyPage(JSON.parse(row.data) as PageData)}];}catch{return [];}});
}
/** Orders of the admin page list (PHP 2.20.0): "" is the display order, which matches the public side. */
export const PAGE_SORTS = ['', 'updated_desc', 'updated_asc', 'id', 'title'] as const;
export type PageSort = typeof PAGE_SORTS[number];
export const pageSortParam = (value: unknown): PageSort => (PAGE_SORTS as readonly string[]).includes(String(value ?? '')) ? String(value ?? '') as PageSort : '';
const idCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const titleCollator = new Intl.Collator('ja');
const updatedAt = (data: PageData) => { const time = Date.parse(String(data.updated_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(data.updated_at || '')) ? '' : 'Z')); return Number.isFinite(time) ? time : 0; };
/**
 * The admin page list order. The default ("display order") is the public side's: pending pages first (this
 * edition has the "pending" status), then index, then display order, then the newest update, then ID.
 * Other orders put index first, whatever the order, and are otherwise purely that order (pending pages
 * included), ties broken by ID. Sorting happens before the page split, so every page of the list follows it.
 */
export function sortPagesForAdmin<T extends {id:string,data:PageData}>(pages:T[],sort:PageSort=''):T[] {
  const order=(page:T)=>Number(page.data.sort_order)||0;
  const title=(page:T)=>String(page.data.title||'').trim()||page.id;
  return [...pages].sort((a,b)=>{
    if(sort==='') {
      const pendingA=a.data.status==='pending',pendingB=b.data.status==='pending';
      if(pendingA!==pendingB)return pendingA?-1:1;
    }
    if(a.id==='index'&&b.id!=='index')return -1;
    if(b.id==='index'&&a.id!=='index')return 1;
    let result=0;
    if(sort==='')result=order(a)-order(b)||updatedAt(b.data)-updatedAt(a.data);
    else if(sort==='updated_desc')result=updatedAt(b.data)-updatedAt(a.data);
    else if(sort==='updated_asc')result=updatedAt(a.data)-updatedAt(b.data);
    else if(sort==='title')result=titleCollator.compare(title(a),title(b));
    return result||idCompare(a.id,b.id);
  });
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

// ---- Media: the files live on the public site; D1 keeps their information (media-store.ts) ----
export async function listMediaFiles(env:Env):Promise<Array<{key:string;size:number;uploaded:Date;customMetadata?:Record<string,string>}>> {
 const result=await env.DB.prepare('SELECT key,size,uploaded FROM media ORDER BY uploaded DESC').all<{key:string;size:number;uploaded:string}>();
 return result.results.map(r=>({key:r.key,size:r.size,uploaded:new Date(r.uploaded)}));
}
export async function mediaUsage(env:Env):Promise<{bytes:number;files:number}> {
 return await env.DB.prepare('SELECT bytes,files FROM media_usage WHERE id=1').first<{bytes:number;files:number}>()||{bytes:0,files:0};
}

// ---- ZIP for backup ----

export async function buildDataBackupZip(env: Env): Promise<Uint8Array> {
  const files: Array<{ name: string; data: Uint8Array }> = [];

  // The MCP API key never leaves in a backup (0.10.3): issue a new one after restoring.
  const settings = { ...(await loadSettings(env)) };
  if ('api_key' in settings) settings.api_key = '';
  files.push({ name: 'data/settings.json', data: new TextEncoder().encode(JSON.stringify(settings, null, 2)) });

  for (const {id,data} of await listPages(env)) {
    files.push({ name: `data/posts/${id}.json`, data: new TextEncoder().encode(JSON.stringify(data, null, 2)) });
  }

  for (const {id,data} of await listComponents(env)) {
    files.push({ name: `data/components/${id}.json`, data: new TextEncoder().encode(JSON.stringify(data, null, 2)) });
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
