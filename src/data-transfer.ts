import type {Env,PageData,ComponentData,Settings} from './types';
import {validId,reservedPageId} from './validation';
import {loadSettings,saveSettings} from './storage';
import {inspectMedia,publishedHash} from './media-store';
import {MEDIA_COUNT_LIMIT,validMediaName} from './media-policy';
import {normalizeImportedPage,normalizeImportedComponent} from './content-import';
import {audit} from './audit';
/** Inside one batch only: the database's own records skip the writes between these two (migration 0027). */
const quietOn=(env:Env)=>env.DB.prepare("INSERT INTO settings(key,value) VALUES('audit_quiet','1') ON CONFLICT(key) DO NOTHING");
const quietOff=(env:Env)=>env.DB.prepare("DELETE FROM settings WHERE key='audit_quiet'");
import {trackingIdValid} from './tracking';
/**
 * Data tool: Save and Read, the same as the PHP editions (shared/lib/data-transfer.php). One ZIP layout:
 * data/settings.json (content settings only), data/posts/<id>.json, data/components/<id>.json,
 * data/revisions/<page id>.json ([{created_at, editor, data}], when history is included), media/<name>.
 * The browser builds the ZIP from transferExport() and the public site, and reads files with
 * data-transfer.js: data in parts, then each media file (checked), then finish; the media then go to the
 * public site with a full build whose new files come from the file that was read, and are recorded once
 * the public site carries them (as uploads are: published first, then recorded).
 * Ways to read: add (only what is missing), overwrite (the same ID or name), replace (the site becomes the
 * file, for the kinds the file holds). Users, devices, the site ID and the keys are never read.
 */
export const TRANSFER_SETTINGS=['site_name','description','keywords','ogp_image','category_candidates','registered_categories','memo','ai_prompt','pages_per_page','media_per_page','tracking_id','tracking_head_code','tracking_body_code','tracking_component','system_lang'] as const;
export const TRANSFER_MODES=['add','overwrite','replace'] as const;
export type TransferMode=typeof TRANSFER_MODES[number];
type Item={id:string;data:Record<string,unknown>};
export const transferMode=(value:unknown):TransferMode=>(TRANSFER_MODES as readonly string[]).includes(String(value))?String(value) as TransferMode:'add';
const contentSettings=(settings:Record<string,unknown>)=>Object.fromEntries(TRANSFER_SETTINGS.filter(key=>Object.hasOwn(settings,key)).map(key=>[key,settings[key]]));

/** What the browser puts in the ZIP; the media files themselves it reads from the public site. */
export async function transferExport(env:Env,withHistory:boolean){
 const [pages,components,revisions,media]=await Promise.all([
  env.DB.prepare('SELECT id,data FROM posts ORDER BY id').all<{id:string;data:string}>(),
  env.DB.prepare('SELECT id,data FROM components ORDER BY id').all<{id:string;data:string}>(),
  withHistory?env.DB.prepare('SELECT post_id,data,created_at,editor_id FROM post_revisions ORDER BY id').all<{post_id:string;data:string;created_at:string;editor_id:string}>():Promise.resolve({results:[]}),
  env.DB.prepare('SELECT key,size,etag,source FROM media ORDER BY key').all<{key:string;size:number;etag:string;source:string|null}>()]);
 const history=new Map<string,Array<{created_at:string;editor:string;data:unknown}>>();
 for(const row of revisions.results){try{const list=history.get(row.post_id)||[];list.push({created_at:row.created_at,editor:row.editor_id,data:JSON.parse(row.data)});history.set(row.post_id,list);}catch{}}
 const parse=(rows:Array<{id:string;data:string}>)=>rows.flatMap(row=>{try{return [{id:row.id,data:JSON.parse(row.data)}];}catch{return [];}});
 return {settings:contentSettings(await loadSettings(env) as Record<string,unknown>),pages:parse(pages.results),components:parse(components.results),
  revisions:[...history].map(([id,items])=>({id,items})),media:media.results.map(row=>({key:row.key,size:row.size,etag:row.etag,from:row.source||'/media/'+encodeURIComponent(row.key)}))};
}

/** One part of the data: {settings?, pages, components, revisions}. */
/** The browser sends about 1 MB at a time; larger parts are refused. */
export const TRANSFER_PART_LIMIT={bytes:4_000_000,records:1000};
export async function transferImportData(env:Env,mode:TransferMode,part:Record<string,unknown>,editor:string){
 const count=(value:unknown)=>Array.isArray(value)?value.length:0;
 if(count(part.pages)+count(part.components)+count(part.revisions)>TRANSFER_PART_LIMIT.records)throw new Error('The part is too large.');
 const result={pages:0,components:0,skipped:0,refused:[] as string[],settings:false};
 if(mode!=='add'&&part.settings&&typeof part.settings==='object'){
  const current=await loadSettings(env) as Record<string,unknown>;
  for(const [key,value] of Object.entries(contentSettings(part.settings as Record<string,unknown>))){
   if(!(value===null||['string','number','boolean'].includes(typeof value))||(typeof value==='string'&&value.length>300_000))continue;
   // Values are checked as the settings screen checks them.
   if(key==='tracking_id'&&!trackingIdValid(String(value??'')))continue;
   if((key==='pages_per_page'||key==='media_per_page')&&!(Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=1000))continue;
   current[key]=value;
  }
  result.settings=await saveSettings(env,current as Settings);
 }
 const now=new Date().toISOString(),added=new Set<string>(),statements:D1PreparedStatement[]=[];
 const list=(value:unknown):Item[]=>Array.isArray(value)?value.filter((item):item is Item=>!!item&&typeof item.id==='string'&&!!item.data&&typeof item.data==='object'):[];
 for(const [kind,table] of [['pages','posts'],['components','components']] as const){
  const items=list(part[kind]);if(!items.length)continue;
  const existing=new Set((await env.DB.prepare(`SELECT id FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(items.map(i=>i.id))).all<{id:string}>()).results.map(r=>r.id));
  for(const item of items){
   const exists=existing.has(item.id);
   if(!exists&&(kind==='pages'?(!validId(item.id)||reservedPageId(item.id)):!validId(item.id,true))){result.refused.push(item.id);continue;}
   if(mode==='add'&&exists){result.skipped++;continue;}
   let data:PageData|ComponentData;
   try{data=kind==='pages'?normalizeImportedPage(item.data):normalizeImportedComponent(item.data);}catch{result.refused.push(item.id);continue;}
   if(kind==='pages'){
    const page=data as PageData;
    // Overwriting keeps the previous content in the page history; replacing takes the file's history (or none).
    if(exists&&mode==='overwrite')statements.push(env.DB.prepare('INSERT INTO post_revisions(post_id,data,created_at,editor_id) SELECT id,data,?,? FROM posts WHERE id=?').bind(now,editor,item.id));
    if(mode==='replace')statements.push(env.DB.prepare('DELETE FROM post_revisions WHERE post_id=?').bind(item.id));
    statements.push(env.DB.prepare('INSERT INTO posts(id,data,status,sort_order,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,status=excluded.status,sort_order=excluded.sort_order,updated_at=excluded.updated_at')
     .bind(item.id,JSON.stringify(page),page.status,page.sort_order||0,page.updated_at||''));
    if(!exists)added.add(item.id);
    result.pages++;
   }else{
    statements.push(env.DB.prepare('INSERT INTO components(id,data,is_wrapper) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,is_wrapper=excluded.is_wrapper').bind(item.id,JSON.stringify(data),(data as ComponentData).is_wrapper?1:0));
    result.components++;
   }
  }
 }
 for(const entry of Array.isArray(part.revisions)?part.revisions:[]){
  if(!entry||typeof entry.id!=='string'||!Array.isArray(entry.items)||!(mode==='replace'||added.has(entry.id)))continue;
  for(const item of entry.items.slice(-10)){
   // History entries are page data like any other: checked the same way, with a real date.
   if(!item||typeof item.created_at!=='string'||Number.isNaN(Date.parse(item.created_at))||!item.data||typeof item.data!=='object')continue;
   let data:PageData;try{data=normalizeImportedPage(item.data);}catch{continue;}
   const author=String(item.editor||'').replace(/[^A-Za-z0-9_.@-]/g,'').slice(0,80);
   statements.push(env.DB.prepare('INSERT INTO post_revisions(post_id,data,created_at,editor_id) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=?)').bind(entry.id,JSON.stringify(data),new Date(item.created_at).toISOString(),author,entry.id));
  }
 }
 // One record for the reading (repeated parts merge into it), not a line per page: the 'audit_quiet'
 // setting exists only inside this batch, so the database's own records skip these writes.
 if(statements.length)await env.DB.batch([quietOn(env),...statements,quietOff(env)]);
 if(result.pages||result.components||result.settings)await audit(env,'data_imported',{actor:editor,target:mode});
 return result;
}

/**
 * One media file, checked as on upload. Like an upload it is published first and recorded after
 * (transferRecordMedia): here it only says whether the file is to be read, and what it is.
 */
export async function transferImportMedia(env:Env,mode:TransferMode,name:string,bytes:Uint8Array){
 const file=await inspectMedia(name,bytes);
 if(mode==='add'&&await env.DB.prepare('SELECT 1 FROM media WHERE key=?').bind(name).first())return {outcome:'skipped' as const};
 return {outcome:'pending' as const,media:{name,hash:file.hash,size:file.size,content_type:file.content_type,etag:file.etag,width:file.width,height:file.height}};
}

/** After the publication: records the files the public site now carries with exactly that content. */
export async function transferRecordMedia(env:Env,items:unknown,actor='system',mode=''){
 if(!Array.isArray(items)||items.length>MEDIA_COUNT_LIMIT)throw new Error('Invalid media list.');
 let recorded=0;
 for(const item of items){
  if(!item||!validMediaName(String(item.name))||!/^[a-f0-9]{64}$/.test(String(item.etag))||String(item.etag).slice(0,32)!==item.hash)continue;
  if(await publishedHash(env,'/media/'+item.name)!==item.hash)continue;
  const exists=!!await env.DB.prepare('SELECT 1 FROM media WHERE key=?').bind(item.name).first();
  const [,r]=await env.DB.batch([quietOn(env),env.DB.prepare(`INSERT INTO media(key,content_type,size,uploaded,etag,hash,width,height,source) SELECT ?,?,?,?,?,?,?,?,NULL WHERE ? OR (SELECT COUNT(*) FROM media)<?
    ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type,size=excluded.size,uploaded=excluded.uploaded,etag=excluded.etag,hash=excluded.hash,width=excluded.width,height=excluded.height,source=NULL`)
   .bind(item.name,String(item.content_type),Number(item.size),new Date().toISOString(),item.etag,item.hash,Number.isInteger(item.width)?item.width:null,Number.isInteger(item.height)?item.height:null,exists?1:0,MEDIA_COUNT_LIMIT),quietOff(env)]);
  if(r.meta.changes)recorded++;
 }
 if(recorded)await audit(env,'data_imported',{actor,target:mode});
 return recorded;
}

/** The end of a reading: replace deletes, for each kind the file held, what the file did not have. */
export async function transferFinish(env:Env,mode:TransferMode,keep:Record<string,unknown>,actor:string,request?:Request){
 const deleted={pages:0,components:0,media:0};
 if(mode!=='replace')return deleted;
 const names=(value:unknown)=>Array.isArray(value)?JSON.stringify(value.map(String)):null;
 const run=async(sql:string,list:string)=>Number((await env.DB.prepare(sql).bind(list).run()).meta.changes||0);
 const pages=names(keep.pages),components=names(keep.components),media=names(keep.media);
 if(pages){
  await env.DB.prepare('DELETE FROM post_revisions WHERE post_id NOT IN (SELECT value FROM json_each(?))').bind(pages).run();
  deleted.pages=await run('DELETE FROM posts WHERE id NOT IN (SELECT value FROM json_each(?))',pages);
 }
 if(components)deleted.components=await run('DELETE FROM components WHERE id NOT IN (SELECT value FROM json_each(?))',components);
 if(media)deleted.media=await run('DELETE FROM media WHERE key NOT IN (SELECT value FROM json_each(?))',media);
 await audit(env,'data_restored',{actor,target:'import-replace',request});
 return deleted;
}
