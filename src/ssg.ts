import type { Env } from './types';
import { loadSettings, listPages, listComponents } from './storage';
import { MikanBoxRenderer, type ImageSizeCache } from './renderer';
import { publicationHash } from './static-publication';
import { sourceHash } from './publish-status';
import { pageOutputFormat, isDataFormat, isApiFormat, formatHasHtml, formatHasMarkdown, publishedPath } from './output-formats';

/**
 * Build every public page into static_pages. Data-format and mikanBox DB pages are built
 * first, so the {{PAGE_URL:ID}} of HTML and Markdown pages carries the hash of what was
 * actually built (as the PHP SSG does). Each row records the file it publishes in `path`;
 * HTML + Markdown pages keep their Markdown version in `md` (published at /id.md).
 */
export async function buildStatic(env: Env, request: Request) {
  const settings=await loadSettings(env),statements:D1PreparedStatement[]=[],snapshot={pages:await listPages(env),components:await listComponents(env)};
  const imageCache:ImageSizeCache=new Map();
  const output:Array<{id:string,html:string,built_at:string,hash:string,source_hash:string,path:string,md:string|null,md_hash:string|null}>=[];
  const renderer=(id:string)=>{const url=new URL(request.url);url.pathname=id==='index'?'/':`/${id}`;url.search='';return new MikanBoxRenderer(env,settings,new Request(url),snapshot,{imageCache});};
  const published=snapshot.pages.filter(({data})=>data.status==='public_static');
  const dataFirst=[...published.filter(({data})=>{const f=pageOutputFormat(data);return isDataFormat(f)||isApiFormat(f);}),...published.filter(({data})=>{const f=pageOutputFormat(data);return !isDataFormat(f)&&!isApiFormat(f);})];
  const dataHashes=new Map<string,string>();
  for(const {id,data} of dataFirst) {
    const format=pageOutputFormat(data),builder=renderer(id);builder.setDataHashes(dataHashes);
    let body:string|null,md:string|null=null;
    if(isApiFormat(format))body=await builder.renderApi(id);
    else if(isDataFormat(format))body=await builder.renderData(id);
    else if(!formatHasHtml(format))body=await builder.renderMarkdown(id);
    else {
      const result=await builder.render(id);
      if(result.status!==200)throw new Error(`Static render failed: ${id}`);
      body=result.html;
      if(formatHasMarkdown(format))md=await renderer(id).renderMarkdown(id);
    }
    if(body===null)throw new Error(`Static render failed: ${id}`);
    if(isDataFormat(format)||isApiFormat(format))dataHashes.set(id,await MikanBoxRenderer.dataHash(body));
    const bytes=new TextEncoder().encode(body);
    output.push({id,html:body,built_at:new Date().toISOString(),hash:await publicationHash(bytes),source_hash:await sourceHash(data),path:publishedPath(id,data),md,md_hash:md===null?null:await publicationHash(new TextEncoder().encode(md))});
  }
  let chunk:typeof output=[],bytes=2;
  const insert=()=>{if(chunk.length)statements.push(env.DB.prepare(`INSERT INTO static_pages(id,html,built_at,hash,source_hash,path,md,md_hash)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.html'),json_extract(value,'$.built_at'),json_extract(value,'$.hash'),json_extract(value,'$.source_hash'),json_extract(value,'$.path'),json_extract(value,'$.md'),json_extract(value,'$.md_hash') FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET html=excluded.html,built_at=excluded.built_at,hash=excluded.hash,source_hash=excluded.source_hash,path=excluded.path,md=excluded.md,md_hash=excluded.md_hash`).bind(JSON.stringify(chunk)));chunk=[];bytes=2;};
  for(const row of output){const size=new TextEncoder().encode(JSON.stringify(row)).byteLength+1;if(size>1_500_000)throw new Error('Static HTML exceeds the D1 per-row limit.');if(bytes+size>1_500_000)insert();chunk.push(row);bytes+=size;}insert();
  if(statements.length>40)throw new Error('Too much static HTML for one build.');
  statements.push(env.DB.prepare("DELETE FROM static_pages WHERE id NOT IN (SELECT id FROM posts WHERE status='public_static')"));
  await env.DB.batch(statements);
}
