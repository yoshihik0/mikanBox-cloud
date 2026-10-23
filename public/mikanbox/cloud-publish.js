(() => {
 'use strict';
 const ja=document.documentElement.lang==='ja';let publishing=false;
 function status(text,error=false){if(window.showToast)window.showToast(text,error);const output=document.querySelector('[data-transfer-status]');if(output)output.textContent=text;}
 async function action(name,extra={},lease=''){
  const form=extra instanceof FormData?extra:new FormData();if(!(extra instanceof FormData))for(const [key,value] of Object.entries(extra))form.set(key,typeof value==='string'?value:JSON.stringify(value));
  form.set('save_action',name);form.set('csrf_token',window.CSRF_TOKEN);form.set('ajax_request','1');if(lease)form.set('publication_lease',lease);
  const response=await fetch('/admin',{method:'POST',body:form,credentials:'same-origin'}),result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'Operation failed.');return result;
 }
 async function read(path){const response=await fetch('/admin?publication_file='+encodeURIComponent(path),{credentials:'same-origin'});if(!response.ok)throw new Error('Publication source is unavailable.');return {bytes:new Uint8Array(await response.arrayBuffer()),type:response.headers.get('Content-Type')||'application/octet-stream'};}
 async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);}
 function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
 window.cloudPublish=async(rebuild=true,excluded=[])=>{
  if(publishing)throw new Error(ja?'配信更新中です。':'Publication is already running.');publishing=true;let lease='';
  try {
   status(ja?'公開ファイルを準備しています…':'Preparing publication…');const begin=await action('publication_begin',{rebuild:rebuild?'1':'0',excluded});lease=begin.job;
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
   const result=await action('publication_finish',{},lease);lease='';status(ja?'再構築・配信更新が完了しました。':'Build and publication completed.');return result;
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
 document.addEventListener('submit',async event=>{
  const form=event.target,name=form.querySelector('[name="save_action"]')?.value;
  if(!['build_ssg','delete_media','rename_media','resize_media','edit_media','convert_media_webp','begin_d1_export','restore_d1_time'].includes(name))return;
  event.preventDefault();event.stopImmediatePropagation();const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{
   let data=new FormData(form);
   if(name==='build_ssg'){await window.cloudPublish(true);return;}
   if(name==='begin_d1_export'){
    let result=await action(name);for(let i=0;i<600&&result.export.status!=='complete';i++){if(result.export.status==='error')throw new Error(result.export.error||'Export failed.');await new Promise(resolve=>setTimeout(resolve,1000));const response=await fetch('/admin?d1_export_poll=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({capability:result.capability}),credentials:'same-origin'}),next=await response.json();if(!response.ok||!next.success)throw new Error(next.message||'Export polling failed.');result={...result,export:next.export};}
    if(result.export.status!=='complete'||!result.export.result?.signed_url)throw new Error('Export did not finish. Try again.');const link=document.createElement('a');link.href=result.export.result.signed_url;link.download=result.export.result.filename||'mikanbox.sql';link.click();status(ja?'D1の書き出しが完了しました。':'D1 export completed.');return;
   }
   if(name==='restore_d1_time'){if(!confirm(ja?'DB全体を指定時刻に戻します。現在の変更が失われます。実行しますか？':'Restore the whole database? Changes after that time will be lost.'))return;data.set('restore_at',new Date(data.get('restore_at')).toISOString());await action(name,data);location.reload();return;}
   const info=await action('media_reference_status',{file:data.get('file')});
   if(name==='rename_media'&&info.count){const choice=await renameChoice(info.message);if(choice==='cancel')return;data.set('confirmed',choice==='update'?'1':'0');}
   if(name==='rename_media'&&!info.count)data.set('confirmed','1');
   if(name==='resize_media'||name==='edit_media'||name==='convert_media_webp')data=await window.cloudPrepareMediaForm(data);
   // Static files bypass the Worker, so a published image must leave the delivery
   // target before its source is deleted or renamed. One button, two steps.
   if(info.published&&pathDropped(name,data)){
    status(ja?'配信先から取り下げています…':'Withdrawing from the delivery target…');
    await window.cloudPublish(true,['/media/'+data.get('file')]);
   }
   await action(name,data);
   location.reload();
  }catch(error){status(error.message,true);}finally{buttons.forEach(b=>b.disabled=false);}
 },true);
})();
