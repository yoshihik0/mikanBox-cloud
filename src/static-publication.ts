import type { Env } from './types';
import { getMediaObject, listMediaFiles, loadSettings } from './storage';
import { validId } from './validation';
import { validMediaName, CODE_MEDIA_TYPES } from './media-policy';
import { MikanBoxRenderer } from './renderer';
import { generateSitemapXml, generateRssXml, generatePodcastXml } from './feeds';
import { splitMode, publicRequest } from './site-split';
import { contentTypeForExtension, RESERVED_OUTPUT_FILES } from './output-formats';

// Paths the Worker must answer itself. Everything else is served from the
// published static assets, falling through to the Worker when no file exists.
// /media/* is absent on purpose: published images are static files, and images
// not yet published still reach the Worker through that fall-through.
export const WORKER_FIRST_ROUTES=['/admin','/admin/*','/mikanBox/*','/mcp','/public-mcp','/public-help.html','/api/*','/preview/*','/preview-media/*'];
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
export const PUBLICATION_PUBLIC_ASSETS=['/mikanbox/ai-question.js','/mikanbox/preview-editor.js','/mikanbox/admin.css','/mikanbox/cloud-admin.js','/mikanbox/cloud-publish.js','/mikanbox/cloud-media.js','/mikanbox/cloud-backup.js','/mikanbox/cloud-storage.js','/mikanbox/cloud-import.js','/mikanbox/cloud-release.json'] as const;
const assetTypes=new Map<string,string>(PUBLICATION_PUBLIC_ASSETS.map(path=>[path,path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8']));
const imageTypes:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',...CODE_MEDIA_TYPES};
const blockedRoots=new Set(['preview','admin','api','mcp','public-mcp','public-help','media','mikanbox','component-js','sitemap.xml','rss.xml','podcast.xml']);
const encode=new TextEncoder();
const STATIC_HEADERS=`/*
  X-Mikanbox-Delivery: static
  X-Content-Type-Options: nosniff

/media/*
  Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'
`;
function safePage(id:string):boolean {return validId(id)&&!blockedRoots.has(id.split('/')[0].toLowerCase());}
// The file a built page publishes (static_pages.path; rows built before output formats are HTML).
const PAGE_PATH="COALESCE(s.path,CASE WHEN s.id='index' THEN '/index.html' ELSE '/'||s.id||'.html' END)";
/** A built page's file: /id.html, /id.md, /id.<data extension> or /api/id.json, never a system file name. */
function safeOutput(id:string,path:string):boolean {
  if(!safePage(id))return false;
  if(path==='/api/'+id+'.json')return true;
  const m=path.match(/^\/(.+)\.(html|md|json|xml|csv|txt|js|css)$/);
  return !!m&&m[1]===id&&!RESERVED_OUTPUT_FILES.includes(path.slice(1).toLowerCase());
}
function outputType(path:string):string {
  if(path.endsWith('.html'))return 'text/html; charset=utf-8';
  return contentTypeForExtension(path.slice(path.lastIndexOf('.')+1));
}
function safeImage(name:string):boolean {return validMediaName(name)&&Object.hasOwn(imageTypes,name.split('.').pop()!.toLowerCase());}
function safePath(path:string):boolean {return path.startsWith('/')&&!path.includes('..')&&!/[\\%?#\x00-\x20\x7f]/.test(path)&&!path.includes('//');}
function checked(file:PublicationFile):PublicationFile {
  if(file.body.byteLength>PUBLICATION_FILE_BYTES)throw new Error('Publication file exceeds 25 MiB: '+file.path);
  return file;
}

const FEEDS:Record<string,typeof generateSitemapXml>={'/sitemap.xml':generateSitemapXml,'/rss.xml':generateRssXml,'/podcast.xml':generatePodcastXml};
// Only the scripts public pages load; the admin scripts stay on the admin Worker.
const SPLIT_PUBLIC_ASSETS=new Set(['/mikanbox/ai-question.js']);
// mikanBox DB answers cross-origin requests through the CORS rules headersFor() adds.
const SPLIT_HEADERS=STATIC_HEADERS;
// Cloudflare's static delivery types a file by its extension, and in production the type
// comes without "charset=utf-8" (checked on a deployed site, 2026-11-09), so UTF-8 text is
// garbled. _headers therefore sets the Content-Type of every text extension a page can publish
// with one wildcard rule each (/*.md and so on). Cloudflare matches the rules against the
// requested path, not the target of a _redirects rewrite, so the aliases of Markdown-only pages
// (/id, /id/) and of mikanBox DB (/api/id) get exact rules too. XML keeps exact rules per file,
// because sitemap.xml, rss.xml and podcast.xml have their own types and two rules that both set
// Content-Type on one path are joined with a comma. Markdown and data outputs (and mikanBox DB)
// also allow cross-origin reads, as in PHP, so external Markdown viewers and scripts can fetch
// them; each path gets that header from exactly one rule for the same reason. HTML gets none.
// Cloudflare allows 100 rules.
const HEADER_RULE_LIMIT=100;
const WILDCARD_TYPES=['html','md','txt','csv','js','css','json'] as const;
const FEED_TYPES:Record<string,string>={'/sitemap.xml':'application/xml; charset=utf-8','/rss.xml':'application/rss+xml; charset=utf-8','/podcast.xml':'application/rss+xml; charset=utf-8'};
const CORS='  Access-Control-Allow-Origin: *\n';
const headerRule=(path:string,type:string,cors=!type.startsWith('text/html'))=>`${path}\n  Content-Type: ${type}\n${cors?CORS:''}`;
async function headersFor(env:Env):Promise<string> {
 const base=splitMode(env)?SPLIT_HEADERS:STATIC_HEADERS;
 const rules=WILDCARD_TYPES.map(ext=>headerRule('/*.'+ext,outputType('/x.'+ext)));
 for(const [path,type] of Object.entries(FEED_TYPES))rules.push(headerRule(path,type,false));
 const {files,aliases}=await publishedRoutes(env);
 // Aliases first: a page whose alias gets no rule is garbled at its usual URL.
 for(const [source,target] of aliases)if(!/\.html$/.test(target))rules.push(headerRule(source,outputType(target)));
 for(const path of files)if(path.endsWith('.xml'))rules.push(headerRule(path,outputType(path)));
 const used=base.split(/\n(?=\/)/).length;
 return base+'\n'+rules.slice(0,Math.max(0,HEADER_RULE_LIMIT-used)).join('\n');
}
/** Published page files, and the URL aliases (_redirects 200 rewrites) that serve them. */
async function publishedRoutes(env:Env):Promise<{files:string[];aliases:Map<string,string>}> {
 const rows=(await env.DB.prepare(`SELECT p.id,p.status,CASE WHEN s.id IS NULL THEN NULL ELSE ${PAGE_PATH} END path FROM posts p LEFT JOIN static_pages s ON s.id=p.id ORDER BY p.id`).all<{id:string;status:string;path:string|null}>()).results;
 const all=new Set(rows.map(row=>row.id)),aliases=new Map<string,string>(),api:Array<[string,string]>=[],files:string[]=[];
 for(const row of rows) {
  if(row.status!=='public_static'||!row.path||!safeOutput(row.id,row.path))continue;
  files.push(row.path);
  // mikanBox DB: /api/ID.json is the file, /api/ID its alias.
  if(row.path.startsWith('/api/')){api.push(['/api/'+row.id,row.path]);continue;}
  // HTML pages answer /id and /id/; so do Markdown-only pages, with their .md file. Data pages only answer /id.<ext>.
  if(!/\.(?:html|md)$/.test(row.path))continue;
  const target=row.path;
  aliases.set('/'+row.id,target);aliases.set('/'+row.id+'/',target);
  if(row.id==='index')aliases.set('/',target);
  if(row.id.endsWith('/index')) {
   const parent=row.id.slice(0,-6);
   if(!all.has(parent)){aliases.set('/'+parent,target);aliases.set('/'+parent+'/',target);}
  }
 }
 // The standard search box submits to index.php?page=search&q=…; the static search
 // page passes the query on to Google (see generateSearchResults).
 if(aliases.has('/search'))aliases.set('/index.php',aliases.get('/search')!);
 // The public Worker runs no code, so DB pages are served from their built JSON.
 for(const [source,target] of api)aliases.set(source,target);
 return {files,aliases};
}
async function redirects(env:Env):Promise<string> {
 const {aliases}=await publishedRoutes(env);
 if([...aliases.keys()].filter(path=>!path.startsWith('/api/')&&path!=='/index.php').length>2000)throw new Error('Publication exceeds the 2,000 URL alias limit.');
 return [...aliases].map(([source,target])=>`${source} ${target} 200`).join('\n')+'\n';
}

/** Metadata only: snapshots, user records, settings and image bytes are never loaded here. */
export async function publicationManifest(env:Env):Promise<PublicationManifest> {
  const entries:PublicationItem[]=[];
  // The hash stored at build time lets publication skip reading unchanged pages.
  const pages=await env.DB.prepare(`SELECT p.id,${PAGE_PATH} path,length(CAST(s.html AS BLOB)) size,s.hash,length(CAST(s.md AS BLOB)) md_size,s.md_hash FROM posts p JOIN static_pages s ON s.id=p.id WHERE p.status='public_static' ORDER BY p.id`).all<{id:string;path:string;size:number;hash:string|null;md_size:number|null;md_hash:string|null}>();
  for(const row of pages.results) {
    if(!safeOutput(row.id,row.path))continue;
    entries.push({path:row.path,kind:row.path.startsWith('/api/')?'api':'page',id:row.id,size:row.size,hash:row.hash});
    // HTML + Markdown: the Markdown version sits beside the HTML at /id.md (no extra alias).
    if(row.md_size!==null&&safeOutput(row.id,'/'+row.id+'.md'))entries.push({path:'/'+row.id+'.md',kind:'page',id:row.id,size:row.md_size,hash:row.md_hash});
  }
  const components=await env.DB.prepare("SELECT id,length(CAST(json_extract(data,'$.js') AS BLOB)) size FROM components WHERE COALESCE(json_extract(data,'$.is_ai_doc'),0)=0 AND length(json_extract(data,'$.js'))>0 ORDER BY id").all<{id:string;size:number}>();
  for(const row of components.results)if(validId(row.id,true))entries.push({path:'/component-js/'+row.id+'.js',kind:'component',id:row.id,size:row.size});
  // Every stored file is published, not only the ones static pages reference:
  // dynamic pages read /media/* from the same static assets.
  for(const file of await listMediaFiles(env))if(safeImage(file.key))entries.push({path:'/media/'+file.key,kind:'media',id:file.key,size:file.size});
  for(const path of PUBLICATION_PUBLIC_ASSETS)if(!splitMode(env)||SPLIT_PUBLIC_ASSETS.has(path))entries.push({path,kind:'asset',id:path,size:null});
  if(splitMode(env)) {
    for(const path of Object.keys(FEEDS))entries.push({path,kind:'feed',id:path,size:null});
  }
  entries.push({path:'/_headers',kind:'headers',id:'_headers',size:encode.encode(await headersFor(env)).byteLength});
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
  if(path==='/_headers')return checked({path,body:encode.encode(await headersFor(env)),contentType:'text/plain; charset=utf-8'});
  if(splitMode(env)&&FEEDS[path]) {
    const xml=await FEEDS[path](env,await loadSettings(env),publicRequest(env,request));
    return checked({path,body:encode.encode(xml),contentType:path==='/sitemap.xml'?'application/xml; charset=utf-8':'application/rss+xml; charset=utf-8'});
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
  // Built pages: the file each one publishes, and the Markdown version of HTML + Markdown pages.
  const page=path.match(/^\/(?:api\/)?(.+)\.(html|md|json|xml|csv|txt|js|css)$/);
  if(page) {
    const id=page[1];if(!safeOutput(id,path))return null;
    const row=await env.DB.prepare(`SELECT ${PAGE_PATH} path,s.html,s.md FROM static_pages s JOIN posts p ON p.id=s.id WHERE p.id=? AND p.status='public_static'`).bind(id).first<{path:string;html:string;md:string|null}>();
    if(!row)return null;
    const body=row.path===path?row.html:path==='/'+id+'.md'&&row.md!==null?row.md:null;
    return body===null?null:checked({path,body:encode.encode(body),contentType:outputType(path)});
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
