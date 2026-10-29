import { renderImportView as renderDataImportView } from './import-view';
// ==========================================
// mikanBox Admin Views
// SQLite版を参照したCloud専用テンプレート。未移植部分はdocs/cloud_ja.mdを参照。
// ==========================================

import type { Settings, PageData, ComponentData } from '../types';
import type { User } from '../accounts';
import type { Revision } from '../revisions';
import {CLOUD_VERSION} from '../version';
import {trackingConfigured} from '../tracking';
import type {PublicationStatus,PublicState} from '../publish-status';
import {cloudUpdateUrl,type CloudRelease} from '../cloud-release';

// PHP版と同じMaterial Iconsマッピング
function getIcon(name: string): string {
  const icons: Record<string, string> = {
    page: 'description', component: 'widgets', media: 'image', save: 'save',
    view: 'visibility', upload: 'upload', video: 'videocam', audio: 'music_note',
    cloud: 'cloud_upload', logout: 'logout', globe: 'language', sparkles: 'auto_awesome',
    edit: 'edit', delete: 'delete', download: 'download', arrow_back: 'arrow_back',
    add: 'add', copy: 'content_copy', open_in_new: 'open_in_new', history: 'history', warning: 'warning', search: 'search', close: 'close', database: 'database', archive: 'archive',
  };
  const iconName = icons[name] || '';
  return iconName ? `<span class="material-symbols-outlined icon">${iconName}</span>` : '';
}

function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function csrfField(token: string): string {
  return `<input type="hidden" name="csrf_token" value="${h(token)}">`;
}

// The Cloud edition publishes statically only, so 'public_static' is simply "public".
const statuses = ['draft','pending','public_static','db'];
function statusClass(status: string) { return ({public_dynamic:'static',public:'static',public_static:'static'} as Record<string,string>)[status] || status; }
function statusLabel(t: (key:string)=>string, status: string) {
  // The shared label reads "公開(静的)" / "Public (static)"; drop the mode in parentheses.
  return status === 'public_static' ? t('page_status_public_static').replace(/\s*[(（].*$/, '') : t('page_status_'+status);
}
function statusOptions(t: (key:string)=>string, selected: string) {
  const current = ['public','public_dynamic'].includes(selected) ? 'public_static' : selected;
  return statuses.map(status=>`<option value="${status}" ${current===status?'selected':''}>${statusLabel(t,status)}</option>`).join('');
}
export function renderLoginPage(opts: {lang:string; initial:boolean; noDevices?:boolean; error:string; t:(key:string,...args:(string|number)[])=>string; csrf:string; inviteStep?:{code:string;device_name:string;username?:string;display_name?:string}}):string {
  const {lang,initial,noDevices,error,t,csrf,inviteStep}=opts, ja=lang==='ja';
  const hidden=(action:string)=>`<input type="hidden" name="login_action" value="${action}"><input type="hidden" name="csrf_token" value="${h(csrf)}">`;
  const deviceField=`<div class="form-group"><label>${ja?'この端末の名前（例: 仕事用PC）':'Name for this device (e.g. Work laptop)'}</label><input type="text" name="device_name" maxlength="60" required></div>`;
  const setupFields=`<div class="form-group"><label>${ja?'初期設定トークン（SETUP_TOKEN）':'Setup token (SETUP_TOKEN)'}</label><input type="password" name="setup_token" autocomplete="off" required></div><div class="form-group"><label>${t('label_username')}</label><input type="text" name="username" autocomplete="off" required></div>`;
  return `<!DOCTYPE html><html lang="${h(lang)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>🍊mikanBox</title><link rel="stylesheet" href="/mikanbox/admin.css?v=${h(CLOUD_VERSION)}-8"></head>
  <body class="login-body"><div class="login-box"><div class="login-title"><span>🍊</span><span>mikanBox</span></div>
  ${error?`<div class="error" role="alert">${h(error)}</div>`:''}
  ${inviteStep&&!initial?`<p><strong>${t('device_invite_intro')}</strong></p>
  <form method="post">${hidden('claim')}<input type="hidden" name="code" value="${h(inviteStep.code)}"><input type="hidden" name="device_name" value="${h(inviteStep.device_name)}"><div class="form-group"><label>${t('label_username')}</label><input type="text" name="username" autocomplete="off" required maxlength="80" pattern="[A-Za-z0-9_\\-]{1,80}" value="${h(inviteStep.username||'')}"></div><div class="form-group"><label>${t('label_display_name')}</label><input type="text" name="display_name" required maxlength="120" value="${h(inviteStep.display_name||'')}"></div><button type="submit">${ja?'この端末を登録':'Register this device'}</button></form>`
  :noDevices?`<p>${ja?'このサイトには、登録された端末がまだありません。初期設定トークン（SETUP_TOKEN）と既存のユーザー名で、この端末を登録します。':'No device is registered on this site yet. Register this device with the setup token (SETUP_TOKEN) and an existing username.'}</p>
  <form method="post">${hidden('setup')}${setupFields}${deviceField}<button type="submit">${ja?'この端末を登録':'Register this device'}</button></form>`
  :initial?`<p><strong>${t('hint_initial_setup')}</strong><br>${ja?'この端末を、最初の管理端末として登録します。パスワードはありません。登録した端末のブラウザが鍵になります。':'Register this device as the first admin device. There is no password; this browser becomes the key.'}</p>
  <form method="post">${hidden('setup')}${setupFields}<div class="form-group"><label>${t('label_display_name')}</label><input type="text" name="display_name" required></div>${deviceField}<button type="submit">${ja?'この端末を登録':'Register this device'}</button></form>`
  :`<p>${ja?'この端末は登録されていません。登録済みの端末の管理画面（サイト →「端末とユーザー」）で追加用のコードを出し、入力してください。':'This device is not registered. Issue a code on a registered device (Site → Devices and users) and enter it here.'}</p>
  <form method="post">${hidden('claim')}<div class="form-group"><label>${ja?'追加用のコード':'Device code'}</label><input type="text" name="code" autocomplete="off" required autofocus placeholder="XXXXX-XXXXX"></div>${deviceField}<button type="submit">${ja?'この端末を登録':'Register this device'}</button></form>
  <details class="mt-10"><summary>${ja?'復旧（すべての端末を失った場合）':'Recovery (all devices lost)'}</summary><p class="sub-text">${ja?'wrangler で新しい SETUP_TOKEN を設定してから使います。登録済みの端末はすべて止まり、未使用のコードとMCPキーも消えます。':'Set a new SETUP_TOKEN with wrangler first. Every registered device stops, and unused codes and the MCP key are cleared.'}</p>
  <form method="post">${hidden('setup')}${setupFields}${deviceField}<button type="submit">${ja?'復旧してこの端末を登録':'Recover and register this device'}</button></form></details>`}
  </div></body></html>`;
}

// Globe icon: blue when the public page shows the current source, grey when it is
// older or not yet public. Never-published pages have nothing to open.
function globeLink(state: PublicState | undefined, ja: boolean): string {
  if (!state) return '';
  if (state.state === 'none') return `<span class="btn btn-sm btn-gray" aria-disabled="true" style="opacity:.45;cursor:default" title="${ja ? 'まだ公開されていません' : 'Not published yet'}">${getIcon('globe')}</span>`;
  const live = state.state === 'live';
  return `<a href="${h(state.url)}" target="_blank" class="btn btn-sm ${live ? 'btn-blue' : 'btn-gray'}" title="${live ? (ja ? '公開ページを開く' : 'Open the public page') : (ja ? '公開ページを開く（変更がまだ反映されていません）' : 'Open the public page (changes not published yet)')}">${getIcon('globe')}</a>`;
}
// The build is how pages reach the public site, so it sits with the page list and
// reports there rather than in the toast at the top of the screen.
function publishBox(csrf: string, t: (key: string, ...args: (string | number)[]) => string, publication: PublicationStatus | undefined, ja: boolean, cloudReady: boolean, publicUrl: string): string {
  const when = publication?.publishedAt ? new Date(publication.publishedAt).toLocaleString(ja ? 'ja-JP' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const summary = !publication ? '' : publication.stale
    ? (ja ? `公開側に反映していない変更があります（${publication.stale}ページ）。` : `${publication.stale} page(s) have changes not on the public site.`)
    : (ja ? '公開側は最新です。' : 'The public site is up to date.');
  // Publishing needs the Cloudflare API token from Site → Cloudflare publication settings; say so here, where the button is.
  const setup = cloudReady ? '' : `<p class="publish-setup" role="note">${ja ? '公開するには、Cloudflare APIトークンの設定が必要です。' : 'Publishing needs a Cloudflare API token.'} <a href="/admin?view=site#cloud-connection" data-open-cloud-connection>${ja ? 'サイト →「Cloudflare公開設定」で設定する（取得方法も書いてあります）' : 'Set it up under Site → Cloudflare publication settings (the steps are explained there)'}</a></p>`;
  const destination = publicUrl ? `<span class="publish-status">${ja ? '公開先' : 'Public site'}: <a href="${h(publicUrl)}" target="_blank" rel="noopener noreferrer">${h(publicUrl)}</a></span>` : '';
  return `<form method="post" class="publish-box mt-10" id="publish-box">${csrfField(csrf)}<input type="hidden" name="save_action" value="build_ssg"><button class="btn btn-blue btn-small">${getIcon('cloud')} <span data-publish-label>${t('btn_ssg_build')}</span></button><span class="publish-status" data-publish-status role="status">${h(summary)}${when ? ` ${ja ? '最後の公開' : 'Last published'}: ${h(when)}` : ''}</span>${destination}${setup}</form>`;
}

// ===== 管理画面メインシェル =====
export function renderAdminShell(opts: {
  lang: string;
  t: (key: string, ...args: (string | number)[]) => string;
  view: string;
  editId: string | null;
  hasNew: boolean;
  helpFile: string;
  message: string;
  csrf: string;
  settings: Settings;
  pagesHtml: string;
  pageEditorHtml: string;
  siteHtml: string;
  designHtml: string;
  designEditorHtml: string;
  mediaHtml: string;
  aiPromptJson: string;
  mediaEnabled?: boolean;
  allCategories?: string[];
  category?: string;
}): string {
  const { lang, t, view, editId, hasNew, message, csrf, settings, helpFile,
          pagesHtml, pageEditorHtml, siteHtml, designHtml, designEditorHtml, mediaHtml, aiPromptJson } = opts;
  const showPageEditor = view === 'pages' && (editId !== null || hasNew);
  const showDesignEditor = view === 'components' && (editId !== null || hasNew);
  const ssgRootUrl = (settings.ssg_root_url || '').trim().replace(/\/$/, '') || String(settings._public_url || '') || '/';

  return `<!DOCTYPE html>
<html lang="${h(lang)}">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${t('admin_site_title')} - mikanBox</title>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block" rel="stylesheet">
    <link rel="stylesheet" href="/mikanbox/admin.css?v=${h(CLOUD_VERSION)}-8">
    <style>
    #admin-toast { position:fixed; bottom:30px; right:30px; max-width:calc(100vw - 60px); box-sizing:border-box; background:rgba(0,0,0,.8); color:white; padding:12px 24px; border-radius:8px; z-index:10000; transition:opacity .3s; opacity:0; visibility:hidden; pointer-events:none; }
    #admin-toast.toast-show { opacity:1; visibility:visible; }
    #admin-toast.toast-error { background:rgba(220,53,69,.9); }
    </style>
</head>
<body>
<script>(function(){
    var s=document.createElement('style');s.id='init-notransition';
    s.textContent='body,.side-nav a{transition:none!important}';
    document.head.appendChild(s);
    var bg=sessionStorage.getItem('mikan_bg');
    if(bg){document.body.style.backgroundColor=bg;sessionStorage.removeItem('mikan_bg');}
})();</script>

${opts.mediaEnabled?`<div id="drop-zone">${getIcon('cloud')} ${t('hint_drop_upload')}</div>`:''}

<nav class="side-nav">
    <div class="side-nav-brand">
        <span class="emoji">🍊</span>
        <span class="text">mikanBox<br>cloud</span>
    </div>

    <a href="${view==='import'?'/admin':''}#pages" class="nav-pages" title="${t('nav_pages')}">
        ${getIcon('page')}
        <span>${t('nav_pages')}</span>
    </a>

    ${showPageEditor ? `
    <a href="#page-editor" class="nav-edit active" data-editor-type="page" title="${t('btn_edit')}">
        ${getIcon('edit')}
        <span>${t('btn_edit')}</span>
        <span class="close-badge" title="閉じる" onclick="event.preventDefault();event.stopPropagation();window.location.href='/admin#pages'">×</span>
    </a>` : ''}
    <a href="${view==='import'?'/admin':''}#site" class="nav-settings" title="${t('nav_settings')}">
        ${getIcon('save')}
        <span>${t('nav_settings')}</span>
    </a>
    <a href="${view==='import'?'/admin':''}#design" class="nav-design" title="${t('nav_design')}">
        ${getIcon('component')}
        <span>${t('nav_design')}</span>
    </a>

    ${showDesignEditor ? `
    <a href="#design-editor" class="nav-edit active" data-editor-type="design" title="${t('btn_edit')}">
        ${getIcon('edit')}
        <span>${t('btn_edit')}</span>
        <span class="close-badge" title="閉じる" onclick="event.preventDefault();event.stopPropagation();window.location.href='/admin?view=components'">×</span>
    </a>` : ''}

    <a href="${view==='import'?'/admin':''}#media" class="nav-media" title="${t('nav_media')}">
        ${getIcon('media')}
        <span>${t('nav_media')}</span>
    </a>
</nav>
<div class="main">
    ${settings._public_url ? '' : `<div class="page-top-links">
        <a href="${h(ssgRootUrl)}" target="_blank">${t('admin_view_site')}</a>
    </div>`}

    ${message ? `<div id="admin-toast" class="toast toast-show">${h(message)}</div>` : ''}

    ${view==='import'?'':`    <div class="category-cloud-wrap"><div class="category-cloud"><span class="category-cloud-label">${t('category_cloud_label')}</span>
    <a href="?cat=" class="category-cloud-tag ${!opts.category?'active':''}">${t('all_pages')}</a>
    ${(opts.allCategories||[]).map(cat=>`<a href="?cat=${encodeURIComponent(cat)}" class="category-cloud-tag ${opts.category===cat?'active':''}">${h(cat)}</a>`).join('')}
    <button type="button" class="category-cloud-tag" data-add-category>${getIcon('add')} ${t('btn_add')}</button></div></div>
    ${pagesHtml}

`}
    ${pageEditorHtml}

    ${siteHtml}

    ${view==='import'?'':designHtml}

    ${designEditorHtml}

    ${view==='import'?'':mediaHtml}

    <script src="/mikanbox/ai-question.js?v=${h(CLOUD_VERSION)}" data-mcp-endpoint="/public-mcp" data-public-mcp="/public-mcp" data-help-ja="/public-help.html?language=ja" data-help-en="/public-help.html?language=en" defer></script>
    <script>
    // The save marker is a one-time notification, not part of navigation state.
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('saved') === '1') {
        currentUrl.searchParams.delete('saved');
        history.replaceState(history.state, '', currentUrl.href);
    }
    window.CSRF_TOKEN = ${JSON.stringify(csrf)};
    window.AI_PROMPT = ${aiPromptJson};
    window.HELP_FILE = ${JSON.stringify(helpFile)};

    window.copyField = async function(id) {
        const input = document.getElementById(id);
        if (!input) return;
        try { await navigator.clipboard.writeText(input.value); showToast(${JSON.stringify(t('msg_copied'))}); }
        catch { input.select(); document.execCommand('copy'); showToast(${JSON.stringify(t('msg_copied'))}); }
    };
    // The admin MCP endpoint of the host this screen is served from.
    const mcpUrlField = document.getElementById('mcp-url-display');
    if (mcpUrlField) mcpUrlField.value = location.origin + '/mcp';

    const searchInput=document.getElementById('admin-page-search'), searchIcon=document.getElementById('admin-page-search-icon'), searchClear=document.getElementById('admin-page-search-clear');
    if(searchInput&&searchIcon&&searchClear){
      const updateSearchControls=()=>{const hasValue=searchInput.value.length>0;searchIcon.style.display=hasValue?'none':'flex';searchClear.style.display=hasValue?'flex':'none';};
      searchInput.addEventListener('input',updateSearchControls);
      searchClear.addEventListener('click',(event)=>{event.preventDefault();searchInput.value='';updateSearchControls();searchInput.form?.requestSubmit();});
    }

    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    (function() {
        var hash = window.location.hash;
        if (hash === '#page-editor' || hash === '#design-editor') {
            var el = document.querySelector(hash);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
    })();

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dropZone) dropZone.classList.add('active');
    });
    window.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null && dropZone) dropZone.classList.remove('active');
    });
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (dropZone) dropZone.classList.remove('active');
        const files = e.dataTransfer.files;
        if (files.length > 0 && uploadForm) {
            const formData = new FormData(uploadForm);
            formData.set('save_action', 'upload_media');
            formData.append('csrf_token', window.CSRF_TOKEN);
            formData.set('image', files[0]);
            await doMediaUpload(formData);
        }
    });

    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await doMediaUpload(new FormData(uploadForm));
        });
    }

    const uploadPublicationStatus = document.getElementById('upload-publication-status');
    const uploadRetry = document.getElementById('upload-publication-retry');
    let unpublishedUpload = '';
    async function publishUploadedImage(name) {
        if (uploadRetry) { uploadRetry.hidden = true; uploadRetry.style.display = 'none'; }
        if (uploadPublicationStatus) uploadPublicationStatus.textContent = ${JSON.stringify(opts.lang==='ja'?'画像を公開しています…':'Publishing image…')};
        try {
            await window.cloudPublish(false, [], name);
            unpublishedUpload = '';
            if (uploadPublicationStatus) uploadPublicationStatus.textContent = ${JSON.stringify(opts.lang==='ja'?'画像を公開しました。':'Image published.')};
        } catch (error) {
            unpublishedUpload = name;
            const message = ${JSON.stringify(opts.lang==='ja'?'画像は保存しましたが、公開に失敗しました。':'Image saved, but publication failed.')} + ' ' + (error.message || '');
            if (uploadPublicationStatus) uploadPublicationStatus.textContent = message;
            if (uploadRetry) { uploadRetry.hidden = false; uploadRetry.style.display = ''; }
            showToast(message, true);
        }
    }
    if (uploadRetry) uploadRetry.addEventListener('click', () => { if (unpublishedUpload) publishUploadedImage(unpublishedUpload); });

    async function doMediaUpload(formData) {
        const btn = document.getElementById('upload-btn');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) { btn.textContent = ${JSON.stringify(opts.t('msg_uploading'))}; btn.disabled = true; }
        formData.append('ajax_request', '1');
        try {
            if(window.cloudPrepareMediaForm)formData=await window.cloudPrepareMediaForm(formData);
            const res = await fetch(window.location.href, { method: 'POST', body: formData });
            const json = await res.json().catch(() => ({}));
            showToast(json.message || '', !json.success);
            if (json.success) {
                if (fileInput) fileInput.value = '';
                await refreshMediaGrid();
                if (json.uploaded_name && /\.(?:jpe?g|png|gif|webp|svg)$/i.test(json.uploaded_name) && window.cloudPublish) {
                    await publishUploadedImage(json.uploaded_name);
                }
            }
        } catch(err) {
            showToast(err.message || ${JSON.stringify(opts.t('err_upload_failed'))}, true);
        } finally {
            if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
        }
    }

    // Keep the viewport stable while a refreshed list replaces its old DOM.
    let listRefreshCount = 0, savedOverflowAnchor = '';
    function replaceListPreservingScroll(oldList, newList) {
        if (!oldList || !newList) return;
        const y = window.scrollY;
        const root = document.documentElement;
        if (listRefreshCount++ === 0) {
            savedOverflowAnchor = root.style.overflowAnchor;
            root.style.overflowAnchor = 'none';
        }
        // Reserve the old height until the replacement has been laid out.
        newList.style.minHeight = oldList.getBoundingClientRect().height + 'px';
        oldList.replaceWith(newList);
        window.scrollTo({top: y, behavior: 'instant'});
        requestAnimationFrame(() => {
            newList.style.minHeight = '';
            window.scrollTo({top: y, behavior: 'instant'});
            requestAnimationFrame(() => {
                if (--listRefreshCount === 0) root.style.overflowAnchor = savedOverflowAnchor;
            });
        });
    }

    async function refreshMediaGrid() {
        try {
            const mediaUrl = new URL(location.href); mediaUrl.searchParams.set('ajax_media','1');
            const res = await fetch(mediaUrl);
            const html = await res.text();
            const temp = document.createElement('div');
            temp.innerHTML = html;
            const newGrid = temp.querySelector('.media-grid');
            const oldGrid = document.querySelector('.media-grid');
            replaceListPreservingScroll(oldGrid, newGrid);
            const newUsage = temp.querySelector('#media-usage');
            const oldUsage = document.querySelector('#media-usage');
            if (newUsage && oldUsage) oldUsage.textContent = newUsage.textContent;
            const newPager = temp.querySelector('#media-pagination');
            const oldPager = document.querySelector('#media-pagination');
            if (newPager && oldPager) oldPager.outerHTML = newPager.outerHTML;
        } catch(err) {}
    }

    document.addEventListener('submit', async function(e) {
        const form = e.target;
        const actionInput = form.querySelector('input[name="save_action"]');
        if (!actionInput) return;
        const action = actionInput.value;
        if (action === 'delete_page') {
            e.preventDefault();
            const formData = new FormData(form);
            formData.append('ajax_request', '1');
            try {
                const res = await fetch(window.location.href, { method: 'POST', body: formData });
                const json = await res.json().catch(() => ({}));
                if (json.success) {
                    window.location.href = '/admin?view=pages';
                } else {
                    showToast(json.message || ${JSON.stringify(opts.t('err_save_failed'))}, true);
                }
            } catch(err) {
                showToast(${JSON.stringify(opts.t('err_save_failed'))}, true);
            }
        } else if (action === 'delete_comp') {
            e.preventDefault();
            const formData = new FormData(form);
            formData.append('ajax_request', '1');
            try {
                const res = await fetch(window.location.href, { method: 'POST', body: formData });
                const json = await res.json().catch(() => ({}));
                if (json.success) {
                    window.location.href = '/admin?view=components';
                } else {
                    showToast(json.message || ${JSON.stringify(opts.t('err_save_failed'))}, true);
                }
            } catch(err) {
                showToast(${JSON.stringify(opts.t('err_save_failed'))}, true);
            }
        } else if (action === 'delete_media' || action === 'rename_media' || action === 'resize_media' || action === 'convert_media_webp') {
            e.preventDefault();
            let formData = new FormData(form);
            formData.append('ajax_request', '1');
            try {
                if(window.cloudPrepareMediaForm)formData=await window.cloudPrepareMediaForm(formData);
                const res = await fetch(window.location.href, { method: 'POST', body: formData });
                const json = await res.json().catch(() => ({}));
                showToast(json.message || '', !json.success);
                if (json.success) { await refreshMediaGrid(); }
            } catch(err) {
                showToast(err.message || ${JSON.stringify(opts.t('err_save_failed'))}, true);
            }
        }
    });

    function basename(path) {
        return path.split('/').reverse()[0];
    }
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            alert(${JSON.stringify(opts.t('msg_copied'))});
        } catch (err) {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                alert(${JSON.stringify(opts.t('msg_copied'))});
            } catch (err) {
                alert(${JSON.stringify(opts.t('msg_copy_failed'))});
            }
            document.body.removeChild(textArea);
        }
    }
    async function csvConvertAndCopy() {
        const fileInput = document.getElementById('csv-file-input');
        const btn = document.getElementById('csv-copy-btn');
        if (!fileInput.files[0]) { alert(${JSON.stringify(opts.t('csv_no_file'))}); return; }
        const buffer = await fileInput.files[0].arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let encoding = 'UTF-8';
        if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            encoding = 'UTF-8';
        } else {
            const probe = new TextDecoder('UTF-8', { fatal: false }).decode(buffer);
            if (probe.includes('\\uFFFD')) encoding = 'Shift_JIS';
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
            const rows = [];
            let cur = '', inQ = false;
            const fields = [];
            for (let i = 0; i <= text.length; i++) {
                const c = text[i];
                if (c === '"') {
                    if (inQ && text[i+1] === '"') { cur += '"'; i++; }
                    else inQ = !inQ;
                } else if ((c === ',' && !inQ)) {
                    fields.push(cur); cur = '';
                } else if ((c === '\\n' && !inQ) || c === undefined) {
                    fields.push(cur); cur = '';
                    if (fields.some(f => f.trim())) rows.push([...fields]);
                    fields.length = 0;
                } else {
                    cur += c;
                }
            }
            if (rows.length < 2) return;
            const headers = rows[0].map(hh => hh.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, ''));
            let output = '';
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                output += \`{{DATAROW:\${i}}}\\n\`;
                headers.forEach((hh, j) => {
                    if (hh) output += \`{{DATA:\${hh}}}\${(row[j] || '').trim()}{{/DATA}}\\n\`;
                });
                output += \`{{/DATAROW}}\\n\\n\`;
            }
            copyToClipboard(output).then(() => {
                const orig = btn.innerHTML;
                btn.textContent = ${JSON.stringify(opts.t('csv_copied'))};
                setTimeout(() => btn.innerHTML = orig, 2000);
            });
        };
        reader.readAsText(fileInput.files[0], encoding);
    }
    async function changePageStatus(id, newStatus) {
        const formData = new FormData();
        formData.append('save_action', 'save_page_status');
        formData.append('id', id);
        formData.append('status', newStatus);
        formData.append('csrf_token', window.CSRF_TOKEN);
        formData.append('ajax_request', '1');
        try {
            const res = await fetch(window.location.href, { method: 'POST', body: formData });
            if (res.ok) {
                const json = await res.json().catch(()=>({}));
                showToast(json.message || ${JSON.stringify(opts.t('msg_update_success'))});
                const selectEl = document.querySelector(\`select[onchange*="'\${id}'"]\`);
                if (selectEl) {
                    selectEl.classList.remove('static', 'dynamic', 'draft', 'db');
                    if (newStatus === 'public_static') selectEl.classList.add('static');
                    else if (newStatus === 'pending') selectEl.classList.add('pending');
                    else if (newStatus === 'db') selectEl.classList.add('db');
                    else selectEl.classList.add('draft');
                }
            } else {
                showToast('保存に失敗しました', true);
            }
        } catch(err) {
            showToast('通信エラー', true);
        }
    }
    let isNavigating = false;
    function updateScrollPos() {
        if (isNavigating) return;
        const sections = [
            { id: 'pages', color: '#e0f2fe', navId: 'nav-pages' },
            { id: 'site', color: '#ffffff', navId: 'nav-settings' },
            { id: 'settings', color: '#ffffff', navId: 'nav-settings' },
            { id: 'backup', color: '#ffffff', navId: 'nav-settings' },
            { id: 'cloud-connection', color: '#ffffff', navId: 'nav-settings' },
            { id: 'ai-prompt', color: '#ffffff', navId: 'nav-settings' },
            { id: 'design', color: '#fffbeb', navId: 'nav-design' },
            { id: 'media', color: '#f0fdf4', navId: 'nav-media' }
        ];
        let scrollY = window.scrollY + window.innerHeight / 3;
        let current = sections[0];
        for (const sec of sections) {
            const el = document.getElementById(sec.id);
            if (el) {
                const rect = el.getBoundingClientRect();
                const top = rect.top + window.scrollY - 100;
                if (scrollY >= top) current = sec;
            }
        }
        if (current) {
            document.body.style.backgroundColor = current.color;
            document.querySelectorAll('.side-nav a:not(.nav-edit)').forEach(btn => {
                const shouldBeActive = btn.classList.contains(current.navId);
                if (shouldBeActive && !btn.classList.contains('active')) btn.classList.add('active');
                else if (!shouldBeActive && btn.classList.contains('active')) btn.classList.remove('active');
            });
        }
    }
    function navigateTo(hash) {
        isNavigating = true;
        const el = document.getElementById(hash.replace('#',''));
        if (el) {
            sessionStorage.setItem('mikan_bg', window.getComputedStyle(document.body).backgroundColor);
            el.scrollIntoView({ behavior: 'smooth' });
        }
        setTimeout(() => { isNavigating = false; updateScrollPos(); }, 600);
    }
    document.querySelectorAll('.side-nav a').forEach(a => {
        a.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            const closeUrl = this.dataset.url;
            if (closeUrl) { e.preventDefault(); window.location.href = closeUrl; return; }
            if (href && href.startsWith('#')) { e.preventDefault(); navigateTo(href); }
        });
    });
    window.addEventListener('scroll', updateScrollPos, { passive: true });
    let toastTimer;
    document.addEventListener('DOMContentLoaded', () => {
        updateScrollPos();
        setTimeout(() => {
            const s = document.getElementById('init-notransition');
            if (s) s.remove();
        }, 100);

        const toast = document.getElementById('admin-toast');
        if (toast) { toastTimer = setTimeout(() => toast.classList.remove('toast-show'), 3000); }
    });
    function showToast(msg, isError = false) {
        let toast = document.getElementById('admin-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'admin-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.className = 'toast toast-show' + (isError ? ' toast-error' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('toast-show'), 3000);
    }
    </script>
    <dialog id="rename-confirm-dialog" class="custom-dialog"><h3 class="dialog-title" style="margin-top:0;margin-bottom:12px;font-size:1.05rem;display:flex;align-items:center;gap:8px">${getIcon('warning')} ${t('media_rename_confirm_title')}</h3><p id="rename-dialog-message" style="font-size:.9rem;line-height:1.5;margin-bottom:20px;color:#475569"></p><div class="dialog-buttons" style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button type="button" data-rename-choice="cancel" class="btn btn-small btn-gray">${t('btn_rename_cancel')}</button><button type="button" data-rename-choice="only" class="btn btn-small btn-gray">${t('btn_rename_only')}</button><button type="button" data-rename-choice="update" class="btn btn-small btn-blue">${t('btn_rename_update')}</button></div></dialog>

    <script src="/mikanbox/preview-editor.js?v=${h(CLOUD_VERSION)}" defer></script>
    <script src="/mikanbox/cloud-admin.js?v=${h(CLOUD_VERSION)}-3" defer></script>
    <script src="/mikanbox/cloud-media.js?v=${h(CLOUD_VERSION)}" defer></script>
    <script src="/mikanbox/cloud-backup.js?v=${h(CLOUD_VERSION)}-2" defer></script><script src="/mikanbox/cloud-publish.js?v=${h(CLOUD_VERSION)}-7" defer></script><script src="/mikanbox/cloud-storage.js?v=${h(CLOUD_VERSION)}-2" defer></script>
</div>
</body>
</html>`;
}

// ===== ページ一覧 (views/pages.php) =====
export function renderPagesView(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  pages: Array<{ id: string; data: PageData }>;
  view: string;
  editId: string | null;
  hasNew: boolean;
  csrf: string;
  helpFile: string;
  settings: Settings;
  query?: string; category?:string; pageNumber?:number; totalPages?:number;
  lang?: string; publication?: PublicationStatus; cloudReady?: boolean; publicUrl?: string;
}): string {
  const { t, pages, view, editId, hasNew, csrf, helpFile } = opts;
  const ja = opts.lang !== 'en', publication = opts.publication;
  const hasEditor = view === 'pages' && (editId !== null || hasNew);

  const rows = pages.map(({ id: pid, data: d }) => {
    const status=['public','public_dynamic'].includes(d.status) ? 'public_static' : d.status || 'draft';
    const cls=statusClass(status);
    const previewUrl = `/preview/${pid}`;

    return `<tr>
                <td class="td-narrow">
                    <div class="flex-center" style="gap: 5px;">
                         <a href="?view=pages&amp;edit=${h(pid)}#page-editor" class="btn btn-sm btn-blue">${getIcon('edit')} ${t('btn_edit')}</a>
                         <a href="${h(previewUrl)}" target="_blank" class="btn btn-sm btn-blue" title="${t('btn_preview')}">${getIcon('open_in_new')}</a>
                         ${globeLink(publication?.pages[pid], ja)}
                    </div>
                </td>
                <td class="td-narrow">
                    <div class="flex-center">
                        <select onchange="changePageStatus('${h(pid)}', this.value)" class="status-select-inline ${cls}">
                            ${statusOptions(t,status)}
                        </select>
                    </div>
                </td>
                <td class="td-narrow"><code>${h(pid)}</code></td>
                <td>
                    <div class="title-cell-flex">
                         <a href="?view=pages&amp;edit=${h(pid)}#page-editor" class="title-link">${h(d.title || 'No Title')}</a>
                    </div>
                </td>
                <td class="td-narrow text-sub">${h((d.updated_at || '').slice(0, 10))}</td>
                <td class="td-narrow text-sub text-center">${h(d.sort_order ?? 0)}</td>
                <td style="font-size: 0.85rem; color: var(--text-sub);">${h((d.category || '').split(',').map(s => s.trim()).filter(Boolean).join(', '))}</td>
            </tr>`;
  }).join('');

  const emptyRow = pages.length === 0
    ? `<tr><td colspan="7" class="td-empty">${t('empty_pages')}</td></tr>`
    : '';

  return `
    <div id="pages" class="section-anchor">
        <div class="section-container section-large-bottom">
            <div class="header">
            <h1>${getIcon('page')} ${t('nav_pages')}
              <a href="?view=pages&amp;new=1#page-editor" class="btn btn-sm btn-blue" style="margin-left:15px;display:inline-flex;align-items:center;gap:5px;font-size:.85rem;padding:4px 10px;vertical-align:middle">${getIcon('add')} ${t('btn_create_new')}</a>
              <a href="${h(helpFile)}#page-mgmt" target="_blank" class="manual-link">${t('admin_help')}</a>
            </h1>
            <form method="get" class="search-bar-wrap" style="display:flex;align-items:center">
              <div style="position:relative;display:flex;align-items:center">
                <input type="search" name="q" id="admin-page-search" value="${h(opts.query||'')}" placeholder="${t('search_placeholder')}" style="padding:6px 32px 6px 12px;border:1px solid var(--border);border-radius:6px;font-size:.9rem;width:220px;box-sizing:border-box;outline:none">
                <span id="admin-page-search-icon" style="position:absolute;right:10px;color:var(--text-sub);display:${opts.query?'none':'flex'};align-items:center;pointer-events:none">${getIcon('search')}</span>
                <a id="admin-page-search-clear" class="search-clear" title="${t('btn_clear_search')}" aria-label="${t('btn_clear_search')}" href="/admin?view=pages&cat=${encodeURIComponent(opts.category||'')}#pages" style="position:absolute;right:10px;color:var(--text-sub);display:${opts.query?'flex':'none'};align-items:center">${getIcon('close')}</a>
              </div><input type="hidden" name="cat" value="${h(opts.category||'')}">
            </form>
        </div>
        <div class="table-responsive" id="pages-table-wrap">
        <form id="ssg-build-form" method="post">
        ${csrfField(csrf)}
        <table>
            <tr><th class="td-narrow">${t('label_operation')}</th><th class="td-narrow">${t('label_status')}</th><th class="td-narrow">${t('label_slug')}</th><th>${t('label_title')}</th><th class="td-narrow">${t('label_updated_at')}</th><th class="td-narrow">${t('label_sort_order')}</th><th>${t('label_category')}</th></tr>
            ${rows}${emptyRow}
        </table>
        </form>
        </div>
        ${(opts.totalPages||1)>1?`<div class="pagination">${Array.from({length:opts.totalPages||1},(_,i)=>`<a class="pagination-link ${opts.pageNumber===i+1?'active':''}" href="?view=pages&amp;p_pages=${i+1}&amp;q=${encodeURIComponent(opts.query||'')}&amp;cat=${encodeURIComponent(opts.category||'')}#pages">${i+1}</a>`).join('')}</div>`:''}
        ${publishBox(csrf, t, publication, ja, opts.cloudReady !== false, opts.publicUrl || '')}
        </div>
    </div>

    <div id="page-editor-slot">
    </div>`;
}

// ===== ページエディター (views/page-editor.php) =====
export function renderPageEditor(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  editId: string | null;
  editData: PageData | null;
  csrf: string;
  helpFile: string;
  wrapperComponents: Array<{ id: string }>;
  allCategories: string[];
  settings: Settings;
  revisions?: Revision[];
  selectedRevision?: Revision;
}): string {
  const { t, editId, editData, csrf, helpFile, wrapperComponents, allCategories } = opts;
  const d = editData || {} as PageData;
  const status=['public','public_dynamic'].includes(d.status) ? 'public_static' : d.status||'draft';

  const wrapperOptions = wrapperComponents.map(c =>
    `<option value="${h(c.id)}" ${(d.wrapper_comp || '_layout') === c.id ? 'selected' : ''}>${h(c.id)}</option>`
  ).join('');

  const renderTagGuide = buildTagGuide(t, helpFile);

  return `
            <div id="page-editor" class="editor-focus-bg section-anchor">
                <div class="editor-floating-card">
                    <div class="header section-header editor-card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px">
                        <div class="header-title-group">
                            <h1 class="no-margin">${editId ? t('page_edit') : t('page_new')}<a href="${h(helpFile)}#page-edit" target="_blank" class="manual-link">${t('admin_help')}</a></h1>
                            ${editId ? `
                                <div class="last-updated-group mt-5">
                                    <span class="updated-label">${t('label_updated_at')}:</span>
                                    <input type="text" name="updated_at" form="page-form" value="${h(d.updated_at || new Date().toISOString().slice(0, 19).replace('T', ' '))}" class="last-updated-input" title="YYYY-MM-DD HH:MM:SS">
                                </div>` : ''}
                        </div>
                    ${editId?`<div class="revisions-select-group" style="display:flex;align-items:center;gap:8px;white-space:nowrap"><span>${getIcon('history')} ${t('label_revisions')}</span><select style="width:auto;min-width:180px" aria-label="${t('label_revisions')}" onchange="location.href=this.value"><option value="?view=pages&edit=${encodeURIComponent(editId)}#page-editor">${t('select_revision')}</option>${(opts.revisions||[]).map(r=>`<option value="?view=pages&edit=${encodeURIComponent(editId)}&rev=${r.id}#page-editor" ${opts.selectedRevision?.id===r.id?'selected':''}>${h(r.created_at)} (${h(r.editor_id)})</option>`).join('')}</select></div>`:''}
                    </div>
                    <div class="editor-container editor-container-transparent">
                        ${opts.selectedRevision?`<div id="revision-warning-banner" class="alert alert-warning" role="status" style="background:#fffbeb;border:1px solid #fef3c7;color:#b45309;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:.9rem;line-height:1.5"><strong>${opts.settings.system_lang==='en'?'Viewing revision':'過去の版を表示中'}:</strong> ${h(opts.selectedRevision.created_at)} (${h(opts.selectedRevision.editor_id)})<br>${opts.settings.system_lang==='en'?'Saving will restore this revision as the current version.':'保存すると、この版が現在のページとして復元されます。'}</div>`:''}
                        <form method="post" id="page-form">
                    <input type="hidden" name="save_action" value="save_page">
                    <input type="hidden" name="old_id" value="${h(editId || '')}">
                    ${csrfField(csrf)}
                    <input type="hidden" name="expected_revision" value="${h(d.revision_tag||'')}">
                    <div class="page-edit-grid">
                        <div class="grid-span-2"><div class="form-group">
                             <label>${t('label_title')}</label>
                             <input type="text" name="title" value="${h(d.title || '')}" required placeholder="${t('label_title')}">
                         </div>
                         <div class="form-group">
                             <label class="sub-label">${t('label_status')}</label>
                             <div class="status-selector-group">
                             ${statuses.map(st=>`<label class="radio-label ${status===st?'active '+statusClass(st):''}"><input type="radio" name="status" value="${st}" ${status===st?'checked':''}> ${t('page_status_'+st)}</label>`).join('')}
                             </div>
                         </div></div>
                    <div class="form-group form-group-memo grid-span-2"><label class="sub-label">${t('label_memo')}</label><textarea name="memo" class="textarea-xs textarea-memo" placeholder="${t('memo_hint')}">${h(d.memo||'')}</textarea></div>
                    </div>
                    <div class="page-edit-grid">
                        <div class="form-group grid-span-1">
                            <label class="sub-label">${t('label_slug')}</label>
                            <input type="text" name="id" value="${h(editId || '')}" ${(editId && editId === 'index') ? 'readonly' : ''} placeholder="profile" class="input-height">
                            <small class="sub-text sub-text-block">${t('page_id_hint')} ${editId === 'index' ? t('hint_slug_index') : ''}</small>
                        </div>
                        <div class="form-group grid-span-1">
                            <label class="sub-label">${t('label_design_component')}</label>
                            <select name="wrapper_comp">
                                <option value="__none" ${d.wrapper_comp==='__none'?'selected':''}>${t('wrapper_none')}</option>
                                ${wrapperOptions}
                            </select>
                            <small class="sub-text sub-text-block">${t('head_completion_hint')}</small>
                            ${trackingConfigured(opts.settings) ? `<input type="hidden" name="tracking_option_present" value="1"><label class="checkbox-label tracking-exclusion"><input type="checkbox" name="exclude_tracking" value="1" ${d.exclude_tracking?'checked':''}> ${t('exclude_tracking_label')}</label>` : ''}
                        </div>
                        <div class="form-group grid-span-1">
                            <label class="sub-label">${t('label_category')} ${t('hint_comma_separated')}</label>
                            <input type="text" name="category" value="${h(d.category || '')}" placeholder="news, blog, ...">
                            <small class="sub-text sub-text-block">
                                ${t('hint_existing_categories')}:
                                ${allCategories.length > 0 ? h(allCategories.join(', ')) : (opts.settings.system_lang==='en'?'(none)':'(なし)')}
                            </small>
                        </div>
                         <div class="form-group grid-span-1">
                             <label class="sub-label">${t('label_sort_order')}</label>
                             <input type="number" name="sort_order" value="${h(d.sort_order ?? 0)}" placeholder="0" class="input-full">
                         </div>
                        <div class="form-group grid-span-2">
                            <label class="sub-label">${t('label_ogp_image')}</label>
                            <input type="text" name="ogp_image" value="${h(d.ogp_image || '')}" placeholder="ogp.jpg">
                        </div>
                        <div class="form-group grid-span-2">
                            <label class="sub-label">${t('label_keywords')}</label>
                            <input type="text" name="keywords" value="${h(d.keywords || '')}" placeholder="AI, CMS, mikanBox...">
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="sub-label">${t('label_description')}</label>
                        <textarea name="description" class="textarea-xs textarea-description">${h(d.description || '')}</textarea>
                        <label>${t('label_content')}</label>
                        <label class="checkbox-label" style="font-size:0.85em; margin-bottom:4px; display:flex; align-items:center; gap:6px; font-weight:normal;"><input type="checkbox" name="is_html" value="1" ${d.is_html?'checked':''}> ${t('label_raw_html')}</label>
                        <textarea name="content_md" class="textarea-lg textarea-mono">${h(d.content_md || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>${t('label_css')}</label>
                        <textarea name="css" class="textarea-sm textarea-mono">${h(d.css || '')}</textarea>
                    </div>
                    <details class="form-group js-accordion" ${d.js?'open':''}><summary>${t('label_page_js')} <span class="accordion-arrow">▼</span></summary><small class="sub-text sub-text-block">${t('page_js_hint')}</small><textarea name="js" aria-label="${t('label_page_js')}" class="textarea-sm textarea-mono" rows="10">${h(d.js||'')}</textarea></details>
                    <div class="flex-row flex-between mt-10">
                        <div class="flex-row">
                            <button type="submit" form="page-form" name="save_action" value="save_page" class="btn btn-blue">${getIcon('save')} ${t('btn_save')}</button>
                            <button type="button" class="btn btn-blue" data-editor-preview="/admin?editor_preview=1">${getIcon('view')} ${t('btn_preview')}</button>
                            <a href="/admin#pages" class="btn btn-gray">${getIcon('arrow_back')} ${t('btn_back_to_list')}</a>
                        </div>
                        ${(editId && editId !== 'index') ? `
                            <button type="button" class="btn btn-red" onclick="if(confirm('${t('hint_confirm_delete')}')){var f=document.getElementById('page-form');f.querySelector('input[name=save_action]').value='delete_page';f.requestSubmit();}">${getIcon('delete')} ${t('btn_delete')}</button>
                        ` : ''}
                    </div>
                </form>

            <details class="hint-accordion">
                <summary><h3 class="accordion-title">${t('markdown_head')} <span class="accordion-arrow">▼</span></h3></summary>
                <div class="hint-accordion-body">
                    <div class="hint-grid hint-grid-md4">
                        <div class="hint-list">
                            <code>(${t('md_paragraph')})</code> <span class="hint-desc">&lt;p&gt;</span><br>
                            <br>
                            <span class="hint-desc">${t('md_html_mix_short')}</span><br>
                            <span class="hint-desc">${t('md_html_block_intro')}</span><br>
                            <code>html</code> <code>head</code> <code>body</code> <code>link</code> <code>meta</code> <code>script</code> <code>style</code><br>
                            <code>div</code> <code>section</code> <code>article</code> <code>aside</code> <code>header</code> <code>footer</code><br>
                            <code>p</code> <code>h1〜h6</code> <code>ul</code> <code>ol</code> <code>li</code><br>
                            <code>table</code> <code>blockquote</code> <code>pre</code> <code>form</code> <code>&lt;!--</code> <span class="hint-desc">(コメント)</span><br>
                            <span class="hint-desc">${t('md_html_block_note')}</span>
                        </div>
                        <div class="hint-list">
                            <span class="hint-section-label">${t('md_block_head')}</span><br>
                            <code># ${t('md_heading')}</code> <span class="hint-desc">&lt;h1&gt;</span><br>
                            <code>## ${t('md_heading')}</code> <span class="hint-desc">&lt;h2&gt;</span><br>
                            <code>### ${t('md_subheading')}</code> <span class="hint-desc">&lt;h3&gt;</span><br>
                            <code>#### ${t('md_subheading')}</code> <span class="hint-desc">&lt;h4&gt;</span><br>
                            <code>##### ${t('md_subheading')}</code> <span class="hint-desc">&lt;h5&gt;</span><br>
                            <code>###### ${t('md_subheading')}</code> <span class="hint-desc">&lt;h6&gt;</span><br>
                            <code>- ${t('md_list')}</code> <span class="hint-desc">&lt;ul&gt;&lt;li&gt;</span><br>
                            <code>* ${t('md_list')}</code> <span class="hint-desc">&lt;ul&gt;&lt;li&gt;</span><br>
                            <code>1. ${t('md_num_list')}</code> <span class="hint-desc">&lt;ol&gt;&lt;li&gt;</span><br>
                            <span class="hint-desc">${t('md_list_space_note')}。</span><br>
                            <br>
                            <code>&gt; ${t('md_quote')}</code> <span class="hint-desc">&lt;blockquote&gt;</span><br>
                            <span class="hint-desc">${t('md_quote_space_note')}</span><br>
                            <br>
                            <code>---</code> <span class="hint-desc">${t('md_hr')} &lt;hr&gt;</span><br>
                            <code>\`\`\`</code> <span class="hint-desc">${t('md_code_block')} &lt;pre&gt;&lt;code&gt;</span>
                        </div>
                        <div class="hint-list">
                            <span class="hint-section-label">${t('md_table_head')}</span><br>
                            <code>| ${t('md_col_default')} | ${t('md_col_left')} | ${t('md_col_center')} | ${t('md_col_right')} |</code><br>
                            <code>|---|:---|:---:|---:|</code><br>
                            <code>|  A  |  B  |  C  |  D  |</code><br>
                            <span class="hint-desc">${t('md_table_th_note')}</span><br>
                            <span class="hint-desc">${t('md_table_td_note')}</span><br>
                            <span class="hint-desc">${t('md_table_row2_required')}</span><br>
                            <br>
                            <span class="hint-section-label">${t('md_inline_head')}</span><br>
                            <code>**${t('md_bold')}**</code> <span class="hint-desc">&lt;strong&gt;</span><br>
                            <code>*${t('md_italic')}*</code> <span class="hint-desc">&lt;em&gt;</span><br>
                            <code>\`${t('md_inline_code')}\`</code> <span class="hint-desc">&lt;code&gt;</span><br>
                            <code>[${t('md_link_text')}](URL)</code><br>
                            <code>![${t('md_image_alt')}](${t('filename')})</code>
                        </div>
                        <div class="hint-list">
                            <span class="hint-section-label">${t('md_unique_tags')}</span><br>
                            <code>{.className}</code><span class="hint-desc"> ${t('md_class')}</span><br>
                            <code>{#idName}</code><span class="hint-desc"> ${t('md_id')}</span><br>
                            <code>[text]{.className}</code><span class="hint-desc"> ${t('md_span_class_c')}</span><br>
                            <code>[text]{#idName}</code><span class="hint-desc"> ${t('md_span_class_i')}</span>
                        </div>
                    </div>
                </div>
            </details>

                ${renderTagGuide}
                    </div>
                </div>
            </div>`;
}

// ===== デザイン一覧 (views/design.php) =====
export function renderDesignView(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  components: Array<{ id: string; data: ComponentData }>;
  view: string;
  editId: string | null;
  hasNew: boolean;
  helpFile: string;
}): string {
  const { t, components, view, editId, hasNew, helpFile } = opts;
  const hasEditor = view === 'components' && (editId !== null || hasNew);

  const rows = components.map(({ id: cid, data: cData }) => {
    const typeLabel = cData.is_wrapper ? t('comp_type_page') : cData.is_ai_doc ? t('comp_type_aidoc') : t('comp_type_part');
    const typeClass = cData.is_wrapper ? 'type-badge wrapper' : cData.is_ai_doc ? 'type-badge aidoc' : 'type-badge';
    return `<tr data-component-id="${h(cid)}" data-component-type="${cData.is_wrapper?'wrapper':cData.is_ai_doc?'ai_doc':'part'}">
                <td class="td-narrow">
                    <div class="flex-center">
                         <a href="?view=design&amp;edit=${h(cid)}#design-editor" class="btn btn-sm btn-blue">${getIcon('edit')} ${t('btn_edit')}</a>
                    </div>
                </td>
                <td class="td-narrow">
                    <a href="?view=design&amp;edit=${h(cid)}#design-editor" class="comp-id-link"><code>${h(cid)}</code></a>
                </td>
                <td class="td-narrow"><span class="${typeClass}">${typeLabel}</span></td>
                <td><input type="text" value="{{COMPONENT:${h(cid)}}}" readonly onclick="copyToClipboard(this.value); this.select();" class="copy-input" title="${t('click_to_copy')}"></td>
            </tr>`;
  }).join('');

  return `
    <div id="design" class="section-anchor">
        <div class="section-container section-large-bottom">
            <div class="header">
            <h1>${getIcon('component')} ${t('nav_design')}<a href="${h(helpFile)}#design-mgmt" target="_blank" class="manual-link">${t('admin_help')}</a><span class="component-filter-control"><select class="select-auto component-filter-select" aria-label="${t('component_filter_label')}">${['all','category','wrapper','part','ai_doc','standard'].map(value=>`<option value="${value}">${t('component_filter_'+value)}</option>`).join('')}</select></span></h1>
            <a href="?view=design&amp;new=1#design-editor" class="btn btn-blue">${getIcon('add')} ${t('btn_create_new')}</a>
        </div>
        <div class="table-responsive ${hasEditor ? 'mb-0' : 'ssg-build-row no-editor'}">
        <table>
            <tr><th class="td-narrow">${t('btn_edit')}</th><th class="td-narrow">${t('label_component_id')}</th><th class="td-narrow">${t('label_type')}</th><th>${t('label_tag_name')}</th></tr>
            ${rows}
        </table>
        </div>
        </div>
    </div>

    <div id="design-editor-slot">
    </div>`;
}

// ===== デザインエディター (views/design-editor.php) =====
export function renderDesignEditor(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  editId: string | null;
  editData: ComponentData | null;
  csrf: string;
  helpFile: string;
}): string {
  const { t, editId, editData, csrf, helpFile } = opts;
  const d = editData || {} as ComponentData;
  const renderTagGuide = buildTagGuide(t, helpFile);

  return `
            <div id="design-editor" class="editor-focus-bg section-anchor">
                <div class="editor-floating-card">
                    <div class="header section-header editor-card-header">
                        <h1 class="no-margin">${editId ? t('comp_edit') : t('comp_new')}<a href="${h(helpFile)}#design-edit" target="_blank" class="manual-link">${t('admin_help')}</a></h1>
                    </div>
                    <div class="editor-container editor-container-transparent">
                        <form method="post" id="comp-form">
                    <input type="hidden" name="save_action" value="save_comp">
                    <input type="hidden" name="old_id" value="${h(editId || '')}">
                    ${csrfField(csrf)}
                <div class="form-group">
                    <label>${t('label_component_id')}</label>
                    <input type="text" name="id" value="${h(editId || '')}" required placeholder="header"><small class="sub-text sub-text-block">${t('component_id_hint')}</small>
                    <small class="sub-text sub-text-block">${t('component_id_hint')}</small>
                </div>
                <div class="page-edit-grid"><div class="form-group grid-span-2"><label>${t('label_type')}</label><div class="checkbox-flex">
                ${['part','wrapper','ai_doc'].map(kind=>`<label class="checkbox-label"><input type="radio" name="comp_type" value="${kind}" ${(d.is_wrapper?'wrapper':d.is_ai_doc?'ai_doc':'part')===kind?'checked':''}>${t(kind==='wrapper'?'comp_type_page':kind==='ai_doc'?'comp_type_aidoc':'comp_type_part')}</label>`).join('')}
                </div></div><div class="form-group grid-span-2"><label>${t('label_memo')}</label><textarea name="memo" class="textarea-xs textarea-memo">${h(d.memo||'')}</textarea></div></div>
                <div class="form-group">
                    <label id="html-editor-label">${d.is_ai_doc?'Markdown':'HTML'}</label>
                    <textarea name="html" class="textarea-md textarea-mono" rows="18">${h(d.html || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>CSS (${t('component_css_hint')})</label>
                    <textarea name="css" class="textarea-md textarea-mono" rows="13">${h(d.css || '')}</textarea>
                </div>
                <div class="form-group mt-15">
                    <div class="form-group">
                        <label class="checkbox-label checkbox-flex">
                            <input type="checkbox" name="use_scope" value="1" ${!d.is_global ? 'checked' : ''}> ${t('label_scope_css')}
                        </label>
                        <small class="sub-text sub-text-indent">${t('use_scope_hint')}</small>
                    </div>
                </div>
                <details class="form-group js-accordion" ${d.js?'open':''}><summary>${t('label_component_js')} <span class="accordion-arrow">▼</span></summary><small class="sub-text sub-text-block">${t('component_js_hint')}</small><textarea name="js" class="textarea-md textarea-mono" rows="10">${h(d.js||'')}</textarea>
                    ${editId && /^[A-Za-z0-9_-]+$/.test(editId) ? `
                    <small class="sub-text sub-text-block">${t('component_js_embed_hint')}</small>
                    <code>${h('<script src="' + editId + '.js" defer></script>')}</code>
                    <small class="sub-text sub-text-block">${t('component_js_path_hint')}<br>
                        <a href="/component-js/${encodeURIComponent(editId)}.js" target="_blank" rel="noopener">/component-js/${h(editId)}.js</a>
                    </small>` : ''}
                </details>

                <div class="flex-row flex-between mt-25">
                    <div class="flex-row">
                        <button type="submit" form="comp-form" name="save_action" value="save_comp" class="btn btn-blue">${getIcon('save')} ${t('btn_save')}</button>
                        <a href="/admin#design" class="btn btn-gray">${getIcon('arrow_back')} ${t('btn_back_to_list')}</a>
                    </div>
                    ${editId ? `
                        <button type="button" class="btn btn-red" onclick="if(confirm('${t('hint_confirm_delete')}')){var f=document.getElementById('comp-form');f.querySelector('input[name=save_action]').value='delete_comp';f.requestSubmit();}">${getIcon('delete')} ${t('btn_delete')}</button>
                    ` : ''}
                </div>
            </form>

            ${renderTagGuide}

            </div>
        </div>
    </div>`;
}

// ===== メディア (views/media.php) =====
// Cloud media editing keeps dimensions, conversion and filename in one panel.
export function renderMediaView(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  files: Array<{ key: string; size: number; uploaded: Date; customMetadata?: Record<string, string> }>;
  csrf: string;
  helpFile: string;
  mediaEnabled?: boolean;
  lang?: string;
  usage?: {bytes:number;files:number};
  storageMode?: 'd1'|'r2';
  query?:string;
  category?:string;
  categories?:string[];
  page?:number;
  totalPages?:number;
  totalFiles?:number;
  references?:Record<string,string[]>;
  ignoreCategory?:boolean;
  mediaType?:string;
}): string {
  const { t, files, csrf, helpFile } = opts;
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
  const audioExts = ['mp3', 'm4a'];

  const cards = files.map(file => {
    const fname = file.key;
    const ext = fname.split('.').pop()?.toLowerCase() || '';
    const webPath = `/admin?media_preview=${encodeURIComponent(fname)}`;
    const isImage = imageExts.includes(ext);
    const isAudio = audioExts.includes(ext);
    const isVideo = ext === 'mp4';
    const isCode = ext === 'js' || ext === 'css';
    const embedTag = ext === 'js' ? `<script src="media/${fname}" defer></script>` : `<link rel="stylesheet" href="media/${fname}">`;
    const dims = file.customMetadata?.width && file.customMetadata?.height
      ? `${file.customMetadata.width}x${file.customMetadata.height}`
      : '';

    const thumb = isImage
      ? `<img src="${h(webPath)}" alt="${h(fname)}" loading="lazy">`
      : isVideo
        ? `<div class="media-card-icon">${getIcon('video')}</div>`
        : isAudio
          ? `<div class="media-card-icon">${getIcon('audio')}</div>`
          : isCode ? '<div class="media-card-icon"><span class="material-symbols-outlined">code</span></div>' : '';

    const refs = opts.references?.[fname] || [];
    const canResize = ['jpg','jpeg','png','webp'].includes(ext);
    return `
            <div class="media-card">
                <div class="media-card-thumb">
                    ${thumb}
                </div>
                <div class="media-card-body">
                    <div class="media-card-title hint-click-to-copy" onclick="copyToClipboard('${h(fname)}')" title="${t('hint_click_to_copy')}">
                        ${h(fname)}
                    </div>

                    <div class="media-meta-row">
                        <div class="media-card-meta media-meta-label">
                            ${ext.toUpperCase()} ${dims ? `(${dims})` : ''}
                        </div>
                        <form method="post" onsubmit="return confirm('${t('hint_confirm_delete')}')" class="inline">
                            <input type="hidden" name="save_action" value="delete_media">
                            <input type="hidden" name="file" value="${h(fname)}">
                            ${csrfField(csrf)}
                            <button type="submit" class="media-delete-btn" title="${t('btn_delete')}">
                                ${getIcon('delete')} ${t('btn_delete')}
                            </button>
                        </form>
                    </div>

                    <div class="media-card-action-container media-action-border">
                        ${isCode?`<div class="flex-row flex-row-wrap mb-10"><button type="button" class="btn btn-gray btn-small" onclick="copyToClipboard(new URL('/media/${encodeURIComponent(fname)}',location.href).href)">${t('media_copy_url')}</button><button type="button" class="btn btn-gray btn-small" onclick="copyToClipboard(${h(JSON.stringify(embedTag))})">${t('media_copy_tag')}</button></div>`:''}
                        ${canResize?`<details class="resize-details">
                            <summary class="resize-summary">${t('btn_resize')}<span class="resize-arrow">▼</span></summary>
                            <form method="post" class="resize-form">
                                ${csrfField(csrf)}<input type="hidden" name="save_action" value="resize_media"><input type="hidden" name="file" value="${h(fname)}">
                                <div class="resize-input-group"><input type="text" name="new_width" placeholder="W" class="resize-input" inputmode="numeric" pattern="[0-9]*" aria-label="${opts.lang==='ja'?'幅':'Width'}"><span class="resize-separator">×</span><input type="text" name="new_height" placeholder="H" class="resize-input" inputmode="numeric" pattern="[0-9]*" aria-label="${opts.lang==='ja'?'高さ':'Height'}"></div>
                                <button type="submit" class="btn btn-sm btn-blue media-action-save" title="${t('btn_save')}">${getIcon('save')}</button>
                            </form>
                        </details>`:''}
                        <details class="resize-details" style="margin-top:5px">
                            <summary class="resize-summary">${t('btn_rename')}<span class="resize-arrow">▼</span></summary>
                            <form method="post" class="rename-form">
                                ${csrfField(csrf)}<input type="hidden" name="save_action" value="rename_media"><input type="hidden" name="file" value="${h(fname)}">
                                <input type="text" name="new_name" value="${h(fname)}" required class="resize-input media-rename-input" aria-label="${opts.lang==='ja'?'ファイル名':'Filename'}"><button type="submit" class="btn btn-sm btn-blue media-action-save" title="${t('btn_save')}">${getIcon('save')}</button>
                            </form>
                        </details>
                        ${['jpg','jpeg','png'].includes(ext)?`<form method="post" class="media-convert-form">
                            ${csrfField(csrf)}<input type="hidden" name="save_action" value="convert_media_webp"><input type="hidden" name="file" value="${h(fname)}"><input type="hidden" name="opt_webp" value="1">
                            <button type="submit" class="media-convert-button">${t('btn_convert_webp')}</button>
                        </form>`:''}
                    </div>
                </div>
            </div>`;
  }).join('');

  return `
    <div id="media" class="section-anchor">
        <div class="section-container section-large-bottom">
            <div class="header">
            <h1>${getIcon('media')} ${t('nav_media')}<a href="${h(helpFile)}#media-mgmt" target="_blank" class="manual-link">${t('admin_help')}</a></h1>
        </div>

        ${opts.mediaEnabled?`<div class="editor-container" id="media-upload-area">
            <form method="post" enctype="multipart/form-data" id="upload-form">
                <input type="hidden" name="save_action" value="upload_media">
                ${csrfField(csrf)}
                <div class="form-group mb-0">
                    <div class="flex-row items-center">
                        <input type="file" name="image" id="file-input" accept=".jpg,.jpeg,.png,.gif,.webp,.svg,.js,.css" required>
                        <button type="submit" class="btn btn-blue" id="upload-btn">${getIcon('upload')} ${t('btn_upload')}</button>
                    </div>
                    <div id="upload-publication-status" role="status" class="sub-text"></div>
                    <button type="button" id="upload-publication-retry" class="btn btn-gray btn-small" hidden style="display:none">${opts.lang==='ja'?'画像の公開を再試行':'Retry image publication'}</button>
                    <details class="resize-details upload-options" id="upload-options"><summary class="resize-summary">${t('upload_options')}<span class="resize-arrow">▼</span></summary><div class="upload-options-body"><label class="upload-option"><input type="checkbox" name="opt_resize" value="1" id="opt-resize" checked> ${t('upload_opt_resize')} <input type="text" name="opt_max_dim" id="opt-max-dim" value="2000" class="resize-input" inputmode="numeric" pattern="[0-9]*"> px</label><label class="upload-option"><input type="checkbox" name="opt_webp" id="opt-webp" value="1"> ${t('upload_opt_webp')}</label></div></details>
                    <div class="upload-info">
                        ${t('media_support_types')}: JPEG, PNG, GIF, WebP, SVG, JS, CSS<br>
                        ${t('media_code_hint')}<br>
                        ${opts.usage?`<span id="media-usage">${opts.lang==='ja'?'メディアの使用量':'Media storage'}: ${opts.storageMode==='r2'?`${(opts.usage.bytes/1_000_000_000).toFixed(3)} GB (R2)`:`${(opts.usage.bytes/1_000_000).toFixed(1)} / 400 MB (D1)`} · ${opts.usage.files.toLocaleString()} / 10,000 ${t('media_file_count')}</span><br>`:''}
                        <br>
                        ${t('hint_media_display')}<br>
                        ${t('hint_media_resize')}
                    </div>
                </div>
            </form>
        </div>

        `:`<p role="status">${opts.lang==='ja'?'画像アップロードは後日対応します。現在はページとデザインの確認ができます。':'Image uploads will be available later. Pages and design editing are available now.'}</p>`}

        ${opts.category?`<div class="media-filter-status flex-row" style="margin:15px 0;justify-content:space-between"><span>${t(opts.ignoreCategory?'all_media_shown_hint':'media_filtered_hint',h(opts.category))}</span><a class="btn btn-sm ${opts.ignoreCategory?'btn-blue':'btn-orange'}" href="/admin?cat=${encodeURIComponent(opts.category)}&media_all=${opts.ignoreCategory?'0':'1'}#media">${t(opts.ignoreCategory?'btn_apply_filter':'btn_ignore_filter')}</a></div>`:''}
        <form method="get" action="/admin#media" class="flex-row media-search-form"><input type="hidden" name="view" value="media"><input type="hidden" name="cat" value="${h(opts.category||'')}"><input type="hidden" name="media_all" value="${opts.ignoreCategory?'1':'0'}"><select name="media_type" aria-label="${t('media_type_filter')}">${[['',t('media_type_all')],['image',t('media_type_image')],['audio',t('media_type_audio')],['video',t('media_type_video')],['js','JS'],['css','CSS']].map(([type,label])=>`<option value="${type}" ${opts.mediaType===type?'selected':''}>${label}</option>`).join('')}</select><input type="text" name="q_media" value="${h(opts.query||'')}" placeholder="${t('media_search_placeholder')}" aria-label="${t('media_search_placeholder')}"><button class="btn btn-gray btn-small">${t('btn_search')}</button>${opts.query?`<a class="btn btn-gray btn-small" href="/admin?view=media&cat=${encodeURIComponent(opts.category||'')}&media_all=${opts.ignoreCategory?'1':'0'}&media_type=${encodeURIComponent(opts.mediaType||'')}#media">${t('btn_clear_search')}</a>`:''}</form>
        <div class="media-grid">
            ${files.length === 0 ? "<p class='td-empty'>No media found.</p>" : cards}
        </div>
        <div id="media-pagination" class="flex-row media-pagination">
            <span>${opts.page||1} / ${opts.totalPages||1} · ${opts.totalFiles??files.length} ${t('media_file_count')}</span>
            ${(opts.page||1)>1?`<a class="btn btn-gray btn-small" href="/admin?view=media&q_media=${encodeURIComponent(opts.query||'')}&cat=${encodeURIComponent(opts.category||'')}&media_all=${opts.ignoreCategory?'1':'0'}&media_type=${encodeURIComponent(opts.mediaType||'')}&p_media=${(opts.page||1)-1}#media">${t('btn_previous')}</a>`:''}
            ${(opts.page||1)<(opts.totalPages||1)?`<a class="btn btn-gray btn-small" href="/admin?view=media&q_media=${encodeURIComponent(opts.query||'')}&cat=${encodeURIComponent(opts.category||'')}&media_all=${opts.ignoreCategory?'1':'0'}&media_type=${encodeURIComponent(opts.mediaType||'')}&p_media=${(opts.page||1)+1}#media">${t('btn_next')}</a>`:''}
        </div>
    </div>
    </div>`;
}

// ===== サイト設定 (views/site.php) =====
// SSGビルドセクションは省略（CF版では不要）
export function renderSiteView(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  settings: Settings;
  csrf: string;
  accountsHtml?: string;
  helpFile: string;
  trackingLegacy?: {id:string;html:string|null;exists:boolean};
  users?: User[]; username?:string;
  release?:CloudRelease;
  updateRepository?:string;
  lang?:string;
}): string {
  const { t, settings, csrf, helpFile } = opts;
  const lang = opts.lang || settings.system_lang || '';

  return `
    <div id="site" class="section-anchor">
        <div class="section-container section-tight">
            <div class="header mb-10">
                <h1 class="mb-0">${getIcon('save')} ${t('nav_settings')}<a href="${h(helpFile)}#site" target="_blank" class="manual-link">${t('admin_help')}</a></h1>
            </div>

            <div class="header section-header mt-0">
                <h2 class="section-sub-title">${t('memo_head')}</h2>
            </div>
            <div class="editor-container editor-container-sub">
                <form method="post">
                    ${csrfField(csrf)}
                    <input type="hidden" name="save_action" value="save_memo">
                    <textarea name="memo" class="textarea-memo mb-10">${h(settings.memo || '')}</textarea>
                    <div class="flex-row">
                        <button type="submit" class="btn btn-gray btn-small">${getIcon('save')} ${t('btn_save')}</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

        <div class="section-container section-tight">
            <div class="system-version-row" id="cloud-version-row">
                <span>${t('version_current')}: ${h(CLOUD_VERSION)} (Cloud)</span>
                <span>${t('version_latest')}: ${opts.release?.version?'v'+h(opts.release.version):opts.release?.status==='error'?t('version_check_failed'):(lang==='en'?'Cloud release information not published':'Cloud版のリリース情報は未公開')}</span>
                <a id="cloud-check-updates" href="/admin?view=site&amp;refresh_updates=1#cloud-version-row">${t('btn_check_updates')}</a>
                ${opts.release?.outdated?`<span style="font-weight:600">${lang==='en'?'A new version is available':'新しいバージョンがあります'}</span>`:''}
                ${cloudUpdateUrl(opts.updateRepository)?`<a class="btn btn-small btn-blue" href="${h(cloudUpdateUrl(opts.updateRepository))}" target="_blank" rel="noopener noreferrer">${lang==='en'?'Update on GitHub':'GitHubでアップデート'}</a>`:''}
                ${opts.release?.url?`<a href="${h(opts.release.url)}" target="_blank" rel="noopener noreferrer">${lang==='en'?'Cloud release':'Cloud版リリース'}</a>`:''}
            </div>
            <small class="sub-text sub-text-block">${lang==='en'?'Open GitHub and press Run workflow to update. Updates run only when you choose. After it succeeds, reload this screen to check the installed version.':'GitHubを開き「Run workflow」を押すと更新します。自動では更新しません。成功後、この画面を再読み込みして現在のバージョンを確認してください。'}</small>
            <details class="mt-10 js-accordion tracking-code-details"><summary>${lang==='en'?'Set up manual updates':'手動アップデートの設定'} <span class="accordion-arrow">▼</span></summary>
              <p><a href="${h(helpFile)}#manual-update" target="_blank" rel="noopener noreferrer">${lang==='en'?'First-time GitHub setup instructions':'GitHubでの初回設定手順'}</a></p>
              <form method="post">${csrfField(csrf)}<input type="hidden" name="save_action" value="save_cloud_update_repository">
                <label>${lang==='en'?'Your GitHub repository (owner/repository)':'自分のGitHubリポジトリ（所有者/リポジトリ名）'} <input name="cloud_update_repository" value="${h(opts.updateRepository||'')}" placeholder="owner/repository" maxlength="200"></label>
                <button type="submit" class="btn btn-gray btn-small">${t('btn_save')}</button>
              </form>
            </details>
        </div>

    <div id="language">
        <div class="section-container section-tight">
            <details class="section-accordion">
                <summary class="header section-header accordion-summary">
                    <h2 class="accordion-title">
                        ${t('label_system_lang')} <span class="accordion-arrow">▼</span>
                    </h2>
                </summary>
                <div class="editor-container editor-container-sub">
                    <form method="post">
                        <input type="hidden" name="save_action" value="save_settings">
                        ${csrfField(csrf)}
                        <div class="form-group mb-10" style="max-width: 300px;">
                            <select name="system_lang">
                                <option value="" ${!settings.system_lang || settings.system_lang==='auto' ? 'selected' : ''}>${t('sett_lang_auto')}</option>
                                <option value="ja" ${settings.system_lang === 'ja' ? 'selected' : ''}>日本語</option>
                                <option value="en" ${settings.system_lang === 'en' ? 'selected' : ''}>English</option>
                            </select>
                        </div>
                        <button type="submit" class="btn btn-blue btn-small">${getIcon('save')} ${t('btn_save')}</button>
                    </form>
                </div>
            </details>
        </div>
    </div>

    <div id="mcp-key"><div class="section-container section-tight"><details class="section-accordion"><summary class="header section-header accordion-summary"><h2 class="accordion-title">${t('mcp_key_head')} <span class="accordion-arrow">▼</span></h2></summary><div class="editor-container editor-container-sub">
      <div class="form-group mt-10"><label for="mcp-url-display">${t('mcp_url_label')}</label><div class="copy-row"><input type="text" id="mcp-url-display" value="" readonly><button type="button" class="btn btn-gray btn-small" onclick="copyField('mcp-url-display')">${getIcon('copy')} ${t('btn_copy')}</button></div></div>
      <div id="mcp-key-issued"${settings.api_key?'':' style="display:none;"'}>
        <div class="form-group mt-10"><label for="mcp-key-display">${t('mcp_key_label')}</label><div class="copy-row"><input type="text" id="mcp-key-display" value="${h(settings.api_key||'')}" readonly><button type="button" class="btn btn-gray btn-small" onclick="copyField('mcp-key-display')">${getIcon('copy')} ${t('btn_copy')}</button></div></div>
        <form method="post" class="mt-10" data-mcp-key-form>${csrfField(csrf)}<input type="hidden" name="save_action" value="generate_api_key"><button class="btn btn-gray btn-small">${getIcon('sparkles')} ${t('btn_regenerate_mcp_key')}</button></form>
      </div>
      <form method="post" class="mt-10" id="mcp-key-generate" data-mcp-key-form${settings.api_key?' style="display:none;"':''}>${csrfField(csrf)}<input type="hidden" name="save_action" value="generate_api_key"><button class="btn btn-blue btn-small">${getIcon('sparkles')} ${t('btn_generate_mcp_key')}</button></form>
      </div></details></div></div>

    <div id="backup">
        <div class="section-container section-tight">
            <details class="section-accordion">
                <summary class="header section-header accordion-summary">
                    <h2 class="accordion-title">
                        ${t('backup_head')} <span class="accordion-arrow">▼</span>
                    </h2>
                </summary>
                <div class="editor-container editor-container-sub">
                    <small class="sub-text sub-text-intro">${t('backup_hint_flat')}</small>
                    <div class="flex-row gap-10">
                        <form method="post">${csrfField(csrf)}<input type="hidden" name="save_action" value="download_backup_data"><button type="submit" class="btn btn-gray btn-small">${getIcon('download')} ${t('backup_data_json')}</button></form>
                        <form method="post">${csrfField(csrf)}<input type="hidden" name="save_action" value="download_backup_media"><button type="submit" class="btn btn-gray btn-small">${getIcon('download')} ${t('backup_media')}</button></form>
                        <a class="btn btn-orange btn-small" href="/admin?view=import">${getIcon('upload')} ${t('btn_data_tool')}</a>
                    </div>
                    


                </div>
            </details>
        </div>
    </div>
    <div id="settings">
        <div class="section-container section-tight">
            <details class="section-accordion">
                <summary class="header section-header accordion-summary">
                    <h2 class="accordion-title">
                        ${t('nav_settings_title')} <span class="accordion-arrow">▼</span>
                    </h2>
                </summary>
                <div class="editor-container editor-container-sub">
                    <form method="post" class="site-settings-form">
                        <input type="hidden" name="save_action" value="save_settings">
                        ${csrfField(csrf)}
                        <div class="grid-2col">
                            <div class="site-identity-row grid-span-2">
                                <div class="form-group"><label>${t('label_site_name')}</label><input type="text" name="site_name" value="${h(settings.site_name||'')}"></div>
                                <div class="form-group"><label>${t('label_site_id')}</label><input type="text" readonly value="${h(settings.site_id||'')}"><small class="sub-text">${t('hint_site_id')}</small></div>
                            </div>
                            <div class="form-group"><label>${t('label_site_url')}</label><input type="url" name="site_url" value="${h(settings.site_url||'')}" placeholder="https://example.com"><small class="sub-text">${t('hint_site_url')}</small></div>
                            <div class="form-group"><label>${t('label_site_environment')}</label><select name="site_environment">${['production','staging','development','local','unspecified'].map(e=>`<option value="${e}" ${(settings.site_environment||'unspecified')===e?'selected':''}>${t('site_environment_'+e)}</option>`).join('')}</select><small class="sub-text">${t('hint_site_environment')}</small></div>
                            <div class="form-group grid-span-2">
                                <label>${t('label_site_desc')}</label>
                                <textarea name="description" rows="3" class="textarea-min-80">${h(settings.description || '')}</textarea>
                            </div>
                            <div class="form-group">
                                <label>${t('label_site_keywords')}</label>
                                <input type="text" name="keywords" value="${h(settings.keywords || '')}">
                            </div>
                            <div class="form-group">
                                <label>${t('label_site_ogp')}</label>
                                <input type="text" name="ogp_image" value="${h(settings.ogp_image || '')}">
                                <small class="sub-text">${t('recommended_size')}</small>
                            </div>
                            <div class="form-group"><label>${t('label_pages_per_page')}</label><input type="number" name="pages_per_page" min="1" max="500" value="${h(settings.pages_per_page||30)}"></div>
                            <div class="form-group"><label>${t('label_media_per_page')}</label><input type="number" name="media_per_page" min="1" max="500" value="${h(settings.media_per_page||100)}"></div>
                        </div>
                        <div class="form-group mt-15">
                            <h3>${t('label_common_loading')}</h3>
                            ${(()=>{
                              let headCode=String(settings.tracking_head_code||''),bodyCode=String(settings.tracking_body_code||''),legacyNotice='';
                              const legacy=opts.trackingLegacy;
                              if(!headCode&&!bodyCode&&!settings.tracking_id&&settings.tracking_component&&legacy){
                                if(legacy.html!==null)headCode=legacy.html;else if(legacy.exists)legacyNotice=legacy.id;
                              }
                              const inUse=!!headCode.trim()||!!bodyCode.trim();
                              const messages=JSON.stringify({idle:t('tracking_id_hint'),busy:t('tracking_id_overridden')}).replace(/</g,'\\u003c').replace(/&/g,'\\u0026');
                              return `<label>${t('label_tracking_id')}</label>
                            <input type="text" name="tracking_id" id="tracking-id" value="${h(settings.tracking_id||'')}" placeholder="G-XXXXXXXXXX / GTM-XXXXXXX" pattern="([Gg][Tt][Mm]|[Gg])-[A-Za-z0-9]{4,}" ${inUse?'readonly':''}>
                            <small class="sub-text sub-text-block" id="tracking-id-hint">${t(inUse?'tracking_id_overridden':'tracking_id_hint')}</small>
                            ${legacyNotice?`<small class="sub-text sub-text-block">${t('tracking_legacy_notice',h(legacyNotice))}</small>`:''}
                            <details class="mt-10 js-accordion tracking-code-details" ${inUse?'open':''}>
                                <summary>${t('label_tracking_code')} <span class="accordion-arrow">▼</span></summary>
                                <label class="sub-label">${t('label_tracking_head_code')}</label>
                                <textarea name="tracking_head_code" class="tracking-code" rows="5" spellcheck="false">${h(headCode)}</textarea>
                                <label class="sub-label">${t('label_tracking_body_code')}</label>
                                <textarea name="tracking_body_code" class="tracking-code" rows="3" spellcheck="false">${h(bodyCode)}</textarea>
                                <small class="sub-text sub-text-block">${t('tracking_code_hint')}</small>
                            </details>
                            <script>
                            (function () {
                                var id = document.getElementById('tracking-id'), hint = document.getElementById('tracking-id-hint');
                                var codes = document.querySelectorAll('textarea.tracking-code');
                                var messages = ${messages};
                                function sync() {
                                    var used = Array.prototype.some.call(codes, function (c) { return c.value.trim() !== ''; });
                                    id.readOnly = used;
                                    hint.textContent = used ? messages.busy : messages.idle;
                                }
                                codes.forEach(function (c) { c.addEventListener('input', sync); });
                            })();
                            </script>`;
                            })()}
                        </div>
                        <button type="submit" class="btn btn-blue mt-10">${getIcon('save')} ${t('btn_save')}</button>
                    </form>
                </div>
            </details>
        </div>
    </div>

    ${opts.accountsHtml||''}
    <div id="cloud-connection"><div class="section-container section-tight"><details class="section-accordion"><summary class="header section-header accordion-summary"><h2 class="accordion-title">${lang==='en'?'Cloudflare publication settings':'Cloudflare公開設定'} <span class="accordion-arrow">▼</span></h2></summary><div class="editor-container editor-container-sub">
                    <p>${lang==='en'?'Configure the Cloudflare account and Worker used for publication. The token is stored securely and is never shown again.':'公開に使うCloudflareアカウントとWorkerを設定します。トークンは安全に保存され、再表示されません。'}</p>
                    <div class="token-guide-box"><h3>${lang==='en'?'How to get a Cloudflare API token':'Cloudflare APIトークンの取得方法'}</h3>
                    ${lang==='en'?`<ol class="token-guide"><li>Sign in to Cloudflare with the account that hosts this site, and open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">My Profile → API Tokens</a>.</li><li>Press <b>Create Token</b>, then <b>Get started</b> next to <b>Create Custom Token</b>.</li><li>Give it a name, such as “mikanBox publishing”.</li><li>Under <b>Permissions</b>, choose <b>Account</b> → <b>Workers Scripts</b> → <b>Edit</b>. To use the D1 backup and Time Travel features as well, add a second row: <b>Account</b> → <b>D1</b> → <b>Edit</b>.</li><li>Under <b>Account Resources</b>, choose <b>Include</b> → the account that hosts this site.</li><li>Press <b>Continue to summary</b>, then <b>Create Token</b>. Copy the long string that is shown. <b>It is shown only once.</b></li><li>Paste it into “Cloudflare API token” below and press Save. The account ID and Worker name are already filled in; leave them as they are.</li></ol><p class="sub-text">You create the token once. The site stores it encrypted and never shows it again. You only need a new one if it is deleted or revoked in Cloudflare, its permissions change, or the site’s secret key (JWT_SECRET) changes.</p>`:`<ol class="token-guide"><li>このサイトを置いているCloudflareのアカウントでログインし、<a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">プロフィール → APIトークン</a>を開きます。</li><li>「トークンを作成する」を押し、「カスタムトークンを作成する」の「開始する」を押します。</li><li>トークン名を付けます。例：「mikanBox公開用」。</li><li>「権限」で、<b>アカウント</b> → <b>Workers スクリプト</b> → <b>編集</b> を選びます（英語表示では Account → Workers Scripts → Edit）。D1のバックアップとTime Travelも使う場合は、もう1行、<b>アカウント</b> → <b>D1</b> → <b>編集</b> を追加します。</li><li>「アカウントリソース」で、<b>含める</b> → このサイトを置いているアカウントを選びます。</li><li>「概要に進む」→「トークンを作成する」を押し、表示された長い文字列をコピーします。<b>表示されるのは1回だけです。</b></li><li>下の「Cloudflare APIトークン」欄に貼り付けて「保存」を押します。アカウントIDとWorker名は最初から入っているので、そのままにしてください。</li></ol><p class="sub-text">トークンは最初に1回作るだけです。サイトが暗号化して保存し、再表示しません。作り直すのは、Cloudflareで削除・失効させたとき、権限を変えたとき、サイトの秘密鍵（JWT_SECRET）を変えたときだけです。</p>`}
                    </div>
                    <form method="post" class="grid-2col"><input type="hidden" name="save_action" value="save_cloud_connection">${csrfField(csrf)}<div class="form-group"><label>${lang==='en'?'Cloudflare account ID':'CloudflareアカウントID'}</label><input type="text" name="cloud_account_id" value="${h(settings.cloud_account_id||'')}" required></div><div class="form-group"><label>${lang==='en'?'Worker name':'Worker名'}</label><input type="text" name="cloud_worker_name" value="${h(settings.cloud_worker_name||'')}" required></div><div class="form-group"><label>${lang==='en'?'Cloudflare API token':'Cloudflare APIトークン'}</label><input type="password" name="cloud_api_token" autocomplete="new-password" ${settings.cloud_connection_ready?'placeholder="•••••••• (set)"':'required'}></div><div class="form-actions"><button class="btn btn-gray btn-small">${t('btn_save')}</button> <span role="status">${settings.cloud_connection_ready?(lang==='en'?'Connection configured':'接続設定済み'):(lang==='en'?'Not configured':'未設定')}</span></div></form>
    </div></details></div></div>
    ${renderStorageView(settings,csrf,lang)}


`;
}

function renderStorageView(settings:Settings,csrf:string,lang:string):string {
 const en=lang==='en',r2=settings.media_storage==='r2';
 const migration=settings.media_migration as {id:string;total:number;copied:number}|null;
 const d1Bytes=settings.d1_bytes as number|null, r2Bytes=Number(settings.r2_bytes||0);
 const warning=(d1Bytes!==null&&d1Bytes>=400_000_000)||r2Bytes>=8_000_000_000;
 return `<div id="image-storage" class="section-large-bottom"><div class="section-container section-tight"><details class="section-accordion" ${migration||settings.storage_migrated?'open':''}>
 <summary class="header section-header accordion-summary"><h2 class="accordion-title">${en?'Media storage':'メディアの保存先'} <span class="accordion-arrow">▼</span></h2></summary>
 <div class="editor-container editor-container-sub">
 ${settings.storage_migrated&&r2?`<p role="status">${en?'Media migrated to R2.':'メディアをR2へ移行しました。'}</p>`:''}
 <p>${en?'Current media storage':'現在のメディアの保存先'}: <strong>${r2?'R2':'D1'}</strong></p>
 <p>${en?'D1 database usage':'D1データベースの使用量'}: ${d1Bytes===null?(en?'Check in Cloudflare':'Cloudflareで確認'):`${(d1Bytes/1_000_000).toFixed(1)} MB`}<br>
 ${en?'Free plan: 500 MB per database. Paid plan: up to 10 GB per database. The plan must be upgraded separately.':'無料プランは1データベース500 MBまで。有料プランは10 GBまでです。プランの変更は別途必要です。'}</p>
 ${r2||migration||r2Bytes>0?`<p>${en?'Tracked R2 media storage (including temporary and retained files)':'R2メディアの使用量（管理対象の一時ファイル・保持ファイルを含む）'}: ${(r2Bytes/1_000_000_000).toFixed(3)} GB<br>${en?'The monthly free allowance is 10 GB-month across the account. This is not a storage limit; excess storage and requests are billed.':'月間の無料枠はアカウント全体で10 GB-monthです。容量の上限ではなく、超過した容量やリクエストは課金対象です。'}</p>`:''}
 ${warning?`<p role="status" class="sub-text">${en?'Usage is approaching the free allowance. Check account usage and billing.':'無料枠に近づいています。アカウント全体の使用量と料金を確認してください。'}</p>`:''}
 <p><a href="https://dash.cloudflare.com/" target="_blank" rel="noopener">${en?'Check usage and set billing alerts in Cloudflare':'Cloudflareで使用量の確認・料金通知の設定'}</a><br><small>${en?'This screen shows this site’s recorded storage. Account totals and request usage are available in Cloudflare. Billing alerts do not stop usage.':'この画面はこのサイトが管理する容量を表示します。アカウント全体の容量・リクエスト数はCloudflareで確認してください。料金通知は利用を停止する機能ではありません。'}</small></p>
 ${!r2?`<p>${en?'Start with D1 without enabling R2. To migrate, enable R2 in Cloudflare (a payment method is required), create a bucket and configure the MEDIA binding. Media files are copied and verified before switching; media URLs remain unchanged. Media changes are paused during migration.':'R2を有効にせずD1で利用を始められます。移行するにはCloudflareでR2を有効にし（支払い方法の登録が必要）、バケットを作成してMEDIA接続を設定してください。メディアファイルをコピー・確認してから切り替え、メディアURLは変わりません。移行中はメディアの変更を停止します。'}</p>
 <p><a href="https://developers.cloudflare.com/r2/get-started/" target="_blank" rel="noopener">${en?'R2 setup instructions':'R2の設定手順'}</a></p>
 <form data-media-migration data-job-id="${h(migration?.id||'')}" data-lang="${h(lang)}" method="post">${csrfField(csrf)}
 ${migration?`<p data-storage-progress role="status">${migration.copied} / ${migration.total}</p><button type="submit" class="btn btn-blue btn-small">${en?'Resume migration':'移行を再開'}</button> <button type="button" data-storage-cancel class="btn btn-gray btn-small">${en?'Cancel migration':'移行を中止'}</button>`:`<button type="submit" class="btn btn-blue btn-small" ${settings.r2_configured?'':'disabled'}>${en?'Migrate from D1 to R2':'D1からR2へ移行'}</button> <button type="button" data-storage-cancel class="btn btn-gray btn-small" hidden style="display:none">${en?'Cancel migration':'移行を中止'}</button><p data-storage-progress role="status">${settings.r2_configured?'':(en?'R2 is not connected. Configure the MEDIA binding first.':'R2未接続です。先にMEDIA接続を設定してください。')}</p>`}
 </form>`:''}
 ${r2||(settings.r2_configured&&r2Bytes>0)?`<form method="post" data-storage-cleanup>${csrfField(csrf)}<input type="hidden" name="save_action" value="cleanup_media"><button class="btn btn-gray btn-small">${en?'Clean unused temporary files':'不要な一時ファイルを整理'}</button> <span role="status"></span><p class="sub-text">${en?'Unused files retained for at least 24 hours are removed, up to 20 per run.':'24時間以上保持した未使用のファイルを、1回につき最大20件削除します。'}</p></form>`:''}
 </div></details></div></div>`;
}

// ===== タグガイド (admin.php::$renderTagGuide) =====
function buildTagGuide(
  t: (key: string, ...args: (string | number)[]) => string,
  helpFile: string
): string {
  return `
    <details class="hint-accordion">
        <summary><h3 class="accordion-title">${t('available_tags_content_css')} <span class="accordion-arrow">▼</span></h3></summary>
        <div class="hint-accordion-body">
            <div class="hint-grid hint-grid-tag">
                <div>
                    <strong>${t('standard_info')}</strong>
                    <ul class="hint-list hint-list-sm">
                        <li><code>{{TITLE}}</code> : ${t('page_title')}</li>
                        <li><code>{{FULL_TITLE}}</code> : ${t('page_title')} - ${t('site_name')}</li>
                        <li><code>{{UPDATE_DATE}}</code> : ${t('hint_update_date_ymd')}</li>
                        <li><code>{{UPDATE_DATE:JP}}</code> : ${t('hint_update_date_jp')}</li>
                        <li><code>{{UPDATE_DATE:SLASH}}</code> : ${t('hint_update_date_slash')}</li>
                        <li><code>{{IS_NEW:30}}</code> : ${t('hint_is_new')}</li>
                        <li><code>{{DESCRIPTION}}</code> : ${t('page_description')}</li>
                        <li><code>{{KEYWORDS}}</code> : ${t('label_keywords')}</li>
                        <li><code>{{OGP_IMAGE}}</code> : ${t('page_thumbnail_ogp_image')}</li>
                        <li><code>{{PAGE_URL}}</code> : ${t('page_full_url')}</li>
                        <li><code>{{SITE_URL}}</code> : ${t('site_root_url')}</li>
                        <li><code>{{SITE_NAME}}</code> : ${t('site_title')}</li>
                        <li><code>{{SITE_DESCRIPTION}}</code> : ${t('site_description')}</li>
                        <li><code>{{SITE_OGP_IMAGE}}</code> : ${t('site_common_ogp_image')}</li>
                    </ul>
                    <strong style="display:block;margin-top:12px">${t('special_wrapper_design')}</strong>
                    <ul class="hint-list hint-list-sm">
                        <li><code>{{CONTENT}}</code> : ${t('page_main_content')}</li>
                        <li><code>{{HEAD_CSS}}</code> : ${t('combined_css_components')}</li>
                        <li><code>{{COMPONENT:_global_head}}</code> : ${t('common_head_section')}</li>
                        <li><code>{{COMPONENT:_header}}</code> : ${t('page_header')}</li>
                        <li><code>{{COMPONENT:_footer}}</code> : ${t('page_footer')}</li>
                    </ul>
                </div>
                <div>
                    <strong>${t('navigation_components')}</strong>
                    <ul class="hint-list hint-list-sm">
                        <li><code>{{COMPONENT:ID}}</code> : ${t('embed_registered_component')}</li>
                        <li><code>{{IMAGE:${t('filename')}}}</code> : ${t('display_static_image')}</li>
                        <li><code>{{AUDIO:${t('filename')}}}</code> : ${t('insert_audio_module')}</li>
                        <li><code>{{VIDEO:${t('filename')}}}</code> : ${t('display_video')}</li>
                        <li><code>{{POST_MD:pageID}}</code> : ${t('hint_post_md')}</li>
                        <li><code>{{EXT_MD:url}}</code> : ${t('hint_ext_md')}${t('cloud_unavailable_note')}</li>
                        <li><code>{{NAV_LINKS:category}}</code> : ${t('link_list')}<span class="hint-desc"> — li.active</span></li>
                        <li><code>{{NAV_CARDS:category:componentID}}</code> : ${t('card_list')}</li>
                        <li class="hint-note">${t('nav_links_cards_hint')}</li>
                        <li style="margin-top:8px"><span class="hint-section-label">${t('nav_cards_template_vars')}</span></li>
                        <li><code>{{PAGE_URL}}</code> <code>{{TITLE}}</code> <code>{{DESCRIPTION}}</code> <code>{{OGP_IMAGE}}</code> <code>{{UPDATE_DATE}}</code> <code>{{IS_NEW:N}}</code> <code>{{POST_MD::key}}</code> <code>{{POST_MD::#rowID:key}}</code></li>
                        <li><code>{{IS_ACTIVE}}</code> : ${t('hint_is_active')}</li>
                    </ul>
                </div>
                <div>
                    <strong>${t('label_database')}</strong>
                    <ul class="hint-list hint-list-sm">
                        <li>
                            <span class="hint-section-label">${t('hint_datarow_def')}</span><br>
                            <code>{{DATA:key}}${t('hint_data_value')}{{/DATA}}</code> : ${t('data_block_visible')}<br>
                            <code>{{DATA:key:GHOST}}${t('hint_data_value')}{{/DATA}}</code> : ${t('data_block_hidden')}<br>
                            <span class="hint-desc">${t('hint_data_ascii_rule')}</span>
                        </li>
                        <li style="margin-top:8px">
                            <span class="hint-section-label">${t('hint_datarow_table_def')}</span><br>
                            <code>{{DATAROW:rowID}}</code><br>
                            <code>{{DATA:key}}${t('hint_data_value')}{{/DATA}}</code><br>
                            <code>{{/DATAROW}}</code>
                        </li>
                        <li style="margin-top:8px"><span class="hint-section-label">${t('hint_datarow_usage')}</span></li>
                        <li><code>{{POST_MD::key}}</code> : ${t('data_from_self')}</li>
                        <li><code>{{POST_MD:pageID:key}}</code> : ${t('data_from_page')}</li>
                        <li><code>{{EXT_MD:url:key}}</code> : ${t('hint_ext_md_key')}${t('cloud_unavailable_note')}</li>
                        <li style="margin-top:6px"><code>{{POST_MD::#rowID:key}}</code> : ${t('hint_datarow_self_table')}</li>
                        <li><code>{{POST_MD:pageID#rowID:key}}</code> : ${t('hint_datarow_page_table')}</li>
                        <li><code>{{EXT_MD:url#rowID:key}}</code> : ${t('hint_datarow_ext_table')}${t('cloud_unavailable_note')}</li>
                        <li style="margin-top:6px" class="hint-note">${t('hint_db_api_hidden')}</li>
                        <li class="hint-note">${t('hint_db_api_public')}</li>
                    </ul>
                </div>
            </div>
        </div>
    </details>`;
}

export function renderImportView(opts: {t:(key:string,...args:(string|number)[])=>string;csrf:string;lang:string;stats?:{pages:number;components:number;users:number;media:number;mediaBytes:number};cloudReady?:boolean}):string {
  const {t,csrf,lang}=opts;
  const d1BackupHtml=`<div class="data-tool-grid data-backup-grid"><section id="cloud-d1-backup" class="data-tool-card"><h2>${getIcon('database')} ${lang==='en'?'Export D1 database as SQL':'D1データベースのSQL書き出し'}</h2>
    <p>${lang==='en'?'Save the current D1 database as an SQL file. Importing it requires a compatible database tool; this screen cannot restore the file. R2 image files are not included.':'現在のD1データベースをSQLファイルとして保存します。利用には対応するデータベースのツールが必要で、この画面からSQLファイルを復元することはできません。R2の画像ファイルは含まれません。'}</p>
    <p>${lang==='en'?'The unencrypted file contains sensitive information. Store it securely. The database may be temporarily unavailable during export.':'暗号化されないファイルには認証情報などが含まれます。安全に保管してください。書き出し中はD1が一時的に利用できなくなる場合があります。'}</p>
    ${opts.cloudReady?`<form method="post" data-cloudbackup="d1-export">${csrfField(csrf)}<input type="hidden" name="save_action" value="begin_d1_export"><button class="btn btn-gray btn-small">${getIcon('download')} ${lang==='en'?'Export D1 as SQL':'D1のSQLを書き出す'}</button><span data-transfer-status role="status"></span></form>`:`<p>${lang==='en'?'Configure Cloudflare publication settings with D1 edit permission.':'D1編集権限を持つトークンをCloudflare公開設定に登録してください。'}</p>`}</section>
    <section id="cloud-d1-restore" class="data-tool-card"><h2>${getIcon('history')} ${lang==='en'?'Restore D1 to a past time':'D1の指定時刻への復元'}</h2><p>${lang==='en'?'Cloudflare Time Travel returns the database to a time within its retention period. This does not use the downloaded SQL file. R2 images and published files are not restored; rebuild the public site afterward.':'CloudflareのTime Travelで、保持期間内の指定時刻にデータベースを戻します。保存したSQLファイルは使いません。R2の画像と公開済みファイルは復元されないため、復元後に公開サイトをビルドしてください。'}</p>
    ${opts.cloudReady?`<form method="post" data-cloudbackup="d1-restore">${csrfField(csrf)}<input type="hidden" name="save_action" value="restore_d1_time"><label class="form-group backup-field">${lang==='en'?'Restore to time':'復元する時刻'} <input type="datetime-local" name="restore_at" required></label><button class="btn btn-orange btn-small">${lang==='en'?'Restore D1 to this time':'D1を指定時刻に戻す'}</button><p class="data-action-hint">${lang==='en'?'This replaces the current database with its past state.':'現在のデータベースを指定時刻の状態に置き換えます。'}</p><span data-transfer-status role="status"></span></form>`:`<p>${lang==='en'?'Configure Cloudflare publication settings with D1 edit permission.':'D1編集権限を持つトークンをCloudflare公開設定に登録してください。'}</p>`}</section></div>`;
  const cloudBackupHtml=`<div class="data-tool-grid data-backup-grid"><section id="cloud-json-backup" class="data-tool-card"><h2>${getIcon('download')} ${lang==='en'?'JSON backup':'JSONバックアップ'}</h2>
    <p>${lang==='en'?'Save pages, components, images, accounts and revision history together. The unencrypted file contains private content, API keys and password hashes. Restrict access and store it securely, preferably encrypted.':'ページ・コンポーネント・画像・アカウント・編集履歴をまとめて保存します。ファイルは暗号化されず、非公開内容・APIキー・パスワードのハッシュを含みます。アクセスを制限し、できれば暗号化して保管してください。'}</p>
    <form method="post" data-cloudbackup="export">${csrfField(csrf)}<input type="hidden" name="save_action" value="download_backup_json"><button type="submit" class="btn btn-gray btn-small">${getIcon('download')} ${lang==='en'?'Download JSON backup':'JSONバックアップを保存'}</button><span data-transfer-status role="status"></span></form></section>
    <section id="cloud-json-restore" class="data-tool-card"><h2>${getIcon('upload')} ${lang==='en'?'Restore a JSON backup':'バックアップJSONファイルの復元'}</h2>
    <p>${lang==='en'?'Restoring replaces current site data. Accounts are restored only if selected. Current site identity, API key and Cloud connection are kept.':'復元すると、現在のサイトの内容がバックアップの内容に置き換わります。ユーザーは選択した場合のみ復元され、現在のサイトID・APIキー・Cloud接続は維持されます。'}</p>
    <p>${lang==='en'?'For D1, existing and temporary restore images must fit within 450 MB. R2 also needs space for both sets.':'D1では現在の画像と復元用の一時画像の合計が450 MB以内である必要があります。R2でも両方の保存領域が必要です。'}</p>
    <form method="post" enctype="multipart/form-data" data-cloudbackup="restore" onsubmit="return confirm('${lang==='en'?'Replace all current site data with this backup?':'現在のサイトデータをすべてバックアップ内容で置き換えます。続けますか？'}')">${csrfField(csrf)}<input type="hidden" name="save_action" value="restore_backup_json"><label class="form-group backup-field">${lang==='en'?'Backup JSON file':'バックアップJSONファイル'} <input type="file" name="backup_file" accept="application/json,.json" required></label><label class="form-group backup-field"><input type="checkbox" name="restore_users" value="1"> ${lang==='en'?'Also restore user accounts (signs everyone out)':'ユーザーも復元（全員ログアウト）'}</label><button type="submit" class="btn btn-orange btn-small">${lang==='en'?'Restore and replace':'復元して置き換え'}</button><span data-transfer-status role="status"></span></form></section></div>`;
  return renderDataImportView({t,csrf,lang,stats:opts.stats||{pages:0,components:0,users:0,media:0,mediaBytes:0},cloudBackupHtml:d1BackupHtml+cloudBackupHtml+`<section id="static-zip" class="data-tool-card"><h2>${getIcon('archive')} ${lang==='en'?'Static HTML (ZIP)':'静的HTML（ZIP）'}</h2><form method="post">${csrfField(csrf)}<input type="hidden" name="save_action" value="download_static_zip"><div class="data-tool-form-row"><label>${lang==='en'?'HTML file structure':'HTMLファイルの構造'} <select name="structure"><option value="flat">ID.html</option><option value="directory">ID/index.html</option></select></label><button class="btn btn-gray btn-small">${getIcon('download')} ${lang==='en'?'Download static ZIP':'静的ZIPを保存'}</button></div><p class="data-action-hint">${lang==='en'?'Exports already-built static pages and referenced local images, up to 20 MB. Dynamic pages and external images remain live links; images loaded dynamically by JavaScript are not collected.':'ビルド済みの静的ページと参照するサイト内画像を、合計20 MBまで保存します。動的ページと外部画像は元のURLのままです。JavaScriptが動的に読み込む画像は収集しません。'}</p></form></section>`});
}
