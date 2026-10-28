// Deploy only the management Worker. Public content is deployed from the admin build.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(await readFile('wrangler.production.json','utf8'));
const vars=config.vars||{}, db=config.d1_databases?.find(x=>x.binding==='DB');
let url;try{url=new URL(vars.PUBLIC_SITE_URL);}catch{throw new Error('Set PUBLIC_SITE_URL to the public site HTTPS origin.');}
if(!/^[a-f0-9]{32}$/.test(config.account_id||'') || vars.CLOUDFLARE_ACCOUNT_ID!==config.account_id || !db?.database_id || db.database_id==='YOUR_D1_DATABASE_ID' || vars.CLOUDFLARE_D1_ID!==db.database_id || !config.name || config.name!==vars.CLOUDFLARE_WORKER_NAME || !vars.CLOUDFLARE_PUBLIC_WORKER_NAME || config.name===vars.CLOUDFLARE_PUBLIC_WORKER_NAME || url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash || config.assets?.directory!=='./public' || config.assets?.binding!=='ASSETS' || config.assets?.run_worker_first!==true) throw new Error('Configure separate admin and public Workers, the public HTTPS origin, and matching account and D1 IDs in wrangler.production.json.');
const args=['wrangler','deploy','--config','wrangler.production.json','--secrets-file','.env.production.secrets','--message','Deploy mikanBox management Worker',...(process.argv.includes('--dry-run')?['--dry-run','--outdir','.build']:[])];
const result=spawnSync('npx',args,{stdio:'inherit',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'}});
if(result.status!==0)throw new Error('Management Worker deployment failed.');
