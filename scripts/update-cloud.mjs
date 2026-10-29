// Manual updates only: verify existing resources before migrations or deployment.
import {readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function validateUpdateConfig(config, remote) {
  const db=config.d1_databases?.find(x=>x.binding==='DB');
  if(!/^[a-f0-9]{32}$/.test(config.account_id||'') || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.name||'') || !/^[a-f0-9-]{36}$/.test(db?.database_id||'')) throw new Error('Invalid existing account, management Worker or D1 configuration.');
  const bindings=remote.bindings||[];
  const vars=Object.fromEntries(bindings.filter(x=>x.type==='plain_text').map(x=>[x.name,x.text]));
  if(vars.CLOUDFLARE_ACCOUNT_ID!==config.account_id || vars.CLOUDFLARE_WORKER_NAME!==config.name || vars.CLOUDFLARE_D1_ID!==db.database_id || !vars.CLOUDFLARE_PUBLIC_WORKER_NAME || vars.CLOUDFLARE_PUBLIC_WORKER_NAME===config.name) throw new Error('The existing Worker must be the matching split-site management Worker.');
  if(!bindings.some(x=>x.type==='secret_text'&&x.name==='JWT_SECRET')) throw new Error('Existing JWT_SECRET is missing; update stopped.');
  const wanted=[...(config.d1_databases||[]).map(x=>({name:x.binding,type:'d1',id:x.database_id})),...(config.r2_buckets||[]).map(x=>({name:x.binding,type:'r2_bucket',id:x.bucket_name,jurisdiction:x.jurisdiction||'default'}))];
  const actual=bindings.filter(x=>['d1','r2_bucket'].includes(x.type)).map(x=>({name:x.name,type:x.type,id:x.type==='d1'?x.id:x.bucket_name,...(x.type==='r2_bucket'?{jurisdiction:x.jurisdiction||'default'}:{})}));
  const normalize=x=>JSON.stringify(x.sort((a,b)=>a.name.localeCompare(b.name)));
  if(normalize(wanted)!==normalize(actual)) throw new Error('D1/R2 bindings differ from the existing installation. Update the saved configuration first.');
  if(bindings.some(x=>!['plain_text','json','secret_text','d1','r2_bucket','assets'].includes(x.type))) throw new Error('This installation has additional bindings that require a reviewed manual update.');
  return db;
}

export async function updateCloud(dependencies={}) {
  const request=dependencies.fetch||fetch;
  if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.MIKANBOX_UPDATE_CONFIG) throw new Error('Set CLOUDFLARE_API_TOKEN and MIKANBOX_UPDATE_CONFIG in GitHub Actions secrets first.');
  const config=JSON.parse(process.env.MIKANBOX_UPDATE_CONFIG);
  // Validate identifiers before constructing an authenticated API URL.
  if(!/^[a-f0-9]{32}$/.test(config.account_id||'')||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.name||'')) throw new Error('Invalid update target.');
  const response=await request(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/scripts/${config.name}/settings`,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000)});
  const remote=await response.json();
  if(!response.ok||!remote.success) throw new Error('Cannot read the existing management Worker. Check the account, name and token permissions.');
  const db=validateUpdateConfig(config,remote.result);
  const repository=process.env.MIKANBOX_UPDATE_REPOSITORY||'';
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid update repository.');
  // Use the release's runtime/assets, but preserve the installation's routes and resources.
  const template=JSON.parse(await readFile('wrangler.production.example.json','utf8'));
  const target={...config,main:template.main,compatibility_date:template.compatibility_date,assets:template.assets,keep_vars:true,
    vars:{CLOUD_UPDATE_REPOSITORY:repository},
    d1_databases:config.d1_databases.map(x=>x.binding==='DB'?{...x,migrations_dir:'migrations'}:x)};
  // Do not accept hooks, environments or secret uploads from an old installation config.
  for(const key of ['build','env','secrets','define'])delete target[key];
  const file='wrangler.update.json';
  const env={...process.env,CLOUDFLARE_ACCOUNT_ID:config.account_id,WRANGLER_SEND_METRICS:'false'};
  delete env.MIKANBOX_UPDATE_CONFIG;
  const run=dependencies.run||(args=>{const result=spawnSync('npx',['--no-install','wrangler',...args],{stdio:'inherit',env});if(result.status!==0)throw new Error('Update stopped. Inspect the failed step before retrying.');});
  try {
    await writeFile(file,JSON.stringify(target,null,2),{mode:0o600});
    // Compilation must succeed before any database modification.
    await run(['deploy','--config',file,'--dry-run','--outdir','.build-update']);
    console.log(`Updating existing management Worker ${config.name}; D1 ${db.database_id}.`);
    await run(['d1','migrations','apply','DB','--remote','--config',file]);
    await run(['deploy','--config',file,'--keep-vars','--message','Manual mikanBox update']);
    console.log('Deployment completed. Reload your management page and verify the version, pages and images.');
  } finally {await rm(file,{force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)updateCloud().catch(error=>{console.error(error.message);process.exitCode=1;});
