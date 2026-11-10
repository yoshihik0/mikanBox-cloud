(() => {
  'use strict';
  const ja=document.documentElement.lang==='ja';
  const updateLink=document.getElementById('cloud-check-updates');
  if(updateLink) updateLink.addEventListener('click',async event=>{
    event.preventDefault();
    if(updateLink.getAttribute('aria-busy')==='true')return;
    updateLink.setAttribute('aria-busy','true');
    try {
      const response=await fetch(updateLink.href,{cache:'no-store'});
      if(!response.ok)throw new Error('Update check failed');
      const doc=new DOMParser().parseFromString(await response.text(),'text/html');
      const replacement=doc.getElementById('cloud-version-row');
      if(!replacement)throw new Error('Update check failed');
      const current=document.getElementById('cloud-version-row');
      current.querySelectorAll('span, a:not(#cloud-check-updates)').forEach(node=>node.remove());
      for(const node of replacement.querySelectorAll('span, a:not(#cloud-check-updates)')) {
        if(node.tagName==='SPAN')current.insertBefore(node,updateLink);
        else current.appendChild(node);
      }
    } catch { if(typeof window.showToast==='function')window.showToast(ja?'更新情報を確認できませんでした。':'Could not check for updates.',true); }
    finally { updateLink.removeAttribute('aria-busy'); }
  });
  // Unsaved changes (window.isDirty) and the confirmations are in cloud-editor.js and admin-ui.js.
  async function action(name,extra={}) {
    const form=new FormData();form.set('save_action',name);form.set('csrf_token',window.CSRF_TOKEN);form.set('ajax_request','1');
    for(const [key,value] of Object.entries(extra))form.set(key,value);
    const response=await fetch(location.pathname,{method:'POST',body:form});
    const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'Request failed');
    return result;
  }
  // A page being edited is locked for other users while its editor is open (45 s heartbeat).
  let lockId='',lockTimer=0;
  const release=id=>{
    const f=new FormData();f.set('save_action','release_lock');f.set('id',id);f.set('csrf_token',window.CSRF_TOKEN);f.set('ajax_request','1');
    navigator.sendBeacon(location.pathname,f);
  };
  window.cloudEditorLock={
    start(id){
      if(lockId===id&&lockTimer)return;
      if(lockId&&lockId!==id)release(lockId);
      clearInterval(lockTimer);lockId=id;
      const acquire=()=>action('acquire_lock',{id}).catch(error=>{
        if(typeof window.showToast==='function')window.showToast(error.message,true);
        document.querySelectorAll('#page-form button[type="submit"], button[type="submit"][form="page-form"]').forEach(button=>button.disabled=true);
      });
      acquire();lockTimer=setInterval(acquire,45000);
    },
    stop(){if(lockId)release(lockId);clearInterval(lockTimer);lockId='';lockTimer=0;}
  };
  const openedEditorId=document.getElementById('page-form')?.querySelector('[name="old_id"]')?.value;
  if(openedEditorId)window.cloudEditorLock.start(openedEditorId);
  window.addEventListener('pagehide',()=>{if(lockId)release(lockId);});
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
  const addCategoryButton=document.querySelector('.btn-add-cat'),newCategoryInput=document.getElementById('new-category-input');
  addCategoryButton?.addEventListener('click',event=>{
    event.preventDefault();addCategoryButton.style.display='none';
    if(newCategoryInput){newCategoryInput.style.display='inline-block';newCategoryInput.focus();}
  });
  newCategoryInput?.addEventListener('keydown',async event=>{
    if(event.key==='Escape'){newCategoryInput.value='';newCategoryInput.style.display='none';addCategoryButton.style.display='inline-flex';return;}
    if(event.key!=='Enter')return;
    event.preventDefault();
    const category=newCategoryInput.value.trim();if(!category)return;
    try{
      const result=await action('add_category',{category});
      const exists=[...document.querySelectorAll('.category-cloud-tag')].some(tag=>tag.textContent.trim()===category);
      if(!exists){
        const tag=document.createElement('a');tag.href='?cat='+encodeURIComponent(category);tag.className='category-cloud-tag';tag.textContent=category;
        newCategoryInput.closest('.category-control-group').before(tag);
      }
      window.showToast(result.message);
    }catch(error){window.showToast(error.message,true);}
    finally{newCategoryInput.value='';newCategoryInput.style.display='none';addCategoryButton.style.display='inline-flex';}
  });
  // Choosing a category filters the lists in place (and keeps the URL), as in PHP.
  document.addEventListener('click',async event=>{
    const tag=event.target.closest('.category-cloud-tag');
    if(!tag||tag.classList.contains('btn-add-cat')||!tag.getAttribute('href'))return;
    event.preventDefault();
    const url=new URL(tag.href,location.href);
    document.querySelectorAll('.category-cloud-tag').forEach(el=>el.classList.remove('active'));tag.classList.add('active');
    for(const key of ['p_pages','p_media','media_all'])url.searchParams.delete(key);
    history.pushState(null,'',url.pathname+url.search+url.hash);
    await Promise.all([window.refreshPageList(),window.refreshMediaGrid()]);
  });
  // Preserve the site section and viewport across ordinary settings submissions.
  try {
    const saved=JSON.parse(sessionStorage.getItem('cloud-site-position')||'null');
    if(saved){sessionStorage.removeItem('cloud-site-position');const details=document.querySelectorAll('#site details');for(const i of saved.open)if(details[i])details[i].open=true;requestAnimationFrame(()=>window.scrollTo(0,saved.y));}
  } catch {}
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.closest?.('#site'))return;
    const name=form.querySelector('[name="save_action"]')?.value;
    if(event.defaultPrevented||form.matches('[data-mcp-key-form],[data-cloudbackup]')||['begin_d1_export','restore_d1_time'].includes(name))return;
    try{const details=[...document.querySelectorAll('#site details')];sessionStorage.setItem('cloud-site-position',JSON.stringify({y:window.scrollY,open:details.flatMap((d,i)=>d.open?[i]:[])}));}catch{}
  });
  // After an in-place action (admin-ui.js): a device code issued now is shown once in its slot, and a
  // language change reloads (every label changes; the one case where a settings save needs a reload).
  const reloadHere=()=>{
    try{const details=[...document.querySelectorAll('#site details')];sessionStorage.setItem('cloud-site-position',JSON.stringify({y:window.scrollY,open:details.flatMap((d,i)=>d.open?[i]:[])}));}catch{}
    location.reload();
  };
  document.addEventListener('mikan:done',async event=>{
    const json=event.detail||{},form=event.target;
    if(json.issued_code){
      // The section is refreshed here (not by the form) so the code is put into the fresh slot; it is shown once and never fetched again.
      await window.MikanUI.refresh('#users-mgmt');
      const slot=document.getElementById('issued-code-slot');
      if(slot){
        slot.textContent='';
        const box=document.createElement('div');box.setAttribute('role','status');box.style.cssText='background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:14px 16px;margin-bottom:18px';
        const code=document.createElement('div');code.style.cssText='font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.6rem;letter-spacing:.12em;font-weight:700;user-select:all';code.textContent=json.issued_code;
        const note=document.createElement('div');note.className='sub-text';note.style.marginTop='6px';note.textContent=slot.dataset.note||'';
        box.append(code,note);slot.append(box);
        const details=slot.closest('details');if(details)details.open=true;
      }
    }
    const language=form.querySelector?.('[name="system_lang"]');
    if(language&&language.value&&language.value!==document.documentElement.lang)reloadHere();
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
