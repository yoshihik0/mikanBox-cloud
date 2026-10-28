import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.MIKANBOX_CLOUD_URL?.replace(/\/$/,'');if(!base||!/^https:\/\//.test(base))throw new Error('Set MIKANBOX_CLOUD_URL to the intended HTTPS site URL.');
const result=spawnSync('npx',['wrangler','d1','execute','DB','--remote','--config','wrangler.production.json','--json','--command','SELECT key,size FROM media'],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'}});
if(result.status!==0)throw new Error('Cannot read Cloud image inventory.');
await mkdir('.publication/media',{recursive:true});
const files=JSON.parse(result.stdout)[0].results;
for(const file of files){
 if(!/^[A-Za-z0-9_.-]+$/.test(file.key)||file.key.includes('..'))throw new Error('Invalid image filename.');
 const response=await fetch(base+'/media/'+encodeURIComponent(file.key));
 if(!response.ok)throw new Error('Cannot preserve existing public image.');
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==file.size)throw new Error('Image preservation size mismatch.');
 await writeFile('.publication/media/'+file.key,bytes);
}
await writeFile('.publication/_headers',"/*\n  X-Mikanbox-Delivery: static\n  X-Content-Type-Options: nosniff\n\n/media/*\n  Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'\n");
console.log('Preserved '+files.length+' existing images for initial direct delivery.');
