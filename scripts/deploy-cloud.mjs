// Deploys the Worker with the current browser assets (public/mikanbox/*).
// wrangler serves .publication, a generated folder; without this step a change to
// public/ never reaches the site. Publishing pages and images is a separate job
// (the admin screen's build button, or scripts/publish-static.mjs).
// Usage: npm run deploy:cloud            (add --dry-run to copy and bundle without deploying)
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const dryRun=process.argv.includes('--dry-run');
const config=JSON.parse(await readFile('wrangler.production.json','utf8'));
if(!config.account_id||!config.d1_databases?.[0]?.database_id||config.d1_databases[0].database_id==='YOUR_D1_DATABASE_ID'||config.assets?.directory!=='./.publication')throw new Error('Configure your Cloudflare account and D1 database in wrangler.production.json.');
const run=(command,args)=>{const r=spawnSync(command,args,{stdio:'inherit',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'}});if(r.status!==0)throw new Error(command+' '+args.join(' ')+' failed.');};
run('npx',['tsc','--module','Node16','--moduleResolution','Node16','--outDir','.test-build']);
const {PUBLICATION_PUBLIC_ASSETS}=(await import(resolve('.test-build/src/static-publication.js'))).default;
const output=resolve('.publication');
for(const path of PUBLICATION_PUBLIC_ASSETS){
 const target=resolve(output,'.'+path);await mkdir(dirname(target),{recursive:true});
 await writeFile(target,await readFile(resolve('public','.'+path)));
}
console.log('Copied '+PUBLICATION_PUBLIC_ASSETS.length+' browser assets into .publication.');
run('npx',['wrangler','deploy','--config','wrangler.production.json','--message','Deploy Cloud code and browser assets',...(dryRun?['--dry-run','--outdir','.build']:[])]);
