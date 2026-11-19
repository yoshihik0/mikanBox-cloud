(() => {
 'use strict';
 const ja=document.documentElement.lang==='ja';
 async function action(name,values={}){
  const data=new FormData();data.set('save_action',name);data.set('csrf_token',window.CSRF_TOKEN);data.set('ajax_request','1');
  for(const [key,value] of Object.entries(values))data.set(key,typeof value==='string'?value:JSON.stringify(value));
  const response=await fetch('/admin',{method:'POST',body:data,credentials:'same-origin'}),result=await response.json();
  if(!response.ok||!result.success)throw new Error(result.message||'Backup operation failed.');return result;
 }
 const hex=buffer=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
 const sha256=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
 function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
 const unbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
 const PART=500000;
 // The backup file: the manifest on the first line, then one JSON line per 500 KB part of each media file.
 // Lines are found by their byte positions, so a large file is read in pieces and never held whole.
 async function* lines(file){
  const reader=file.stream().getReader();let buffer=new Uint8Array(0),base=0;
  try{while(true){const {value,done}=await reader.read();
   if(value){const next=new Uint8Array(buffer.length+value.length);next.set(buffer);next.set(value,buffer.length);buffer=next;}
   let end;while((end=buffer.indexOf(10))>=0){yield {start:base,end:base+end,bytes:buffer.subarray(0,end)};base+=end+1;buffer=buffer.slice(end+1);}
   if(buffer.length>25_000_000)throw new Error('Backup record is too large.');if(done)break;
  }if(buffer.length)yield {start:base,end:base+buffer.length,bytes:buffer};}finally{await reader.cancel().catch(()=>{});}
 }
 const decoder=new TextDecoder('utf-8',{fatal:true});
 const text=line=>decoder.decode(line.bytes).trim();
 document.addEventListener('submit',async event=>{
  const form=event.target,kind=form.dataset?.cloudbackup;if(!['export','restore'].includes(kind))return;
  event.preventDefault();event.stopImmediatePropagation();
  const output=form.querySelector('[data-transfer-status]'),buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const progress=text=>{if(output)output.textContent=text;};const fields=new FormData(form);let stage='';
  try{
   if(kind==='export'){
    // Everything in one JSON file: the site data from D1, the media files from the public site.
    const {manifest}=await action('download_backup_json',{}),pieces=[new Blob(['{"manifest":'+JSON.stringify(manifest)+',\n"parts":[\n'])];let first=true,count=0;
    const publicBase=String(window.PUBLIC_SITE_URL||'').replace(/\/$/,'');
    for(const media of manifest.media){
     const response=await fetch(publicBase+(media.source||'/media/'+encodeURIComponent(media.key)),{mode:'cors',cache:'no-store',credentials:'omit'});
     if(!response.ok)throw new Error((ja?'公開サイトから読めませんでした: ':'Could not read from the public site: ')+media.key);
     const bytes=new Uint8Array(await response.arrayBuffer());
     if(bytes.length!==media.size||await sha256(bytes)!==media.etag)throw new Error((ja?'公開サイトのファイルが記録と違います: ':'The public file differs from the record: ')+media.key);
     for(let index=0;index<media.chunk_count;index++){const part=bytes.subarray(index*PART,(index+1)*PART);pieces.push(new Blob([(first?'':',\n')+JSON.stringify({key:media.key,index,content_base64:base64(part),sha256:await sha256(part)})]));first=false;}
     progress((ja?'バックアップを作成中 ':'Creating backup ')+ ++count+' / '+manifest.media.length);
    }
    await action('backup_export_validate',{manifest});pieces.push(new Blob(['\n]}\n']));
    window.mikanDownload?window.mikanDownload(new Blob(pieces,{type:'application/json'}),'mikanbox-cloud-'+new Date().toISOString().slice(0,10)+'.json'):null;
    progress(ja?'バックアップを保存しました。安全に保管してください。':'Backup downloaded. Store it securely.');
   }else{
    if(!await window.MikanUI.confirm(ja?'今の内容（画像を含む）を消して、バックアップの内容に置き換えます。続けますか？':'Replace the current site (images included) with this backup?',ja?'バックアップから復元':'Restore from backup',ja?'置き換える':'Replace','btn-red'))return;
    const file=fields.get('backup_file');if(!(file instanceof File)||!file.size)throw new Error('Choose a backup file.');
    // 1. Read the whole file first and check every file in it, before anything is replaced.
    const iterator=lines(file)[Symbol.asyncIterator](),header=await iterator.next();
    if(header.done||!text(header.value).startsWith('{"manifest":')||!text(header.value).endsWith(','))throw new Error('Unsupported backup file layout.');
    const manifest=JSON.parse(text(header.value).slice(12,-1)),start=await iterator.next();if(start.done||text(start.value)!=='"parts":[')throw new Error('Incomplete backup file.');
    const byKey=new Map(manifest.media.map(m=>[m.key,m])),where=new Map();let current=null,collected=[],closed=false,count=0;
    const finish=async()=>{if(!current)return;const m=byKey.get(current),whole=new Uint8Array(m.size);let at=0;for(const part of collected){whole.set(part,at);at+=part.length;}
     if(at!==m.size||await sha256(whole)!==m.etag)throw new Error((ja?'バックアップの画像が壊れています: ':'A file in the backup is damaged: ')+current);current=null;collected=[];};
    for(let line=await iterator.next();!line.done;line=await iterator.next()){
     const value=text(line.value);if(!value)continue;if(value===']}'){closed=true;break;}
     const part=JSON.parse(value.replace(/,$/,'')),m=byKey.get(part.key);if(!m)throw new Error('Unexpected file in the backup.');
     const bytes=unbase64(part.content_base64);if(await sha256(bytes)!==part.sha256)throw new Error((ja?'バックアップの画像が壊れています: ':'A file in the backup is damaged: ')+part.key);
     if(part.key!==current){await finish();current=part.key;}
     if(part.index!==collected.length)throw new Error('Incomplete backup file.');collected.push(bytes);
     (where.get(part.key)||where.set(part.key,[]).get(part.key)).push([line.value.start,line.value.end]);
     progress((ja?'バックアップを確認中 ':'Checking the backup ')+ ++count);
    }
    await finish();
    if(!closed||manifest.media.some(m=>(where.get(m.key)||[]).length!==m.chunk_count))throw new Error('Incomplete backup file.');
    // 2. Replace the site data.
    stage=(await action('restore_backup_json',{manifest,restore_users:fields.get('restore_users')==='1'?'1':'0'})).stage;
    let result;try{result=await action('backup_restore_commit',{stage});}catch{try{result=await action('backup_restore_commit',{stage});}catch{throw new Error(ja?'復元の完了を確認できません。再読み込みして内容を確認してから再試行してください。':'Restore completion could not be confirmed. Reload and check the content before retrying.');}}stage='';
    // 3. Publish the site again, the media files coming from the backup file.
    const source=async path=>{
     const key=decodeURIComponent(path.replace(/^\/media\//,'')),spans=where.get(key),m=byKey.get(key);if(!spans)return null;
     const whole=new Uint8Array(m.size);let at=0;
     for(const [a,b] of spans){const part=JSON.parse(decoder.decode(new Uint8Array(await file.slice(a,b).arrayBuffer())).trim().replace(/,$/,''));const bytes=unbase64(part.content_base64);whole.set(bytes,at);at+=bytes.length;}
     return {bytes:whole,type:m.content_type};
    };
    progress(ja?'公開サイトへ送っています…':'Publishing…');
    try{await window.cloudPublish(true,[],'',{source});}catch(error){throw new Error((ja?'データの復元は終わりましたが、公開に失敗しました。同じファイルで、もう一度復元してください。 ':'The data is restored, but publication failed. Restore again with the same file. ')+(error.message||''));}
    progress(ja?'復元が完了しました。':'Restore completed.');
    if(result.accountsRestored){location.href='/admin';return;}
    window.cloudKeepPosition?.();location.reload();
   }
  }catch(error){progress(error.message);window.showToast?.(error.message,true);}finally{
   if(stage)await action('backup_restore_abort',{stage}).catch(()=>{});buttons.forEach(b=>b.disabled=false);
  }
 },true);
})();
