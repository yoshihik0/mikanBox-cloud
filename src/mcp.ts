import {assertNotPublished,checkPublicationLock} from './publication-state';
import type { Env, PageData, ComponentData } from './types';
import {CLOUD_VERSION,negotiatedProtocol} from './version';
import { loadSettings, listPages, loadComponent, listComponents, saveComponent, deleteComponent, uploadMedia } from './storage';
import { MEDIA_FILE_LIMIT, validMediaName, mediaType, isCodeMedia } from './media-policy';
import { pageId, componentId, pageStatus } from './validation';
import { verifyCsrf } from './auth';
import { saveWithRevision, revisions } from './revisions';
import { buildStatic } from './ssg';
const string={type:'string'};
const boolean={type:'boolean'};
const pageFields=Object.fromEntries(['title','category','description','keywords','ogp_image','content_md','css','js','wrapper_comp','memo','updated_at'].map(key=>[key,string]));
const pageProperties={id:string,...pageFields,status:{type:'string',enum:['draft','pending','public_dynamic','public_static','db']},is_html:boolean,exclude_tracking:boolean,sort_order:{type:'number'},data:{type:'object'},expected_revision:string};
const componentProperties={id:string,...Object.fromEntries(['html','css','js','memo'].map(key=>[key,string])),is_global:boolean,is_wrapper:boolean,is_ai_doc:boolean,data:{type:'object'}};
const tool=(name:string,description:string,properties:Record<string,unknown>={},required:string[]=[])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:/^(?:get_|list_)/.test(name),destructiveHint:/^(?:update_|delete_)/.test(name),idempotentHint:/^(?:update_|delete_)/.test(name)||name==='build_ssg',untrustedContentHint:/^(?:get_|list_)/.test(name)&&!['get_site_info','get_settings'].includes(name),openWorldHint:false}});
const tools=[
  tool('get_site_info','Identify this Cloud site before writing.'),
  tool('list_pages','List pages, including draft and pending pages.'),
  tool('get_page','Get an editable page.',{id:string},['id']),
  tool('create_page','Create a page. Pass fields directly, or in the legacy data object.',pageProperties,['id']),
  tool('update_page','Update selected page fields; preserve unspecified fields.',pageProperties,['id']),
  tool('delete_page','Delete a page and its history.',{id:string},['id']),
  tool('list_components','List components.'),
  tool('get_component','Get a component.',{id:string},['id']),
  tool('create_component','Create a component without overwriting an existing one. A leading _ marks a standard component. Omit it for ordinary new or duplicated components; use it only when the user intends standard classification. Preserve existing standard IDs.',componentProperties,['id']),
  tool('update_component','Update selected fields. Legacy data arguments also support upsert.',componentProperties,['id']),
  tool('delete_component','Delete a component.',{id:string},['id']),
  tool('get_revisions','Get the last 50 saved revisions.',{id:string},['id']),
  tool('get_settings','Get site settings without credentials.'),
  tool('get_ai_context','Read all site-specific AI instruction documents before planning changes.'),
  tool('list_ai_docs','List AI instruction documents.'),
  tool('get_ai_doc','Read an AI instruction document. The .md suffix is optional.',{id:string},['id']),
  tool('update_ai_doc','Create or update an AI instruction document.',{id:string,html:string,css:string},['id','html']),
  tool('upload_media','Upload media (JPEG, PNG, GIF, WebP, SVG, UTF-8 JS or CSS; up to 10MB). Existing names are never overwritten.',{filename:string,content_base64:string,category:string},['filename','content_base64']),
  tool('build_ssg','Rebuild all public_static snapshots.')
];
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected an object.');
  return value as Record<string,unknown>;
}
function fields(args:Record<string,unknown>,allowed:Record<string,unknown>) {
  const nested=args.data===undefined?{}:object(args.data);
  for(const key of Object.keys(nested))if(!(key in allowed)||['id','data','expected_revision'].includes(key))throw new Error(`Unknown field: ${key}`);
  for(const key of Object.keys(nested))if(key in args)throw new Error(`Ambiguous field: ${key}`);
  return {...nested,...Object.fromEntries(Object.entries(args).filter(([key])=>!['id','data','expected_revision'].includes(key)))};
}
async function exactPage(env:Env,id:string):Promise<PageData|null> {
  const row=await env.DB.prepare('SELECT data FROM posts WHERE id=?').bind(id).first<{data:string}>();
  return row?JSON.parse(row.data):null;
}
function aiId(value:unknown) {const id=String(value||'');return componentId(id.endsWith('.md')?id:id+'.md');}
function decodeImage(encoded:string):Uint8Array<ArrayBuffer> {
  const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
  if(encoded.length%4!==0||/[^A-Za-z0-9+/]/.test(encoded.slice(0,encoded.length-padding)))throw new Error('Invalid Base64 image.');
  const bytes=new Uint8Array(encoded.length/4*3-padding);
  // Decode in blocks so a 10MB upload never builds a large intermediate number array.
  let offset=0;
  for(let start=0;start<encoded.length;start+=65536) {
    const block=atob(encoded.slice(start,start+65536));
    for(let index=0;index<block.length;index++)bytes[offset++]=block.charCodeAt(index);
  }
  return bytes;
}
export async function handleMcp(request:Request,env:Env):Promise<Response> {
  const settings=await loadSettings(env),key=String(settings.api_key||'');
  if(!key||!verifyCsrf(request.headers.get('Authorization')?.replace(/^Bearer /,'')||'',key))
    return Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:{Allow:'POST'}});
  let id:unknown=null;
  try {
    const body=object(await request.json());id=body.id;
    if(body.jsonrpc!=='2.0'||typeof body.method!=='string')throw new Error('Invalid JSON-RPC request.');
    const params=body.params?object(body.params):{};
    const result=(data:unknown)=>Response.json({jsonrpc:'2.0',id,result:data},{headers:{'Cache-Control':'no-store'}});
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    if(body.method==='initialize')return result({protocolVersion:negotiatedProtocol(params),capabilities:{tools:{}},serverInfo:{name:'mikanbox-cloud',version:CLOUD_VERSION},instructions:'A leading _ marks a standard component. Omit it for ordinary new or duplicated components; use it only when the user intends standard classification. Preserve existing standard IDs. Call get_site_info to confirm the target site, then get_ai_context before planning content, design, or code changes. Confirm get_site_info again before writes.'});
    if(body.method==='ping')return result({});
    if(body.method==='tools/list')return result({tools});
    if(body.method!=='tools/call')return Response.json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}},{status:400});
    const name=String(params.name||''),args=params.arguments?object(params.arguments):{};
    const definition=tools.find(t=>t.name===name);if(!definition)throw new Error('Unknown tool.');
    for(const key of definition.inputSchema.required)if(!(key in args))throw new Error(`Missing argument: ${key}`);
    for(const [key,value] of Object.entries(args)) {
      const schema=definition.inputSchema.properties[key] as {type:string}|undefined;
      if(!schema)throw new Error(`Unknown argument: ${key}`);
      if(schema.type==='object')object(value);
      else if(typeof value!==schema.type)throw new Error(`Invalid argument: ${key}`);
    }
    if(!/^(get_|list_)/.test(name))await checkPublicationLock(env);
    if(settings.demo_mode&&['create_page','update_page','delete_page','create_component','update_component','delete_component','update_ai_doc','upload_media','build_ssg'].includes(name))throw new Error('Demo mode is read-only.');
    let data:unknown;
    switch(name) {
      case 'get_site_info':data={site_id:settings.site_id,site_name:settings.site_name,site_url:settings.site_url||new URL(request.url).origin,environment:settings.site_environment||'unspecified',site_environment:settings.site_environment||'unspecified',edition:'cloud',version:CLOUD_VERSION};break;
      case 'list_pages': {
        const pages=(await listPages(env)).map(({id,data:page})=>({id,title:page.title||'',status:page.status||'draft',category:page.category||'',sort_order:page.sort_order||0,updated_at:page.updated_at||''}));
        data={pages,count:pages.length};break;
      }
      case 'get_page':data=await exactPage(env,pageId(String(args.id||'')));if(!data)throw new Error('Page not found.');data={id:args.id,...data};break;
      case 'create_page':case 'update_page': {
        const pid=pageId(String(args.id||'')),incoming=fields(args,pageProperties),previous=await exactPage(env,pid);
        if(name==='create_page'&&previous)throw new Error('Page already exists.');
        if(name==='update_page'&&!previous)throw new Error('Page not found.');
        if(name==='create_page'&&typeof incoming.title!=='string')throw new Error('A title is required.');
        const lock=await env.DB.prepare('SELECT owner FROM edit_locks WHERE post_id=? AND expires_at>?').bind(pid,Date.now()).first();
        if(lock)throw new Error('Page is being edited.');
        const next:PageData=previous?{...previous}:{title:'',status:'draft',preview_token:crypto.randomUUID()};
        for(const field of ['title','category','description','keywords','ogp_image','content_md','css','js','wrapper_comp','memo','updated_at']) {
          if(field in incoming){if(typeof incoming[field]!=='string')throw new Error(`Invalid field: ${field}`);(next as unknown as Record<string,unknown>)[field]=incoming[field];}
        }
        if('status'in incoming)next.status=pageStatus(String(incoming.status));
        if('exclude_tracking'in incoming){if(typeof incoming.exclude_tracking!=='boolean')throw new Error('Invalid exclude_tracking');next.exclude_tracking=incoming.exclude_tracking;}
        if('is_html'in incoming){if(typeof incoming.is_html!=='boolean')throw new Error('Invalid is_html');next.is_html=incoming.is_html;}
        if('sort_order'in incoming){if(typeof incoming.sort_order!=='number'||!Number.isFinite(incoming.sort_order))throw new Error('Invalid sort order');next.sort_order=incoming.sort_order;}
        next.preview_token||=crypto.randomUUID();if(!('updated_at' in incoming))next.updated_at=new Date().toISOString();
        const expected=typeof args.expected_revision==='string'?args.expected_revision:previous?.revision_tag||'';
        await saveWithRevision(env,pid,previous?pid:'',next,'MCP',expected);data={success:true,id:pid,...next};break;
      }
      case 'delete_page': {
        const pid=pageId(String(args.id||''));
        if(await env.DB.prepare('SELECT owner FROM edit_locks WHERE post_id=? AND expires_at>?').bind(pid,Date.now()).first())throw new Error('Page is being edited.');
        await env.DB.batch([env.DB.prepare('DELETE FROM posts WHERE id=?').bind(pid),env.DB.prepare('DELETE FROM post_revisions WHERE post_id=?').bind(pid),env.DB.prepare('DELETE FROM static_pages WHERE id=?').bind(pid)]);data={deleted:pid};break;
      }
      case 'list_components': {
        const components=(await listComponents(env)).map(({id,data:component})=>({id,is_global:!!component.is_global,is_wrapper:!!component.is_wrapper,is_ai_doc:!!component.is_ai_doc,html_length:new TextEncoder().encode(component.html||'').length}));
        data={components,count:components.length};break;
      }
      case 'get_component':data=await loadComponent(env,componentId(String(args.id||'')));if(!data)throw new Error('Component not found.');data={id:args.id,...data};break;
      case 'create_component':case 'update_component': {
        const cid=componentId(String(args.id||'')),incoming=fields(args,componentProperties),current=await loadComponent(env,cid),next:ComponentData=current?{...current}:{html:''};
        if(name==='create_component'&&current)throw new Error('Component already exists.');
        if(name==='update_component'&&!current&&args.data===undefined)throw new Error('Component not found.');
        for(const field of ['html','css','js','memo'])if(field in incoming){if(typeof incoming[field]!=='string')throw new Error(`Invalid field: ${field}`);(next as unknown as Record<string,unknown>)[field]=incoming[field];}
        for(const field of ['is_global','is_wrapper','is_ai_doc'])if(field in incoming){if(typeof incoming[field]!=='boolean')throw new Error(`Invalid field: ${field}`);(next as unknown as Record<string,unknown>)[field]=incoming[field];}
        if(next.is_ai_doc)await assertNotPublished(env,['/component-js/'+cid+'.js']);
        if(next.is_wrapper&&next.is_ai_doc)throw new Error('Invalid component type.');
        if(name==='create_component') {
          const saved=await env.DB.prepare('INSERT INTO components(id,data,is_wrapper) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(cid,JSON.stringify(next,null,2),next.is_wrapper?1:0).run();
          if(!saved.meta.changes)throw new Error('Component already exists.');
        }else if(!await saveComponent(env,cid,next))throw new Error('Save failed.');
        data={success:true,id:cid,...next};break;
      }
      case 'delete_component':await assertNotPublished(env,['/component-js/'+String(args.id||'')+'.js']);if(!await deleteComponent(env,componentId(String(args.id||''))))throw new Error('Delete failed.');data={deleted:args.id};break;
      case 'get_revisions':data=await revisions(env,pageId(String(args.id||'')));break;
      case 'get_settings':data=Object.fromEntries(Object.entries(settings).filter(([key])=>!/(?:password|secret|token|api.?key|credential)/i.test(key)&&!['_site_base','memo'].includes(key)));break;
      case 'get_ai_context':case 'list_ai_docs': {
        const docs=(await listComponents(env)).map(({id,data:component})=>({id,...component})).filter(doc=>doc.is_ai_doc);
        data=name==='get_ai_context'?{documents:docs.map(doc=>({id:doc.id,content_md:doc.html||''})),count:docs.length,component_naming:'A leading _ marks a standard component. Omit it for ordinary new or duplicated components; use it only when the user intends standard classification. Preserve existing standard IDs.'}:{ai_docs:docs.map(doc=>({id:doc.id,html_length:new TextEncoder().encode(doc.html||'').length})),count:docs.length};break;
      }
      case 'get_ai_doc': {
        const cid=aiId(args.id),current=await loadComponent(env,cid);if(!current?.is_ai_doc)throw new Error('AI document not found.');data={id:cid,...current};break;
      }
      case 'update_ai_doc': {
        const cid=aiId(args.id),current=await loadComponent(env,cid);if(current&&!current.is_ai_doc)throw new Error('Component is not an AI document.');
        const next:ComponentData=current?{...current}:{html:'',css:'',is_global:false,is_wrapper:false,is_ai_doc:true};
        next.html=String(args.html);if('css' in args)next.css=String(args.css);
        if(!await saveComponent(env,cid,next))throw new Error('Save failed.');data={success:true,id:cid,...next};break;
      }
      case 'upload_media': {
        const filename=String(args.filename).replace(/\.[^.]+$/,ext=>ext.toLowerCase()),category=String(args.category||'');
        if(category&&!/^[A-Za-z0-9_-]+$/.test(category))throw new Error('Invalid category.');
        const key=(!isCodeMedia(filename)&&category&&!/^[A-Za-z0-9]+_/.test(filename)?category+'_':'')+filename;
        if(!validMediaName(key))throw new Error('Invalid filename.');
        const encoded=String(args.content_base64);
        if(!encoded||encoded.length>4*Math.ceil(MEDIA_FILE_LIMIT/3))throw new Error('Invalid or oversized Base64 image.');
        const bytes=decodeImage(encoded),contentType=mediaType(bytes,key.split('.').pop()!.toLowerCase());
        if(!contentType||!bytes.length||bytes.length>MEDIA_FILE_LIMIT)throw new Error('Invalid or oversized image.');
        if(!await uploadMedia(env,key,bytes.buffer,contentType))throw new Error('Upload failed: name already exists or storage limit reached.');
        data={success:true,filename:key,url:new URL('/media/'+encodeURIComponent(key),request.url).href};break;
      }
      case 'build_ssg':await buildStatic(env,request);data={built:true};break;
    }
    return result({content:[{type:'text',text:JSON.stringify(data)}],isError:false});
  } catch(error) {
    const message=error instanceof Error&&!/D1_|SQLITE_|constraint|UNIQUE/.test(error.message)?error.message:'Request failed.';
    return Response.json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:message}],isError:true}},{headers:{'Cache-Control':'no-store'}});
  }
}
