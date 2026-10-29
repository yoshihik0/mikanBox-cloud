// Uses official Wrangler/workerd local bindings; never connects to Cloudflare resources.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
const root=fileURLToPath(new URL('../',import.meta.url)),temp=await mkdtemp(join(tmpdir(),'mikanbox-r2-system-'));
const config=join(temp,'wrangler.json'),state=join(temp,'state'),cli=join(root,'node_modules/wrangler/bin/wrangler.js');
const setupToken=randomBytes(32).toString('hex'),password='disposable-local-system-test';
const environment={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(root,'.wrangler/logs')};
await writeFile(config,JSON.stringify({name:'mikanbox-r2-local-system-test',main:join(root,'src/index.ts'),compatibility_date:'2026-10-03',assets:{directory:join(root,'public'),binding:'ASSETS',run_worker_first:true},vars:{JWT_SECRET:randomBytes(32).toString('hex'),SETUP_TOKEN:setupToken,STATIC_DELIVERY:'true'},d1_databases:[{binding:'DB',database_name:'r2-local-test-only',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:join(root,'migrations')}],r2_buckets:[{binding:'MEDIA',bucket_name:'r2-local-test-only'}]}));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`;let worker,log='',cookie='',csrf='';const passed=[];
function check(name){passed.push(name);console.log('PASS: '+name);}
async function request(path,body){return fetch(base+path,{method:body?'POST':'GET',body,headers:cookie?{Cookie:cookie}:{},redirect:'manual',signal:AbortSignal.timeout(20000)});}
async function action(name,values={},expected=true){
 const form=values instanceof FormData?values:new URLSearchParams(values);form.set('save_action',name);form.set('csrf_token',csrf);form.set('ajax_request','1');
 const response=await request('/admin',form),data=await response.json();assert.equal(data.success,expected,`${name}: ${data.message}`);return data;
}
const pixel=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
const large=new Uint8Array(1_000_025);large.set(pixel);
async function upload(name,bytes){const form=new FormData();form.set('image',new File([bytes],name,{type:'image/png'}));return action('upload_media',form);}
async function image(name,bytes){const response=await request('/media/'+name);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);return response.headers.get('etag');}
async function backup(){
 const manifest=(await action('download_backup_json',{current_password:password})).manifest,parts=[];
 for(const m of manifest.media)for(let index=0;index<m.chunk_count;index++)parts.push((await action('backup_media_part',{file:m.key,index:String(index),expected:JSON.stringify(m)})).part);
 await action('backup_export_validate',{manifest:JSON.stringify(manifest)});return {manifest,parts};
}
async function restore(saved){const stage=(await action('restore_backup_json',{manifest:JSON.stringify(saved.manifest),current_password:password})).stage;for(const part of saved.parts)await action('backup_restore_part',{stage,part:JSON.stringify(part)});return action('backup_restore_commit',{stage,current_password:password});}
try {
 const migrations=spawnSync(process.execPath,[cli,'d1','migrations','apply','DB','--local','--config',config,'--persist-to',state],{cwd:root,env:environment,encoding:'utf8',timeout:60000});assert.equal(migrations.status,0,migrations.stderr+'\n'+migrations.stdout);
 check('all D1 migrations applied to isolated local state');
 worker=spawn(process.execPath,[cli,'dev','--local','--config',config,'--persist-to',state,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--show-interactive-dev-session=false'],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
 worker.stdout.on('data',data=>{log+=data;});worker.stderr.on('data',data=>{log+=data;});
 for(let attempt=0;;attempt++){try{if((await request('/admin')).status===200)break;}catch{}if(attempt>=60||worker.exitCode!==null)throw new Error('Local Worker did not start: '+log);await new Promise(resolve=>setTimeout(resolve,500));}
 const loginPage=await request('/admin');cookie=loginPage.headers.get('set-cookie').split(';')[0];const loginCsrf=cookie.split('=')[1];const login=await request('/admin',new URLSearchParams({login_action:'setup',username:'local-system',display_name:'Local integration test',device_name:'Local test',setup_token:setupToken,csrf_token:loginCsrf}));assert.equal(login.status,303,await login.text());cookie=login.headers.get('set-cookie').split(';')[0];
 const admin=await(await request('/admin?view=site')).text();csrf=admin.match(/window.CSRF_TOKEN = "([^"]+)"/)[1];check('actual Worker authentication, CSRF and default installation');
 await upload('large.png',large);await upload('pixel.png',pixel);await image('large.png',large);await image('pixel.png',pixel);check('D1 multipart upload and public byte-for-byte delivery with static mode enabled');
 await action('save_page',{id:'integration_page',title:'Integration',status:'draft',content_md:'![Test](large.png)'});
 const d1Backup=await backup();assert.equal(d1Backup.manifest.media.length,2);check('D1 backup with original image parts');
 let job=(await action('begin_media_migration',{current_password:password})).migration;assert.equal(job.total,2);
 await action('finish_media_migration',{migration_id:job.id},false);await action('delete_media',{file:'pixel.png'},false);await image('pixel.png',pixel);check('incomplete cutover and image changes rejected while originals stay readable');
 job=(await action('copy_media_migration',{migration_id:job.id})).migration;assert.equal(job.copied,1);await action('cancel_media_migration',{migration_id:job.id});await image('large.png',large);check('real local R2 copy, checksum verification and cancellation preserve D1');
 job=(await action('begin_media_migration',{current_password:password})).migration;do{job=(await action('copy_media_migration',{migration_id:job.id})).migration;}while(job.copied<job.total);await action('finish_media_migration',{migration_id:job.id});
 await image('large.png',large);await image('pixel.png',pixel);const site=await(await request('/admin?view=site')).text();assert.match(site,/Current media storage[^<]*<strong>R2|現在のメディアの保存先[^<]*<strong>R2/);assert.doesNotMatch(site,/D1 database usage: Check in Cloudflare/);check('D1-to-R2 cutover, stable public URLs and real D1 size metadata');
 await upload('new.png',pixel);const etag=await image('new.png',pixel);const replacement=new Uint8Array(pixel.length+5);replacement.set(pixel);const resized=new FormData();resized.set('file','new.png');resized.set('source_etag',etag);resized.set('image',new File([replacement],'new.png',{type:'image/png'}));await action('resize_media',resized);await image('new.png',replacement);check('R2 upload and atomic image replacement');
 await action('rename_media',{file:'large.png',new_name:'renamed.png',confirmed:'1'});await image('renamed.png',large);assert.equal((await request('/media/large.png')).status,404);check('R2 filename rename and removal of old public URL');
 const webp=Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));const conversion=new FormData();conversion.set('file','renamed.png');conversion.set('new_filename','renamed.webp');conversion.set('source_etag',await image('renamed.png',large));conversion.set('image',new File([webp],'renamed.webp',{type:'image/webp'}));await action('convert_media_webp',conversion);await image('renamed.webp',webp);check('R2 WebP replacement with reference updates');
 await restore(d1Backup);await image('large.png',large);await image('pixel.png',pixel);assert.equal((await request('/media/new.png')).status,404);check('D1 backup restores atomically into R2');
 const r2Backup=await backup();const stage=(await action('restore_backup_json',{manifest:JSON.stringify(r2Backup.manifest),current_password:password})).stage;await action('backup_restore_commit',{stage,current_password:password},false);await image('large.png',large);await action('backup_restore_abort',{stage});check('incomplete R2 restore rejected without changing current images');
 await action('delete_media',{file:'large.png'});assert.equal((await request('/media/large.png')).status,404);await restore(r2Backup);await image('large.png',large);check('R2 backup restores deleted multipart images');
 await action('cleanup_media');await image('large.png',large);check('R2 cleanup retains live and recently superseded objects');
 // Read only the disposable D1 database through the official local binding.
 const inspected=spawnSync(process.execPath,[cli,'d1','execute','DB','--local','--config',config,'--persist-to',state,'--json','--command',"SELECT (SELECT COUNT(*) FROM media_chunks) chunks,(SELECT COUNT(*) FROM media WHERE object_key IS NULL OR data<>'') invalid,(SELECT value FROM settings WHERE key='media_storage') mode"],{cwd:root,env:environment,encoding:'utf8',timeout:30000});assert.equal(inspected.status,0,inspected.stderr);const row=JSON.parse(inspected.stdout)[0].results[0];assert.equal(row.chunks,0);assert.equal(row.invalid,0);assert.equal(row.mode,'r2');check('D1 contains only R2 metadata after migration and restoration');
 await writeFile(join(root,'artifacts/r2-local-system-test.json'),JSON.stringify({passed:true,runtime:'official Wrangler/workerd local D1 + R2 bindings',remoteServicesUsed:false,paymentMethodRequired:false,checks:passed},null,2)+'\n');
 console.log(`${passed.length} system integration checks passed. No Cloudflare subscription or remote resource was used.`);
}finally{
 if(worker&&worker.exitCode===null){worker.kill('SIGTERM');await Promise.race([new Promise(resolve=>worker.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}
 await rm(temp,{recursive:true,force:true});
}
