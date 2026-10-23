import {spawnSync} from 'node:child_process';import {readFile} from 'node:fs/promises';import auth from '../.test-build/src/auth.js';
const raw=spawnSync('npx',['wrangler','d1','execute','DB','--remote','--config','wrangler.production.json','--json','--command','SELECT username,auth_version FROM users ORDER BY username LIMIT 1'],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'}});
if(raw.status!==0)throw new Error('Cloud account lookup failed.');const user=JSON.parse(raw.stdout)[0].results[0];
const secret=(await readFile('.env.production.secrets','utf8')).match(/^JWT_SECRET=(.+)$/m)[1];const session=await auth.createSessionToken(secret,user.username,user.auth_version);const headers={Cookie:auth.setSessionCookie(session.token).split(';')[0]};
const base='https://example.invalid';const html=await(await fetch(base+'/admin?view=site',{headers})).text();const csrf=html.match(/window.CSRF_TOKEN = "([^"]+)"/)[1];
for(const id of ['index','404','sample_page','sample_tags','sample_markdown']) {
 const response=await fetch(base+'/admin',{method:'POST',headers,body:new URLSearchParams({csrf_token:csrf,save_action:'change_status',id,status:'public_static',ajax_request:'1'})});
 const result=await response.json();if(!response.ok||!result.success)throw new Error('Static status update failed: '+id);console.log('Selected static publication: '+id);
}
