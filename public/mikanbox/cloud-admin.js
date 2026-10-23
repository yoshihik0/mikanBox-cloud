(() => {
  'use strict';
  const ja=document.documentElement.lang==='ja';
  const pageForm=document.getElementById('page-form');
  let dirty=false,sending=false;
  document.addEventListener('input',event=>{
    if(event.target.closest('#page-form,#comp-form'))dirty=true;
  });
  document.addEventListener('submit',event=>{
    if(event.target.matches('#page-form,#comp-form'))sending=true;
    if(event.submitter?.matches('[data-confirm-delete]')&&!confirm(ja?'削除しますか？':'Delete this item?'))event.preventDefault();
  });
  window.addEventListener('beforeunload',event=>{if(dirty&&!sending){event.preventDefault();event.returnValue='';}});
  const editorId=pageForm?.querySelector('[name="old_id"]')?.value;
  async function action(name,extra={}) {
    const form=new FormData();form.set('save_action',name);form.set('csrf_token',window.CSRF_TOKEN);form.set('ajax_request','1');
    for(const [key,value] of Object.entries(extra))form.set(key,value);
    const response=await fetch(location.pathname,{method:'POST',body:form});
    const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'Request failed');
    return result;
  }
  if(editorId) {
    const acquire=()=>action('acquire_lock',{id:editorId}).catch(error=>{
      if(typeof window.showToast==='function')window.showToast(error.message,true);
      pageForm.querySelectorAll('button[type="submit"]').forEach(button=>button.disabled=true);
    });
    acquire();setInterval(acquire,45000);
    window.addEventListener('pagehide',()=>{
      const f=new FormData();f.set('save_action','release_lock');f.set('id',editorId);f.set('csrf_token',window.CSRF_TOKEN);f.set('ajax_request','1');
      navigator.sendBeacon(location.pathname,f);
    });
  }
  document.addEventListener('change',event=>{
    if(event.target.matches('[name="status"]')) {
      const banner=document.getElementById('pending-preview-banner');if(banner)banner.style.display=event.target.value==='pending'?'':'none';
    }
    if(event.target.matches('[name="status"]'))document.querySelectorAll('.radio-label').forEach(label=>{
      const input=label.querySelector('input');label.classList.toggle('active',!!input?.checked);
      for(const cls of ['draft','pending','dynamic','static','db'])label.classList.remove(cls);
      if(input?.checked)label.classList.add(input.value.replace('public_',''));
    });
    if(event.target.matches('[name="comp_type"]')){
      const ai=event.target.value==='ai_doc';
      const label=document.getElementById('html-editor-label');if(label)label.textContent=ai?'Markdown':'HTML';
    }
  });
  document.querySelector('[data-add-category]')?.addEventListener('click',async()=>{
    const category=prompt(ja?'追加するカテゴリ':'New category');if(!category)return;
    try{await action('add_category',{category});location.reload();}catch(error){alert(error.message);}
  });
})();
