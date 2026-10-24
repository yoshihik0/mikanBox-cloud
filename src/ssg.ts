import type { Env } from './types';
import { loadSettings, listPages, listComponents } from './storage';
import { MikanBoxRenderer } from './renderer';
import { publicationHash } from './static-publication';
import { sourceHash } from './publish-status';
export async function buildStatic(env: Env, request: Request) {
  const settings=await loadSettings(env),statements:D1PreparedStatement[]=[],snapshot={pages:await listPages(env),components:await listComponents(env)};
  const output:Array<{id:string,html:string,built_at:string,hash:string,source_hash:string}>=[];
  for(const {id,data} of snapshot.pages) {
    if(data.status!=='public_static')continue;
    const url=new URL(request.url);url.pathname=id==='index'?'/':`/${id}`;url.search='';
    const result=await new MikanBoxRenderer(env,settings,new Request(url),snapshot).render(id);
    if(result.status!==200)throw new Error(`Static render failed: ${id}`);
    output.push({id,html:result.html,built_at:new Date().toISOString(),hash:await publicationHash(new TextEncoder().encode(result.html)),source_hash:await sourceHash(data)});
  }
  let chunk:typeof output=[],bytes=2;
  const insert=()=>{if(chunk.length)statements.push(env.DB.prepare(`INSERT INTO static_pages(id,html,built_at,hash,source_hash)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.html'),json_extract(value,'$.built_at'),json_extract(value,'$.hash'),json_extract(value,'$.source_hash') FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET html=excluded.html,built_at=excluded.built_at,hash=excluded.hash,source_hash=excluded.source_hash`).bind(JSON.stringify(chunk)));chunk=[];bytes=2;};
  for(const row of output){const size=new TextEncoder().encode(JSON.stringify(row)).byteLength+1;if(size>1_500_000)throw new Error('Static HTML exceeds the D1 per-row limit.');if(bytes+size>1_500_000)insert();chunk.push(row);bytes+=size;}insert();
  if(statements.length>40)throw new Error('Too much static HTML for one build.');
  statements.push(env.DB.prepare("DELETE FROM static_pages WHERE id NOT IN (SELECT id FROM posts WHERE status='public_static')"));
  await env.DB.batch(statements);
}
