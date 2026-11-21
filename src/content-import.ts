import type { PageData, ComponentData } from './types';
import { OUTPUT_FORMATS, isDataFormat, type OutputFormat } from './output-formats';

const allowedStatuses = new Set(['draft','pending','public','public_dynamic','public_static','db']);
const PAGE_STRINGS = ['title','category','memo','js','description','keywords','ogp_image','content_md','css','custom_css','wrapper_comp','updated_at','first_published_at'] as const;
const COMPONENT_STRINGS = ['html','css','memo','js'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A page read by the data tool (data-transfer.ts): only known fields, of the right types. */
export function normalizeImportedPage(source: Record<string, unknown>): PageData {
  if (!record(source) || typeof source.title !== 'string' || !allowedStatuses.has(String(source.status ?? 'draft'))) throw new Error('Invalid page data.');
  const data:Record<string,unknown>={};
  for(const key of PAGE_STRINGS){const value=source[key];if(value!==undefined){if(typeof value!=='string'||value.length>300_000)throw new Error(`Invalid page field: ${key}`);data[key]=value;}}
  for(const key of ['is_html','exclude_tracking'] as const){const value=source[key];if(value!==undefined){if(typeof value!=='boolean')throw new Error(`Invalid page field: ${key}`);data[key]=value;}}
  const sortOrder=source.sort_order===undefined?0:source.sort_order;
  if(typeof sortOrder!=='number'||!Number.isSafeInteger(sortOrder)||Math.abs(sortOrder)>1_000_000)throw new Error('Invalid page sort order.');
  const rawStatus=String(source.status??'draft');
  const status=['public','public_dynamic'].includes(rawStatus)?'public_static':rawStatus;
  data.status=status;data.sort_order=sortOrder;data.updated_at=typeof source.updated_at==='string'&&source.updated_at?source.updated_at:new Date().toISOString();
  if(status==='pending')data.preview_token=crypto.randomUUID();
  // Output formats (2.17.0); the former "DB" status is the output format "mikanBox DB" of a public page.
  if(source.output_format!==undefined){if(!OUTPUT_FORMATS.includes(source.output_format as OutputFormat))throw new Error('Invalid page field: output_format');data.output_format=source.output_format;}
  if(source.md_footer_comps!==undefined){if(!Array.isArray(source.md_footer_comps)||source.md_footer_comps.length>50||source.md_footer_comps.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]+$/.test(id)))throw new Error('Invalid page field: md_footer_comps');data.md_footer_comps=[...source.md_footer_comps];}
  if(source.expand_tags!==undefined){if(typeof source.expand_tags!=='boolean')throw new Error('Invalid page field: expand_tags');if(isDataFormat(data.output_format))data.expand_tags=source.expand_tags;}
  if(status==='db'){data.status='public_static';data.output_format='db';delete data.expand_tags;}
  // Map the SQLite legacy field while refusing to copy source preview/revision state.
  if(typeof source.custom_css==='string'&&typeof source.css!=='string')data.css=source.custom_css;
  return data as unknown as PageData;
}

/** A component read by the data tool. */
export function normalizeImportedComponent(source: Record<string, unknown>): ComponentData {
  if (!record(source) || typeof source.html !== 'string') throw new Error('Invalid component data.');
  const data:Record<string,unknown>={};
  for(const key of COMPONENT_STRINGS){const value=source[key];if(value!==undefined){if(typeof value!=='string'||value.length>300_000)throw new Error(`Invalid component field: ${key}`);data[key]=value;}}
  for(const key of ['is_global','is_wrapper','is_ai_doc'] as const){const value=source[key];if(value!==undefined){if(typeof value!=='boolean')throw new Error(`Invalid component field: ${key}`);data[key]=value;}}
  return data as unknown as ComponentData;
}
