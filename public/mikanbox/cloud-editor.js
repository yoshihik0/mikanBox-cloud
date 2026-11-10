(() => {
  'use strict';
  // Opening and closing the page and design editors, and saving or deleting inside them, without
  // reloading the screen (the Cloud counterpart of the editor code in the PHP admin, 2.19.0).
  // Strings come from window.__CLOUD_EDITOR (set by the admin screen from the language files).
  const C = window.__CLOUD_EDITOR || {};
  const ui = () => window.MikanUI;
  const nav = (window.mikanNav = window.mikanNav || { pending: 0 });
  // Unsaved changes are tracked per editor (the page and the design editor can both be open), and
  // window.isDirty is true while either has some.
  const dirty = new Set();
  const syncDirty = () => { window.isDirty = dirty.size > 0; };
  const markClean = (type) => { if (type) dirty.delete(type); else dirty.clear(); syncDirty(); };
  window.isDirty = false;
  let navigating = false;

  // ---- Scrolling: measured positions, checked afterwards -------------------------------------
  // A smooth scroll can be cut short by a list refresh that restores the old position, by images
  // or fonts changing the layout, or by the browser skipping the animation. settleScroll()
  // scrolls, then checks where the target ended up and corrects it. Not scrollIntoView.
  const viewportHeight = () => window.innerHeight || document.documentElement.clientHeight || 800;
  function scrollToElement(el, block, behavior) {
    const rect = el.getBoundingClientRect();
    let top = rect.top + window.scrollY;
    if (block === 'center' && rect.height < viewportHeight()) top -= (viewportHeight() - rect.height) / 2;
    window.scrollTo({ top: Math.max(0, Math.round(top)), behavior });
  }
  function settleScroll(getTarget) {
    const first = getTarget();
    if (!first || !first.el) return Promise.resolve();
    nav.pending++;
    return new Promise((resolve) => {
      let finished = false;
      let endTimer;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener('scrollend', onEnd);
        const target = getTarget();
        if (target && target.el) {
          const rect = target.el.getBoundingClientRect();
          const inView = target.block === 'center' ? rect.top >= 0 && rect.bottom <= viewportHeight() : Math.abs(rect.top) <= 40;
          if (!inView) scrollToElement(target.el, target.block || 'start', 'instant');
        }
        nav.pending--;
        resolve();
      };
      const onEnd = () => { clearTimeout(endTimer); endTimer = setTimeout(finish, 80); };
      window.addEventListener('scrollend', onEnd);
      scrollToElement(first.el, first.block || 'start', 'smooth');
      setTimeout(finish, 1200); // also when no scroll was needed or scrollend is unsupported
    });
  }

  // ---- Lists ------------------------------------------------------------------------------------
  async function refreshCompList() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('ajax_comps', '1'); url.searchParams.set('view', 'design');
      url.searchParams.delete('edit'); url.searchParams.delete('new');
      const temp = document.createElement('div');
      temp.innerHTML = await (await fetch(url, { credentials: 'same-origin' })).text();
      window.replaceListPreservingScroll(document.querySelector('#comps-table-wrap'), temp.querySelector('#comps-table-wrap'));
    } catch (_) { /* the list keeps what it had */ }
  }
  const refreshList = (type) => (type === 'page' ? window.refreshPageList() : refreshCompList());

  // The list's own parameters (cat, fmt, q, p_pages, ...) without the editor's.
  function listUrlParams(view) {
    const params = new URLSearchParams(window.location.search);
    ['edit', 'new', 'rev', 'ajax_editor', 'ajax_pages', 'ajax_media', 'ajax_comps', 'ajax_request', 'saved'].forEach((key) => params.delete(key));
    params.set('view', view);
    return params;
  }
  const viewOf = (type) => (type === 'page' ? 'pages' : 'design');
  const ids = (type) => ({
    editor: type === 'page' ? 'page-editor' : 'design-editor',
    slot: type === 'page' ? 'page-editor-slot' : 'design-editor-slot',
    section: type === 'page' ? 'pages' : 'design',
  });

  // ---- Side navigation "edit" button ------------------------------------------------------------
  function createNavEditButton(type) {
    const closeUrl = '/admin?' + listUrlParams(viewOf(type)).toString() + '#' + ids(type).section;
    const a = document.createElement('a');
    a.href = '#' + ids(type).editor;
    a.className = 'nav-edit active';
    a.dataset.editorType = type;
    a.title = C.editLabel || '';
    a.innerHTML = C.editIcon || ''; // the icon markup comes from the server's own translations/icons
    const label = document.createElement('span');
    label.textContent = C.editLabel || '';
    const badge = document.createElement('span');
    badge.className = 'close-badge';
    badge.dataset.url = closeUrl;
    badge.title = C.closeLabel || '';
    badge.textContent = '×';
    a.append(label, badge);
    return a;
  }
  const navAnchor = (type) => document.querySelector(type === 'page' ? '.side-nav .nav-settings' : '.side-nav .nav-media');
  const bindDirtyTrackers = (container, type) => {
    container.querySelectorAll('input, textarea, select').forEach((el) => {
      el.addEventListener('input', () => { dirty.add(type); syncDirty(); });
      el.addEventListener('change', () => { dirty.add(type); syncDirty(); });
    });
  };
  // Unsaved changes: the same three-way prompt as the PHP admin (#unsaved-modal): save and close,
  // discard and close, or cancel. `type` is the editor being left or replaced. Resolves true when the
  // caller may go on (that editor was saved, or its changes were discarded). A save that cannot be
  // done (no such form or button) or that fails never counts as done: the prompt stays open.
  function guardUnsaved(type) {
    if (!dirty.has(type)) return Promise.resolve(true);
    const modal = document.getElementById('unsaved-modal');
    if (!modal) return ui().confirm(C.unsavedText || '', C.unsavedTitle || '', C.ok || '', 'btn-red');
    const save = document.getElementById('btn-modal-save'), discard = document.getElementById('btn-modal-discard'), cancel = document.getElementById('btn-modal-cancel');
    return new Promise((resolve) => {
      const close = (value) => { modal.style.display = 'none'; save.onclick = discard.onclick = cancel.onclick = null; resolve(value); };
      cancel.onclick = () => close(false);
      discard.onclick = () => { markClean(type); close(true); };
      save.onclick = async () => {
        const form = document.querySelector(type === 'page' ? '#page-editor #page-form' : '#design-editor #comp-form');
        const button = form && document.querySelector('button[form="' + form.getAttribute('id') + '"][name="save_action"][value^="save_"]');
        if (!form || !button) { ui().toast(C.saveFailed || '', true); return; }
        const savingHtml = '<span class="material-symbols-outlined icon" style="animation: spin 1s linear infinite;">sync</span> ' + (C.saving || '');
        const original = { modal: save.innerHTML, button: button.innerHTML };
        save.innerHTML = button.innerHTML = savingHtml; save.disabled = button.disabled = true;
        try {
          if (await saveEditor(type, form, button)) close(true);  // a failed save keeps the prompt open, with the message in the toast
        } finally {
          save.innerHTML = original.modal; button.innerHTML = original.button; save.disabled = button.disabled = false;
        }
      };
      modal.style.display = 'flex';
    });
  }

  // ---- Open ------------------------------------------------------------------------------------
  // Scripts in HTML put in with innerHTML do not run; recreate them so the editor's own script does.
  function runScripts(container) {
    container.querySelectorAll('script').forEach((old) => {
      const fresh = document.createElement('script');
      Array.from(old.attributes).forEach((attr) => fresh.setAttribute(attr.name, attr.value));
      fresh.appendChild(document.createTextNode(old.innerHTML));
      old.parentNode.replaceChild(fresh, old);
    });
  }
  let openController = null;
  function spaOpenEditor(type, editId, rev) {
    const view = viewOf(type);
    const { editor: editorId, slot: slotId } = ids(type);
    const params = listUrlParams(view);
    if (editId) params.set('edit', editId); else params.set('new', '1');
    if (rev) params.set('rev', rev);
    const fetchParams = new URLSearchParams(params); fetchParams.set('ajax_editor', '1');
    if (openController) openController.abort(); // a second click while loading
    openController = new AbortController();
    // An editor of the same kind that is already open stays in view until the new one arrives and
    // is replaced in the same place (emptying it first would shrink the screen and jump).
    const replacing = !!document.getElementById(editorId);
    fetch('/admin?' + fetchParams.toString(), { signal: openController.signal, credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('editor'); return r.text(); })
      .then((html) => {
        const slot = document.getElementById(slotId);
        if (!slot) return;
        if (type === 'page' && window.cloudEditorLock) window.cloudEditorLock.stop();
        slot.innerHTML = html;
        runScripts(slot);
        const editor = document.getElementById(editorId);
        if (!editor) return;
        const oldNav = document.querySelector('.side-nav .nav-edit[data-editor-type="' + type + '"]');
        if (oldNav) oldNav.remove();
        const anchor = navAnchor(type);
        if (anchor) anchor.parentNode.insertBefore(createNavEditButton(type), anchor);
        bindDirtyTrackers(editor, type);
        markClean(type);
        history.pushState({ spaEditor: true, type, editId }, '', '/admin?' + params.toString() + '#' + editorId);
        if (type === 'page' && editId && window.cloudEditorLock) window.cloudEditorLock.start(editId);
        // Every editor opens the same way: scroll to its top while it grows in (only when newly
        // opened). Started by a timer: animation frames stop in a background tab.
        setTimeout(() => settleScroll(() => ({ el: document.getElementById(editorId), block: 'start' })), 0);
        if (!replacing) ui().expand(editor);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        ui().toast(C.loadFailed || '', true);
      });
  }

  // ---- Close -----------------------------------------------------------------------------------
  function spaCloseEditor(type) {
    const { editor: editorId, slot: slotId, section: sectionId } = ids(type);
    const editor = document.getElementById(editorId);
    const navEdit = document.querySelector('.side-nav .nav-edit[data-editor-type="' + type + '"]');
    navigating = true;
    window.mikanNavigating = true;
    document.querySelectorAll('.side-nav a').forEach((a) => { a.style.transition = 'none'; });
    if (navEdit) navEdit.classList.add('closing');
    const sectionColors = { pages: '#e0f2fe', design: '#fffbeb', media: '#f0fdf4' };
    const sectionNavs = { pages: 'nav-pages', design: 'nav-design', media: 'nav-media' };
    document.body.style.backgroundColor = sectionColors[sectionId] || '#ffffff';
    document.querySelectorAll('.side-nav a:not(.nav-edit)').forEach((btn) => { btn.classList.toggle('active', btn.classList.contains(sectionNavs[sectionId])); });
    // The URL goes back first: the list refresh filters by the current URL (cat, fmt, q), so the
    // buttons and the list agree after closing.
    history.pushState({ spaEditor: false }, '', '/admin?' + listUrlParams(viewOf(type)).toString() + '#' + sectionId);
    markClean(type);
    if (type === 'page' && window.cloudEditorLock) window.cloudEditorLock.stop();
    (async () => {
      try {
        const before = editor ? editor.getBoundingClientRect().top : 0;
        nav.pending++;
        try { await refreshList(type); } catch (_) { /* the list keeps what it had */ } finally { nav.pending--; }
        // A taller or shorter list must not move the editor that is still in view.
        if (editor) {
          const shift = editor.getBoundingClientRect().top - before;
          if (shift) window.scrollBy({ top: shift, behavior: 'instant' });
        }
        // 2. Fade out in place (200 ms, opacity only: the editor keeps its height, so something visibly goes away).
        if (editor) await ui().fadeOut(editor, 200);
        // 3. Scroll smoothly to the top of the list (300-600 ms by distance, timers and frames of our own).
        //    The editor keeps its height while scrolling, so the page length is stable and the position never jumps.
        const section = document.getElementById(sectionId);
        nav.pending++;
        try { if (section) await ui().scrollToY(section.getBoundingClientRect().top + window.scrollY); } finally { nav.pending--; }
      } finally {
        const slot = document.getElementById(slotId);
        if (slot) slot.innerHTML = '';
        if (navEdit) navEdit.remove();
        // 4. Only now is the editor removed (its height goes to 0 off screen); fix any drift of 4 px or more.
        const listTop = document.getElementById(sectionId);
        if (listTop && Math.abs(listTop.getBoundingClientRect().top) >= 4) scrollToElement(listTop, 'start', 'instant');
        setTimeout(() => {
          navigating = false;
          window.mikanNavigating = false;
          document.querySelectorAll('.side-nav a').forEach((a) => { a.style.transition = ''; });
          if (window.updateScrollPos) window.updateScrollPos();
        }, 200);
      }
    })();
  }

  // ---- Clicks: open, close, with a confirmation when there are unsaved changes -------------------
  document.body.addEventListener('click', async (event) => {
    const editLink = event.target.closest('a[href*="edit="][href*="#page-editor"], a[href*="new=1"][href*="#page-editor"], a[href*="edit="][href*="#design-editor"], a[href*="new=1"][href*="#design-editor"]');
    if (editLink && !event.target.closest('.close-badge')) {
      event.preventDefault(); event.stopPropagation();
      const href = editLink.getAttribute('href');
      const type = href.indexOf('#page-editor') !== -1 ? 'page' : 'design';
      if (!await guardUnsaved(type)) return;
      const query = new URLSearchParams(href.split('?')[1]?.split('#')[0] || '');
      spaOpenEditor(type, query.get('edit') || null);
      return;
    }
    const closer = event.target.closest('.editor-focus-bg a.btn-gray[href*="#pages"], .editor-focus-bg a.btn-gray[href*="#design"], .side-nav .close-badge');
    if (closer) {
      event.preventDefault(); event.stopPropagation();
      const target = closer.dataset.url || closer.getAttribute('href') || closer.closest('a').getAttribute('href') || '';
      const type = target.indexOf('#pages') !== -1 ? 'page' : 'design';
      if (!await guardUnsaved(type)) return;
      spaCloseEditor(type);
    }
  }, true);

  // The revision list inside the page editor opens that revision in place.
  window.spaChangeRevision = async (select) => {
    const query = new URLSearchParams((select.value.split('?')[1] || '').split('#')[0]);
    if (!await guardUnsaved('page')) { select.selectedIndex = 0; return; }
    spaOpenEditor('page', query.get('edit'), query.get('rev'));
  };

  // Back and forward follow the editor's open and closed states.
  window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (state && state.spaEditor === false) {
      ['page', 'design'].forEach((type) => { const slot = document.getElementById(ids(type).slot); if (slot) slot.innerHTML = ''; });
      if (window.cloudEditorLock) window.cloudEditorLock.stop();
      document.querySelectorAll('.side-nav .nav-edit').forEach((el) => el.remove());
      markClean();
      if (window.updateScrollPos) window.updateScrollPos();
    } else if (state && state.spaEditor === true) {
      spaOpenEditor(state.type, state.editId);
    }
  });

  // ---- Saving and deleting inside an editor -----------------------------------------------------
  // Saving keeps the editor open: the result goes to the toast, and only the parts that change
  // with a save (the page's ID and revision stamp, the revision list) are taken from the server.
  async function afterSave(type, form, wasNew) {
    markClean(type);
    const editId = form.querySelector('input[name="id"]')?.value.trim() || '';
    if (!editId) return;
    try {
      const view = viewOf(type);
      if (wasNew) {
        // The first save of a new page or component: the editor becomes the editor of an existing one
        // (Delete, the revision list, the lock), swapped in place without moving the screen.
        const params = listUrlParams(view); params.set('edit', editId);
        const fetchParams = new URLSearchParams(params); fetchParams.set('ajax_editor', '1');
        const html = await (await fetch('/admin?' + fetchParams.toString(), { credentials: 'same-origin' })).text();
        const slot = document.getElementById(ids(type).slot), y = window.scrollY;
        slot.innerHTML = html;
        runScripts(slot);
        const editor = document.getElementById(ids(type).editor);
        if (editor) bindDirtyTrackers(editor, type);
        window.scrollTo({ top: y, behavior: 'instant' });
        history.replaceState({ spaEditor: true, type, editId }, '', '/admin?' + params.toString() + '#' + ids(type).editor);
        if (type === 'page' && window.cloudEditorLock) window.cloudEditorLock.start(editId);
        refreshList(type);
        return;
      }
      const response = await fetch('/admin?view=' + view + '&edit=' + encodeURIComponent(editId) + '&ajax_editor=1', { credentials: 'same-origin' });
      const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');
      for (const name of ['old_id', 'expected_revision']) {
        const next = fresh.querySelector('input[name="' + name + '"]'), current = form.querySelector('input[name="' + name + '"]');
        if (next && current) current.value = next.value;
      }
      const revisions = fresh.getElementById('editor-revisions-container'), shown = document.getElementById('editor-revisions-container');
      if (revisions && shown) shown.replaceWith(revisions);
      const params = listUrlParams(view); params.set('edit', editId);
      history.replaceState({ spaEditor: true, type, editId }, '', '/admin?' + params.toString() + '#' + ids(type).editor);
      if (type === 'page' && window.cloudEditorLock) window.cloudEditorLock.start(editId);
    } catch (_) { /* the form keeps working; the next save refreshes the stamp */ }
    refreshList(type);
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('#page-form, #comp-form') || event.defaultPrevented) return;
    // getAttribute: the form has an <input name="id">, which shadows form.id
    const formId = form.getAttribute('id');
    const type = formId === 'page-form' ? 'page' : 'design';
    const submitter = event.submitter || null;
    const action = (submitter && submitter.name === 'save_action' ? submitter.value : '') || form.querySelector('input[name="save_action"]')?.value || '';
    if (action === 'delete_page' || action === 'delete_comp') {
      event.preventDefault();
      if (!await ui().confirm(C.confirmDelete || '', C.deleteTitle || '', C.deleteOk || '', 'btn-red')) return;
      try {
        const { ok, json } = await ui().post(form, submitter);
        ui().toast(json.message || (ok ? C.done : C.saveFailed) || '', !ok);
        if (!ok) return;
        markClean(type);
        spaCloseEditor(type); // the editor goes away, the list is refreshed, the screen returns to the list
      } catch (_) { ui().toast(C.networkError || '', true); }
      return;
    }
    if (action !== 'save_page' && action !== 'save_comp') return;
    event.preventDefault();
    await saveEditor(type, form, submitter);
  });

  // Saves an editor in place (toast, stamps refreshed). Resolves true when the save succeeded.
  async function saveEditor(type, form, submitter) {
    const wasNew = !form.querySelector('input[name="old_id"]')?.value;
    const formId = form.getAttribute('id');
    const buttons = [...document.querySelectorAll('button[form="' + formId + '"], #' + formId + ' button')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const { ok, json } = await ui().post(form, submitter);
      ui().toast(json.message || (ok ? C.done : C.saveFailed) || '', !ok);
      if (ok) await afterSave(type, form, wasNew);
      return ok;
    } catch (_) { ui().toast(C.networkError || '', true); return false; }
    finally { buttons.forEach((b) => { if (b.isConnected) b.disabled = false; }); }
  }

  // An editor that the server rendered into the page (a link with ?edit=) starts out clean and tracked.
  document.addEventListener('DOMContentLoaded', () => {
    [['page', 'page-editor'], ['design', 'design-editor']].forEach(([type, id]) => { const editor = document.getElementById(id); if (editor) bindDirtyTrackers(editor, type); });
  });
  window.mikanEditors = { open: spaOpenEditor, close: spaCloseEditor, settleScroll, refreshCompList };
  window.addEventListener('beforeunload', (event) => { if (window.isDirty && !navigating) { event.preventDefault(); event.returnValue = ''; } });
})();
