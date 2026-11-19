import type {Env,PageData,ComponentData} from './types';
import {validMediaName} from './media-policy';
import {getMedia,publishedHash,renamedSource,type MediaFile} from './media-store';

type Edit={id:string,before:string,after:string};
const textFields=['content_md','css','js','ogp_image'];
function mediaReplace(text:string,old:string,name:string) {
  const escaped=old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return text.replace(new RegExp('(^|[^A-Za-z0-9_.-])'+escaped+'(?=$|[^A-Za-z0-9_.-])','g'),(_,prefix)=>prefix+name);
}
async function sourceRows(env:Env) {
  const [pages,components]=await Promise.all([env.DB.prepare('SELECT id,data FROM posts').all<{id:string,data:string}>(),env.DB.prepare('SELECT id,data FROM components').all<{id:string,data:string}>()]);
  return {pages:pages.results,components:components.results};
}
export async function mediaReferenceCount(env:Env,name:string) {
  const source=await sourceRows(env);
  const used=(row:{data:string},fields:string[])=>{const data=JSON.parse(row.data);return fields.some(field=>typeof data[field]==='string'&&mediaReplace(data[field],name,'__reference_probe__')!==data[field]);};
  const siteRow=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('settings').first<{value:string}>();
  const site=siteRow ? JSON.parse(siteRow.value) : {};
  const ogp=typeof site.ogp_image==='string' ? site.ogp_image : '';
  return source.pages.filter(row=>used(row,textFields)).length+source.components.filter(row=>used(row,['html','css','js'])).length+(mediaReplace(ogp,name,'__reference_probe__')!==ogp?1:0);
}
export async function mediaHasLockedReferences(env:Env,name:string) {
  const rows=await env.DB.prepare('SELECT posts.data FROM posts JOIN edit_locks ON edit_locks.post_id=posts.id WHERE edit_locks.expires_at>?').bind(Date.now()).all<{data:string}>();
  return rows.results.some(row=>{const data=JSON.parse(row.data);return textFields.some(field=>typeof data[field]==='string'&&mediaReplace(data[field],name,'__reference_probe__')!==data[field]);});
}
// A transaction-local marker gates every write. A stale page/component or an
// active editor prevents the entire operation, including the image rename.
async function commit(env:Env,pages:Edit[],components:Edit[],editor:string,extra:(marker:string)=>D1PreparedStatement[],additionalGuard='1',guardArgs:unknown[]=[]) {
  const marker='operation:'+crypto.randomUUID(),p=JSON.stringify(pages),c=JSON.stringify(components);
  if(p.length+c.length>1_500_000)throw new Error('Too many references for one operation.');
  const exists='EXISTS(SELECT 1 FROM settings WHERE key=?)';
  const statements=[env.DB.prepare(`INSERT INTO settings(key,value) SELECT ?,'temporary' WHERE
    NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN posts t ON t.id=json_extract(e.value,'$.id') WHERE t.id IS NULL OR t.data<>json_extract(e.value,'$.before'))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN components t ON t.id=json_extract(e.value,'$.id') WHERE t.id IS NULL OR t.data<>json_extract(e.value,'$.before'))
    AND NOT EXISTS(SELECT 1 FROM edit_locks WHERE expires_at>? AND post_id IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
    AND (${additionalGuard})`).bind(marker,p,c,Date.now(),p,...guardArgs),
    env.DB.prepare(`INSERT INTO post_revisions(post_id,data,created_at,editor_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.before'),?,? FROM json_each(?) WHERE ${exists}`).bind(new Date().toISOString(),editor,p,marker),
    env.DB.prepare(`UPDATE posts SET data=(SELECT json_extract(value,'$.after') FROM json_each(?) WHERE json_extract(value,'$.id')=posts.id),
      status=(SELECT json_extract(json_extract(value,'$.after'),'$.status') FROM json_each(?) WHERE json_extract(value,'$.id')=posts.id)
      WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${exists}`).bind(p,p,p,marker),
    env.DB.prepare(`UPDATE components SET data=(SELECT json_extract(value,'$.after') FROM json_each(?) WHERE json_extract(value,'$.id')=components.id) WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${exists}`).bind(c,c,marker),
    env.DB.prepare(`DELETE FROM static_pages WHERE (id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) OR json_array_length(?)>0) AND ${exists}`).bind(p,c,marker),
    ...extra(marker),
    env.DB.prepare('DELETE FROM settings WHERE key=?').bind(marker)
  ];
  const results=await env.DB.batch(statements);
  if(!results[0].meta.changes)throw new Error('他の編集があります。再読み込みしてください。 / Content changed or is being edited; reload and retry.');
}
/**
 * Renames a media file and the references to it. With `replacement` the file also gets new content
 * (resize, WebP conversion): that content is already on the public site at the new name, and is
 * recorded only when the last publication carries it there.
 */
export async function renameMediaReferences(env:Env,old:string,name:string,editor:string,replacement?:MediaFile&{expectedEtag?:string},updateReferences=true) {
  if(!validMediaName(old)||!validMediaName(name)||old===name||(!replacement&&old.split('.').pop()?.toLowerCase()!==name.split('.').pop()?.toLowerCase()))throw new Error('Check the filename and extension.');
  if(await getMedia(env,name))throw new Error('変更先のファイル名はすでに存在します。 / The target filename already exists.');
  const image=await getMedia(env,old);if(!image)throw new Error('Image not found.');
  if(replacement?.expectedEtag&&replacement.expectedEtag.replace(/^"|"$/g,'')!==String(image.etag))throw new Error('Image changed; reload and retry.');
  if(replacement&&await publishedHash(env,'/media/'+name)!==replacement.hash)throw new Error('公開サイトの画像と内容が一致しません。もう一度お試しください。 / The file on the public site does not match. Try again.');
  const source=await sourceRows(env),pages:Edit[]=[],components:Edit[]=[];
  const siteRow=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('settings').first<{value:string}>();
  const site=siteRow?JSON.parse(siteRow.value):null;
  const oldOgp=typeof site?.ogp_image==='string'?site.ogp_image:'';
  const newOgp=mediaReplace(oldOgp,old,name),siteChanged=updateReferences&&newOgp!==oldOgp;
  if(siteChanged)site.ogp_image=newOgp;
  const siteGuard=siteChanged?' AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)':'',siteArgs=siteChanged?['settings',siteRow!.value]:[];
  const siteWrites=(marker:string)=>siteChanged?[env.DB.prepare('UPDATE settings SET value=? WHERE key=? AND EXISTS(SELECT 1 FROM settings WHERE key=?)').bind(JSON.stringify(site),'settings',marker),env.DB.prepare('DELETE FROM static_pages WHERE EXISTS(SELECT 1 FROM settings WHERE key=?)').bind(marker)]:[];

  for(const row of updateReferences?source.pages:[]){const data=JSON.parse(row.data) as PageData;let changed=false;for(const field of textFields){const record=data as unknown as Record<string,unknown>;if(typeof record[field]==='string'){const next=mediaReplace(record[field],old,name);if(next!==record[field]){record[field]=next;changed=true;}}}if(changed){data.revision_tag=crypto.randomUUID();pages.push({id:row.id,before:row.data,after:JSON.stringify(data)});}}
  for(const row of updateReferences?source.components:[]){const data=JSON.parse(row.data) as ComponentData;let changed=false;for(const field of ['html','css','js']){const record=data as unknown as Record<string,unknown>;if(typeof record[field]==='string'){const next=mediaReplace(record[field],old,name);if(next!==record[field]){record[field]=next;changed=true;}}}if(changed)components.push({id:row.id,before:row.data,after:JSON.stringify(data)});}
  const baseGuard="EXISTS(SELECT 1 FROM media WHERE key=? AND etag IS ? AND uploaded=? AND size=?) AND NOT EXISTS(SELECT 1 FROM media WHERE key=?) AND NOT EXISTS(SELECT 1 FROM settings, json_each(settings.value,'$.paths') WHERE settings.key='static_publication' AND json_each.value=? AND ? IS NULL) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='publication_lock' AND json_extract(value,'$.expires')>?)"+siteGuard;
  const baseArgs=[old,image.etag,image.uploaded,image.size,name,'/media/'+name,replacement?'replacement':null,Date.now(),...siteArgs];
  if(replacement){
   const uploaded=new Date(Math.max(Date.now(),(Date.parse(image.uploaded)||0)+1)).toISOString();
   await commit(env,pages,components,editor,marker=>[env.DB.prepare('UPDATE media SET key=?,content_type=?,size=?,uploaded=?,etag=?,hash=?,width=?,height=?,source=NULL WHERE key=? AND EXISTS(SELECT 1 FROM settings WHERE key=?)').bind(name,replacement.content_type,replacement.size,uploaded,replacement.etag,replacement.hash,replacement.width,replacement.height,old,marker),...siteWrites(marker)],baseGuard,baseArgs);
   return {pages:pages.length,components:components.length};
  }
  // Same content, new name: until the next build the file is still served from where it was.
  await commit(env,pages,components,editor,marker=>[env.DB.prepare('UPDATE media SET key=?,source=? WHERE key=? AND EXISTS(SELECT 1 FROM settings WHERE key=?)').bind(name,renamedSource(image),old,marker),...siteWrites(marker)],baseGuard,baseArgs);
  return {pages:pages.length,components:components.length};
}
export async function removeCategory(env:Env,category:string,editor:string) {
  const settings=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('settings').first<{value:string}>();if(!settings)throw new Error('Settings not found.');
  const next=JSON.parse(settings.value);next.category_candidates=String(next.category_candidates||'').split(',').map((v:string)=>v.trim()).filter((v:string)=>v&&v!==category).join(', ');
  const rows=await env.DB.prepare('SELECT id,data FROM posts').all<{id:string,data:string}>(),pages:Edit[]=[];
  for(const row of rows.results){const data=JSON.parse(row.data) as PageData,previous=(data.category||'').split(',').map(v=>v.trim()).filter(Boolean);if(!previous.includes(category))continue;data.category=previous.filter(v=>v!==category).join(', ');data.revision_tag=crypto.randomUUID();pages.push({id:row.id,before:row.data,after:JSON.stringify(data)});}
  await commit(env,pages,[],editor,marker=>[env.DB.prepare('UPDATE settings SET value=? WHERE key=? AND EXISTS(SELECT 1 FROM settings WHERE key=?)').bind(JSON.stringify(next),'settings',marker)],'EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)',['settings',settings.value]);
  return pages.length;
}
