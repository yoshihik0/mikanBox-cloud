import { renderTransferSections, type TransferStats } from './data-section';
// ==========================================
// mikanBox Admin Views
// SQLite版を参照したCloud専用テンプレート。未移植部分はdocs/cloud_ja.mdを参照。
// ==========================================

import type { Settings, PageData, ComponentData } from '../types';
import type { User } from '../accounts';
import type { Revision } from '../revisions';
import {CLOUD_VERSION} from '../version';
import {mcpKeyList,MCP_KEY_NAME_MAX} from '../mcp';
import {auditGroup,auditTargetText,auditUnusual,AUDIT_EVENTS} from '../audit';
import {MEDIA_COUNT_LIMIT,D1_WARNING_BYTES} from '../media-policy';
import {localTime,isoInstant,utcFallback,localTimeScript} from './local-time';
import {trackingConfigured} from '../tracking';
import type {PublicationStatus,PublicState} from '../publish-status';
import {cloudUpdateUrl,type CloudRelease} from '../cloud-release';
import {pageOutputFormat,formatHasHtml,isDataFormat,isApiFormat,formatBadge,adminPreviewUrl,isStructuralCategory,sortCategories,pageExpandsTags,expandTagsDefault,DATA_FORMATS} from '../output-formats';

// PHP版と同じMaterial Iconsマッピング
function getIcon(name: string): string {
  const icons: Record<string, string> = {
    page: 'description', component: 'widgets', media: 'image', save: 'save',
    view: 'visibility', upload: 'upload', video: 'videocam', audio: 'music_note',
    cloud: 'cloud_upload', logout: 'logout', globe: 'language', sparkles: 'auto_awesome',
    edit: 'edit', delete: 'delete', download: 'download', arrow_back: 'arrow_back',
    add: 'add', copy: 'content_copy', open_in_new: 'open_in_new', history: 'history', warning: 'warning', search: 'search', close: 'close', database: 'database', archive: 'archive', settings_backup_restore: 'settings_backup_restore', check: 'check', visual: 'edit_square',
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
// The former "DB" status is now the output format "mikanBox DB" (2.18.0).
const statuses = ['draft','pending','public_static'];
// The token guide opens and closes like "Add a device" (accounts-view.ts).
const guideBoxStyle='margin-top: 0; margin-bottom: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa;';
const guideSummaryStyle='padding: 10px 15px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-bottom: none; background: transparent;';
const guideBodyStyle='padding: 15px; border-top: 1px solid #e2e8f0; background: #fff; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;';
/** A category list with structural "_" categories after the others, shown faded. */
const categoryList = (cats: string[]) => sortCategories(cats).map(c => isStructuralCategory(c) ? `<span class="category-structural">${h(c)}</span>` : h(c)).join(', ');
function statusClass(status: string) { return ({public_dynamic:'static',public:'static',public_static:'static'} as Record<string,string>)[status] || status; }
function statusLabel(t: (key:string)=>string, status: string) {
  // The shared label reads "公開(静的)" / "Public (static)"; drop the mode in parentheses.
  return status === 'public_static' ? t('page_status_public_static').replace(/\s*[(（].*$/, '') : t('page_status_'+status);
}
function statusOptions(t: (key:string)=>string, selected: string) {
  const current = ['public','public_dynamic'].includes(selected) ? 'public_static' : selected;
  return statuses.map(status=>`<option value="${status}" ${current===status?'selected':''}>${statusLabel(t,status)}</option>`).join('');
}
/** Admin window title: "🍊site name" (+ " - suffix"); a site name that already starts with 🍊 keeps one (PHP mikanBoxAdminTitle). */
export function adminTitle(settings: Partial<Settings> | null | undefined, suffix = ''): string {
  const name = String(settings?.site_name ?? '').trim().replace(/^\u{1F34A}\s*/u, '').trim() || 'mikanBox';
  return h('🍊' + name + (suffix !== '' ? ' - ' + suffix : ''));
}
export function renderLoginPage(opts: {lang:string; siteName?: string; initial:boolean; noDevices?:boolean; error:string; t:(key:string,...args:(string|number)[])=>string; csrf:string; inviteStep?:{code:string;device_name:string;username?:string;display_name?:string}}):string {
  const {lang,initial,noDevices,error,t,csrf,inviteStep}=opts, ja=lang==='ja';
  const hidden=(action:string)=>`<input type="hidden" name="login_action" value="${action}"><input type="hidden" name="csrf_token" value="${h(csrf)}">`;
  const deviceField=`<div class="form-group"><label>${ja?'この端末の名前（例: 仕事用PC）':'Name for this device (e.g. Work laptop)'}</label><input type="text" name="device_name" maxlength="60" required></div>`;
  const setupFields=`<div class="form-group"><label>${ja?'初期設定トークン（SETUP_TOKEN）':'Setup token (SETUP_TOKEN)'}</label><input type="password" name="setup_token" autocomplete="off" required></div><div class="form-group"><label>${t('label_username')}</label><input type="text" name="username" autocomplete="off" required></div>`;
  return `<!DOCTYPE html><html lang="${h(lang)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${adminTitle({ site_name: opts.siteName }, t('admin_login'))}</title><link rel="stylesheet" href="/mikanbox/admin.css?v=${h(CLOUD_VERSION)}-8"></head>
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
/**
 * The page list's globe: the page at its address on the public site. Drafts and pending pages show
 * it grey and unclickable, like the visual-editing button (PHP 2.18.2, msg_not_public_yet). A public
 * page that is not on the site yet is also unclickable; one whose changes are not published is grey.
 */
function globeLink(state: PublicState | undefined, status: string, t: (key: string) => string): string {
  const disabled = (title: string) => `<span class="btn btn-sm btn-gray btn-disabled" aria-disabled="true" title="${h(title)}">${getIcon('globe')}</span>`;
  if (status !== 'public_static') return disabled(t('msg_not_public_yet'));
  if (!state || state.state === 'none') return disabled(t('cloud_globe_not_published'));
  const live = state.state === 'live';
  return `<a href="${h(state.url)}" target="_blank" rel="noopener" class="btn btn-sm ${live ? 'btn-blue' : 'btn-gray'}" title="${h(t(live ? 'btn_open_public_page' : 'cloud_globe_stale'))}">${getIcon('globe')}</a>`;
}
// The build is how pages reach the public site, so it sits with the page list and
// reports there rather than in the toast at the top of the screen.
function publishBox(csrf: string, t: (key: string, ...args: (string | number)[]) => string, publication: PublicationStatus | undefined, ja: boolean, cloudReady: boolean, publicUrl: string, publicWorkerMissing = false): string {
  // Shown in the viewer's time zone (the Worker formats in UTC).
  const when = publication?.publishedAt ? localTime(publication.publishedAt, ja ? 'ja' : 'en') : '';
  const summary = !publication ? '' : publication.stale
    ? t('build_status_stale', publication.stale)
    : t('build_status_up_to_date');
  // Publishing needs the Cloudflare API token from Site → Cloudflare publication settings; say so here, where the button is.
  const setup = cloudReady ? '' : `<p class="publish-setup" role="note">${t('cloud_publish_needs_token')} <a href="/admin?view=site#cloud-connection" data-open-cloud-connection>${t('cloud_publish_setup_link')}</a></p>`;
  // Without a public Worker of its own nothing is published (the server refuses); say so beside the button, always.
  const worker = publicWorkerMissing ? `<p class="publish-setup" role="note" data-public-worker-missing>${t('cloud_publish_needs_public_worker')} <a href="/public-help.html?language=${ja ? 'ja' : 'en'}#public-worker" target="_blank" rel="noopener">${t('cloud_publish_public_worker_link')}</a></p>` : '';
  const destination = publicUrl ? `<span class="publish-status">${t('build_status_destination')}: <a href="${h(publicUrl)}" target="_blank" rel="noopener noreferrer">${h(publicUrl)}</a></span>` : '';
  return `<form method="post" class="publish-box mt-10" id="publish-box">${csrfField(csrf)}<input type="hidden" name="save_action" value="build_ssg"><button class="btn btn-blue btn-small">${getIcon('cloud')} <span data-publish-label>${t('btn_ssg_build')}</span></button><span class="publish-status" data-publish-status role="status">${h(summary)}${when ? ` ${t('build_status_last')}: ${when}` : ''}</span>${destination}${worker}${setup}</form>`;
}

/**
 * The page list's state (category and output-format filters, search, list page) as a query string, so that opening
 * the page editor, saving, and going back to the list keep the list as it was (as in PHP, where
 * the editor opens over the list without reloading it). Starts with "&" when not empty.
 */
export function pageListQuery(state: { category?: string; format?: string; sort?: string; query?: string; pageNumber?: number }): string {
  const params = new URLSearchParams();
  if (state.category) params.set('cat', state.category);
  if (state.format) params.set('fmt', state.format);
  if (state.sort) params.set('sort', state.sort);
  if (state.query) params.set('q', state.query);
  if (state.pageNumber && state.pageNumber > 1) params.set('p_pages', String(state.pageNumber));
  const qs = params.toString();
  return qs ? '&' + qs : '';
}

/** Values of the page list's output-format filter ("data" is every data format), as in PHP pages.php. */
export const PAGE_FORMAT_FILTERS = ['', 'html', 'html_md', 'md', 'data', 'db'] as const;
/** Orders of the page list (value, language key): the URL parameter is sort= (PHP 2.20.0). */
export const PAGE_SORT_CHOICES: Array<[string, string]> = [['', 'page_sort_display'], ['updated_desc', 'page_sort_updated_desc'], ['updated_asc', 'page_sort_updated_asc'], ['id', 'page_sort_id'], ['title', 'page_sort_title']];

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
  /** pageListQuery() of the current list. */
  listQuery?: string;
}): string {
  const { lang, t, view, editId, hasNew, message, csrf, settings, helpFile,
          pagesHtml, pageEditorHtml, siteHtml, designHtml, designEditorHtml, mediaHtml, aiPromptJson } = opts;
  const showPageEditor = view === 'pages' && (editId !== null || hasNew);
  const showDesignEditor = view === 'components' && (editId !== null || hasNew);
  const ssgRootUrl = String(settings._public_url || '') || '/';

  return `<!DOCTYPE html>
<html lang="${h(lang)}">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${adminTitle(settings)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block" rel="stylesheet">
    <link rel="stylesheet" href="/mikanbox/admin.css?v=${h(CLOUD_VERSION)}-8">
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
        <span class="close-badge" title="${t('btn_close')}" data-url="/admin${opts.listQuery ? h('?' + opts.listQuery.slice(1)) : ''}#pages">×</span>
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
        <span class="close-badge" title="${t('btn_close')}" data-url="/admin?view=design#design">×</span>
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


    ${view==='import'?'':`    <div class="category-cloud-wrap"><div class="category-cloud"><span class="category-cloud-label">${t('category_cloud_label')}</span>
    <a href="?cat=" class="category-cloud-tag ${!opts.category?'active':''}">${t('all_pages')}</a>
    ${sortCategories(opts.allCategories||[]).map(cat=>`<span class="category-cloud-tag-wrap"><a href="?cat=${encodeURIComponent(cat)}" class="category-cloud-tag ${opts.category===cat?'active':''}${isStructuralCategory(cat)?' is-structural':''}"${isStructuralCategory(cat)?` title="${h(t('category_structural_hint'))}"`:''}>${h(cat)}</a><span class="category-delete-badge" data-category="${h(cat)}" title="${h(t('category_delete_confirm_title'))}">&times;</span></span>`).join('')}
    <span class="category-control-group" style="display:inline-flex;align-items:center;gap:8px;white-space:nowrap"><span class="category-cloud-divider" style="margin:0">|</span><a href="#" class="category-cloud-tag btn-add-cat" style="border-style:dashed;background:transparent;display:inline-flex;align-items:center;gap:5px">${getIcon('add')} ${t('btn_add')}</a><a href="#" class="category-cloud-tag btn-toggle-del-cat" style="border-style:dashed;background:transparent;display:inline-flex;align-items:center;gap:5px" data-label-delete="${h(getIcon('delete')+' '+t('btn_delete'))}" data-label-done="${h(getIcon('check')+' '+t('btn_done'))}" data-confirm-title="${h(t('category_delete_confirm_title'))}" data-confirm-ok="${h(t('btn_delete_confirm'))}">${getIcon('delete')} ${t('btn_delete')}</a><input type="text" id="new-category-input" placeholder="${t('placeholder_new_category')}" maxlength="100" style="display:none;width:120px;padding:4px 10px;border-radius:8px;border:1px solid #ff8c00;font-size:.85rem;height:30px;box-sizing:border-box"></span></div></div>
    ${pagesHtml}

`}
    ${siteHtml}

    ${view==='import'?'':designHtml}

    ${view==='import'?'':mediaHtml}

    <script>window.__MIKAN_UI = ${JSON.stringify({confirmTitle:t('btn_delete'),confirmOk:t('btn_delete_confirm'),cancel:t('btn_cancel'),saveFailed:t('err_save_failed'),done:t('msg_update_success'),networkError:t('err_network_error')}).replace(/</g,'\\u003c')};window.__CLOUD_EDITOR = ${JSON.stringify({editLabel:t('btn_edit'),closeLabel:t('btn_close'),editIcon:getIcon('edit'),loadFailed:t('err_editor_load_failed'),saving:t('msg_saving'),unsavedTitle:t('modal_unsaved_title'),unsavedText:t('visual_js_confirm_leave'),ok:t('btn_ok'),confirmDelete:t('hint_confirm_delete'),deleteTitle:t('btn_delete'),deleteOk:t('btn_delete_confirm'),saveFailed:t('err_save_failed'),done:t('msg_update_success'),networkError:t('err_network_error')}).replace(/</g,'\\u003c')};</script>
    <script src="/mikanbox/admin-ui.js?v=${h(CLOUD_VERSION)}"></script>
    <script src="/mikanbox/ai-question.js?v=${h(CLOUD_VERSION)}" data-mcp-endpoint="/public-mcp" data-public-mcp="/public-mcp" data-help-ja="/public-help.html?language=ja" data-help-en="/public-help.html?language=en" defer></script>
    <script>
    // The save marker is a one-time notification, not part of navigation state.
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get('saved') === '1') {
        currentUrl.searchParams.delete('saved');
        history.replaceState(history.state, '', currentUrl.href);
    }
    window.CSRF_TOKEN = ${JSON.stringify(csrf)};
    // Media files live on the public site; the admin screen reads and exports them from there.
    window.PUBLIC_SITE_URL = ${JSON.stringify(String(settings._public_url||'')).replace(/</g,'\\u003c')};
    ${message ? `document.addEventListener('DOMContentLoaded', () => window.MikanUI.toast(${JSON.stringify(message).replace(/</g,'\\u003c')}));` : ''}
    // Times are sent as instants and shown in the viewer's own time zone (the Worker formats in UTC).
    ${localTimeScript(lang)}
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

    // The page search filters as you type, like the media search (the list is fetched for the current URL; q is kept in it).
    // Clearing it with the browser's own × (a "search" event) shows the whole list again at once.
    const pageSearch=document.getElementById('admin-page-search');
    if(pageSearch){
        let pageSearchTimer;
        const applyPageSearch=()=>{clearTimeout(pageSearchTimer);applyListParam('q', pageSearch.value.trim(), 'p_pages', 'pages', refreshPageList);};
        pageSearch.addEventListener('input',()=>{clearTimeout(pageSearchTimer);pageSearchTimer=setTimeout(applyPageSearch,250);});
        pageSearch.addEventListener('search',applyPageSearch);
        pageSearch.form.addEventListener('submit',(event)=>{event.preventDefault();applyPageSearch();});
    }

    // List filters kept in the URL (as in PHP): the page list's output format (fmt), the media type and search.
    function applyListParam(name, value, pager, view, refresh) {
        const url = new URL(window.location.href);
        if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
        url.searchParams.delete(pager);
        url.searchParams.set('view', view);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
        document.querySelectorAll('form[role="search"] input[type="hidden"][name="' + name + '"]').forEach(input => { input.value = value; });
        refresh();
    }
    const pageFormatFilter = document.getElementById('page-format-filter');
    if (pageFormatFilter) pageFormatFilter.addEventListener('change', () => applyListParam('fmt', pageFormatFilter.value, 'p_pages', 'pages', refreshPageList));
    const pageSortOrder = document.getElementById('page-sort-order');
    if (pageSortOrder) pageSortOrder.addEventListener('change', () => applyListParam('sort', pageSortOrder.value, 'p_pages', 'pages', refreshPageList));
    const mediaTypeFilter = document.getElementById('media-type-filter');
    if (mediaTypeFilter) mediaTypeFilter.addEventListener('change', () => applyListParam('media_type', mediaTypeFilter.value, 'p_media', 'media', refreshMediaGrid));
    const mediaSearch = document.getElementById('admin-media-search');
    if (mediaSearch) {
        let timer;
        mediaSearch.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => applyListParam('q_media', mediaSearch.value.trim(), 'p_media', 'media', refreshMediaGrid), 250); });
        mediaSearch.form.addEventListener('submit', (event) => { event.preventDefault(); applyListParam('q_media', mediaSearch.value.trim(), 'p_media', 'media', refreshMediaGrid); });
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

    // Files can be dropped only on the Media section (they are uploaded there). Elsewhere the
    // page shows "no drop" instead of silently uploading, and file inputs (such as the import
    // forms) keep the browser's own behaviour of taking the dropped file (as in PHP 2.18.2).
    const isFileInput = (target) => target instanceof Element && target.matches('input[type="file"]');
    const inMediaSection = (target) => target instanceof Element && !!target.closest('#media, #drop-zone');
    window.addEventListener('dragover', (e) => {
        if (isFileInput(e.target)) return;
        e.preventDefault();
        const allowed = inMediaSection(e.target) && !!uploadForm;
        if (e.dataTransfer) e.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
        if (dropZone) dropZone.classList.toggle('active', allowed);
    });
    window.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null && dropZone) dropZone.classList.remove('active');
    });
    window.addEventListener('drop', async (e) => {
        if (isFileInput(e.target)) return;
        e.preventDefault();
        if (dropZone) dropZone.classList.remove('active');
        if (!inMediaSection(e.target)) return;
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
    // Media files live only on the public site: the file is published first, and recorded once it is there.
    async function doMediaUpload(formData) {
        const btn = document.getElementById('upload-btn');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) { btn.textContent = ${JSON.stringify(opts.t('msg_uploading'))}; btn.disabled = true; }
        try {
            if(window.cloudPrepareMediaForm)formData=await window.cloudPrepareMediaForm(formData);
            const file = formData.get('image');
            if (!(file instanceof File)) throw new Error(${JSON.stringify(opts.t('err_upload_failed'))});
            if (uploadPublicationStatus) uploadPublicationStatus.textContent = ${JSON.stringify(opts.lang==='ja'?'公開サイトへ送っています…':'Sending to the public site…')};
            const media = await window.cloudPublishNewMedia(file, { cat: formData.get('cat') || '' });
            const commit = new FormData();
            commit.set('save_action', 'upload_media'); commit.set('csrf_token', window.CSRF_TOKEN); commit.set('ajax_request', '1');
            commit.set('media_name', media.name); commit.set('image', file);
            const res = await fetch(window.location.href, { method: 'POST', body: commit });
            const json = await res.json().catch(() => ({}));
            if (uploadPublicationStatus) uploadPublicationStatus.textContent = '';
            showToast(json.message || '', !json.success);
            if (json.success) {
                if (fileInput) fileInput.value = '';
                await refreshMediaGrid();
            }
        } catch(err) {
            if (uploadPublicationStatus) uploadPublicationStatus.textContent = '';
            showToast(err.message || ${JSON.stringify(opts.t('err_upload_failed'))}, true);
        } finally {
            if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
        }
    }

    // Keep the viewport stable while a refreshed list replaces its old DOM.
    let listRefreshCount = 0, savedOverflowAnchor = '';
    // While an editor is being opened or closed (window.mikanNav.pending), its own scroll decides the position.
    window.mikanNav = window.mikanNav || { pending: 0 };
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
        const keepPosition = window.mikanNav.pending === 0;
        const replacedAt = performance.now();
        if (keepPosition) window.scrollTo({top: y, behavior: 'instant'});
        requestAnimationFrame(() => {
            newList.style.minHeight = '';
            // Only right after the replacement: a frame delayed in a background tab must not pull the page back later.
            if (keepPosition && window.mikanNav.pending === 0 && performance.now() - replacedAt < 200) window.scrollTo({top: y, behavior: 'instant'});
            requestAnimationFrame(() => {
                if (--listRefreshCount === 0) root.style.overflowAnchor = savedOverflowAnchor;
            });
        });
    }
    window.replaceListPreservingScroll = replaceListPreservingScroll;

    async function refreshMediaGrid() {
        try {
            const mediaUrl = new URL(location.href); mediaUrl.searchParams.set('ajax_media','1');
            const res = await fetch(mediaUrl);
            const html = await res.text();
            const temp = document.createElement('div');
            temp.innerHTML = html;
            const newWrap = temp.querySelector('#media-list-wrap');
            const oldWrap = document.querySelector('#media-list-wrap');
            replaceListPreservingScroll(oldWrap, newWrap);
        } catch(err) {}
    }
    window.refreshMediaGrid = refreshMediaGrid;

    // The page list (table and pages) for the current URL, as in PHP refreshPageList().
    async function refreshPageList() {
        try {
            const url = new URL(location.href); url.searchParams.set('ajax_pages', '1'); url.searchParams.set('view', 'pages');
            const temp = document.createElement('div');
            temp.innerHTML = await (await fetch(url)).text();
            replaceListPreservingScroll(document.querySelector('#pages-table-wrap'), temp.querySelector('#pages-table-wrap'));
            const newPag = temp.querySelector('#pages .pagination'), oldPag = document.querySelector('#pages .pagination');
            if (newPag && oldPag) oldPag.outerHTML = newPag.outerHTML;
            else if (oldPag) oldPag.remove();
            else if (newPag) { const wrap = document.querySelector('#pages-table-wrap'); if (wrap) wrap.after(newPag); }
        } catch (err) {}
    }
    window.refreshPageList = refreshPageList;

    document.addEventListener('submit', async function(e) {
        const form = e.target;
        const actionInput = form.querySelector('input[name="save_action"]');
        if (!actionInput || e.defaultPrevented) return;
        const action = actionInput.value;
        if (action === 'delete_media' || action === 'rename_media' || action === 'resize_media' || action === 'convert_media_webp') {
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
            showToast(${JSON.stringify(opts.t('msg_copied'))});
        } catch (err) {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showToast(${JSON.stringify(opts.t('msg_copied'))});
            } catch (err) {
                showToast(${JSON.stringify(opts.t('msg_copy_failed'))}, true);
            }
            document.body.removeChild(textArea);
        }
    }
    async function csvConvertAndCopy() {
        const fileInput = document.getElementById('csv-file-input');
        const btn = document.getElementById('csv-copy-btn');
        if (!fileInput.files[0]) { showToast(${JSON.stringify(opts.t('csv_no_file'))}, true); return; }
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
                    selectEl.classList.remove('static', 'dynamic', 'draft', 'pending', 'db');
                    if (newStatus === 'public_static') selectEl.classList.add('static');
                    else if (newStatus === 'pending') selectEl.classList.add('pending');
                    else selectEl.classList.add('draft');
                }
            } else {
                showToast(${JSON.stringify(opts.t('err_save_failed'))}, true);
            }
        } catch(err) {
            showToast(${JSON.stringify(opts.t('err_network_error'))}, true);
        }
    }
    let isNavigating = false;
    function updateScrollPos() {
        if (isNavigating || window.mikanNavigating) return;
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
            if (href && href.startsWith('#')) { e.preventDefault(); navigateTo(href); }
        });
    });
    window.updateScrollPos = updateScrollPos;
    window.addEventListener('scroll', updateScrollPos, { passive: true });
    document.addEventListener('DOMContentLoaded', () => {
        updateScrollPos();
        setTimeout(() => {
            const s = document.getElementById('init-notransition');
            if (s) s.remove();
        }, 100);

    });
    </script>
    <!-- The dialogs below have the same markup and styles as the PHP admin (admin.php) -->
    <dialog id="rename-confirm-dialog" class="custom-dialog">
        <h3 style="margin-top:0; margin-bottom:12px; font-size:1.05rem; display:flex; align-items:center; gap:8px; color:var(--text);">
            <span class="material-symbols-outlined" style="color: #f59e0b;">warning</span> ${t('media_rename_confirm_title')}
        </h3>
        <p id="rename-dialog-message" style="font-size:0.9rem; line-height:1.5; margin-bottom:20px; color:#475569;"></p>
        <div class="dialog-buttons" style="display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
            <button type="button" id="btn-rename-cancel" data-rename-choice="cancel" class="btn btn-small" style="background:#f1f5f9; color:#1e293b; border: 1px solid #cbd5e1;">${t('btn_rename_cancel')}</button>
            <button type="button" id="btn-rename-only" data-rename-choice="only" class="btn btn-small" style="background:#f1f5f9; color:#1e293b; border: 1px solid #cbd5e1;">${t('btn_rename_only')}</button>
            <button type="button" id="btn-rename-update" data-rename-choice="update" class="btn btn-small btn-blue">${t('btn_rename_update')}</button>
        </div>
    </dialog>

    <style>
    .unsaved-modal-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.2s ease forwards;
    }
    .unsaved-modal-content {
        background: #fff; padding: 30px; border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2); max-width: 500px; text-align: center;
        font-family: system-ui, sans-serif;
    }
    .unsaved-modal-actions {
        display: flex; gap: 10px; justify-content: center; margin-top: 20px;
    }
    .unsaved-modal-actions .btn {
        white-space: nowrap;
    }
    .unsaved-modal-content h3 { margin-top: 0; font-size: 1.2rem; color: #333; }
    .unsaved-modal-content p { color: #666; font-size: 0.95rem; margin-bottom: 20px; line-height: 1.5; }
    @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
    </style>
    <div id="unsaved-modal" class="unsaved-modal-overlay" style="display: none;">
        <div class="unsaved-modal-content">
            <h3>${t('modal_unsaved_title')}</h3>
            <p>${t('modal_unsaved_text')}</p>
            <div class="unsaved-modal-actions">
                <button id="btn-modal-save" class="btn btn-blue">${getIcon('save')} ${t('btn_save_and_close')}</button>
                <button id="btn-modal-discard" class="btn btn-red">${getIcon('delete')} ${t('btn_discard_and_close')}</button>
                <button id="btn-modal-cancel" class="btn btn-gray">${t('btn_cancel')}</button>
            </div>
        </div>
    </div>

    <script src="/mikanbox/preview-editor.js?v=${h(CLOUD_VERSION)}-2" defer></script>
    <script src="/mikanbox/cloud-editor.js?v=${h(CLOUD_VERSION)}" defer></script>
    <script src="/mikanbox/cloud-admin.js?v=${h(CLOUD_VERSION)}-5" defer></script>
    <script src="/mikanbox/cloud-media.js?v=${h(CLOUD_VERSION)}" defer></script>
    <script src="/mikanbox/cloud-zip.js?v=${h(CLOUD_VERSION)}" defer></script><script src="/mikanbox/cloud-export.js?v=${h(CLOUD_VERSION)}" defer></script><script src="/mikanbox/cloud-integrity.js?v=${h(CLOUD_VERSION)}" defer></script><script src="/mikanbox/data-transfer.js?v=${h(CLOUD_VERSION)}" defer></script><script src="/mikanbox/cloud-transfer.js?v=${h(CLOUD_VERSION)}" defer></script><script src="/mikanbox/cloud-publish.js?v=${h(CLOUD_VERSION)}-8" defer></script>
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
  query?: string; category?:string; format?: string; sort?: string; pageNumber?:number; totalPages?:number;
  lang?: string; publication?: PublicationStatus; cloudReady?: boolean; publicUrl?: string; publicWorkerMissing?: boolean;
  /** The page editor (when ?edit= or ?new= opens it); it lives in the page-editor slot. */
  editorHtml?: string;
}): string {
  const { t, pages, view, editId, hasNew, csrf, helpFile } = opts;
  const listQuery = h(pageListQuery({ category: opts.category, format: opts.format, sort: opts.sort, query: opts.query, pageNumber: opts.pageNumber }));
  const ja = opts.lang !== 'en', publication = opts.publication;
  const hasEditor = view === 'pages' && (editId !== null || hasNew);

  const rows = pages.map(({ id: pid, data: d }) => {
    const status=['public','public_dynamic'].includes(d.status) ? 'public_static' : d.status || 'draft';
    const cls=statusClass(status);
    const format = pageOutputFormat(d);

    return `<tr data-page-id="${h(pid)}">
                <td class="td-narrow">
                    <div class="flex-center" style="gap: 5px;">
                         <a href="?view=pages&amp;edit=${h(encodeURIComponent(pid))}${listQuery}#page-editor" class="btn btn-sm btn-blue" title="${t('btn_edit')}">${getIcon('edit')}</a>
                         ${formatHasHtml(format)
                           ? `<a href="/admin/visual?id=${h(encodeURIComponent(pid))}" class="btn btn-sm btn-blue" title="${t('btn_visual_edit')}">${getIcon('visual')}</a>`
                           : `<span class="btn btn-sm btn-gray btn-disabled" aria-disabled="true" title="${h(t('visual_err_not_html'))}">${getIcon('visual')}</span>`}
                         ${globeLink(publication?.pages[pid], status, t)}
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
                         <a href="?view=pages&amp;edit=${h(encodeURIComponent(pid))}${listQuery}#page-editor" class="title-link">${h(d.title || 'No Title')}</a>
                         ${format !== 'html' ? `<span class="format-badge ${isDataFormat(format) || isApiFormat(format) ? 'format-data' : 'format-md'}" title="${h(t('label_output_format') + ': ' + t('output_format_' + format))}">${formatBadge(format)}</span>` : ''}
                    </div>
                </td>
                <td class="td-narrow text-sub">${h((d.updated_at || '').slice(0, 10))}</td>
                <td class="td-narrow text-sub text-center">${h(d.sort_order ?? 0)}</td>
                <td style="font-size: 0.85rem; color: var(--text-sub);">${(d.category || '').split(',').map(s => s.trim()).filter(Boolean).map(c => isStructuralCategory(c) ? `<span class="category-structural">${h(c)}</span>` : h(c)).join(', ')}</td>
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
              <a href="?view=pages&amp;new=1${listQuery}#page-editor" class="btn btn-sm btn-blue" style="margin-left:15px;display:inline-flex;align-items:center;gap:5px;font-size:.85rem;padding:4px 10px;vertical-align:middle">${getIcon('add')} ${t('btn_create_new')}</a>
              <a href="${h(helpFile)}#page-mgmt" target="_blank" class="manual-link">${t('admin_help')}</a><span class="component-filter-control"><select class="select-auto list-filter-select" id="page-format-filter" aria-label="${t('label_output_format')}">${PAGE_FORMAT_FILTERS.map(value=>`<option value="${value}" ${(opts.format||'')===value?'selected':''}>${h(t(value===''?'page_format_filter_all':value==='data'?'output_format_data_group':'output_format_'+value))}</option>`).join('')}</select></span><span class="component-filter-control"><select class="select-auto list-filter-select" id="page-sort-order" aria-label="${t('page_sort_label')}" title="${h(t('page_sort_hint'))}">${PAGE_SORT_CHOICES.map(([value,key])=>`<option value="${value}" ${(opts.sort||'')===value?'selected':''}>${h(t(key))}</option>`).join('')}</select></span>
            </h1>
            <!-- Admin page search: the browser's own clear button only (as in PHP) -->
            <form method="get" action="/admin#pages" class="search-bar-wrap" role="search">
              <input type="hidden" name="view" value="pages"><input type="hidden" name="cat" value="${h(opts.category||'')}"><input type="hidden" name="fmt" value="${h(opts.format||'')}"><input type="hidden" name="sort" value="${h(opts.sort||'')}">
              <div class="admin-search">
                <input type="search" name="q" id="admin-page-search" class="admin-search-input" value="${h(opts.query||'')}" placeholder="${t('search_placeholder')}" aria-label="${t('search_placeholder')}">
                <span id="admin-page-search-icon" class="admin-search-icon">${getIcon('search')}</span>
              </div>
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
        ${(opts.totalPages||1)>1?`<div class="pagination">${Array.from({length:opts.totalPages||1},(_,i)=>`<a class="pagination-link ${opts.pageNumber===i+1?'active':''}" href="?view=pages&amp;p_pages=${i+1}${h(pageListQuery({category:opts.category,format:opts.format,sort:opts.sort,query:opts.query}))}#pages">${i+1}</a>`).join('')}</div>`:''}
        ${publishBox(csrf, t, publication, ja, opts.cloudReady !== false, opts.publicUrl || '', opts.publicWorkerMissing === true)}
        </div>
    </div>

    <div id="page-editor-slot">${opts.editorHtml || ''}</div>`;
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
  /** Public site URL without a trailing slash, for the output URL shown under the format. */
  publicBase?: string;
  /** pageListQuery() of the list the editor was opened from; a new page takes its category. */
  listQuery?: string;
  listCategory?: string;
}): string {
  const { t, editId, editData, csrf, helpFile, wrapperComponents, allCategories } = opts;
  const d = editData || {} as PageData;
  const currentFormat = pageOutputFormat(d);
  const isErrorPage = editId === '404';
  const visualAvailable = formatHasHtml(currentFormat);
  const expandTags = isDataFormat(currentFormat) ? pageExpandsTags(d) : expandTagsDefault(currentFormat);
  const publicBase = (opts.publicBase || '').replace(/\/$/, '');
  // The body heading names what the body is for the chosen output format.
  const contentLabels: Record<string, string> = { html: t('label_content'), html_md: t('label_content'), md: t('label_content_md') };
  for (const f of [...DATA_FORMATS, 'db']) contentLabels[f] = t('label_content_data', t('output_format_' + f));
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
                    <div class="editor-header-actions">
                    ${editId?`<div id="editor-revisions-container"><div class="revisions-select-group" style="display:flex;align-items:center;gap:8px;white-space:nowrap"><span>${getIcon('history')} ${t('label_revisions')}</span><select style="width:auto;min-width:180px" aria-label="${t('label_revisions')}" onchange="spaChangeRevision(this)"><option value="?view=pages&edit=${encodeURIComponent(editId)}${h(opts.listQuery || '')}#page-editor">${t('select_revision')}</option>${(opts.revisions||[]).map(r=>{const iso=isoInstant(r.created_at),lang=opts.settings.system_lang==='en'?'en':'ja';return `<option value="?view=pages&edit=${encodeURIComponent(editId)}&rev=${r.id}${h(opts.listQuery || '')}#page-editor" ${opts.selectedRevision?.id===r.id?'selected':''}${iso?` data-local-time="${iso}" data-local-suffix="${h(` (${r.editor_id})`)}"`:''}>${h(iso?utcFallback(iso,lang):r.created_at)} (${h(r.editor_id)})</option>`;}).join('')}</select></div></div>`:''}
                    ${editId?`<a href="/admin/visual?id=${h(encodeURIComponent(editId))}" id="editor-visual-btn" class="btn btn-sm editor-visual-btn ${visualAvailable?'btn-blue':'btn-gray btn-disabled'}" ${visualAvailable?'':'aria-disabled="true" tabindex="-1"'} data-saved-html="${visualAvailable?'1':'0'}" data-title-on="${h(t('btn_visual_edit'))}" data-title-off="${h(t('visual_err_not_html'))}" title="${h(visualAvailable?t('btn_visual_edit'):t('visual_err_not_html'))}">${getIcon('visual')} ${t('btn_visual_edit')}</a>`:''}
                    </div>
                    </div>
                    <div class="editor-container editor-container-transparent">
                        ${opts.selectedRevision?`<div id="revision-warning-banner" class="alert alert-warning" role="status" style="background:#fffbeb;border:1px solid #fef3c7;color:#b45309;padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:.9rem;line-height:1.5"><strong>${opts.settings.system_lang==='en'?'Viewing revision':'過去の版を表示中'}:</strong> ${localTime(opts.selectedRevision.created_at, opts.settings.system_lang==='en'?'en':'ja')} (${h(opts.selectedRevision.editor_id)})<br>${opts.settings.system_lang==='en'?'Saving will restore this revision as the current version.':'保存すると、この版が現在のページとして復元されます。'}</div>`:''}
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
                    <div class="page-edit-grid" id="page-format-grid" data-format="${h(currentFormat)}">
                        <div class="form-group grid-span-1">
                            <label class="sub-label">${t('label_slug')}</label>
                            <input type="text" name="id" value="${h(editId || '')}" placeholder="profile" class="input-height">
                            <small class="sub-text sub-text-block">${t('page_id_hint')}</small>
                        </div>
                        <div class="form-group grid-span-1">
                            <label class="sub-label" for="output-format-select">${t('label_output_format')}</label>
                            <select name="output_format" id="output-format-select" class="output-format-select" data-dynamic-base="${h(publicBase)}" data-static-base="${h(publicBase)}" data-structure="directory">
                                ${(['html','html_md','md'] as const).map(f=>`<option value="${f}" ${currentFormat===f?'selected':''} ${f!=='html'&&isErrorPage?'disabled':''}>${t('output_format_'+f)}</option>`).join('')}
                                <optgroup label="${h(t('output_format_data_group'))}">
                                    ${DATA_FORMATS.map(f=>`<option value="${f}" data-expand="${expandTagsDefault(f)?'1':'0'}" ${currentFormat===f?'selected':''} ${isErrorPage?'disabled':''}>${t('output_format_'+f)} (.${f})</option>`).join('')}
                                    <option value="db" ${currentFormat==='db'?'selected':''} ${isErrorPage?'disabled':''}>${t('output_format_db')} (/api/*.json)</option>
                                </optgroup>
                            </select>
                            <small class="sub-text sub-text-block output-url-line">${t('output_url_label')}: <code id="output-format-url"></code></small>
                            <small class="sub-text sub-text-block" data-formats="json xml csv txt js css">${t('output_format_data_hint')}</small>
                            <small class="sub-text sub-text-block" data-formats="db">${t('output_format_db_hint')}</small>
                        </div>
                        <div class="form-group grid-span-1">
                            <label class="sub-label">${t('label_category')} ${t('hint_comma_separated')}</label>
                            <input type="text" name="category" value="${h(d.category ?? (editData ? '' : opts.listCategory || ''))}" placeholder="news, blog, ...">
                            <small class="sub-text sub-text-block">
                                ${t('hint_existing_categories')}:
                                ${allCategories.length > 0 ? categoryList(allCategories) : t('label_none')}
                            </small>
                        </div>
                        <div class="form-group grid-span-1" data-formats="html html_md">
                            <label class="sub-label">${t('label_design_component')}</label>
                            <select name="wrapper_comp">
                                <option value="__none" ${d.wrapper_comp==='__none'?'selected':''}>${t('wrapper_none')}</option>
                                ${wrapperOptions}
                            </select>
                            ${trackingConfigured(opts.settings) ? `<input type="hidden" name="tracking_option_present" value="1"><label class="checkbox-label tracking-exclusion"><input type="checkbox" name="exclude_tracking" value="1" ${d.exclude_tracking?'checked':''}> ${t('exclude_tracking_label')}</label>` : ''}
                        </div>
                        <div class="form-group grid-span-2" data-formats="html_md md">
                            <label class="sub-label">${t('label_md_footer_comps')}</label>
                            <input type="text" name="md_footer_comps" value="${h((d.md_footer_comps || []).join(', '))}" placeholder="_md_footer">
                            <small class="sub-text sub-text-block">${t('md_footer_comps_hint')}</small>
                        </div>
                        <div class="form-group grid-span-1" data-formats="json xml csv txt js css">
                            <input type="hidden" name="expand_tags_present" value="1">
                            <label class="checkbox-label expand-tags-label"><input type="checkbox" name="expand_tags" id="expand-tags-checkbox" value="1" ${expandTags?'checked':''}> ${t('label_expand_tags')}</label>
                            <small class="sub-text sub-text-block">${t('expand_tags_hint')}</small>
                        </div>
                         <div class="form-group grid-span-1">
                             <label class="sub-label">${t('label_sort_order')}</label>
                             <input type="number" name="sort_order" value="${h(d.sort_order ?? 0)}" placeholder="0" class="input-full">
                         </div>
                        <div class="form-group grid-span-2 grid-row-start" data-formats="html html_md md">
                            <label class="sub-label">${t('label_ogp_image')}</label>
                            <input type="text" name="ogp_image" value="${h(d.ogp_image || '')}" placeholder="ogp.jpg">
                        </div>
                        <div class="form-group grid-span-2" data-formats="html html_md md">
                            <label class="sub-label">${t('label_keywords')}</label>
                            <input type="text" name="keywords" value="${h(d.keywords || '')}" placeholder="AI, CMS, mikanBox...">
                        </div>
                    </div>

                    <div class="form-group">
                        <div data-formats="html html_md md">
                        <label class="sub-label">${t('label_description')}</label>
                        <textarea name="description" class="textarea-xs textarea-description">${h(d.description || '')}</textarea>
                        </div>
                        <label id="content-label" data-labels="${h(JSON.stringify(contentLabels))}">${h(contentLabels[currentFormat] || t('label_content'))}</label>
                        <label data-formats="html html_md" class="checkbox-label" style="font-size:0.85em; margin-bottom:4px; display:flex; align-items:center; gap:6px; font-weight:normal;"><input type="checkbox" name="is_html" value="1" ${d.is_html?'checked':''}> ${t('label_raw_html')}</label>
                        <textarea name="content_md" class="textarea-lg textarea-mono">${h(d.content_md || '')}</textarea>
                    </div>
                    <div class="form-group" data-formats="html html_md">
                        <label>${t('label_css')}</label>
                        <textarea name="css" class="textarea-sm textarea-mono">${h(d.css || '')}</textarea>
                    </div>
                    <details data-formats="html html_md" class="form-group js-accordion" ${d.js?'open':''}><summary>${t('label_page_js')} <span class="accordion-arrow">▼</span></summary><small class="sub-text sub-text-block">${t('page_js_hint')}</small><textarea name="js" aria-label="${t('label_page_js')}" class="textarea-sm textarea-mono" rows="10">${h(d.js||'')}</textarea></details>
                    <div class="flex-row flex-between mt-10">
                        <div class="flex-row">
                            <button type="submit" form="page-form" name="save_action" value="save_page" class="btn btn-blue">${getIcon('save')} ${t('btn_save')}</button>
                            <button type="button" id="editor-preview-btn" class="btn btn-blue" data-editor-preview title="${h(t('preview_editing_hint'))}" data-error="${h(t('err_network_error_detail'))}">${getIcon('view')} ${t('btn_preview')}</button><small class="sub-text preview-saved-note">${t('preview_editing_hint')}</small>
                            <a href="/admin${opts.listQuery ? h('?' + opts.listQuery.slice(1)) : ''}#pages" class="btn btn-gray">${getIcon('arrow_back')} ${t('btn_back_to_list')}</a>
                        </div>
                        ${(editId && editId !== 'index') ? `
                            <button type="submit" form="page-form" name="save_action" value="delete_page" class="btn btn-red" formnovalidate>${getIcon('delete')} ${t('btn_delete')}</button>
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
            </div>
<script>${EDITOR_FORMAT_SCRIPT}</script>`;
}

// Output format: show only the fields that format uses, and the URL it publishes at (shared/views/page-editor.php).
// The Cloud edition publishes statically: HTML at /id/, everything with an extension at /id.<extension>.
const EDITOR_FORMAT_SCRIPT = `(function () {
    const select = document.getElementById('output-format-select');
    const grid = document.getElementById('page-format-grid');
    const form = document.getElementById('page-form');
    if (!select || !grid || !form) return;
    const urlCode = document.getElementById('output-format-url');
    const expand = document.getElementById('expand-tags-checkbox');
    const idInput = form.querySelector('input[name="id"]');
    let expandTouched = false;
    if (expand) expand.addEventListener('change', () => { expandTouched = true; });
    function pageUrl(format) {
        const id = (idInput && idInput.value.trim()) || 'page';
        const base = select.dataset.staticBase;
        if (format === 'db') return base + '/api/' + id + '.json';
        const ext = format === 'md' ? 'md' : (['html', 'html_md'].includes(format) ? '' : format);
        if (ext) return base + '/' + id + '.' + ext;
        if (id === 'index') return base + '/';
        return base + '/' + id + '/';
    }
    function update(changed) {
        const format = select.value;
        grid.dataset.format = format;
        form.querySelectorAll('[data-formats]').forEach((el) => {
            el.hidden = !el.dataset.formats.split(' ').includes(format);
        });
        if (urlCode) urlCode.textContent = pageUrl(format) + (format === 'html_md' ? '  ·  ' + pageUrl('md') : '');
        const contentLabel = document.getElementById('content-label');
        if (contentLabel) {
            try { contentLabel.textContent = JSON.parse(contentLabel.dataset.labels)[format] || contentLabel.textContent; } catch (e) {}
        }
        const visual = document.getElementById('editor-visual-btn');
        if (visual) {
            const on = ['html', 'html_md'].includes(format) && visual.dataset.savedHtml === '1';
            visual.classList.toggle('btn-blue', on);
            visual.classList.toggle('btn-gray', !on);
            visual.classList.toggle('btn-disabled', !on);
            if (on) { visual.removeAttribute('aria-disabled'); visual.removeAttribute('tabindex'); }
            else { visual.setAttribute('aria-disabled', 'true'); visual.setAttribute('tabindex', '-1'); }
            visual.title = on ? visual.dataset.titleOn : visual.dataset.titleOff;
        }
        const option = select.selectedOptions[0];
        if (changed && expand && !expandTouched && option && option.dataset.expand !== undefined) {
            expand.checked = option.dataset.expand === '1';
        }
    }
    select.addEventListener('change', () => update(true));
    if (idInput) idInput.addEventListener('input', () => update(false));
    update(false);
})();`;

// ===== デザイン一覧 (views/design.php) =====
export function renderDesignView(opts: {
  t: (key: string, ...args: (string | number)[]) => string;
  components: Array<{ id: string; data: ComponentData }>;
  view: string;
  editId: string | null;
  hasNew: boolean;
  helpFile: string;
  /** The design editor, in the design-editor slot. */
  editorHtml?: string;
}): string {
  const { t, components, view, editId, hasNew, helpFile } = opts;
  const hasEditor = view === 'components' && (editId !== null || hasNew);

  // AI instructions first, then page templates, then parts (standard head/header/footer first), as in PHP.
  const rank = (c: { id: string; data: ComponentData }) => c.data.is_ai_doc ? 0 : c.data.is_wrapper ? 1 : 2;
  const standard: Record<string, number> = { _global_head: 1, _header: 2, _footer: 3 };
  const ordered = [...components].sort((a, b) => rank(a) - rank(b) || (standard[a.id] || 99) - (standard[b.id] || 99) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows = ordered.map(({ id: cid, data: cData }) => {
    const typeLabel = cData.is_wrapper ? t('comp_type_page') : cData.is_ai_doc ? t('comp_type_aidoc') : t('comp_type_part');
    const typeClass = cData.is_wrapper ? 'type-badge wrapper' : cData.is_ai_doc ? 'type-badge aidoc' : 'type-badge';
    return `<tr data-component-id="${h(cid)}" data-component-type="${cData.is_wrapper?'wrapper':cData.is_ai_doc?'ai_doc':'part'}" data-component-memo="${h(cData.memo||'')}">
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
            <h1>${getIcon('component')} ${t('nav_design')}<a href="?view=design&amp;new=1#design-editor" class="btn btn-sm btn-blue" style="margin-left:15px;display:inline-flex;align-items:center;gap:5px;font-size:.85rem;padding:4px 10px;vertical-align:middle">${getIcon('add')} ${t('btn_create_new')}</a><a href="${h(helpFile)}#design-mgmt" target="_blank" class="manual-link">${t('admin_help')}</a><span class="component-filter-control"><select class="select-auto component-filter-select" aria-label="${t('component_filter_label')}">${['all','wrapper','part','ai_doc','standard'].map(value=>`<option value="${value}">${t('component_filter_'+value)}</option>`).join('')}</select></span></h1>
            <form class="search-bar-wrap" role="search" onsubmit="return false"><div class="admin-search"><input type="search" id="admin-component-search" class="admin-search-input" placeholder="${t('component_search_placeholder')}" aria-label="${t('component_search_placeholder')}"><span class="admin-search-icon">${getIcon('search')}</span></div></form>
        </div>
        <div class="table-responsive ${hasEditor ? 'mb-0' : 'ssg-build-row no-editor'}" id="comps-table-wrap">
        <table>
            <tr><th class="td-narrow">${t('btn_edit')}</th><th class="td-narrow">${t('label_component_id')}</th><th class="td-narrow">${t('label_type')}</th><th>${t('label_tag_name')}</th></tr>
            ${rows}
        </table>
        </div>
        </div>
    </div>

    <div id="design-editor-slot">${opts.editorHtml || ''}</div>`;
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
                </details>

                <div class="flex-row flex-between mt-25">
                    <div class="flex-row">
                        <button type="submit" form="comp-form" name="save_action" value="save_comp" class="btn btn-blue">${getIcon('save')} ${t('btn_save')}</button>
                        <a href="/admin?view=design#design" class="btn btn-gray">${getIcon('arrow_back')} ${t('btn_back_to_list')}</a>
                    </div>
                    ${editId ? `
                        <button type="submit" form="comp-form" name="save_action" value="delete_comp" class="btn btn-red" formnovalidate>${getIcon('delete')} ${t('btn_delete')}</button>
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
                        <form method="post" class="inline" data-confirm="${h(t('hint_confirm_delete'))}" data-confirm-ok="${h(t('btn_delete_confirm'))}" data-confirm-title="${h(t('btn_delete'))}">
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
                        ${['jpg','jpeg','png'].includes(ext)?`<form method="post" class="media-convert-form" data-confirm="${h(t('confirm_media_webp',fname))}" data-confirm-title="${h(t('btn_convert_webp'))}" data-confirm-ok="${h(t('btn_convert_webp'))}" data-confirm-class="btn-blue">
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
            <h1>${getIcon('media')} ${t('nav_media')}<a href="${h(helpFile)}#media-mgmt" target="_blank" class="manual-link">${t('admin_help')}</a><span class="component-filter-control"><select class="select-auto list-filter-select" id="media-type-filter" aria-label="${t('media_type_filter')}">${[['',t('media_type_all')],['image',t('media_type_image')],['audio',t('media_type_audio')],['video',t('media_type_video')],['js','JS'],['css','CSS']].map(([type,label])=>`<option value="${type}" ${opts.mediaType===type?'selected':''}>${label}</option>`).join('')}</select></span></h1>
            <!-- Media search: the same control and behaviour as the page search -->
            <form method="get" action="/admin#media" class="search-bar-wrap" role="search">
                <input type="hidden" name="view" value="media"><input type="hidden" name="cat" value="${h(opts.category||'')}"><input type="hidden" name="media_all" value="${opts.ignoreCategory?'1':'0'}"><input type="hidden" name="media_type" value="${h(opts.mediaType||'')}">
                <div class="admin-search">
                    <input type="search" name="q_media" id="admin-media-search" class="admin-search-input" value="${h(opts.query||'')}" placeholder="${t('media_search_placeholder')}" aria-label="${t('media_search_placeholder')}">
                    <span class="admin-search-icon">${getIcon('search')}</span>
                </div>
            </form>
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
                    <details class="resize-details upload-options" id="upload-options"><summary class="resize-summary">${t('upload_options')}<span class="resize-arrow">▼</span></summary><div class="upload-options-body"><div class="upload-info upload-info-types">${t('media_support_types')}: JPEG, PNG, GIF, WebP, SVG, JS, CSS<br>${t('media_code_hint')}</div><label class="upload-option"><input type="checkbox" name="opt_resize" value="1" id="opt-resize" checked> ${t('upload_opt_resize')} <input type="text" name="opt_max_dim" id="opt-max-dim" value="2000" class="resize-input" inputmode="numeric" pattern="[0-9]*"> px</label><label class="upload-option"><input type="checkbox" name="opt_webp" id="opt-webp" value="1"> ${t('upload_opt_webp')}</label></div></details>
                    <div class="upload-info">
                        ${opts.usage&&opts.usage.files>=MEDIA_COUNT_LIMIT*0.9?`<strong id="media-usage-warning" role="status">${opts.lang==='ja'?'ファイル数の上限に近づいています。使っていないメディアを削除してください。':'The file count is close to its limit. Delete unused media.'}</strong><br>`:''}
                        ${t('hint_media_display')}<br>
                        ${t('hint_media_resize')}
                    </div>
                </div>
            </form>
        </div>

        `:`<p role="status">${opts.lang==='ja'?'画像アップロードは後日対応します。現在はページとデザインの確認ができます。':'Image uploads will be available later. Pages and design editing are available now.'}</p>`}

        <div id="media-list-wrap">
        ${opts.category?`<div class="media-filter-status flex-row" style="margin:15px 0;justify-content:space-between"><span>${t(opts.ignoreCategory?'all_media_shown_hint':'media_filtered_hint',h(opts.category))}</span><a class="btn btn-sm ${opts.ignoreCategory?'btn-blue':'btn-orange'}" href="/admin?cat=${encodeURIComponent(opts.category)}&media_all=${opts.ignoreCategory?'0':'1'}#media">${t(opts.ignoreCategory?'btn_apply_filter':'btn_ignore_filter')}</a></div>`:''}
        <div class="media-grid">
            ${files.length === 0 ? "<p class='td-empty'>No media found.</p>" : cards}
        </div>
        <div id="media-pagination" class="flex-row media-pagination">
            <span>${opts.page||1} / ${opts.totalPages||1} · ${opts.totalFiles??files.length} ${t('media_file_count')}</span>
            ${(opts.page||1)>1?`<a class="btn btn-gray btn-small" href="/admin?view=media&q_media=${encodeURIComponent(opts.query||'')}&cat=${encodeURIComponent(opts.category||'')}&media_all=${opts.ignoreCategory?'1':'0'}&media_type=${encodeURIComponent(opts.mediaType||'')}&p_media=${(opts.page||1)-1}#media">${t('btn_previous')}</a>`:''}
            ${(opts.page||1)<(opts.totalPages||1)?`<a class="btn btn-gray btn-small" href="/admin?view=media&q_media=${encodeURIComponent(opts.query||'')}&cat=${encodeURIComponent(opts.category||'')}&media_all=${opts.ignoreCategory?'1':'0'}&media_type=${encodeURIComponent(opts.mediaType||'')}&p_media=${(opts.page||1)+1}#media">${t('btn_next')}</a>`:''}
        </div>
        </div> <!-- /#media-list-wrap -->
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
  dataHtml?:string;
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
                <form method="post" data-ajax>
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
                <a id="cloud-check-updates" href="/admin?view=site&amp;refresh_updates=1#cloud-version-row" data-done="${h(t('msg_updates_checked'))}"${opts.release?.status==='error'?` data-failed="${h(t('version_latest')+': '+t('version_check_failed'))}"`:''}>${t('btn_check_updates')}</a>
                ${opts.release?.outdated?`<span style="font-weight:600">${lang==='en'?'A new version is available':'新しいバージョンがあります'}</span>`:''}
                ${cloudUpdateUrl(opts.updateRepository)?`<a class="btn btn-small btn-blue" href="${h(cloudUpdateUrl(opts.updateRepository))}" target="_blank" rel="noopener noreferrer">${lang==='en'?'Update on GitHub':'GitHubでアップデート'}</a>`:''}
                ${opts.release?.url?`<a href="${h(opts.release.url)}" target="_blank" rel="noopener noreferrer">${lang==='en'?'Cloud release':'Cloud版リリース'}</a>`:''}
            </div>
            <small class="system-version-note">${lang==='en'?'Click “Update on GitHub”, then press “Run workflow” on the page that opens. After it succeeds, reload this screen.':'「GitHubでアップデート」をクリックし、移動したページで「Run workflow」を押すと更新します。成功後、この画面を再読み込みしてください。'}</small>
            <details class="section-accordion mt-10" style="${guideBoxStyle}"><summary class="header section-header accordion-summary" style="${guideSummaryStyle}"><h3 style="font-size: 0.95rem; margin: 0; color: var(--text); display: inline-flex; align-items: center; gap: 8px; pointer-events: none;">${lang==='en'?'Set up updates connected to GitHub':'GitHubと接続したアップデートの設定'}</h3><span class="accordion-arrow" style="font-size: 0.75rem; opacity: 0.5;">▼</span></summary><div class="token-guide-body" style="${guideBodyStyle}">
              <p><a href="${h(helpFile)}#manual-update" target="_blank" rel="noopener noreferrer">${lang==='en'?'First-time GitHub setup instructions':'GitHubでの初回設定手順'}</a></p>
              <form method="post" data-ajax>${csrfField(csrf)}<input type="hidden" name="save_action" value="save_cloud_update_repository">
                <label>${lang==='en'?'Your GitHub repository (owner/repository)':'自分のGitHubリポジトリ（所有者/リポジトリ名）'} <input name="cloud_update_repository" value="${h(opts.updateRepository||'')}" placeholder="owner/repository" maxlength="200"></label>
                <button type="submit" class="btn btn-gray btn-small">${t('btn_save')}</button>
              </form>
            </div></details>
        </div>

        <div class="section-container section-tight">
            <div class="integrity-box panel-card" id="integrity-box" data-labels="${h(JSON.stringify(Object.fromEntries(['integrity_ok','integrity_found','integrity_sec_public','integrity_sec_data','integrity_changed','integrity_missing','integrity_data_changed','integrity_data_missing','integrity_data_unrecorded','integrity_item_page','integrity_item_component','integrity_item_settings','integrity_unusual_head','integrity_unusual_hint','integrity_accept_btn','integrity_accept_hint','integrity_checking','integrity_cloud_program_na','integrity_cloud_not_published','integrity_cloud_unreachable','integrity_cloud_unverified','integrity_cloud_truncated','integrity_cloud_checked','err_network_error',...AUDIT_EVENTS.map(e=>'audit_event_'+e)].map(k=>[k,t(k,'%s','%s')]))))}">
                <button type="button" class="btn btn-gray btn-small" id="integrity-run">${t('integrity_btn')}</button>
                <small class="sub-text sub-text-block">${t('integrity_hint')}</small>
                <div id="integrity-output" aria-live="polite"></div>
            </div>
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
                <div class="panel-card">
                    <form method="post" data-ajax>
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
                </div>
            </details>
        </div>
    </div>




    <div id="csv-import">
        <div class="section-container section-tight">
            <details class="section-accordion">
                <summary class="header section-header accordion-summary">
                    <h2 class="accordion-title">
                        ${t('csv_head')} <span class="accordion-arrow">▼</span>
                    </h2>
                </summary>
                <div class="editor-container editor-container-sub">
                <div class="panel-card">
                    <small class="sub-text sub-text-intro">${t('csv_hint')}</small>
                    <div class="mt-10">
                        <input type="file" id="csv-file-input" accept=".csv,text/csv">
                    </div>
                    <div class="mt-10">
                        <button type="button" class="btn btn-gray btn-small" onclick="csvConvertAndCopy()" id="csv-copy-btn">${getIcon('copy')} ${t('btn_csv_convert')}</button>
                    </div>
                </div>
                </div>
            </details>
        </div>
    </div>

    <div id="backup">
        <div class="section-container section-tight">
            <details class="section-accordion">
                <summary class="header section-header accordion-summary">
                    <h2 class="accordion-title">
                        ${t('backup_head')} <span class="accordion-arrow">▼</span>
                    </h2>
                </summary>
                <div class="editor-container editor-container-sub">
                    ${opts.dataHtml||''}
                    ${settings.d1_bytes!==null&&Number(settings.d1_bytes)>=D1_WARNING_BYTES?`<p role="status"><strong>${lang==='en'?'The database is close to its limit.':'データベースが上限に近づいています。'}</strong></p>`:''}
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
                <div class="panel-card">
                    <form method="post" class="site-settings-form" data-ajax>
                        <input type="hidden" name="save_action" value="save_settings">
                        ${csrfField(csrf)}
                        <div class="grid-2col">
                            <div class="site-identity-row grid-span-2">
                                <div class="form-group"><label>${t('label_site_name')}</label><input type="text" name="site_name" value="${h(settings.site_name||'')}"></div>
                                <div class="form-group"><label>${t('label_site_id')}</label><input type="text" readonly value="${h(settings.site_id||'')}"><small class="sub-text">${t('hint_site_id')}</small></div>
                            </div>
                            <div class="form-group"><label>${t('label_site_url')}</label><input type="url" readonly value="${h(String(settings._public_url||''))}"></div>
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
                </div>
            </details>
        </div>
    </div>

    <div id="cloud-connection"><div class="section-container section-tight"><details class="section-accordion"><summary class="header section-header accordion-summary"><h2 class="accordion-title">${lang==='en'?'Cloudflare publication settings':'Cloudflare公開設定'} <span class="accordion-arrow">▼</span></h2></summary><div class="editor-container editor-container-sub">
                    <details class="section-accordion" style="${guideBoxStyle}"><summary class="header section-header accordion-summary" style="${guideSummaryStyle}"><h3 style="font-size: 0.95rem; margin: 0; color: var(--text); display: inline-flex; align-items: center; gap: 8px; pointer-events: none;">${lang==='en'?'How to get a Cloudflare API token':'Cloudflare APIトークンの取得方法'}</h3><span class="accordion-arrow" style="font-size: 0.75rem; opacity: 0.5;">▼</span></summary><div class="token-guide-body" style="${guideBodyStyle}">
                    ${lang==='en'?`<ol class="token-guide"><li>Sign in to Cloudflare with the account that hosts this site, and open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">My Profile → API Tokens</a>.</li><li>Press <b>Create Token</b>, then <b>Get started</b> next to <b>Create Custom Token</b>.</li><li>Give it a name, such as “mikanBox publishing”.</li><li>Under <b>Permissions</b>, choose <b>Account</b> → <b>Workers Scripts</b> → <b>Edit</b>. To use the D1 backup and Time Travel features as well, add a second row: <b>Account</b> → <b>D1</b> → <b>Edit</b>.</li><li>Under <b>Account Resources</b>, choose <b>Include</b> → the account that hosts this site.</li><li>Press <b>Continue to summary</b>, then <b>Create Token</b>. Copy the long string that is shown. <b>It is shown only once.</b></li><li>Paste it into “Cloudflare API token” below and press Save. The account ID and Worker name are already filled in; leave them as they are.</li></ol><p class="sub-text">You create the token once. The site stores it encrypted and never shows it again. You only need a new one if it is deleted or revoked in Cloudflare, its permissions change, or the site’s secret key (JWT_SECRET) changes.</p>`:`<ol class="token-guide"><li>このサイトを置いているCloudflareのアカウントでログインし、<a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">プロフィール → APIトークン</a>を開きます。</li><li>「トークンを作成する」を押し、「カスタムトークンを作成する」の「開始する」を押します。</li><li>トークン名を付けます。例：「mikanBox公開用」。</li><li>「権限」で、<b>アカウント</b> → <b>Workers スクリプト</b> → <b>編集</b> を選びます（英語表示では Account → Workers Scripts → Edit）。D1のバックアップとTime Travelも使う場合は、もう1行、<b>アカウント</b> → <b>D1</b> → <b>編集</b> を追加します。</li><li>「アカウントリソース」で、<b>含める</b> → このサイトを置いているアカウントを選びます。</li><li>「概要に進む」→「トークンを作成する」を押し、表示された長い文字列をコピーします。<b>表示されるのは1回だけです。</b></li><li>下の「Cloudflare APIトークン」欄に貼り付けて「保存」を押します。アカウントIDとWorker名は最初から入っているので、そのままにしてください。</li></ol><p class="sub-text">トークンは最初に1回作るだけです。サイトが暗号化して保存し、再表示しません。作り直すのは、Cloudflareで削除・失効させたとき、権限を変えたとき、サイトの秘密鍵（JWT_SECRET）を変えたときだけです。</p>`}
                    </div></details>
                    <div class="panel-card">
                    <form method="post" class="grid-2col" data-ajax data-refresh="#cloud-connection, #publish-box"><input type="hidden" name="save_action" value="save_cloud_connection">${csrfField(csrf)}<div class="form-group"><label>${lang==='en'?'Cloudflare account ID':'CloudflareアカウントID'}</label><input type="text" name="cloud_account_id" value="${h(settings.cloud_account_id||'')}" required></div><div class="form-group"><label>${lang==='en'?'Worker name':'Worker名'}</label><input type="text" name="cloud_worker_name" value="${h(settings.cloud_worker_name||'')}" required></div><div class="form-group"><label>${lang==='en'?'Cloudflare API token':'Cloudflare APIトークン'}</label><input type="password" name="cloud_api_token" autocomplete="new-password" ${settings.cloud_connection_ready?'placeholder="•••••••• (set)"':'required'}></div><div class="form-actions"><button class="btn btn-gray btn-small">${t('btn_save')}</button> <span role="status">${settings.cloud_connection_ready?(lang==='en'?'Connection configured':'接続設定済み'):(lang==='en'?'Not configured':'未設定')}</span></div></form>
                    </div>
    </div></details></div></div>
    ${opts.accountsHtml||''}
    <div id="mcp-key"><div class="section-container section-tight"><details class="section-accordion"><summary class="header section-header accordion-summary"><h2 class="accordion-title">${t('mcp_key_head')} <span class="accordion-arrow">▼</span></h2></summary><div class="editor-container editor-container-sub">
      <div class="panel-card"><form method="post" data-ajax>${csrfField(csrf)}<input type="hidden" name="save_action" value="set_mcp_enabled"><label><input type="checkbox" name="mcp_enabled" value="1" ${settings.mcp_disabled?'':'checked'}> ${t('mcp_enable_label')}</label> <button type="submit" class="btn btn-gray btn-small">${t('btn_save')}</button></form></div>
      <details class="section-accordion" style="margin-top: 15px; margin-bottom: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa;"><summary class="header section-header accordion-summary" style="${guideSummaryStyle}"><h3 style="font-size: 0.95rem; margin: 0; color: var(--text); display: inline-flex; align-items: center; gap: 8px; pointer-events: none;">${getIcon('add')} ${t('mcp_key_add_summary')}</h3><span class="accordion-arrow" style="font-size: 0.75rem; opacity: 0.5;">▼</span></summary><div style="${guideBodyStyle}">
        <small class="sub-text sub-text-intro">${t('mcp_key_hint')}</small>
        <form method="post" id="mcp-key-generate" data-ajax data-refresh="#mcp-key-list">${csrfField(csrf)}<input type="hidden" name="save_action" value="generate_api_key"><div class="form-group"><label for="mcp-key-name">${t('mcp_key_name_label')}</label><input type="text" id="mcp-key-name" name="mcp_key_name" maxlength="${MCP_KEY_NAME_MAX}" autocomplete="off" style="max-width:300px;"></div><button class="btn btn-blue btn-small">${getIcon('sparkles')} ${t('btn_generate_mcp_key')}</button></form>
      <div class="form-group mt-10"><label for="mcp-url-display">${t('mcp_url_label')}</label><div class="copy-row"><input type="text" id="mcp-url-display" value="" readonly><button type="button" class="btn btn-gray btn-small" onclick="copyField('mcp-url-display')">${getIcon('copy')} ${t('btn_copy')}</button></div></div>
        <div id="mcp-key-issued" class="form-group mt-10"><label for="mcp-key-display">${t('mcp_key_label')}</label><div class="copy-row"><input type="text" id="mcp-key-display" value="" placeholder="${h(t('mcp_key_issued_placeholder'))}" readonly><button type="button" class="btn btn-gray btn-small" onclick="copyField('mcp-key-display')">${getIcon('copy')} ${t('btn_copy')}</button></div><small class="sub-text" id="mcp-key-once" style="display:none;">${t('mcp_key_once_note')}</small></div>
      </div></details>
      <div id="mcp-key-list"><h3 style="font-size: 0.95rem; margin: 18px 0 12px; color: var(--text); border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">${t('mcp_key_list_title')}</h3>${(()=>{
        const keys=mcpKeyList(settings.api_key),used=(settings._mcp_last_used||{}) as Record<string,number>;
        if(!keys.length)return `<p class="sub-text">${t('mcp_key_none')}</p>`;
        return `<div class="account-user"><div class="account-table-wrap"><table class="account-table"><thead><tr><th>${t('mcp_key_col_name')}</th><th>${t('mcp_key_col_created')}</th><th>${t('mcp_key_col_last_used')}</th><th></th></tr></thead><tbody>${keys.map(k=>{const name=k.name||t('mcp_key_unnamed');return `<tr><td>${h(name)}</td><td>${k.created?h(new Date(k.created*1000).toISOString().slice(0,10)):'—'}</td><td>${used[k.id]?localTime(used[k.id],lang):t('mcp_never_used')}</td><td class="account-actions"><form method="post" data-ajax data-refresh="#mcp-key-list" data-confirm="${h(t('mcp_key_revoke_confirm',name))}">${csrfField(csrf)}<input type="hidden" name="save_action" value="revoke_mcp_key"><input type="hidden" name="mcp_key_id" value="${h(k.id)}"><button type="submit" class="btn btn-gray btn-small">${t('btn_revoke_mcp_key')}</button></form></td></tr>`;}).join('')}</tbody></table></div></div>`;
      })()}</div>
      </div></details></div></div>
    <div class="section-container section-tight"><details class="section-accordion"><summary class="header section-header accordion-summary"><h2 class="accordion-title">${t('audit_heading')} <span class="accordion-arrow">▼</span></h2></summary><div class="editor-container editor-container-sub">
    ${(()=>{
      type Row={at:string;event:string;actor:string;target:string;from_value:string;to_value:string;ip:string};
      const rows=(settings._audit as Row[])||[],groups:Array<[string,Row[]]>=[['important',[]],['edit',[]],['login',[]]];
      const unusual=new Set(auditUnusual([...rows].reverse(),String(settings._unusual_until||'')).map(i=>rows.length-1-i));   // rows are newest first
      rows.forEach((e,i)=>{(e as Row&{unusual?:boolean}).unusual=unusual.has(i);groups.find(g=>g[0]===auditGroup(e.event))![1].push(e);});
      const table=(list:Row[])=>list.length?`<table><thead><tr><th>${t('audit_time_local')}</th><th>${t('audit_action')}</th><th>${t('audit_actor')}</th><th>${t('audit_target')}</th><th>IP</th></tr></thead><tbody>${list.map(e=>`<tr${(e as Row&{unusual?:boolean}).unusual?` class="audit-unusual" title="${h(t('audit_unusual_title'))}"`:''}><td>${localTime(Date.parse(e.at),lang)}</td><td>${h(t('audit_event_'+e.event))}</td><td>${h(e.actor)}</td><td>${h(auditTargetText(e))}</td><td>${h(e.ip)}</td></tr>`).join('')}</tbody></table>`:`<p>${t('audit_empty')}</p>`;
      return `<div class="audit-tabs">${groups.map((g,n)=>`<input type="radio" name="audit-tab" id="audit-tab-${n+1}"${n===0?' checked':''} aria-label="${h(t('audit_tab_'+g[0]))}">`).join('')}<div class="audit-tab-labels">${groups.map((g,n)=>`<label for="audit-tab-${n+1}">${t('audit_tab_'+g[0])} (${g[1].length})</label>`).join('')}</div>${groups.map(g=>`<div class="audit-panel">${table(g[1])}</div>`).join('')}</div>`;
    })()}
    </div></details></div>

    <div class="section-end-gap" aria-hidden="true"></div>
`;
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
                        <li><code>{{PAGE_URL:ID}}</code> : ${t('hint_page_url_id')}</li>
                        <li><code>{{CATEGORY}}</code> : ${t('hint_category')}</li>
                        <li><code>{{CATEGORY:all}}</code> : ${t('hint_category_all')}</li>
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
                        <li><code>{{NAV_LINKS:@same}}</code> : ${t('hint_nav_same')}</li>
                        <li><code>{{NAV_CARDS:news:_nav_card:sort=new:limit=5}}</code></li>
                        <li class="hint-note">${t('hint_nav_options')}</li>
                        <li class="hint-note">${t('nav_links_cards_hint')}</li>
                        <li style="margin-top:8px"><span class="hint-section-label">${t('nav_cards_template_vars')}</span></li>
                        <li><code>{{PAGE_URL}}</code> <code>{{TITLE}}</code> <code>{{CATEGORY}}</code> <code>{{DESCRIPTION}}</code> <code>{{OGP_IMAGE}}</code> <code>{{UPDATE_DATE}}</code> <code>{{IS_NEW:N}}</code> <code>{{POST_MD::key}}</code> <code>{{POST_MD::#rowID:key}}</code></li>
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
                        <li style="margin-top:8px"><span class="hint-section-label">${t('label_output_formats_head')}</span></li>
                        <li class="hint-note">${t('hint_output_formats')} <a href="${h(helpFile)}#output-formats" target="_blank">${t('admin_help')}</a></li>
                    </ul>
                </div>
            </div>
        </div>
    </details>`;
}

function cloudDataExtra(opts: {t:(key:string,...args:(string|number)[])=>string;csrf:string;lang:string;cloudReady?:boolean}):string {
  const {t,csrf,lang}=opts,en=lang==='en';
  const needsToken=`<p>${en?'Configure Cloudflare publication settings with D1 edit permission.':'D1編集権限を持つトークンをCloudflare公開設定に登録してください。'}</p>`;
  // After Save and Read (data-section.ts), the Cloud edition's own: D1 to a past time, then the public site.
  const extraHtml=`<section id="cloud-d1-restore" class="data-tool-card"><h2>${getIcon('history')} ${en?'Restore D1 to a past time':'D1の指定時刻への復元'}</h2><p>${en?'Returns the database to a time within Cloudflare’s retention period (the last 7 days on the free plan). The public site is not changed: build the site after restoring.':'データベースを、Cloudflareが保持している期間内（無料プランは直近7日）の指定時刻に戻します。公開サイトは変わらないので、復元後はサイトをビルドしてください。'}</p>
    ${opts.cloudReady?`<form method="post" data-cloudbackup="d1-restore">${csrfField(csrf)}<input type="hidden" name="save_action" value="restore_d1_time"><label class="form-group backup-field">${en?'Restore to time':'復元する時刻'} <input type="datetime-local" name="restore_at" required></label><button class="btn btn-gray btn-small">${en?'Restore D1 to this time':'D1を指定時刻に戻す'}</button><span data-transfer-status role="status"></span></form>`:needsToken}</section>
    <section id="site-export" class="data-tool-card"><h2>${getIcon('download')} ${t('site_export_title')}</h2>
    <p>${t('site_export_hint')}</p>
    <form method="post" data-cloud-export="site">${csrfField(csrf)}<div class="flex-row flex-row-wrap items-center"><label class="transfer-field"><input type="checkbox" name="relative" value="1"> ${t('site_export_relative')}</label><button type="submit" class="btn btn-gray btn-small">${getIcon('download')} ${t('site_export_btn')}</button></div><span data-transfer-status role="status"></span></form></section>`;
  return extraHtml;
}
/** The site screen's "Data management": the site's figures, Save, Read, then the Cloud edition's own sections. */
export function renderDataSection(opts: {t:(key:string,...args:(string|number)[])=>string;csrf:string;lang:string;cloudReady?:boolean;stats:TransferStats}):string {
  return renderTransferSections({t:opts.t,csrf:opts.csrf,cloudReady:!!opts.cloudReady,extraHtml:cloudDataExtra(opts),stats:opts.stats});
}
