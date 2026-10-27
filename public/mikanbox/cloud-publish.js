(() => {
 'use strict';
 const ja=document.documentElement.lang==='ja';let publishing=false;
 // The build reports beside its own button; other operations use the toast.
 let statusTarget=null;
 // Where the token is set. The server's message names it in two languages; here it becomes a link beside the button.
 const needsToken=text=>/Cloudflare配信用トークン|deployment token/.test(text);
 function status(text,error=false){if(statusTarget){statusTarget.textContent=needsToken(text)?(ja?'Cloudflare APIトークンが未設定のため公開できません。':'Publishing is not possible: the Cloudflare API token is not set.'):text;statusTarget.classList.toggle('error',!!error);if(error&&needsToken(text)){const link=document.createElement('a');link.href='/admin?view=site#cloud-connection';link.textContent=ja?' 設定する':' Set it up';link.dataset.openCloudConnection='';statusTarget.append(link);}return;}if(window.showToast)window.showToast(text,error);const output=document.querySelector('[data-transfer-status]');if(output)output.textContent=text;}
 async function action(name,extra={},lease=''){
  const form=extra instanceof FormData?extra:new FormData();if(!(extra instanceof FormData))for(const [key,value] of Object.entries(extra))form.set(key,typeof value==='string'?value:JSON.stringify(value));
  form.set('save_action',name);form.set('csrf_token',window.CSRF_TOKEN);form.set('ajax_request','1');if(lease)form.set('publication_lease',lease);
  const response=await fetch('/admin',{method:'POST',body:form,credentials:'same-origin'}),result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'Operation failed.');return result;
 }
 async function read(path){const response=await fetch('/admin?publication_file='+encodeURIComponent(path),{credentials:'same-origin'});if(!response.ok)throw new Error('Publication source is unavailable.');return {bytes:new Uint8Array(await response.arrayBuffer()),type:response.headers.get('Content-Type')||'application/octet-stream'};}
 async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);}
 function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
 window.cloudPublish=async(rebuild=true,excluded=[],mediaOnly='')=>{
  if(publishing)throw new Error(ja?'配信更新中です。':'Publication is already running.');publishing=true;let lease='';
  try {
   status(ja?'公開ファイルを準備しています…':'Preparing publication…');const begin=await action('publication_begin',{rebuild:rebuild?'1':'0',excluded,media_only:mediaOnly});lease=begin.job;
   const unprepared=begin.entries.filter(item=>!item.hash),items=[];
   for(let i=0;i<unprepared.length;i++){
    const item=unprepared[i],file=await read(item.path);items.push({path:item.path,hash:await digest(file.bytes),size:file.bytes.length,contentType:file.type});
    if(items.length===20||i===unprepared.length-1){await action('publication_hashes',{items:items.splice(0)},lease);}
    status((ja?'公開準備 ':'Preparing ')+(i+1)+'/'+unprepared.length);
   }
   const upload=await action('publication_prepare',{},lease);
   for(let i=0;i<upload.uploads.length;i++){
    const item=upload.uploads[i],file=await read(item.path);if(await digest(file.bytes)!==item.hash)throw new Error('Publication source changed. Restart publication.');
    const form=new FormData();form.set('hash',item.hash);form.set('asset_data',new File([base64(file.bytes)],item.hash,{type:file.type}));await action('publication_upload',form,lease);
    status((ja?'配信更新 ':'Uploading ')+(i+1)+'/'+upload.uploads.length);
   }
   const result=await action('publication_finish',{},lease);lease='';status(mediaOnly?(ja?'画像を公開しました。':'Image published.'):(ja?'再構築・配信更新が完了しました。':'Build and publication completed.'));return result;
  }catch(error){status(error.message,true);throw error;}finally{if(lease)await action('publication_cancel',{},lease).catch(()=>{});publishing=false;}
 };
 async function renameChoice(message){
  const dialog=document.getElementById('rename-confirm-dialog');
  document.getElementById('rename-dialog-message').textContent=message;
  return new Promise(resolve=>{
   const finish=choice=>{dialog.removeEventListener('click',click);dialog.removeEventListener('cancel',cancel);dialog.close();resolve(choice);};
   const click=event=>{const choice=event.target.closest('[data-rename-choice]')?.dataset.renameChoice;if(choice)finish(choice);};
   const cancel=event=>{event.preventDefault();finish('cancel');};
   dialog.addEventListener('click',click);dialog.addEventListener('cancel',cancel);dialog.showModal();
  });
 }
 // True when the operation removes the image from its published path.
 function pathDropped(name,data){
  if(name==='delete_media')return true;
  const renamed=name==='rename_media'?data.get('new_name'):data.get('new_filename');
  return !!renamed&&renamed!==data.get('file');
 }
 // The Cloud publication connection lives in a collapsed section of the Site view.
 function openConnection(){const box=document.getElementById('cloud-connection');if(!box)return;const details=box.querySelector('details');if(details)details.open=true;box.scrollIntoView({block:'center'});}
 document.addEventListener('click',event=>{const link=event.target?.closest?.('[data-open-cloud-connection]');if(!link||!document.getElementById('cloud-connection'))return;event.preventDefault();openConnection();});
 if(location.hash==='#cloud-connection')addEventListener('load',openConnection);
 document.addEventListener('submit',async event=>{
  const form=event.target,name=form.querySelector('[name="save_action"]')?.value;
  if(!['build_ssg','delete_media','rename_media','resize_media','edit_media','convert_media_webp','begin_d1_export','restore_d1_time'].includes(name))return;
  event.preventDefault();event.stopImmediatePropagation();const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const label=form.querySelector('[data-publish-label]'),labelText=label?.textContent;if(label)label.textContent=ja?'公開中…':'Publishing…';form.classList?.add('is-busy');
  form.parentElement?.querySelector('[data-media-action-error]')?.remove();
  try{
   let data=new FormData(form);
   // Reload afterwards so the globe icons and the last-published time are current.
   if(name==='build_ssg'){statusTarget=form.querySelector('[data-publish-status]');await window.cloudPublish(true);setTimeout(()=>location.reload(),1500);return;}
   if(name==='begin_d1_export'){
    let result=await action(name);for(let i=0;i<600&&result.export.status!=='complete';i++){if(result.export.status==='error')throw new Error(result.export.error||'Export failed.');await new Promise(resolve=>setTimeout(resolve,1000));const response=await fetch('/admin?d1_export_poll=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capability:result.capability}),credentials:'same-origin'}),next=await response.json();if(!response.ok||!next.success)throw new Error(next.message||'Export polling failed.');result={...result,export:next.export,download_capability:next.download_capability};}
    if(result.export.status!=='complete'||!result.download_capability)throw new Error('Export did not finish. Try again.');
    const download=document.createElement('form');download.method='post';download.action='/admin';download.hidden=true;
    for(const [key,value] of Object.entries({save_action:'download_d1_export',csrf_token:window.CSRF_TOKEN,capability:result.download_capability})){const input=document.createElement('input');input.type='hidden';input.name=key;input.value=value;download.append(input);}
    document.body.append(download);download.submit();download.remove();status(ja?'D1のダウンロードを開始しました。':'D1 download started.');return;
   }
   if(name==='restore_d1_time'){if(!confirm(ja?'DB全体を指定時刻に戻します。現在の変更が失われます。実行しますか？':'Restore the whole database? Changes after that time will be lost.'))return;data.set('restore_at',new Date(data.get('restore_at')).toISOString());await action(name,data);location.reload();return;}
   const info=await action('media_reference_status',{file:data.get('file')});
   if(name==='rename_media'&&info.count){const choice=await renameChoice(info.message);if(choice==='cancel')return;data.set('confirmed',choice==='update'?'1':'0');}
   if(name==='rename_media'&&!info.count)data.set('confirmed','1');
   if(name==='resize_media'||name==='edit_media'||name==='convert_media_webp')data=await window.cloudPrepareMediaForm(data);
   const target=name==='rename_media'?data.get('new_name'):data.get('new_filename');
   if(target&&target!==data.get('file')){
    const check=await action('media_reference_status',{file:data.get('file'),target});
    if(check.target_exists)throw new Error(ja?'変更先のファイル名はすでに存在します。元のファイルと公開画像は変更していません。':'The target filename already exists. The original and published image were not changed.');
    if(check.locked&&(name!=='rename_media'||data.get('confirmed')!=='0'))throw new Error(ja?'この画像を使うページが編集中です。ページを保存して編集を終了してから、もう一度お試しください。':'A page using this image is being edited. Save and close the page editor, then try again.');
   }
   // Keep the existing public image and HTML when renaming or converting.
   // A later explicit build switches both together. Deletion still withdraws it.
   if(name==='delete_media'&&info.published&&pathDropped(name,data)){
    status(ja?'配信先から取り下げています…':'Withdrawing from the delivery target…');
    await window.cloudPublish(true,['/media/'+data.get('file')]);
   }
   const result=await action(name,data);
   await window.refreshMediaGrid();
   status(result.message || (ja?'変更しました。':'Updated.'));
  }catch(error){status(error.message,true);if(['delete_media','rename_media','resize_media','edit_media','convert_media_webp'].includes(name)&&form.parentElement){const message=document.createElement('p');message.dataset.mediaActionError='';message.setAttribute('role','alert');message.style.cssText='color:#b91c1c;font-size:0.85em;margin:8px 0;';message.textContent=error.message;form.insertAdjacentElement('afterend',message);}}finally{statusTarget=null;buttons.forEach(b=>b.disabled=false);if(label)label.textContent=labelText;form.classList?.remove('is-busy');}
 },true);
})();
