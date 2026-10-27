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
  // Preserve the site section and viewport across ordinary settings submissions.
  try {
    const saved=JSON.parse(sessionStorage.getItem('cloud-site-position')||'null');
    if(saved){sessionStorage.removeItem('cloud-site-position');const details=document.querySelectorAll('#site details');for(const i of saved.open)if(details[i])details[i].open=true;requestAnimationFrame(()=>window.scrollTo(0,saved.y));}
  } catch {}
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.closest?.('#site'))return;
    if(form.matches('[data-device-expiry]')){
      event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('[data-device-expiry-status]');button.disabled=true;
      try{await action('device_expiry',{days:form.querySelector('[name="days"]').value});status.textContent=ja?'変更しました。':'Updated.';}
      catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}return;
    }
    const name=form.querySelector('[name="save_action"]')?.value;
    if(event.defaultPrevented||form.matches('[data-mcp-key-form],[data-cloudbackup]')||['begin_d1_export','restore_d1_time'].includes(name))return;
    try{const details=[...document.querySelectorAll('#site details')];sessionStorage.setItem('cloud-site-position',JSON.stringify({y:window.scrollY,open:details.flatMap((d,i)=>d.open?[i]:[])}));}catch{}
  });
  // Generating or regenerating the MCP API key: show it in place. A reload would close the accordion it lives in.
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.matches?.('[data-mcp-key-form]'))return;
    event.preventDefault();
    const button=form.querySelector('button'),label=button.innerHTML;button.disabled=true;
    try{
      const result=await action('generate_api_key');
      const field=document.getElementById('mcp-key-display');if(field)field.value=result.mcp_api_key;
      const issued=document.getElementById('mcp-key-issued'),generate=document.getElementById('mcp-key-generate');
      if(issued)issued.style.display='';if(generate)generate.style.display='none';
      if(typeof window.showToast==='function')window.showToast(result.message);
    }catch(error){if(typeof window.showToast==='function')window.showToast(error.message,true);}
    finally{button.disabled=false;button.innerHTML=label;}
  });
})();
