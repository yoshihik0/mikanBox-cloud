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
 const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 const json=value=>encoder.encode(JSON.stringify(value,null,2));
 // The full backup is one ZIP: data/backup.json (everything the restore needs), the same data in the
 // PHP layout for reading (data/settings.json, data/posts/, data/components/), and media/ with the files.
 document.addEventListener('submit',async event=>{
  const form=event.target,kind=form.dataset?.cloudbackup;if(!['export','restore'].includes(kind))return;
  event.preventDefault();event.stopImmediatePropagation();
  const output=form.querySelector('[data-transfer-status]'),buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const progress=text=>{if(output)output.textContent=text;};const fields=new FormData(form);let stage='';
  const damaged=key=>new Error((ja?'バックアップの画像が壊れています: ':'A file in the backup is damaged: ')+key);
  try{
   if(kind==='export'){
    const {manifest}=await action('download_backup_json',{include_revisions:fields.get('include_revisions')==='1'?'1':'0'}),zip=new window.MikanZip();
    const publicBase=String(window.PUBLIC_SITE_URL||'').replace(/\/$/,'');let count=0;
    for(const media of manifest.media){
     const response=await fetch(publicBase+(media.source||'/media/'+encodeURIComponent(media.key)),{mode:'cors',cache:'no-store',credentials:'omit'});
     if(!response.ok)throw new Error((ja?'公開サイトから読めませんでした: ':'Could not read from the public site: ')+media.key);
     const bytes=new Uint8Array(await response.arrayBuffer());
     if(bytes.length!==media.size||await sha256(bytes)!==media.etag)throw new Error((ja?'公開サイトのファイルが記録と違います: ':'The public file differs from the record: ')+media.key);
     zip.add('media/'+media.key,bytes);progress((ja?'バックアップを作成中 ':'Creating backup ')+ ++count+' / '+manifest.media.length);
    }
    await action('backup_export_validate',{manifest});
    zip.add('data/backup.json',json(manifest));zip.add('data/settings.json',json(manifest.settings));
    for(const page of manifest.pages)zip.add('data/posts/'+page.id+'.json',encoder.encode(String(page.data)));
    for(const part of manifest.components)zip.add('data/components/'+part.id+'.json',encoder.encode(String(part.data)));
    window.mikanDownload(zip.blob(),'mikanbox-backup-'+new Date().toISOString().slice(0,10)+'.zip');
    progress('');window.MikanUI?.toast(ja?'バックアップを保存しました。':'Backup downloaded.');
   }else{
    if(!await window.MikanUI.confirm(ja?'今のページ・設定・画像を、バックアップの内容に置き換えます。続けますか？':'Replace the current pages, settings and images with this backup?',ja?'バックアップから復元':'Restore from backup',ja?'置き換える':'Replace','btn-red'))return;
    const file=fields.get('backup_file');if(!(file instanceof File)||!file.size)throw new Error('Choose a backup file.');
    // 1. Check the whole backup before anything is replaced.
    let zip;try{zip=await window.MikanZip.open(file);}catch{throw new Error(ja?'mikanBoxのバックアップZIPではありません。':'This is not a mikanBox backup ZIP.');}
    const data=await zip.read('data/backup.json').catch(()=>null);if(!data)throw new Error(ja?'mikanBoxのバックアップZIPではありません。':'This is not a mikanBox backup ZIP.');
    const manifest=JSON.parse(decoder.decode(data));let count=0;
    for(const media of manifest.media){
     let bytes;try{bytes=await zip.read('media/'+media.key);}catch{throw damaged(media.key);}
     if(!bytes||bytes.length!==media.size||await sha256(bytes)!==media.etag)throw damaged(media.key);
     progress((ja?'バックアップを確認中 ':'Checking the backup ')+ ++count+' / '+manifest.media.length);
    }
    // 2. Replace the site data.
    stage=(await action('restore_backup_json',{manifest,restore_users:fields.get('restore_users')==='1'?'1':'0'})).stage;
    let result;try{result=await action('backup_restore_commit',{stage});}catch{try{result=await action('backup_restore_commit',{stage});}catch{throw new Error(ja?'復元の完了を確認できません。再読み込みして内容を確認してから再試行してください。':'Restore completion could not be confirmed. Reload and check the content before retrying.');}}stage='';
    // 3. Publish the site again, the media files coming from the backup.
    const types=new Map(manifest.media.map(m=>[m.key,m.content_type]));
    const source=async path=>{const key=decodeURIComponent(path.replace(/^\/media\//,''));if(!types.has(key))return null;return {bytes:await zip.read('media/'+key),type:types.get(key)};};
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
