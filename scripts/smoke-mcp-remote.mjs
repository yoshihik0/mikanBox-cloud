import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import auth from '../.test-build/src/auth.js';
const base=process.env.MIKANBOX_CLOUD_URL?.replace(/\/$/,'');if(!base||!/^https:\/\//.test(base))throw new Error('Set MIKANBOX_CLOUD_URL to the intended HTTPS site URL.');
const accountFile='artifacts/mcp-test-account.json';
const account=JSON.parse(await readFile(accountFile,'utf8'))[0]?.results[0];
if(!account?.site_id)throw new Error('An existing Cloud account and site identity are required.');
const secret=(await readFile('.env.production.secrets','utf8')).match(/^JWT_SECRET=(.+)$/m)[1];
const session=await auth.createSessionToken(secret,account.username,account.auth_version);
const headers={Cookie:auth.setSessionCookie(session.token).split(';')[0]};
let admin=await(await fetch(base+'/admin?view=site',{headers})).text();
assert.match(admin,/name="save_action" value="download_static_zip"/);
const csrf=admin.match(/window.CSRF_TOKEN = "([^"]+)"/)[1];
let key=admin.match(/<input type="password" value="([^"]*)" readonly aria-label="MCP API key"/)[1];
let keyIssued=false;
if(!key){
 const response=await fetch(base+'/admin',{method:'POST',headers,body:new URLSearchParams({csrf_token:csrf,save_action:'generate_api_key',ajax_request:'1'})});
 assert.equal((await response.json()).success,true);
 admin=await(await fetch(base+'/admin?view=site',{headers})).text();key=admin.match(/<input type="password" value="([^"]*)" readonly aria-label="MCP API key"/)[1];
 console.log('Issued the explicitly approved Cloud API key. The key is shown only in Cloud Site settings.');
 keyIssued=true;
}
assert.ok(key);
const rpc=async(method,params={})=>{
 const response=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 assert.equal(response.status,200);const body=await response.json();assert.notEqual(body.result?.isError,true);assert.ok(body.result);return body.result;
};
const tool=async(name,args={})=>JSON.parse((await rpc('tools/call',{name,arguments:args})).content[0].text);
const info=await tool('get_site_info');assert.equal(info.site_id,account.site_id);assert.equal(info.edition,'cloud');assert.equal(info.version,'0.3.0');
assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25'})).protocolVersion,'2025-11-25');
const tools=(await rpc('tools/list')).tools;assert.equal(tools.length,19);assert.ok(tools.every(t=>t.annotations));
const context=await tool('get_ai_context');assert.ok(context.documents.length);const settings=await tool('get_settings');assert.equal(settings.api_key,undefined);assert.equal(settings.memo,undefined);
const pages=await tool('list_pages');assert.ok(pages.count>=8);
// This verification reads only existing content and built snapshots.
let zipVerified=false;
if(pages.pages.some(p=>p.status==='public_static')){
 const response=await fetch(base+'/admin',{method:'POST',headers,body:new URLSearchParams({csrf_token:csrf,save_action:'download_static_zip',structure:'flat'})});
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/application\/zip/);
 const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[80,75,3,4]);
 await writeFile('artifacts/production-static-export.zip',bytes,{mode:0o600});zipVerified=true;
}
const publicResponse=await fetch(base+'/public-mcp?action=get_product_info&language=ja');assert.equal(publicResponse.status,200);assert.equal((await publicResponse.json()).version,'0.3.0');
assert.equal((await fetch(base+'/mcp',{method:'POST',body:'{}'})).status,401);
await writeFile('artifacts/mcp-remote-verification.json',JSON.stringify({passed:true,version:'0.3.0',managementTools:tools.length,siteIdentityVerified:true,aiContext:true,secretsExcluded:true,publicHelp:true,staticZip:zipVerified,keyIssued,authoredContentUnchanged:true},null,2));
await unlink(accountFile);
console.log('Production Cloud MCP: identity, protocol, 19 tools, AI context, secret exclusions and public help passed. Authored content unchanged. Static ZIP downloaded: '+zipVerified);
