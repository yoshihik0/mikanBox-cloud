import type { Env, PageData, ComponentData } from './types';
import { pageId, componentId } from './validation';

export interface ContentPackage {
  pages?: Array<{ id: string; data: PageData }>;
  components?: Array<{ id: string; data: ComponentData }>;
}

const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_RECORDS = 300;
const allowedStatuses = new Set(['draft','pending','public','public_dynamic','public_static','db']);
const PAGE_STRINGS = ['title','category','memo','js','description','keywords','ogp_image','content_md','css','custom_css','wrapper_comp','updated_at'] as const;
const COMPONENT_STRINGS = ['html','css','memo','js'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validatePackage(input: unknown): ContentPackage {
  if (!record(input)) throw new Error('Invalid content import payload.');
  const pages = input.pages ?? [];
  const components = input.components ?? [];
  if (!Array.isArray(pages) || !Array.isArray(components) || pages.length + components.length > MAX_IMPORT_RECORDS)
    throw new Error('The import contains too many records.');
  const normalizedPages: ContentPackage['pages'] = [];
  const normalizedComponents: ContentPackage['components'] = [];
  const seenPages = new Set<string>(), seenComponents = new Set<string>();
  let bytes = 0;
  const countBytes=(value:unknown)=>{bytes+=new TextEncoder().encode(JSON.stringify(value)).byteLength;};
  for (const item of pages) {
    if (!record(item) || typeof item.id !== 'string' || !record(item.data)) throw new Error('Invalid imported page.');
    const id = pageId(item.id);
    if (seenPages.has(id)) throw new Error(`Duplicate page ID: ${id}`);
    seenPages.add(id);
    const source=item.data;
    if (typeof source.title !== 'string' || !allowedStatuses.has(String(source.status ?? 'draft'))) throw new Error(`Invalid page data: ${id}`);
    const data:Record<string,unknown>={};
    for(const key of PAGE_STRINGS){const value=source[key];if(value!==undefined){if(typeof value!=='string'||value.length>300_000)throw new Error(`Invalid page field: ${key}`);data[key]=value;}}
    for(const key of ['is_html','exclude_tracking'] as const){const value=source[key];if(value!==undefined){if(typeof value!=='boolean')throw new Error(`Invalid page field: ${key}`);data[key]=value;}}
    const sortOrder=source.sort_order===undefined?0:source.sort_order;
    if(typeof sortOrder!=='number'||!Number.isSafeInteger(sortOrder)||Math.abs(sortOrder)>1_000_000)throw new Error('Invalid page sort order.');
    const rawStatus=String(source.status??'draft');
    const status=rawStatus==='public'?'public_dynamic':rawStatus;
    data.status=status;data.sort_order=sortOrder;data.updated_at=typeof source.updated_at==='string'&&source.updated_at?source.updated_at:new Date().toISOString();
    if(status==='pending')data.preview_token=crypto.randomUUID();
    // Map the SQLite legacy field while refusing to copy source preview/revision state.
    if(typeof source.custom_css==='string'&&typeof source.css!=='string')data.css=source.custom_css;
    countBytes({id,data});
    normalizedPages.push({ id, data: data as unknown as PageData });
  }
  for (const item of components) {
    if (!record(item) || typeof item.id !== 'string' || !record(item.data) || typeof item.data.html !== 'string') throw new Error('Invalid imported component.');
    const id = componentId(item.id);
    if (seenComponents.has(id)) throw new Error(`Duplicate component ID: ${id}`);
    seenComponents.add(id);
    const source=item.data,data:Record<string,unknown>={};
    for(const key of COMPONENT_STRINGS){const value=source[key];if(key==='html'&&typeof value!=='string')throw new Error(`Invalid component field: ${key}`);if(value!==undefined){if(typeof value!=='string'||value.length>300_000)throw new Error(`Invalid component field: ${key}`);data[key]=value;}}
    for(const key of ['is_global','is_wrapper','is_ai_doc'] as const){const value=source[key];if(value!==undefined){if(typeof value!=='boolean')throw new Error(`Invalid component field: ${key}`);data[key]=value;}}
    countBytes({id,data});
    normalizedComponents.push({ id, data: data as unknown as ComponentData });
  }
  if (bytes > MAX_IMPORT_BYTES) throw new Error('The import content exceeds 1 MB.');
  return { pages: normalizedPages, components: normalizedComponents };
}

/** Add package content only. Existing IDs are retained, and package settings are intentionally ignored. */
export async function importContentPackage(env: Env, input: unknown): Promise<{ pages: number; components: number; skippedPages: number; skippedComponents: number }> {
  const payload=validatePackage(input);
  const pages=payload.pages??[],components=payload.components??[];
  const statements: D1PreparedStatement[]=[];
  if(pages.length)statements.push(env.DB.prepare(`INSERT INTO posts(id,data,status,sort_order,updated_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.data'),json_extract(value,'$.data.status'),json_extract(value,'$.data.sort_order'),json_extract(value,'$.data.updated_at')
    FROM json_each(?) WHERE 1 ON CONFLICT(id) DO NOTHING`).bind(JSON.stringify(pages.map(({id,data})=>({id,data})))));
  if(components.length)statements.push(env.DB.prepare(`INSERT INTO components(id,data,is_wrapper)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.data'),COALESCE(json_extract(value,'$.data.is_wrapper'),0)
    FROM json_each(?) WHERE 1 ON CONFLICT(id) DO NOTHING`).bind(JSON.stringify(components.map(({id,data})=>({id,data})))));
  const results=statements.length ? await env.DB.batch(statements) : [];
  const insertedPages=pages.length?Number(results[0]?.meta.changes||0):0;
  const insertedComponents=components.length?Number(results[pages.length?1:0]?.meta.changes||0):0;
  return {pages:insertedPages,components:insertedComponents,skippedPages:pages.length-insertedPages,skippedComponents:components.length-insertedComponents};
}

export function normalizeWordPressImport(input: unknown): ContentPackage {
  if (!record(input) || !Array.isArray(input.pages)) throw new Error('Invalid WordPress import payload.');
  const pages=input.pages.map((item, index) => {
    if (!record(item)) throw new Error('Invalid WordPress page.');
    const slug=String(item.slug||'').replace(/[^A-Za-z0-9_-]/g,'_').replace(/^_+|_+$/g,'');
    const id=slug || `post_${String(item.postId||index+1).replace(/[^A-Za-z0-9_-]/g,'_')}`;
    const wpStatus=String(item.status||'');
    const status=wpStatus==='publish'?'public_dynamic':wpStatus==='pending'?'pending':'draft';
    const title=String(item.title||'');
    const updated=String(item.date||'');
    const updatedAt=!updated||updated==='0000-00-00 00:00:00'?new Date().toISOString():updated;
    return {id,data:{title,content_md:String(item.content_md||''),category:String(item.category||''),status,sort_order:0,updated_at:updatedAt} as PageData};
  });
  return validatePackage({pages,components:[]});
}

export async function importWordPressContent(env: Env, input: unknown): Promise<{ pages: number; components: number; skippedPages: number; skippedComponents: number }> {
  return importContentPackage(env, normalizeWordPressImport(input));
}
