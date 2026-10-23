import type { Env } from './types';
import { getMediaObject, listMediaFiles, loadSettings } from './storage';
import { validId } from './validation';
import { validMediaName, CODE_MEDIA_TYPES } from './media-policy';
import { MikanBoxRenderer } from './renderer';
import { generateSitemapXml, generateRssXml, generatePodcastXml } from './feeds';
import { splitMode, publicRequest } from './site-split';

// Paths the Worker must answer itself. Everything else is served from the
// published static assets, falling through to the Worker when no file exists.
// /media/* is absent on purpose: published images are static files, and images
// not yet published still reach the Worker through that fall-through.
export const WORKER_FIRST_ROUTES=['/admin','/admin/*','/mikanBox/*','/mcp','/public-mcp','/public-help.html','/api/*','/index.php','/search','/search/*','/search.html','/preview/*'];
export const PUBLICATION_FILE_LIMIT=20_000;
export const PUBLICATION_FILE_BYTES=25*1024*1024;
export const PUBLICATION_MAP_BYTES=32*1024*1024;
export interface PublicationFile {path:string;body:Uint8Array;contentType:string}
export interface PublicationItem {path:string;kind:'page'|'media'|'component'|'asset'|'headers'|'redirects'|'feed'|'api';id:string;size:number|null;hash?:string|null}
/** Same digest the browser computes in cloud-publish.js: the first 32 hex digits of SHA-256. */
export async function publicationHash(bytes:Uint8Array):Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
export interface PublicationManifest {entries:PublicationItem[];count:number;totalKnownBytes:number}
// These are public source assets only. Never enumerate the workspace or include runtime files.
export const PUBLICATION_PUBLIC_ASSETS=['/mikanbox/ai-question.js','/mikanbox/admin.css','/mikanbox/cloud-admin.js','/mikanbox/cloud-publish.js','/mikanbox/cloud-media.js','/mikanbox/cloud-backup.js','/mikanbox/cloud-storage.js','/mikanbox/cloud-import.js','/mikanbox/cloud-release.json'] as const;
const assetTypes=new Map<string,string>(PUBLICATION_PUBLIC_ASSETS.map(path=>[path,path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8']));
const imageTypes:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',...CODE_MEDIA_TYPES};
const blockedRoots=new Set(['preview','admin','api','mcp','public-mcp','public-help','search','media','mikanbox','component-js','sitemap.xml','rss.xml','podcast.xml']);
const encode=new TextEncoder();
const STATIC_HEADERS=`/*
  X-Mikanbox-Delivery: static
  X-Content-Type-Options: nosniff

/media/*
  Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'
`;
function safePage(id:string):boolean {return validId(id)&&!blockedRoots.has(id.split('/')[0].toLowerCase());}
function safeImage(name:string):boolean {return validMediaName(name)&&Object.hasOwn(imageTypes,name.split('.').pop()!.toLowerCase());}
function safePath(path:string):boolean {return path.startsWith('/')&&!path.includes('..')&&!/[\\%?#\x00-\x20\x7f]/.test(path)&&!path.includes('//');}
function checked(file:PublicationFile):PublicationFile {
  if(file.body.byteLength>PUBLICATION_FILE_BYTES)throw new Error('Publication file exceeds 25 MiB: '+file.path);
  return file;
}

const FEEDS:Record<string,typeof generateSitemapXml>={'/sitemap.xml':generateSitemapXml,'/rss.xml':generateRssXml,'/podcast.xml':generatePodcastXml};
// Only the scripts public pages load; the admin scripts stay on the admin Worker.
const SPLIT_PUBLIC_ASSETS=new Set(['/mikanbox/ai-question.js']);
const SPLIT_HEADERS=STATIC_HEADERS+`
/api/*
  Access-Control-Allow-Origin: *
`;
const headersFor=(env:Env)=>splitMode(env)?SPLIT_HEADERS:STATIC_HEADERS;
async function dbPages(env:Env):Promise<string[]> {
 const rows=(await env.DB.prepare("SELECT id FROM posts WHERE status='db' ORDER BY id").all<{id:string}>()).results;
 return rows.map(row=>row.id).filter(id=>validId(id));
}
async function redirects(env:Env):Promise<string> {
 const rows=(await env.DB.prepare("SELECT p.id,p.status,CASE WHEN s.id IS NULL THEN 0 ELSE 1 END built FROM posts p LEFT JOIN static_pages s ON s.id=p.id ORDER BY p.id").all<{id:string;status:string;built:number}>()).results;
 const all=new Set(rows.map(row=>row.id)),aliases=new Map<string,string>();
 for(const row of rows) {
  if(row.status!=='public_static'||!row.built||!safePage(row.id))continue;
  const target=row.id==='index'?'/index.html':'/'+row.id+'.html';
  aliases.set('/'+row.id,target);aliases.set('/'+row.id+'/',target);
  if(row.id==='index')aliases.set('/',target);
  if(row.id.endsWith('/index')) {
   const parent=row.id.slice(0,-6);
   if(!all.has(parent)){aliases.set('/'+parent,target);aliases.set('/'+parent+'/',target);}
  }
 }
 if(aliases.size>2000)throw new Error('Publication exceeds the 2,000 URL alias limit.');
 // The public Worker runs no code, so DB pages are served from their built JSON.
 if(splitMode(env))for(const id of await dbPages(env))aliases.set('/api/'+id,'/api/'+id+'.json');
 return [...aliases].map(([source,target])=>`${source} ${target} 200`).join('\n')+'\n';
}

/** Metadata only: snapshots, user records, settings and image bytes are never loaded here. */
export async function publicationManifest(env:Env):Promise<PublicationManifest> {
  const entries:PublicationItem[]=[];
  // The hash stored at build time lets publication skip reading unchanged pages.
  const pages=await env.DB.prepare("SELECT p.id,length(CAST(s.html AS BLOB)) size,s.hash FROM posts p JOIN static_pages s ON s.id=p.id WHERE p.status='public_static' ORDER BY p.id").all<{id:string;size:number;hash:string|null}>();
  for(const row of pages.results)if(safePage(row.id))entries.push({path:row.id==='index'?'/index.html':'/'+row.id+'.html',kind:'page',id:row.id,size:row.size,hash:row.hash});
  const components=await env.DB.prepare("SELECT id,length(CAST(json_extract(data,'$.js') AS BLOB)) size FROM components WHERE COALESCE(json_extract(data,'$.is_ai_doc'),0)=0 AND length(json_extract(data,'$.js'))>0 ORDER BY id").all<{id:string;size:number}>();
  for(const row of components.results)if(validId(row.id,true))entries.push({path:'/component-js/'+row.id+'.js',kind:'component',id:row.id,size:row.size});
  // Every stored file is published, not only the ones static pages reference:
  // dynamic pages read /media/* from the same static assets.
  for(const file of await listMediaFiles(env))if(safeImage(file.key))entries.push({path:'/media/'+file.key,kind:'media',id:file.key,size:file.size});
  for(const path of PUBLICATION_PUBLIC_ASSETS)if(!splitMode(env)||SPLIT_PUBLIC_ASSETS.has(path))entries.push({path,kind:'asset',id:path,size:null});
  if(splitMode(env)) {
    for(const path of Object.keys(FEEDS))entries.push({path,kind:'feed',id:path,size:null});
    for(const id of await dbPages(env))entries.push({path:'/api/'+id+'.json',kind:'api',id,size:null});
  }
  entries.push({path:'/_headers',kind:'headers',id:'_headers',size:encode.encode(headersFor(env)).byteLength});
  if(entries.length>PUBLICATION_FILE_LIMIT)throw new Error('Publication exceeds 20,000 files.');
  entries.push({path:'/_redirects',kind:'redirects',id:'_redirects',size:encode.encode(await redirects(env)).byteLength});
  if(new Set(entries.map(item=>item.path)).size!==entries.length)throw new Error('Publication path collision.');
  for(const item of entries)if(item.size!==null&&item.size>PUBLICATION_FILE_BYTES)throw new Error('Publication file exceeds 25 MiB: '+item.path);
  return {entries,count:entries.length,totalKnownBytes:entries.reduce((total,item)=>total+(item.size||0),0)};
}

/** Recheck current visibility for each individual download; never trust a stale manifest. */
export async function readPublicationEntry(env:Env,request:Request,path:string):Promise<PublicationFile|null> {
  if(!safePath(path))return null;
  if(path==='/_redirects')return checked({path,body:encode.encode(await redirects(env)),contentType:'text/plain; charset=utf-8'});
  if(path==='/_headers')return checked({path,body:encode.encode(headersFor(env)),contentType:'text/plain; charset=utf-8'});
  if(splitMode(env)&&FEEDS[path]) {
    const xml=await FEEDS[path](env,await loadSettings(env),publicRequest(env,request));
    return checked({path,body:encode.encode(xml),contentType:path==='/sitemap.xml'?'application/xml; charset=utf-8':'application/rss+xml; charset=utf-8'});
  }
  if(splitMode(env)&&path.startsWith('/api/')&&path.endsWith('.json')) {
    const id=path.slice(5,-5);if(!(await dbPages(env)).includes(id))return null;
    const data=await new MikanBoxRenderer(env,await loadSettings(env),publicRequest(env,request)).getPageDataBlocks(id);
    return checked({path,body:encode.encode(JSON.stringify(data)),contentType:'application/json; charset=utf-8'});
  }
  const assetType=assetTypes.get(path);
  if(assetType) {
    if(!env.ASSETS)throw new Error('Bundled public assets are unavailable.');
    const response=await env.ASSETS.fetch(new Request(new URL(path,new URL(request.url).origin)));
    if(!response.ok)throw new Error('Missing bundled public asset: '+path);
    if(Number(response.headers.get('Content-Length')||0)>PUBLICATION_FILE_BYTES)throw new Error('Publication file exceeds 25 MiB: '+path);
    return checked({path,body:new Uint8Array(await response.arrayBuffer()),contentType:assetType});
  }
  if(path.startsWith('/media/')) {
    const key=path.slice(7);if(!safeImage(key))return null;
    const object=await getMediaObject(env,key);if(!object)return null;
    if(object.size>PUBLICATION_FILE_BYTES)throw new Error('Publication file exceeds 25 MiB: '+path);
    return checked({path,body:new Uint8Array(await object.arrayBuffer()),contentType:imageTypes[key.split('.').pop()!.toLowerCase()]});
  }
  if(path.startsWith('/component-js/')&&path.endsWith('.js')) {
    const id=path.slice(14,-3);if(!validId(id,true))return null;
    const row=await env.DB.prepare("SELECT json_extract(data,'$.js') js FROM components WHERE id=? AND COALESCE(json_extract(data,'$.is_ai_doc'),0)=0 AND length(json_extract(data,'$.js'))>0").bind(id).first<{js:string}>();
    return row?checked({path,body:encode.encode(row.js),contentType:'text/javascript; charset=utf-8'}):null;
  }
  if(path.endsWith('.html')) {
    const id=path.slice(1,-5);if(!safePage(id))return null;
    const row=await env.DB.prepare("SELECT s.html FROM static_pages s JOIN posts p ON p.id=s.id WHERE p.id=? AND p.status='public_static'").bind(id).first<{html:string}>();
    return row?checked({path,body:encode.encode(row.html),contentType:'text/html; charset=utf-8'}):null;
  }
  return null;
}

/** Consume and write one file at a time. Use separate requests per file when reading remote D1. */
export async function* publicationEntries(env:Env,request:Request):AsyncGenerator<PublicationFile> {
  const manifest=await publicationManifest(env);
  for(const item of manifest.entries) {
    const file=await readPublicationEntry(env,request,item.path);
    if(!file)throw new Error('Publication source changed or disappeared: '+item.path);
    yield file;
  }
}

/** Convenience for small local callers. Large sites must use publicationEntries/per-file download. */
export async function buildPublicationAssets(env:Env,request:Request):Promise<Map<string,{body:Uint8Array;contentType:string}>> {
  const assets=new Map<string,{body:Uint8Array;contentType:string}>();let bytes=0;
  for await(const file of publicationEntries(env,request)) {
    bytes+=file.body.byteLength;
    if(bytes>PUBLICATION_MAP_BYTES)throw new Error('Publication exceeds the 32 MiB in-memory limit. Use individual file downloads.');
    assets.set(file.path,{body:file.body,contentType:file.contentType});
  }
  return assets;
}
