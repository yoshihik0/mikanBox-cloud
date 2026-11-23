const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
function environment() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(__dirname,'../migrations')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  const DB={
    prepare(sql) {return {
      sql,args:[],bind(...args){this.args=args.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value);return this;},
      async first(column){const row=sqlite.prepare(sql).get(...this.args);return column?(row?.[column]??null):(row??null);},
      async all(){return {success:true,results:sqlite.prepare(sql).all(...this.args)};},
      async run(){
        const statement=sqlite.prepare(sql);
        if(/\bRETURNING id\s*$/i.test(sql)){
          const results=statement.all(...this.args);
          return {success:true,results,meta:{changes:results.length}};
        }
        const r=statement.run(...this.args);
        return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};
      }
    };},
    async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(/^\s*select/i.test(statement.sql)?await statement.all():await statement.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
  };
  // The public site is always a Worker of its own: admin at cloud.test, public site at www.cloud.test.
  return {DB,sqlite,JWT_SECRET:'test-secret-'.repeat(4),SETUP_TOKEN:'test-setup-token',CLOUDFLARE_WORKER_NAME:'cloud-admin',CLOUDFLARE_PUBLIC_WORKER_NAME:'cloud-public',PUBLIC_SITE_URL:'https://www.cloud.test'};
}
const worker=require('../.test-build/src/index.js').default;
async function call(env,url='/admin',data,cookie) {
  const headers={};if(cookie)headers.Cookie=cookie;
  const options={headers};
  if(data){options.method='POST';options.body=new URLSearchParams(data);}
  return worker.fetch(new Request('https://cloud.test'+url,options),env);
}
// Registers a device through the real setup form for the first user; later users get a device directly.
async function login(env,username='admin',display_name='Admin') {
  const devices=require('../.test-build/src/devices.js');
  let cookie;
  if(!env.sqlite.prepare('SELECT 1 FROM users').get()) {
    const page=await call(env,'/admin'),csrfCookie=page.headers.get('Set-Cookie').match(/login_csrf=([^;]+)/);
    const response=await worker.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:csrfCookie[0]},body:new URLSearchParams({login_action:'setup',csrf_token:csrfCookie[1],setup_token:env.SETUP_TOKEN,username,display_name,device_name:'Test device'})}),env);
    if(response.status!==303)throw new Error(await response.text());
    cookie=response.headers.get('Set-Cookie').split(';')[0];
  } else {
    env.sqlite.prepare("INSERT INTO users(username,display_name,auth_version) VALUES(?,?,1) ON CONFLICT(username) DO NOTHING").run(username,display_name);
    cookie=(await devices.createDevice(env,username,'Test device',new Request('https://cloud.test/admin'))).cookie.split(';')[0];
  }
  const session=await devices.deviceSession(new Request('https://cloud.test/admin',{headers:{Cookie:cookie}}),env);
  return {cookie,csrf_token:session.csrf,username};
}
async function post(env,auth,data,url='/admin') {
  const response=await call(env,url,{...data,csrf_token:auth.csrf_token,ajax_request:'1'},auth.cookie);
  return {response,data:await response.json()};
}
// Public pages are only served as built static files, so tests that check page
// output render it the way the build does instead of requesting it from the Worker.
async function publicView(env,path='/') {
  const {MikanBoxRenderer}=require('../.test-build/src/renderer.js'),{loadSettings}=require('../.test-build/src/storage.js');
  const url=new URL('https://cloud.test'+path),id=url.pathname.replace(/^\/+|\/+$/g,'').replace(/\.html$/,'')||'index';
  const result=await new MikanBoxRenderer(env,await loadSettings(env),new Request(url)).render(id);
  return {status:result.status,text:async()=>result.html};
}
/**
 * Media files live on the public site and D1 holds their information. putMedia records a file as if it had
 * been published (the default) and keeps its bytes in env.publicFiles, the mock public site's content.
 */
async function putMedia(env,name,bytes) {
  const {inspectMedia}=require('../.test-build/src/media-store.js');
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),file=await inspectMedia(name,data);
  env.sqlite.prepare('INSERT INTO media(key,content_type,size,uploaded,etag,hash,width,height) VALUES(?,?,?,?,?,?,?,?)').run(name,file.content_type,file.size,new Date().toISOString(),file.etag,file.hash,file.width,file.height);
  (env.publicFiles||(env.publicFiles=new Map())).set('/media/'+name,data);
  return file;
}
/**
 * A mock Cloudflare account and public site for publication: upload sessions ask only for unknown hashes
 * (or for every hash after forget()), uploads are kept by hash, a new version becomes the public site.
 * Requests to env.PUBLIC_SITE_URL are answered from that site. Call restore() when done.
 */
function mockCloudflare(env) {
  Object.assign(env,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token',ASSETS:env.ASSETS||{fetch:async request=>new Response('asset:'+new URL(request.url).pathname)}});
  const original=global.fetch,known=new Map(),site=new Map(),calls=[];
  for(const [path,bytes] of env.publicFiles||[]){const hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex').slice(0,32);known.set(hash,bytes);site.set(path,hash);}
  let active='v0',version=0,session=null,forgotten=false;
  const ok=result=>Response.json({success:true,result});
  global.fetch=async(url,init={})=>{
    url=String(url?.url||url);calls.push(url);
    const base=String(env.PUBLIC_SITE_URL||'').replace(/\/$/,'');
    if(base&&url.startsWith(base+'/')){const path=decodeURI(new URL(url).pathname),hash=site.get(path);return hash?new Response(known.get(hash),{headers:{'Access-Control-Allow-Origin':'*'}}):new Response('Not Found',{status:404});}
    if(url.endsWith('/deployments')&&init.method!=='POST')return ok({deployments:[{versions:[{version_id:active,percentage:100}]}]});
    if(url.endsWith('/assets-upload-session')){session=JSON.parse(init.body).manifest;const need=[...new Set(Object.values(session).map(v=>v.hash).filter(h=>forgotten||!known.has(h)))];return ok({jwt:need.length?'upload':'done',buckets:need.length?[need]:[]});}
    if(url.includes('/workers/assets/upload')){for(const [hash,blob] of init.body.entries()){const text=await blob.text();known.set(hash,Uint8Array.from(Buffer.from(text,'base64')));}return ok({jwt:'done'});}
    if(/\/versions$/.test(url)&&init.method==='POST'){version++;env.lastVersionMetadata=JSON.parse(await init.body.get('metadata').text());return ok({id:'v'+version});}
    if(url.endsWith('/deployments')&&init.method==='POST'){active='v'+version;site.clear();for(const [path,v] of Object.entries(session||{}))site.set(path,v.hash);forgotten=false;return ok({});}
    if(original&&!/api\.cloudflare\.com/.test(url))return original(url,init);
    throw new Error('Unexpected Cloudflare call: '+url);
  };
  return {site,known,calls,forget(){forgotten=true;},restore(){global.fetch=original;}};
}
/** What cloud-publish.js does in the browser, through the same admin actions (media bytes from options or the public site). */
async function browserPublish(env,auth,{rebuild=false,excluded=[],mediaOnly='',newMedia=null,bytes=null,source=null}={}) {
  const crypto=require('node:crypto'),digest=b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,32);
  const act=async(name,data={},lease='')=>{const fields={save_action:name};for(const [k,v] of Object.entries(data))fields[k]=typeof v==='string'?v:JSON.stringify(v);if(lease)fields.publication_lease=lease;const r=await post(env,auth,fields);if(!r.data.success)throw new Error(r.data.message);return r.data;};
  const begin=await act('publication_begin',{rebuild:rebuild?'1':'0',excluded,media_only:mediaOnly,...(newMedia?{new_media:newMedia}:{})}),lease=begin.job;
  const byPath=new Map(begin.entries.map(e=>[e.path,e]));
  const read=async(path)=>{
    if(path.startsWith('/media/')){
      if(newMedia&&path==='/media/'+newMedia.name)return {bytes,type:newMedia.content_type};
      const held=source?await source(path):null;if(held)return held;
      const r=await fetch(String(env.PUBLIC_SITE_URL).replace(/\/$/,'')+(byPath.get(path)?.source||path));if(!r.ok)throw new Error('Not on the public site: '+path);return {bytes:new Uint8Array(await r.arrayBuffer()),type:r.headers.get('Content-Type')||'application/octet-stream'};
    }
    const r=await call(env,'/admin?publication_file='+encodeURIComponent(path),undefined,auth.cookie);if(!r.ok)throw new Error('Publication source is unavailable: '+path);return {bytes:new Uint8Array(await r.arrayBuffer()),type:r.headers.get('Content-Type')};
  };
  try{
    const items=[];for(const e of begin.entries.filter(e=>!e.hash)){const f=await read(e.path);items.push({path:e.path,hash:digest(f.bytes),size:f.bytes.length,contentType:f.type});}
    for(let i=0;i<items.length;i+=20)await act('publication_hashes',{items:items.slice(i,i+20)},lease);
    const prepared=await act('publication_prepare',{},lease);
    for(const item of prepared.uploads){const f=await read(item.path);const form=new FormData();form.set('save_action','publication_upload');form.set('csrf_token',auth.csrf_token);form.set('ajax_request','1');form.set('publication_lease',lease);form.set('hash',item.hash);form.set('asset_data',new File([Buffer.from(f.bytes).toString('base64')],item.hash,{type:f.type}));
      const r=await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:auth.cookie},body:form}),env);const j=await r.json();if(!j.success)throw new Error(j.message);}
    return await act('publication_finish',{},lease);
  }catch(error){await act('publication_cancel',{},lease).catch(()=>{});throw error;}
}
/** cloud-publish.js cloudPublishNewMedia: media_prepare, then publish exactly those bytes. Returns what was published. */
async function publishNewMedia(env,auth,file,fields={}) {
  const form=new FormData();for(const [k,v] of Object.entries(fields))form.set(k,v);form.set('image',file);form.set('save_action','media_prepare');form.set('csrf_token',auth.csrf_token);form.set('ajax_request','1');
  const prepared=await(await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:auth.cookie},body:form}),env)).json();
  if(!prepared.success)throw new Error(prepared.message);
  await browserPublish(env,auth,{mediaOnly:prepared.media.name,newMedia:prepared.media,bytes:new Uint8Array(await file.arrayBuffer())});
  return prepared.media;
}
/** The media screen's upload: prepare, publish the bytes, then record (as views.ts doUpload). */
async function uploadThroughAdmin(env,auth,filename,bytes,fields={}) {
  const multipart=async data=>{const form=new FormData();for(const [k,v] of Object.entries(data))form.set(k,v);form.set('csrf_token',auth.csrf_token);form.set('ajax_request','1');
    const r=await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:auth.cookie},body:form}),env);return r.json();};
  const file=new File([bytes],filename);
  const prepared=await multipart({save_action:'media_prepare',image:file,...fields});if(!prepared.success)return prepared;
  await browserPublish(env,auth,{mediaOnly:prepared.media.name,newMedia:prepared.media,bytes:new Uint8Array(bytes)});
  return {...await multipart({save_action:'upload_media',media_name:prepared.media.name,image:file}),media:prepared.media};
}
/** The MCP API key as settings hold it: only its fingerprint (src/mcp.ts mcpKeyStore). */
const mcpKey=key=>'sha256:'+require('node:crypto').createHash('sha256').update(key).digest('hex');
/** The MCP API keys as settings hold them: a list of {name,hash,created}. */
const mcpKeys=(...keys)=>keys.map(key=>({name:'',hash:mcpKey(key),created:0}));
module.exports={mcpKey,mcpKeys,environment,call,login,post,publicView,putMedia,mockCloudflare,browserPublish,uploadThroughAdmin,publishNewMedia};
