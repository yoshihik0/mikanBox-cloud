(() => {
  'use strict';
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
        const wrap=document.createElement('span');wrap.className='category-cloud-tag-wrap';
        const tag=document.createElement('a');tag.href='?cat='+encodeURIComponent(category);tag.className='category-cloud-tag';tag.textContent=category;
        const badge=document.createElement('span');badge.className='category-delete-badge';badge.dataset.category=category;badge.textContent='×';
        wrap.append(tag,badge);newCategoryInput.closest('.category-control-group').before(wrap);
      }
      window.showToast(result.message);
    }catch(error){window.showToast(error.message,true);}
    finally{newCategoryInput.value='';newCategoryInput.style.display='none';addCategoryButton.style.display='inline-flex';}
  });
  // Deleting categories, as in PHP: "Delete" switches the cloud into delete mode, where
  // the × mark — or the category itself — deletes it (after a confirmation when pages use it).
  const deleteCategory=async category=>{
    try{
      let result=await action('delete_category',{category});
      if(result.require_confirm){
        const toggle=document.querySelector('.btn-toggle-del-cat');
        if(!await window.MikanUI.confirm(result.message,toggle?.dataset.confirmTitle||'',toggle?.dataset.confirmOk||''))return;
        result=await action('delete_category',{category,confirmed:'1'});
      }
      document.querySelector(`.category-delete-badge[data-category="${CSS.escape(category)}"]`)?.closest('.category-cloud-tag-wrap')?.remove();
      const url=new URL(location.href);
      if(url.searchParams.get('cat')===category){
        for(const key of ['cat','p_pages','p_media','media_all'])url.searchParams.delete(key);
        history.pushState(null,'',url.pathname+url.search+url.hash);
        document.querySelectorAll('.category-cloud-tag').forEach(el=>el.classList.remove('active'));document.querySelector('a.category-cloud-tag[href="?cat="]')?.classList.add('active');
      }
      await Promise.all([window.refreshPageList(),window.refreshMediaGrid()]);
      window.showToast(result.message);
    }catch(error){window.showToast(error.message,true);}
  };
  document.addEventListener('click',event=>{
    const toggle=event.target.closest('.btn-toggle-del-cat');
    if(toggle){
      event.preventDefault();
      const active=document.querySelector('.category-cloud-wrap')?.classList.toggle('delete-mode');
      toggle.innerHTML=active?toggle.dataset.labelDone:toggle.dataset.labelDelete;toggle.style.color=active?'#15803d':'';toggle.style.borderColor=active?'#bbf7d0':'';
      return;
    }
    const badge=event.target.closest('.category-delete-badge');
    const inMode=event.target.closest('.category-cloud-wrap.delete-mode .category-cloud-tag-wrap');
    if(badge||inMode){event.preventDefault();event.stopImmediatePropagation();deleteCategory((badge||inMode.querySelector('.category-delete-badge')).dataset.category);}
  },true);
  // Choosing a category filters the lists in place (and keeps the URL), as in PHP.
  document.addEventListener('click',async event=>{
    const tag=event.target.closest('.category-cloud-tag');
    if(!tag||tag.classList.contains('btn-add-cat')||tag.classList.contains('btn-toggle-del-cat')||!tag.getAttribute('href'))return;
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
    if(saved){sessionStorage.removeItem('cloud-site-position');const details=document.querySelectorAll('#site details');for(const i of saved.open)if(details[i])details[i].open=true;const back=()=>window.scrollTo(0,saved.y);requestAnimationFrame(back);setTimeout(back,60);}
  } catch {}
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!form.closest?.('#site'))return;
    const name=form.querySelector('[name="save_action"]')?.value;
    if(event.defaultPrevented||form.matches('[data-cloudbackup],[data-transfer]')||['restore_d1_time'].includes(name))return;
    try{const details=[...document.querySelectorAll('#site details')];sessionStorage.setItem('cloud-site-position',JSON.stringify({y:window.scrollY,open:details.flatMap((d,i)=>d.open?[i]:[])}));}catch{}
  });
  // After an in-place action (admin-ui.js): a device code issued now is shown once in its slot, and a
  // language change reloads (every label changes; the one case where a settings save needs a reload).
  // A reload that cannot be avoided (storage switch, restore) comes back to the same place.
  window.cloudKeepPosition=()=>{
    try{const details=[...document.querySelectorAll('#site details')];sessionStorage.setItem('cloud-site-position',JSON.stringify({y:window.scrollY,open:details.flatMap((d,i)=>d.open?[i]:[])}));}catch{}
  };
  const reloadHere=()=>{
    try{const details=[...document.querySelectorAll('#site details')];sessionStorage.setItem('cloud-site-position',JSON.stringify({y:window.scrollY,open:details.flatMap((d,i)=>d.open?[i]:[])}));}catch{}
    location.reload();
  };
  document.addEventListener('mikan:done',async event=>{
    const json=event.detail||{},form=event.target;
    if(json.issued_code){
      // The section is refreshed here (not by the form) so the code is put into the fresh slot; it is shown once and never fetched again.
      await window.MikanUI.refresh('#users-mgmt');
      // Under the button that issued it (own device or invite), as in the SQLite edition.
      const slot=document.querySelector(`[data-issued-code-slot="${json.issued_invite?'invite':'own'}"]`);
      if(slot){
        slot.textContent='';
        const box=document.createElement('div');box.className='issued-code';box.setAttribute('role','status');
        const code=document.createElement('div');code.className='issued-code-value';code.textContent=json.issued_code;
        const note=document.createElement('div');note.className='sub-text';note.textContent=slot.dataset.note||'';
        box.append(code,note);slot.append(box);
        for(let details=slot.closest('details');details;details=details.parentElement?.closest('details'))details.open=true;
        box.scrollIntoView({block:'nearest',behavior:'smooth'});
      }
    }
    const language=form.querySelector?.('[name="system_lang"]');
    if(language&&language.value&&language.value!==document.documentElement.lang)reloadHere();
  });
  // A new MCP API key: the form refreshes the list, then the key is shown here once, in place.
  // A reload would close the accordion it lives in.
  document.addEventListener('mikan:done',event=>{
    const form=event.target;if(!form.matches?.('#mcp-key-generate'))return;
    const key=event.detail&&event.detail.mcp_api_key;if(!key)return;
    document.getElementById('mcp-key-display').value=key;
    document.getElementById('mcp-key-once').style.display='';
    const name=document.getElementById('mcp-key-name');if(name)name.value='';
  });
})();
