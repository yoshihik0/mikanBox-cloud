// Publishing uses the local Wrangler login; no Cloudflare credential is sent to the site.
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import auth from '../.test-build/src/auth.js';
import publication from '../.test-build/src/static-publication.js';
const config=JSON.parse(await readFile('wrangler.production.json','utf8'));
if(config.vars?.CLOUDFLARE_PUBLIC_WORKER_NAME) throw new Error('This legacy command cannot publish a separated site. Use the build button in the management screen.');
if(!config.account_id||!config.d1_databases?.[0]?.database_id||config.d1_databases[0].database_id==='YOUR_D1_DATABASE_ID')throw new Error('Configure your Cloudflare account and D1 database in wrangler.production.json.');
const base=process.env.MIKANBOX_CLOUD_URL?.replace(/\/$/,'');if(!base||!/^https:\/\//.test(base))throw new Error('Set MIKANBOX_CLOUD_URL to the intended HTTPS site URL.');
const excluded=new Set(process.argv.filter(a=>a.startsWith('--exclude=')).map(a=>a.slice(10)));
const run=(args,capture=false)=>{
 const result=spawnSync('npx',['wrangler',...args],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'},stdio:capture?'pipe':'inherit'});
 if(result.status!==0)throw new Error('Cloud publication command failed.');return result.stdout;
};
const raw=run(['d1','execute','DB','--remote','--config','wrangler.production.json','--json','--command',"SELECT username,auth_version FROM users ORDER BY username LIMIT 1"],true);
const user=JSON.parse(raw)[0]?.results?.[0];if(!user)throw new Error('Set up a Cloud account first.');
const secret=(await readFile('.env.production.secrets','utf8')).match(/^JWT_SECRET=(.+)$/m)?.[1];if(!secret)throw new Error('Cloud authentication secret is missing.');
const session=await auth.createSessionToken(secret,user.username,user.auth_version);
const headers={Cookie:auth.setSessionCookie(session.token).split(';')[0]};
const get=async(path)=>{const response=await fetch(base+path,{headers});if(!response.ok)throw new Error('Publication source request failed: '+response.status);return response;};
// The signed session already contains the CSRF token. Verify authentication
// using the publication endpoint without rendering unrelated admin panels.
const csrf=session.csrf;if(!csrf)throw new Error('Cloud authentication failed.');
await get('/admin?publication_manifest=1');
let lease='';
const post=async(data)=>{const response=await fetch(base+'/admin',{method:'POST',headers,body:new URLSearchParams({csrf_token:csrf,ajax_request:'1',publication_lease:lease,...data})});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'Publication request failed.');return result;};
lease=(await post({save_action:'begin_publication'})).lease;
try {
await post({save_action:'build_ssg'});
const manifest=await(await get('/admin?publication_manifest=1')).json();
const output=resolve('.publication');await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const published=[];
for(const entry of manifest.entries){
 // Also omit image entries returned by an older Worker during a code upgrade.
 if(entry.kind==='media')continue;
 if(excluded.has(entry.path))continue;
 if(!entry.path.startsWith('/')||entry.path.includes('..')||entry.path.includes('\\'))throw new Error('Unsafe publication path.');
 const target=resolve(output,'.'+entry.path);if(!target.startsWith(output+'/'))throw new Error('Unsafe publication path.');
 const response=await get('/admin?publication_file='+encodeURIComponent(entry.path));
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>25*1024*1024)throw new Error('Static file is too large.');
 await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);published.push(entry.path);
}
// Code releases must publish the local browser scripts, including newly added
// files that the currently deployed version does not know about yet.
for(const path of publication.PUBLICATION_PUBLIC_ASSETS){
 const target=resolve(output,'.'+path);await mkdir(dirname(target),{recursive:true});
 await writeFile(target,await readFile(resolve('public','.'+path)));
 if(!published.includes(path))published.push(path);
}
// Excluded pages must have their aliases withdrawn too.
if(excluded.size&&published.includes('/_redirects')) {
 const redirects=await readFile(output+'/_redirects','utf8');
 await writeFile(output+'/_redirects',redirects.split('\n').filter(line=>!excluded.has(line.split(/\s+/)[1])).join('\n'));
}
await post({save_action:'record_publication',paths:JSON.stringify(published),stage:'1'});
run(['deploy','--config','wrangler.production.json','--secrets-file','.env.production.secrets','--message','Publish Cloud static pages and all images']);
await post({save_action:'record_publication',paths:JSON.stringify(published)});
console.log('Published '+published.length+' static files. Admin/search remain dynamic.');
} finally {await post({save_action:'end_publication'});}
