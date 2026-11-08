import type {Env} from './types';
import {sha256} from './devices';
import type {PageData} from './types';
import {normalizeStatus} from './storage';
import {publishedPath,publicUrlPath} from './output-formats';
/** Hash of the page source as loaded, so the build and the page list compare the same thing. */
export const sourceHash=(data:PageData)=>sha256(JSON.stringify(data));
// Where each page stands on the public site, for the globe icon in the page list.
// live: the public page shows the current source. stale: it is public but older than
// the source, or not public yet. none: never published. A change that alters other
// pages (a page list component, for instance) only shows once those pages are rebuilt.
export type PublicState={url:string;state:'live'|'stale'|'none'};
export interface PublicationStatus {pages:Record<string,PublicState>;publishedAt:string|null;stale:number}
export async function publicationStatus(env:Env,origin:string,list:Array<{id:string;data:PageData}>):Promise<PublicationStatus>{
 const base=(env.PUBLIC_SITE_URL||origin).replace(/\/$/,'');
 const publication=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();
 const published=publication?JSON.parse(publication.value) as {paths?:string[];published_at?:string}:{};
 const paths=new Set(published.paths||[]),publishedAt=published.published_at||null;
 const built=new Map((await env.DB.prepare('SELECT id,built_at,source_hash FROM static_pages').all<{id:string;built_at:string;source_hash:string|null}>()).results.map(row=>[row.id,row]));
 const pages:Record<string,PublicState>={};let stale=0;
 for(const row of list){
  const status=normalizeStatus(row.data.status||'draft'),url=base+publicUrlPath(row.id,row.data);
  const page=built.get(row.id),path=publishedPath(row.id,row.data);
  const onSite=paths.has(path);
  const current=status==='public_static'&&!!page&&page.source_hash===await sourceHash(row.data)&&!!publishedAt&&page.built_at<=publishedAt;
  const state=current&&onSite?'live':onSite?'stale':'none';
  if(state!=='live'&&(status==='public_static'||onSite))stale++;
  pages[row.id]={url,state};
 }
 const currentPaths=new Set(list.flatMap(row=>{const path=publishedPath(row.id,row.data);return path.endsWith('.html')?[path,'/'+row.id+'.md']:[path];}));
 // Published page files whose page is gone (system files, media and scripts are not pages).
 const pageFile=(path:string)=>/\.(?:html|md|json|xml|csv|txt|js|css)$/.test(path)&&!/^\/(?:mikanbox|media|component-js)\//.test(path)&&!['/sitemap.xml','/rss.xml','/podcast.xml'].includes(path);
 for(const path of paths)if(pageFile(path)&&!currentPaths.has(path))stale++;
 return {pages,publishedAt,stale};
}
