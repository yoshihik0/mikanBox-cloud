// ==========================================
// mikanBox visual editing (Cloud edition). The counterpart of shared/visual.php.
//   /admin/visual           choose a page
//   /admin/visual?id=ID     the page as it looks, editable by picking parts of it
//   /admin/visual?api=NAME  the calls the screen makes (JSON)
// Same login (device session) as /admin. Writes need the CSRF token and a same-origin request.
// The screen code (visual.js / visual.css) and the visual_* strings are shared with the PHP editions.
// ==========================================
import type { Env, PageData, Settings } from './types';
import { loadSettings, listMediaFiles, uploadMedia } from './storage';
import { authenticatedUser } from './accounts';
import { verifyCsrf } from './auth';
import { MikanBoxRenderer } from './renderer';
import { scopeCss } from './cssScope';
import { getSystemLanguage, createTranslator } from './i18n';
import { validId, reservedPageId } from './validation';
import { imageType, validMediaName, MEDIA_FILE_LIMIT } from './media-policy';
import { imageSize } from './image-size';
import { CLOUD_VERSION } from './version';
import { injectMarkers, applyMarkers, isDoc } from './visual-blocks';
import { VisualError, readPage, counts, points, commit, move, restorePoint, createPage } from './visual-store';
import JA from '../lang/ja.json';
import EN from '../lang/en.json';

const SELF = '/admin/visual';
const ADMIN = '/admin';
type Translator = (key: string, ...args: (string | number)[]) => string;

const nl = (s: string) => s.replace(/\r\n/g, '\n');
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const nonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function headers(type: string, n?: string): Headers {
  const h = new Headers({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' });
  if (n) {
    // No script of the page runs here (inline, external, component JS or uploaded JS media): this document holds the
    // administrator's session, and the Cloud edition keeps site scripts apart from it (as the sandboxed preview does).
    // Only this screen's own nonce'd scripts run.
    h.set('Content-Security-Policy', `default-src 'self'; script-src 'nonce-${n}'; `
      + "style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; img-src * data: blob:; media-src * data: blob:; "
      + "connect-src 'self'; frame-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  }
  return h;
}
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers('application/json; charset=utf-8') });
function dieHtml(t: Translator, message: string, status: number) {
  const n = nonce(), title = esc(t('btn_visual_edit'));
  return new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px/1.7 system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#1b3a57"><h2>${title}</h2><p>${esc(message)}</p></body>`, { status, headers: headers('text/html; charset=utf-8', n) });
}

/** The Origin header must match; without it, only same-origin (or direct) fetches pass. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  const site = request.headers.get('Sec-Fetch-Site') || '';
  return site === '' || site === 'same-origin' || site === 'none';
}

/** Strings for the screen: visual_* keys and a few shared with the admin screen. */
function jsStrings(lang: string): Record<string, string> {
  const all = (lang === 'en' ? EN : JA) as Record<string, string>, out: Record<string, string> = {};
  for (const k of Object.keys(all)) if (k.startsWith('visual_')) out[k] = all[k];
  for (const k of ['btn_close', 'btn_cancel', 'btn_copy', 'label_title', 'btn_visual_edit']) if (all[k] !== undefined) out[k] = all[k];
  return out;
}
const statusLabel = (t: Translator, s: string) => {
  const key = { draft: 'page_status_draft', pending: 'page_status_pending', public: 'page_status_public_static', public_dynamic: 'page_status_public_static', public_static: 'page_status_public_static', db: 'page_status_db' }[s];
  // Same wording as the Cloud page list: "public" without the mode in parentheses
  return key ? (key === 'page_status_public_static' ? t(key).replace(/\s*[(（].*$/, '') : t(key)) : s;
};

/**
 * Renders the page with the site's own renderer: with block markers, a CSS range marker and as a draft.
 * Links and images use this origin, so they work inside the signed-in admin screen (including split mode).
 */
export async function renderVisual(env: Env, settings: Settings, request: Request, id: string, page: PageData): Promise<string> {
  const md = nl(String(page.content_md ?? ''));
  const data: PageData = {
    ...page,
    content_md: isDoc(page) ? md : injectMarkers(md),
    css: `.fv-css-start{}\n${nl(String(page.css ?? ''))}\n.fv-css-end{}`,
  };
  const local = { ...env, PUBLIC_SITE_URL: undefined } as Env;
  const renderer = new MikanBoxRenderer(local, { ...settings, ssg_root_url: '' }, request);
  const result = await renderer.render(id, true, data);
  return applyMarkers(result.html);
}

const pickerStyle = `body{margin:0;background:#f4f8fb;color:#1b3a57;font:15px/1.6 system-ui,-apple-system,"Hiragino Sans",sans-serif}
main{max-width:760px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:1.25rem;margin:0 0 4px;display:flex;align-items:center;gap:8px}
p.note{color:#4f6b86;margin:0 0 18px;font-size:.9rem}
.bar{display:flex;gap:8px;margin-bottom:12px}
input[type=search]{flex:1;border:1px solid #cfd8e3;border-radius:10px;padding:9px 12px;font:inherit;background:#fff;color:inherit}
a.btn{display:inline-flex;align-items:center;gap:4px;border:1px solid #cfd8e3;background:#fff;border-radius:10px;padding:0 12px;color:#1b3a57;text-decoration:none;font-size:.9rem}
a.btn:hover,.row:hover{background:#e3f3fc;border-color:#8cc7e8}
.list{display:flex;flex-direction:column;gap:6px}
.row{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #cfd8e3;border-radius:10px;padding:10px 14px;color:inherit;text-decoration:none}
.row .t{flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .i{color:#4f6b86;font:12px ui-monospace,Menlo,monospace}
.row .s{font-size:.75rem;background:#e3f3fc;border:1px solid #8cc7e8;border-radius:999px;padding:1px 9px;white-space:nowrap}
.ic{font-family:'Material Symbols Outlined';font-size:20px;line-height:1;font-feature-settings:'liga'}`;

async function pageList(env: Env): Promise<Array<{ id: string; title: string; status: string }>> {
  const rows = await env.DB.prepare("SELECT id, COALESCE(json_extract(data, '$.title'), '') AS title, status FROM posts ORDER BY sort_order, updated_at DESC, id")
    .all<{ id: string; title: string; status: string }>();
  return rows.results.map(r => ({ id: r.id, title: String(r.title ?? ''), status: r.status }));
}

function pickerPage(t: Translator, lang: string, pages: Awaited<ReturnType<typeof pageList>>): Response {
  const n = nonce();
  const rows = pages.map(p => {
    const title = p.title || t('visual_untitled');
    return `<a class="row" href="?id=${esc(encodeURIComponent(p.id).replace(/%2F/gi, '/'))}" data-q="${esc((title + ' ' + p.id).toLowerCase())}"><span class="t">${esc(title)}</span><span class="i">${esc(p.id)}</span><span class="s">${esc(statusLabel(t, p.status))}</span></a>`;
  }).join('');
  const body = `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t('btn_visual_edit') + ' - ' + t('visual_picker_title'))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=block">
<style>${pickerStyle}</style></head><body><main>
<h1><span class="ic">edit_square</span>${esc(t('btn_visual_edit'))}</h1>
<p class="note">${esc(t('visual_picker_note'))}</p>
<div class="bar"><input type="search" id="q" placeholder="${esc(t('visual_search_placeholder'))}" autofocus><a class="btn" href="${ADMIN}?view=pages"><span class="ic">dashboard</span>${esc(t('admin_site_title'))}</a></div>
<div class="list" id="list">${rows}</div>
</main>
<script nonce="${n}">
document.getElementById('q').addEventListener('input',function(){var q=this.value.trim().toLowerCase();document.querySelectorAll('#list .row').forEach(function(r){r.style.display=!q||r.dataset.q.indexOf(q)>=0?'':'none'})});
</script></body></html>`;
  return new Response(body, { headers: headers('text/html; charset=utf-8', n) });
}

/** Published pages are static files: a save changes the stored page, not the public site, until it is published again. */
function publishNotice(lang: string, page: PageData): { notice?: string } {
  if (!['public', 'public_dynamic', 'public_static'].includes(page.status)) return {};
  return { notice: lang === 'en' ? 'The public site updates when you publish.' : '公開サイトへは、公開すると反映されます。' };
}

const ID_PATTERN = (id: string) => validId(id);
const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export async function handleVisual(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const settings = await loadSettings(env);
  const lang = getSystemLanguage(settings, request.headers.get('Accept-Language') || '');
  const t = createTranslator(lang);
  const apiName = url.searchParams.get('api');
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });

  const auth = settings.demo_mode ? null : await authenticatedUser(request, env);
  if (!auth) {
    if (apiName !== null) return jsonResponse({ error: t('visual_err_login'), login: true }, 401);
    return new Response(null, { status: 303, headers: { Location: ADMIN, 'Cache-Control': 'no-store' } });
  }
  const csrf = auth.session.csrf, editor = auth.user.username;

  // ---------------------------------------------------------------- API
  if (apiName !== null) {
    const post = request.method === 'POST';
    if (post) {
      if (!sameOrigin(request)) return jsonResponse({ error: 'forbidden' }, 403);
      if (!verifyCsrf(request.headers.get('X-CSRF-Token') || '', csrf)) return jsonResponse({ error: t('visual_err_csrf') }, 403);
    }
    let input: Record<string, unknown> = {}, bytes: ArrayBuffer | null = null;
    if (post && apiName === 'upload') {
      const declared = Number(request.headers.get('Content-Length') || 0);
      if (declared > MEDIA_FILE_LIMIT) return jsonResponse({ error: t('visual_err_image_size') }, 400);   // do not read what will be refused
      bytes = await request.arrayBuffer();
    } else if (post) {
      try { const v = await request.json(); if (v && typeof v === 'object') input = v as Record<string, unknown>; } catch { /* an empty or broken body is treated as no input */ }
    }
    const id = String(input.id ?? url.searchParams.get('id') ?? '');
    const needId = !['scope-css', 'upload', 'create', 'media'].includes(apiName);
    const str = (k: string) => String(input[k] ?? '');
    const sid = str('sid');
    const out = (body: unknown, status = 200) => jsonResponse(body, status);
    const methodOnly = () => out({ error: 'method' }, 405);
    let row = null as Awaited<ReturnType<typeof readPage>>;
    if (needId) {
      row = ID_PATTERN(id) ? await readPage(env, id) : null;
      if (!row) return out({ error: t('visual_err_page_not_found') }, 400);
    }
    try {
      switch (apiName) {
        case 'history': return out(await counts(env, id));
        case 'source': return out({ text: nl(String(row!.data.content_md ?? '')), is_html: !!row!.data.is_html });
        case 'css': return out({ css: nl(String(row!.data.css ?? '')) });
        case 'scope-css': return out({ css: scopeCss(`.fv-css-start{}\n${nl(String(input.css ?? ''))}\n.fv-css-end{}`, '.mikan-content-scope') });
        case 'render': {
          if (!post) return methodOnly();
          const page = { ...row!.data };
          if (typeof input.text === 'string') page.content_md = input.text;
          return out({ html: await renderVisual(env, settings, request, id, page) });
        }
        case 'points': return out({ points: await points(env, id) });
        case 'restore': {
          if (!post) return methodOnly();
          if (!await restorePoint(env, id, str('point'), sid, editor)) return out({ error: t('visual_err_point_missing') }, 409);
          return out({ ok: true, ...await counts(env, id) });
        }
        case 'undo': case 'redo': {
          if (!post) return methodOnly();
          if (!await move(env, id, apiName, editor)) return out({ error: apiName === 'undo' ? t('visual_err_undo_none') : t('visual_err_redo_none') }, 409);
          return out({ ok: true, ...await counts(env, id) });
        }
        case 'save-css': case 'save-md': {
          if (!post) return methodOnly();
          const field = apiName === 'save-css' ? 'css' : 'content_md';
          const orig = String(row!.data[field] ?? '');
          if (nl(orig) !== input.old) return out({ error: t(field === 'css' ? 'visual_err_css_changed' : 'visual_err_body_changed') }, 409);
          const text = nl(String(input.new ?? ''));
          const next = { ...row!.data, [field]: orig.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text };
          await commit(env, id, row!, next, sid, editor);
          return out({ ok: true, ...await counts(env, id), ...publishNotice(lang, next) });
        }
        case 'create': {   // a new page, or a copy of one (always a draft)
          if (!post) return methodOnly();
          const title = str('title').trim(), from = str('from');
          let newId = id || `page_${Math.floor(Date.now() / 1000)}`;
          if (!validId(newId)) return out({ error: t('visual_err_id_chars') }, 400);
          if (reservedPageId(newId)) return out({ error: t('visual_err_id_reserved') }, 400);
          let data: PageData;
          if (from !== '') {
            const src = validId(from) ? await readPage(env, from) : null;
            if (!src) return out({ error: t('visual_err_source_missing') }, 400);
            data = { ...src.data, title: title !== '' ? title : String(src.data.title ?? '') + t('visual_copy_suffix') };
          } else {
            data = { title: title !== '' ? title : newId, category: '', description: '', memo: '', keywords: '', ogp_image: '', content_md: t('visual_new_body'), css: '', js: '', is_html: false, wrapper_comp: '_layout', exclude_tracking: false, sort_order: 0, status: 'draft' };
          }
          data.status = 'draft'; data.updated_at = nowStamp(); data.preview_token = crypto.randomUUID();
          if (!await createPage(env, newId, data)) return out({ error: t('visual_err_id_exists') }, 409);
          return out({ ok: true, id: newId });
        }
        case 'media': {   // images for the picker, newest first. The thumbnails come from /media/ on this origin
          const items = (await listMediaFiles(env))
            .filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f.key) && validMediaName(f.key))
            .slice(0, 500).map(f => ({ name: f.key, t: Math.floor(f.uploaded.getTime() / 1000) || 0 }));
          return out({ items, base: '/media/' });
        }
        case 'upload': {   // pasted, dropped or chosen image: png / jpg / gif / webp, checked by content
          if (!post) return methodOnly();
          const data = new Uint8Array(bytes!);
          if (!data.length || data.length > MEDIA_FILE_LIMIT) return out({ error: t('visual_err_image_size') }, 400);
          const ext = ['png', 'jpg', 'gif', 'webp'].find(e => imageType(data, e));
          const size = ext ? imageSize(data) : null;
          if (!ext || !size || size.width * size.height > 40_000_000) return out({ error: t('visual_err_image_type') }, 400);
          const type = imageType(data, ext)!, stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
          for (let attempt = 0; attempt < 3; attempt++) {
            const name = `img-${stamp}-${[...crypto.getRandomValues(new Uint8Array(2))].map(b => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
            if (!validMediaName(name)) return out({ error: t('visual_err_filename') }, 400);
            if (await uploadMedia(env, name, bytes!, type)) return out({ name });
          }
          return out({ error: t('visual_err_save') }, 500);
        }
      }
    } catch (error) {
      if (error instanceof VisualError) return out({ error: error.message }, error.status);
      // Media operations throw readable messages (for example while images are moving to R2); everything else stays generic.
      if (apiName === 'upload' && error instanceof Error) return out({ error: error.message }, 409);
      console.error('Visual editing failed', error instanceof Error ? error.name : 'UnknownError');
      return out({ error: t('visual_err_save') }, 500);
    }
    return out({ error: 'not found' }, 404);
  }

  // ---------------------------------------------------------------- the page itself
  const id = url.searchParams.get('id') || '';
  if (id === '') return pickerPage(t, lang, await pageList(env));
  const row = validId(id) ? await readPage(env, id) : null;
  if (!row) return dieHtml(t, t('visual_err_page_not_found_id', id), 404);
  const html = await renderVisual(env, settings, request, id, row.data);
  const n = nonce(), h = headers('text/html; charset=utf-8', n);
  if (url.searchParams.has('fv-frame')) return new Response(html, { headers: h });   // for checking widths (no editing)
  const info = {
    api: SELF, list: `${ADMIN}?view=pages`, page: `${ADMIN}?view=pages&edit=${encodeURIComponent(id)}#page-editor`, pick: SELF,
    view: `${SELF}?id=`, site: '/', edit: `${ADMIN}?view=pages#`, editBase: `${ADMIN}?view=pages&edit=`,
  };
  const globals = `window.__VISUAL_PAGE=${jsonForScript(id)};window.__VISUAL_ADMIN=${jsonForScript(info)};window.__VISUAL_PAGES=${jsonForScript(await pageList(env))};`
    + `window.__VISUAL_CSRF=${jsonForScript(csrf)};window.__VISUAL_DOC=${jsonForScript(isDoc(row.data))};window.__VISUAL_T=${jsonForScript(jsStrings(lang))};`;
  const v = encodeURIComponent(CLOUD_VERSION);
  const tags = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=block">'
    + `<link rel="stylesheet" href="/mikanbox/visual.css?v=${v}">`
    + `<script nonce="${n}">${globals}</script><script nonce="${n}" src="/mikanbox/visual.js?v=${v}"></script>`;
  const at = html.search(/<\/body>/i);
  return new Response(at >= 0 ? html.slice(0, at) + tags + html.slice(at) : html + tags, { headers: h });
}
