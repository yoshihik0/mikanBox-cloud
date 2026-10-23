(() => {
 'use strict';
 const ja=document.documentElement.lang==='ja';
 async function action(name,values={}){
  const data=new FormData();data.set('save_action',name);data.set('csrf_token',window.CSRF_TOKEN);data.set('ajax_request','1');
  for(const [key,value] of Object.entries(values))data.set(key,typeof value==='string'?value:JSON.stringify(value));
  const response=await fetch('/admin',{method:'POST',body:data,credentials:'same-origin'}),result=await response.json();
  if(!response.ok||!result.success)throw new Error(result.message||'Backup operation failed.');return result;
 }
 // Each image part is one JSON line. This remains a standard JSON document,
 // while allowing a large backup to be read without loading it all into RAM.
 async function* lines(file){
  let buffer='';const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  try{while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;
   while((end=buffer.indexOf('\n'))>=0){yield buffer.slice(0,end).trim();buffer=buffer.slice(end+1);}
   if(buffer.length>25_000_000)throw new Error('Backup record is too large.');if(done)break;
  }if(buffer.trim())yield buffer.trim();}finally{await reader.cancel();}
 }
 document.addEventListener('submit',async event=>{
  const form=event.target,kind=form.dataset?.cloudbackup;if(!['export','restore'].includes(kind))return;
  event.preventDefault();event.stopImmediatePropagation();
  const output=form.querySelector('[data-transfer-status]'),buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const progress=text=>{if(output)output.textContent=text;};const fields=new FormData(form);let stage='';
  try{
   if(kind==='export'){
    const {manifest}=await action('download_backup_json',{}),pieces=[new Blob(['{"manifest":'+JSON.stringify(manifest)+',\n"parts":[\n'])];let first=true,count=0;
    for(const media of manifest.media)for(let index=0;index<media.chunk_count;index++){
     const {part}=await action('backup_media_part',{file:media.key,index,expected:media});pieces.push(new Blob([(first?'':',\n')+JSON.stringify(part)]));first=false;
     progress((ja?'バックアップを作成中 ':'Creating backup ')+ ++count);
    }
    await action('backup_export_validate',{manifest});pieces.push(new Blob(['\n]}\n']));
    const url=URL.createObjectURL(new Blob(pieces,{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='mikanbox-cloud-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    progress(ja?'バックアップを保存しました。安全に保管してください。':'Backup downloaded. Store it securely.');
   }else{
    if(!confirm(ja?'バックアップで現在の内容を置き換えます。続けますか？':'Replace the current site with this backup?'))return;
    const file=fields.get('backup_file');if(!(file instanceof File)||!file.size)throw new Error('Choose a backup file.');
    const iterator=lines(file)[Symbol.asyncIterator](),header=await iterator.next();
    if(header.done||!header.value.startsWith('{"manifest":')||!header.value.endsWith(','))throw new Error('Unsupported backup file layout.');
    const manifest=JSON.parse(header.value.slice(12,-1)),start=await iterator.next();if(start.value!=='"parts":[')throw new Error('Incomplete backup file.');
    stage=(await action('restore_backup_json',{manifest,restore_users:fields.get('restore_users')==='1'?'1':'0'})).stage;
    let count=0,closed=false;
    for(let line=await iterator.next();!line.done;line=await iterator.next()){
     if(!line.value)continue;if(line.value===']}'){closed=true;break;}
     await action('backup_restore_part',{stage,part:JSON.parse(line.value.replace(/,$/,''))});progress((ja?'復元データを確認中 ':'Validating restore ')+ ++count);
    }
    if(!closed)throw new Error('Incomplete backup file.');const tail=await iterator.next();if(!tail.done)throw new Error('Unexpected backup data.');
    const result=await action('backup_restore_commit',{stage});stage='';
    progress(ja?'復元が完了しました。':'Restore completed.');
    if(result.accountsRestored){location.href='/admin';return;}
    // Restored snapshots and images need a new immutable asset deployment.
    if(window.cloudPublish)await window.cloudPublish(true);location.reload();
   }
  }catch(error){progress(error.message);window.showToast?.(error.message,true);}finally{
   if(stage)await action('backup_restore_abort',{stage}).catch(()=>{});buttons.forEach(b=>b.disabled=false);
  }
 },true);
})();
