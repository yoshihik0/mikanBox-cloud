import type { Env } from './types';
import { createZip, getMediaObject } from './storage';
import { validId } from './validation';
import { MEDIA_ZIP_LIMIT, MEDIA_CHUNK_SIZE, validMediaName } from './media-policy';

export interface StaticExportOptions { structure:'flat'|'directory'; siteUrl?:string }
const encode=new TextEncoder();
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function relative(from:string,to:string):string {
  const base=from.split('/').slice(0,-1),target=to.split('/');
  while(base.length&&target.length&&base[0]===target[0]){base.shift();target.shift();}
  return '../'.repeat(base.length)+target.join('/');
}
function outputPath(id:string,structure:StaticExportOptions['structure']) {
  return id==='index'?'index.html':structure==='flat'||id.endsWith('/index')?id+'.html':id+'/index.html';
}
interface PageRow {id:string;status:string;html:string|null}
interface MediaRow {key:string;size:number;upload_id:string|null;chunk_count:number;object_key:string|null}

/** Export already-built public snapshots; this operation never renders private content or writes data. */
export async function buildStaticExportZip(env:Env,request:Request,options:StaticExportOptions):Promise<Uint8Array> {
  if(!['flat','directory'].includes(options.structure))throw new Error('Invalid export structure.');
  const live=new URL(options.siteUrl||env.PUBLIC_SITE_URL||new URL(request.url).origin);
  if(!['https:','http:'].includes(live.protocol))throw new Error('Invalid site URL.');
  const basePath=live.pathname.replace(/\/$/,'');
  const siteOrigin=new URL(request.url).origin;
  const localOrigins=new Set([live.origin,siteOrigin]);
  if(env.PUBLIC_SITE_URL){const publicUrl=new URL(env.PUBLIC_SITE_URL);if(['https:','http:'].includes(publicUrl.protocol))localOrigins.add(publicUrl.origin);}
  const rows=(await env.DB.prepare("SELECT p.id,p.status,CASE WHEN p.status='public_static' THEN s.html ELSE NULL END html FROM posts p LEFT JOIN static_pages s ON s.id=p.id ORDER BY p.id").all<PageRow>()).results;
  const exactIds=new Set(rows.map(row=>row.id));
  const snapshots=rows.filter(row=>row.status==='public_static'&&row.html!==null&&validId(row.id));
  if(!snapshots.length)throw new Error('No built public_static pages to export. Build static pages first.');
  const paths=new Map(snapshots.map(row=>[row.id,outputPath(row.id,options.structure)]));
  if(new Set(paths.values()).size!==paths.size)throw new Error('Static export path collision. Rename pages with overlapping directory index URLs.');
  const components=(await env.DB.prepare("SELECT id,json_extract(data,'$.js') js FROM components WHERE COALESCE(json_extract(data,'$.is_ai_doc'),0)=0").all<{id:string;js:string|null}>()).results;
  const publicJs=new Map(components.filter(row=>validId(row.id,true)&&row.js).map(row=>[row.id,row.js!]));
  const media=new Set<string>(),assets=new Set<string>(),componentScripts=new Set<string>();
  const files: Array<{name:string;data:Uint8Array}>=[];
  let bytes=22; // ZIP end record, plus each file's two headers and names below.
  const add=(name:string,data:Uint8Array)=>{
    bytes+=data.length+76+2*encode.encode(name).length;
    if(bytes>MEDIA_ZIP_LIMIT)throw new Error('Static export ZIP exceeds 20 MB. Reduce images or page size.');
    files.push({name,data});
  };
  function resolve(raw:string,sourceUrl:URL):URL|null {
    if(!raw||/^(?:#|data:|javascript:|mailto:|tel:)/i.test(raw))return null;
    try {return new URL(raw.replace(/&amp;/g,'&'),sourceUrl);}catch{return null;}
  }
  function localPath(url:URL):string|null {
    if(!localOrigins.has(url.origin))return null;
    let path=url.pathname;
    if(url.origin===live.origin&&basePath&&(path===basePath||path.startsWith(basePath+'/')))path=path.slice(basePath.length)||'/';
    try{return decodeURIComponent(path);}catch{return null;}
  }
  function rewrite(raw:string,from:string,sourceUrl:URL):string {
    const url=resolve(raw,sourceUrl);if(!url)return raw;
    const pathname=localPath(url);if(pathname===null)return raw;
    const suffix=url.search+url.hash;
    if(pathname.startsWith('/media/')) {
      const key=pathname.slice(7);if(!validMediaName(key))return url.href;
      media.add(key);return relative(from,'media/'+key)+suffix;
    }
    if(pathname.startsWith('/component-js/')) {
      const id=pathname.slice(14).replace(/\.js$/,'');
      if(!publicJs.has(id))return url.href;
      componentScripts.add(id);return relative(from,'component-js/'+id+'.js')+suffix;
    }
    if(/^\/mikanbox\/[A-Za-z0-9_.\/-]+$/.test(pathname)&&!pathname.includes('..')&&!pathname.endsWith('/ai-question.js')) {
      assets.add(pathname);return relative(from,pathname.slice(1))+suffix;
    }
    let id=pathname.replace(/^\/|\/$/g,'').replace(/\.html$/,'')||'index';
    if(pathname==='/index.php'&&url.searchParams.has('page'))id=url.searchParams.get('page')!;
    const actual=exactIds.has(id)?id:exactIds.has(id+'/index')?id+'/index':id;
    if(paths.has(actual))return relative(from,paths.get(actual)!)+(pathname==='/index.php'?url.hash:suffix);
    // Unbuilt or dynamic pages and APIs remain live links rather than broken export paths.
    return url.href;
  }
  const css=(text:string,from:string,sourceUrl:URL)=>text.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,(_,quote,value)=>`url(${quote}${rewrite(value,from,sourceUrl)}${quote})`);
  function html(text:string,from:string,sourceUrl:URL):string {
    return text.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]+>/gi,(tag:string,kind:string|undefined)=>{
      if(tag.startsWith('<!--'))return tag;
      if(/^<base\b/i.test(tag))return '';
      if(kind?.toLowerCase()==='script') {
        const src=tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
        if(!src)return tag;
        const url=resolve(src[2],sourceUrl),path=url?localPath(url):null;
        if(path==='/mikanbox/ai-question.js')return '<!-- Cloud WebMCP is unavailable in a static export. -->';
        if(path?.startsWith('/component-js/')) {
          const id=path.slice(14).replace(/\.js$/,'');if(!publicJs.has(id))return '';
        }
      }
      if(/^<div\b[^>]*\bdata-mikanbox-ai-question\b/i.test(tag)) {
        return `<div class="mikanbox-export-ai-help"><a href="${escape(new URL('/public-help.html',siteOrigin).href)}">mikanBox Cloud Help / AIに質問</a>`;
      }
      if(kind?.toLowerCase()==='style')return css(tag,from,sourceUrl);
      return tag.replace(/\b(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi,(original,attr,quote,value)=>{const next=rewrite(value,from,sourceUrl);return next===value?original:`${attr}=${quote}${escape(next)}${quote}`;}).replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi,(original,quote,value)=>/\bdata:/i.test(value)?original:`srcset=${quote}${escape(value.split(',').map((item:string)=>{const parts=item.trim().split(/\s+/);parts[0]=rewrite(parts[0],from,sourceUrl);return parts.join(' ');}).join(', '))}${quote}`).replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi,(_,quote,value)=>`style=${quote}${css(value,from,sourceUrl)}${quote}`);
    });
  }
  for(const row of snapshots) {
    const from=paths.get(row.id)!;
    const sourceUrl=new URL((basePath||'')+'/'+(row.id==='index'?'':row.id+'/'),live.origin);
    add(from,encode.encode(html(row.html!,from,sourceUrl)));
  }
  // Assets are read only from the bundled public directory; no admin or API endpoint is fetched.
  const fetched=new Set<string>();
  while([...assets].some(path=>!fetched.has(path))) {
    const path=[...assets].find(path=>!fetched.has(path))!;fetched.add(path);
    if(fetched.size>100)throw new Error('Too many public assets for a static export.');
    if(!env.ASSETS)throw new Error('Public assets are unavailable for export.');
    const response=await env.ASSETS.fetch(new Request(new URL(path,siteOrigin)));
    if(!response.ok)throw new Error('Missing public asset: '+path);
    if(Number(response.headers.get('Content-Length')||0)>MEDIA_ZIP_LIMIT)throw new Error('Public asset exceeds export limit.');
    const data=new Uint8Array(await response.arrayBuffer());
    add(path.slice(1),path.endsWith('.css')?encode.encode(css(new TextDecoder().decode(data),path.slice(1),new URL(path,live.origin))):data);
  }
  for(const id of componentScripts)add('component-js/'+id+'.js',encode.encode(publicJs.get(id)!));
  if(media.size>39)throw new Error('Static export has too many image reads. Reduce included images.');
  const metadata=media.size?(await env.DB.prepare(`SELECT key,size,upload_id,chunk_count,object_key FROM media WHERE key IN (${[...media].map(()=>'?').join(',')})`).bind(...media).all<MediaRow>()).results:[];
  let queries=2+(media.size?1:0),predictedBytes=bytes;
  const accounted=new Set<string>();
  function account(key:string,row:MediaRow) {
    queries+=row.object_key?1:row.upload_id?1+(row.chunk_count||Math.ceil(row.size/MEDIA_CHUNK_SIZE)):2;
    if(queries>42)throw new Error('Static export exceeds the 42-query image budget. Reduce included images.');
    predictedBytes+=row.size+76+2*encode.encode('media/'+key).length;
    if(predictedBytes>MEDIA_ZIP_LIMIT)throw new Error('Static export ZIP exceeds 20 MB. Reduce images or page size.');
    accounted.add(key);
  }
  for(const key of media){const row=metadata.find(row=>row.key===key);if(!row)throw new Error('Missing image: '+key);account(key,row);}
  for(const key of media) {
    let row=metadata.find(row=>row.key===key);
    if(!row){queries++;row=await env.DB.prepare('SELECT key,size,upload_id,chunk_count,object_key FROM media WHERE key=?').bind(key).first<MediaRow>()||undefined;}
    if(!row)throw new Error('Missing image: '+key);
    if(!accounted.has(key))account(key,row);
    const object=await getMediaObject(env,key);if(!object)throw new Error('Missing image: '+key);
    if(bytes+object.size+76+2*encode.encode('media/'+key).length>MEDIA_ZIP_LIMIT)throw new Error('Static export ZIP exceeds 20 MB. Reduce images or page size.');
    const data=new Uint8Array(await object.arrayBuffer());
    // Uploaded stylesheets can themselves reference media; processing the Set
    // while iterating also discovers nested local CSS imports via url(...).
    add('media/'+key,key.toLowerCase().endsWith('.css')?encode.encode(css(new TextDecoder().decode(data),'media/'+key,new URL('/media/'+key,live.origin))):data);
  }
  return createZip(files);
}
