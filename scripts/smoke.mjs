import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const base='http://localhost:8788';
const variables=await readFile(new URL('../.dev.vars',import.meta.url),'utf8');
const token=variables.match(/^SETUP_TOKEN=(.+)$/m)?.[1];
assert.ok(token,'Local setup token missing.');
let cookie='';
async function request(path,body,extra={}) {
  const headers={...extra};if(cookie)headers.Cookie=cookie;
  return fetch(base+path,{method:body?'POST':'GET',body,headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
}
const initial=await(await request('/admin')).text();
const login=initial.includes('name="setup_token"')
  ?{login_action:'set_initial_password',username:'cloud-smoke',display_name:'Cloud検証用',new_password:'local-smoke-password',setup_token:token}
  :{login_action:'login',username:'cloud-smoke',password:'local-smoke-password'};
let response=await request('/admin',new URLSearchParams(login));
assert.equal(response.status,303,'Smoke account setup/login failed; no account will be overwritten.');
cookie=response.headers.get('set-cookie').split(';')[0];
let adminHtml=await(await request('/admin')).text();
const csrf=adminHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1];assert.ok(csrf);
async function action(data,path='/admin') {
  const response=await request(path,new URLSearchParams({...data,csrf_token:csrf,ajax_request:'1'}));
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.success,true);return result;
}
await action({save_action:'save_comp',id:'cloud_smoke_layout',old_id:'cloud_smoke_layout',comp_type:'wrapper',html:'<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">{{HEAD_CSS}}{{HEAD_JS}}</head><body><h1>{{PAGE_TITLE}}</h1>{{CONTENT}}</body></html>',css:'body{font-family:system-ui;max-width:800px;margin:60px auto;line-height:1.8}'});
for(const [id,status,title,content] of [
  ['index','public_dynamic','Cloudflare版のローカル検証','# Cloudflare版の開発用プレビュー\n\nページ・デザイン・メディア・サイトの管理操作を検証しています。'],
  ['cloud-smoke-draft','draft','下書きの検証','NONPUBLIC-DRAFT'],
  ['cloud-smoke-pending','pending','承認待ちの検証','NONPUBLIC-PENDING'],
  ['cloud-smoke-static','public_static','公開HTMLの検証','# Static snapshot']
]) {
  await action({save_action:'save_page',id,title,status,content_md:content,wrapper_comp:'cloud_smoke_layout',category:'Cloud検証'}).catch(async error=>{
    // A rerun only updates known smoke fixtures through the current revision tag.
    const body=await(await request('/admin?view=pages&edit='+encodeURIComponent(id))).text();
    const expected=body.match(/name="expected_revision" value="([^"]*)"/)?.[1];if(!expected)throw error;
    await action({save_action:'save_page',id,old_id:id,expected_revision:expected,title,status,content_md:content,wrapper_comp:'cloud_smoke_layout',category:'Cloud検証'});
  });
}
await action({save_action:'build_ssg'});
assert.equal((await fetch(base+'/cloud-smoke-draft')).status,404);
assert.equal((await fetch(base+'/cloud-smoke-pending')).status,404);
assert.equal((await fetch(base+'/cloud-smoke-static')).status,200);
assert.match(await(await fetch(base+'/')).text(),/Cloudflare版の開発用プレビュー/);
response=await request('/admin',new URLSearchParams({save_action:'save_memo',memo:'bad',csrf_token:'bad',ajax_request:'1'}));assert.equal(response.status,403);
assert.equal((await request('/admin.css')).status,200);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5EAAAAASUVORK5CYII=','base64');
const media=new FormData();media.set('save_action','upload_media');media.set('csrf_token',csrf);media.set('ajax_request','1');media.set('image',new File([bytes],'cloud-smoke.png',{type:'image/png'}));
response=await request('/admin',media);const upload=await response.json();
if(!upload.success)assert.match(upload.message,/already exists/);
response=await fetch(base+'/media/cloud-smoke.png');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
await action({save_action:'generate_api_key'});
adminHtml=await(await request('/admin')).text();
const key=adminHtml.match(/value="([a-f0-9]{64})" readonly aria-label="MCP API key"/)?.[1];assert.ok(key);
response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_site_info',arguments:{}}})});
const rpc=await response.json();assert.equal(rpc.result.isError,false);const info=JSON.parse(rpc.result.content[0].text);assert.notEqual(info.site_id,'site-56ae1fb3a5c501fc');
response=await request('/admin',new URLSearchParams({save_action:'download_backup_data',csrf_token:csrf}));assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(new Uint8Array(await response.arrayBuffer())[0],0x50);
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/live-smoke.json',import.meta.url),JSON.stringify({passed:true,runtime:'Wrangler local D1/R2',checks:['setup/login','page/component writes','private-page access','static snapshot','CSRF rejection','CSS assets','R2 upload/read','authenticated MCP site identity','ZIP export'],port:8788},null,2));
console.log('Live smoke passed: local authentication, D1, R2, static publication, MCP, and ZIP export.');
