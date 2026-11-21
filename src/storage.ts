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
/** Orders of the admin page list. An empty sort selects the default display order. */
export const PAGE_SORTS = ['', 'updated_desc', 'updated_asc', 'id', 'title'] as const;
export type PageSort = typeof PAGE_SORTS[number];
export const pageSortParam = (value: unknown): PageSort => (PAGE_SORTS as readonly string[]).includes(String(value ?? '')) ? String(value ?? '') as PageSort : '';
const idCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const titleCollator = new Intl.Collator('ja');
const updatedAt = (data: PageData) => { const time = Date.parse(String(data.updated_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(data.updated_at || '')) ? '' : 'Z')); return Number.isFinite(time) ? time : 0; };
export function adminPageMatches(id:string,page:PageData,query:string):boolean {
  const keyword=query.toLowerCase();
  return !keyword||[id,page.title,page.content_md,page.description].some(field=>String(field??'').toLowerCase().includes(keyword));
}

/** In the default order, index and pending pages come first. Explicit orders use ID to break ties. */
export function sortPagesForAdmin<T extends {id:string,data:PageData}>(pages:T[],sort:PageSort=''):T[] {
  const order=(page:T)=>Number(page.data.sort_order)||0;
  const title=(page:T)=>String(page.data.title||'').trim()||page.id;
  return [...pages].sort((a,b)=>{
    if(sort==='') {
      if(a.id==='index'&&b.id!=='index')return -1;
      if(b.id==='index'&&a.id!=='index')return 1;
      const pendingA=a.data.status==='pending',pendingB=b.data.status==='pending';
      if(pendingA!==pendingB)return pendingA?-1:1;
    }
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
