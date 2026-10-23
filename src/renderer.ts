// ==========================================
// mikanBox Renderer (renderer.php の移植)
// ==========================================
// PHP版のMikanBoxRendererクラスをasync/awaitベースに変換

import type { Env, PageData, ComponentData, Settings } from './types';
import { MikanBoxMarkdown } from './markdown';
import { scopeCss } from './cssScope';
import { createTranslator } from './i18n';
import {
  loadPage, loadComponent, getSortedPageIds, isPublicStatus, listPages,
} from './storage';

function resolveMediaPath(url: string): string {
  if (!url) return '';
  if (url.startsWith('images/')) return 'media/' + url.slice(7);
  if (/^(?:https?:\/\/|\/|media\/)/.test(url)) return url;
  return 'media/' + url;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class MikanBoxRenderer {
  private env: Env;
  private siteSettings: Settings;
  private markdown: MikanBoxMarkdown;
  private globalCssBuffer: string[] = [];
  private javascriptBuffer = new Map<string, string>();
  private includedComponentIds = new Set<string>();
  private excludeTracking = false;
  private expansionCount = 0;
  private currentPageId = '';
  private currentPageData: Record<string, string> = {};
  private request: Request;
  private navigationPages?:Promise<Array<{id:string,data:PageData}>>;
  private snapshot?:{pages:Array<{id:string,data:PageData}>,components:Array<{id:string,data:ComponentData}>};
  private componentCache=new Map<string,Promise<ComponentData|null>>();
  private publicPages() {return this.navigationPages??=Promise.resolve(this.snapshot?.pages||listPages(this.env)).then(pages=>pages.filter(p=>isPublicStatus(p.data.status)));}
  private readPage(id:string) {return this.snapshot?Promise.resolve(this.snapshot.pages.find(p=>p.id===id)?.data||this.snapshot.pages.find(p=>p.id===id+'/index')?.data||null):loadPage(this.env,id);}
  private readComponent(id:string) {
    if(!this.componentCache.has(id))this.componentCache.set(id,this.snapshot?Promise.resolve(this.snapshot.components.find(c=>c.id===id)?.data||null):loadComponent(this.env,id));
    return this.componentCache.get(id)!;
  }

  constructor(env: Env, settings: Settings, request: Request, snapshot?:{pages:Array<{id:string,data:PageData}>,components:Array<{id:string,data:ComponentData}>}) {
    this.env = env;
    this.siteSettings = {
      site_name: 'mikanBox',
      description: '',
      keywords: '',
      ogp_image: '',
      ssg_root_url: '',
      ...settings,
    };
    this.markdown = new MikanBoxMarkdown();
    this.request = request;
    this.snapshot=snapshot;
  }

  getSiteUrl(): string {
    const ssgRootUrl = (this.siteSettings.ssg_root_url || '').trim().replace(/\/$/, '');
    if (ssgRootUrl) return ssgRootUrl;
    const url = new URL(this.request.url);
    return url.protocol + '//' + url.host;
  }

  // Workers は常にルートにデプロイされるため basePath = '/'
  private getSiteBasePath(): string {
    const rootUrl = (this.siteSettings.ssg_root_url || '').trim();
    if (rootUrl) {
      try {
        const path = new URL(rootUrl).pathname;
        if (path && path !== '/') return path.replace(/\/?$/, '/');
      } catch {}
    }
    return '/';
  }

  private buildFullUrl(siteUrl: string, absLink: string): string {
    const base = this.getSiteBasePath().replace(/\/$/, '');
    if (base && base !== '/' && absLink.startsWith(base)) {
      absLink = absLink.slice(base.length);
    }
    return siteUrl.replace(/\/$/, '') + absLink;
  }

  getPageLink(postId: string): string {
    const root = this.getSiteBasePath();
    const id = postId === 'index' ? '' : postId;
    return id === '' ? root : root + id + '/';
  }

  private resolveAbsoluteUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//.test(url)) return url;
    return this.getSiteUrl().replace(/\/$/, '') + '/' + url.replace(/^\//, '');
  }

  // ---- Public API: DATA/DATAROWブロックをJSON構造で返す ----
  async getPageDataBlocks(pageId: string): Promise<object | null> {
    const postData = await this.readPage( pageId);
    if (!postData) return null;
    const blocks: Record<string, string> = {};
    this.extractDataBlocks(postData.content_md || '', blocks);
    const rows: Record<string, Record<string, string>> = {};
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(blocks)) {
      const m = key.match(/^#([^:]+):(.+)$/);
      if (m) {
        if (!rows[m[1]]) rows[m[1]] = {};
        rows[m[1]][m[2]] = value;
      } else {
        fields[key] = value;
      }
    }
    const rowList = Object.entries(rows).map(([id, data]) => ({ id, ...data }));
    return { id: pageId, title: postData.title || '', fields, rows: rowList };
  }

  // ---- Main render ----
  async render(pageId: string, allowPrivate = false): Promise<{ html: string; status: number }> {
    this.currentPageId = pageId;
    this.globalCssBuffer = [];
    this.javascriptBuffer.clear();
    this.includedComponentIds.clear();
    this.expansionCount = 0;
    this.currentPageData = {};

    let pageData = await this.readPage( pageId);
    let responseStatus = 200;

    if (!pageData) {
      responseStatus = 404;
      pageData = await this.readPage( '404') || {
        title: '404 Not Found',
        content_md: '# 404 Not Found\nページが見つかりませんでした。',
        wrapper_comp: '_layout',
        status: 'public',
      };
    }

    // 非公開ページはプライベートコメントを返す
    const preview = new URL(this.request.url).searchParams.get('preview');
    const tokenPreview = pageData.status === 'pending' && !!pageData.preview_token && preview === pageData.preview_token;
    if (!isPublicStatus(pageData.status) && !allowPrivate && !tokenPreview) {
      return { html: '<h1>404 Not Found</h1>', status: 404 };
    }

    // メタ情報
    const pageTitle = pageData.title
      ? pageData.title + ' - ' + (this.siteSettings.site_name || 'mikanBox')
      : (this.siteSettings.site_name || 'mikanBox');
    const pageDesc = pageData.description || this.siteSettings.description || '';
    const pageKeywords = pageData.keywords || this.siteSettings.keywords || '';
    const ogpImage = pageData.ogp_image || this.siteSettings.ogp_image || '';

    // 1. コードブロックを保護してDATAブロックを抽出、Markdownを変換
    let contentMd = pageData.content_md || '';
    const codeMap: Record<string, string> = {};
    contentMd = this.protectCodeSpans(contentMd, codeMap);
    contentMd = this.extractDataBlocks(contentMd, this.currentPageData);
    contentMd = this.restoreCodeSpans(contentMd, codeMap);

    let contentHtml: string;
    if (pageData.is_html || /^\s*<!DOCTYPE/i.test(contentMd)) {
      contentHtml = contentMd;
    } else {
      // テンプレートタグをbase64エンコードして保護
      const protectedMd = contentMd.replace(/\{\{[^}]+\}\}/g, (m) =>
        '<!--MKNTG' + btoa(unescape(encodeURIComponent(m))) + '-->'
      );
      contentHtml = this.markdown.text(protectedMd);
      contentHtml = contentHtml.replace(/<!--MKNTG([a-zA-Z0-9+/=]+)-->/g, (_, b64) => {
        try { return decodeURIComponent(escape(atob(b64))); } catch { return ''; }
      });
    }

    this.excludeTracking = !!pageData.exclude_tracking;

    // 2. ラッパーを読み込んで{{CONTENT}}を差し込む
    const wrapperCompId = pageData.wrapper_comp || '_layout';
    const wrapperData = wrapperCompId === '__none' ? null : (await this.readComponent(wrapperCompId) || await this.readComponent('_layout'));
    if (wrapperData) this.includedComponentIds.add(wrapperCompId);
    let html = wrapperData?.html ?? (wrapperCompId === '__none' ? '{{CONTENT}}' : '<!DOCTYPE html><html><head>{{HEAD_CSS}}{{HEAD_JS}}</head><body>{{CONTENT}}</body></html>');
    if (wrapperData?.js) this.javascriptBuffer.set(wrapperCompId, wrapperData.js);

    let scopedContent = pageData.css ? `<div class="mikan-content-scope">${contentHtml}</div>` : contentHtml;
    if (pageData.css) {
      let bodyScoped = false;
      const scopedDocument = contentHtml.replace(/<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<body\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
        if (bodyScoped || !/^<body\b/i.test(tag)) return tag;
        bodyScoped = true;
        let attrs = tag.slice(5, -1);
        const classPattern = /(^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
        attrs = classPattern.test(attrs) ? attrs.replace(classPattern, (_,space,a,b,c) => space + 'class="' + (a ?? b ?? c ?? '').replace(/"/g,'&quot;') + ' mikan-content-scope"') : attrs + ' class="mikan-content-scope"';
        return '<body' + attrs + '>';
      });
      if (bodyScoped) scopedContent = scopedDocument;
    }
    html = html.replace('{{CONTENT}}', () => scopedContent);

    // ラッパーCSS
    if (wrapperData?.css) {
      if (wrapperData.is_global || wrapperCompId === '_layout') {
        this.globalCssBuffer.push(`/* Wrapper (Global): ${wrapperCompId} */\n${wrapperData.css}`);
      } else {
        const prefixClass = `cmp-${wrapperCompId}`;
        this.globalCssBuffer.push(
          `/* Wrapper: ${wrapperCompId} */\n${scopeCss(wrapperData.css, '.' + prefixClass)}`
        );
      }
    }

    // 3. ページ専用CSS
    if (pageData.css) {
      this.globalCssBuffer.push(`/* Page CSS */\n${scopeCss(pageData.css,'.mikan-content-scope')}`);
    }

    const comments: string[] = [];
    html = html.replace(/<!--(?!MKNTG)[\s\S]*?-->/g, comment => { const index=comments.push(comment)-1; return `\x04COMMENT${index}\x04`; });

    // 4. コンポーネントを再帰的に展開
    html = await this.parseComponents(html);

    const trackingId = String(this.siteSettings.tracking_component || '');
    const tracking = trackingId ? await this.readComponent(trackingId) : null;
    let trackingHtml = '';
    const trackingMarker = '\x02TRACKING\x03';
    if (!this.excludeTracking && tracking && !tracking.is_ai_doc && !tracking.is_wrapper && !this.includedComponentIds.has(trackingId)) {
      trackingHtml = await this.parseComponents('{{COMPONENT:' + trackingId + '}}');
      html += trackingMarker + trackingHtml;
    }

    // 5. 基本タグを展開
    html = this.replaceBasicTags(html, pageData, pageTitle, pageDesc, pageKeywords, ogpImage);

    // 6. ナビゲーション・特殊タグを展開
    html = await this.replaceSpecialTags(html);

    // 7. パス補完
    html = await this.applyPathCompletion(html);

    // 7.5 コードブロック内のエスケープされたプレースホルダーを復元
    html = html.replace(/&lt;!--MKNTG([a-zA-Z0-9+/=]+)--&gt;/g, (_, b64) => {
      try { return escapeHtml(decodeURIComponent(escape(atob(b64)))); } catch { return ''; }
    });

    const trackingOffset = html.indexOf(trackingMarker);
    trackingHtml = trackingOffset >= 0 ? html.slice(trackingOffset + trackingMarker.length) : '';
    if (trackingOffset >= 0) html = html.slice(0, trackingOffset);
    html = html.replace(/\x04COMMENT(\d+)\x04/g,(_,index)=>comments[Number(index)] || '');
    html = this.completeHead(html, pageTitle, pageDesc, this.resolveAbsoluteUrl(resolveMediaPath(ogpImage)), trackingHtml);

    // 8. CSSバッファを処理してHEAD_CSSに差し込む
    const processedCss = this.globalCssBuffer.map(cssLine => {
      cssLine = this.replaceBasicTags(cssLine, pageData!, pageTitle, pageDesc, pageKeywords, ogpImage);
      cssLine = cssLine.replace(/images\//g, this.getSiteBasePath() + 'media/');
      return cssLine;
    });

    const uniqueCss = [...new Set(processedCss)];
    const cssTag = `<style>\n${uniqueCss.join('\n')}\n</style>`;
    html = this.embedCss(html, cssTag, uniqueCss.length > 0);

    if (pageData.js) this.javascriptBuffer.set('page:'+pageId, pageData.js);
    const jsTags = [...this.javascriptBuffer.values()].map(js=>`<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`).join('\n');
    if (/\{\{\s*HEAD_JS\s*\}\}/i.test(html)) html=html.replace(/\{\{\s*HEAD_JS\s*\}\}/gi,()=>jsTags);
    else if (jsTags) html=html.includes('</body>')?html.replace('</body>',jsTags+'</body>'):html+jsTags;
    const origin=new URL(this.request.url).origin;
    const aiScript=`<script src="/mikanbox/ai-question.js" data-mcp-endpoint="/public-mcp" data-public-mcp="${escapeHtml(origin)}/public-mcp" data-help-ja="${escapeHtml(origin)}/public-help.html?language=ja" data-help-en="${escapeHtml(origin)}/public-help.html?language=en" defer></script>`;
    html=html.includes('</body>')?html.replace('</body>',()=>aiScript+'</body>'):html+aiScript;
    html = html.replace(/\x04COMMENT(\d+)\x04/g,(_,index)=>comments[Number(index)] || '');
    return { html, status: responseStatus };
  }

  private completeHead(html: string, title: string, description: string, image: string, tracking: string): string {
    const pattern = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const tokens = [...html.matchAll(pattern)];
    let start: number | undefined, end: number | undefined, htmlStart: number | undefined;
    for (const token of tokens) {
      if (/^<html\b/i.test(token[0])) htmlStart = token.index! + token[0].length;
      if (start === undefined && /^<head\b/i.test(token[0])) start = token.index! + token[0].length;
      if (start !== undefined && /^<\/head\s*>/i.test(token[0])) { end = token.index!; break; }
    }
    if (start === undefined) {
      html = htmlStart !== undefined ? html.slice(0, htmlStart) + '<head></head>' + html.slice(htmlStart)
        : '<!DOCTYPE html><html><head></head><body>' + html + '</body></html>';
      return this.completeHead(html, title, description, image, tracking);
    }
    if (end === undefined) {
      end = tokens.find(t => t.index! >= start! && /^<body\b/i.test(t[0]))?.index ?? html.length;
      html = html.slice(0, end) + '</head>' + html.slice(end);
    }
    let head = html.slice(start, end);
    const present = new Set<string>(); let charsetEnd = 0;
    for (const token of head.matchAll(pattern)) {
      if (/^<title\b/i.test(token[0])) present.add('title');
      if (!/^<meta\b/i.test(token[0])) continue;
      const attrs: Record<string,string> = {};
      for (const a of token[0].matchAll(/([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? '').toLowerCase();
      if ('charset' in attrs || attrs['http-equiv'] === 'content-type') { present.add('charset'); charsetEnd = token.index! + token[0].length; }
      if (attrs.name) present.add(attrs.name);
      if (attrs.property) present.add(attrs.property);
    }
    let prefix = present.has('charset') ? '' : '<meta charset="UTF-8">';
    if (!present.has('viewport')) prefix += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    if (!present.has('title')) prefix += '<title>' + escapeHtml(title) + '</title>';
    if (!present.has('description') && description) prefix += '<meta name="description" content="' + escapeHtml(description) + '">';
    if (!present.has('og:image') && image) prefix += '<meta property="og:image" content="' + escapeHtml(image) + '">';
    head = head.slice(0, charsetEnd) + prefix + tracking + head.slice(charsetEnd);
    return html.slice(0, start) + head + html.slice(end);
  }

  private embedCss(html: string, cssTag: string, hasCss: boolean): string {
    // Comments and raw-text elements contain examples/code, not insertion points.
    let inserted = false;
    html = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|\{\{\s*HEAD_CSS\s*\}\}/gi, match => {
      if (!match.startsWith('{{')) return match;
      if (inserted) return '';
      inserted = true;
      return cssTag;
    });
    if (inserted || !hasCss) return html;
    const pattern = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|(?<head><\/head\s*>)/gi;
    for (const match of html.matchAll(pattern)) {
      if (match.groups?.head) {
        const offset = match.index!;
        return html.slice(0, offset) + cssTag + html.slice(offset);
      }
    }
    return cssTag + html;
  }

  // ---- parseComponents (再帰的・非同期) ----
  private async parseComponents(content: string, visited: string[] = []): Promise<string> {
    if (visited.length > 32 || ++this.expansionCount > 1000 || content.length > 2000000) return '<!-- Component expansion limit -->';
    const regex = /\{\{COMPONENT:([a-zA-Z0-9_\-]+(?:\.md)?)\}\}/g;
    const parts: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      parts.push(content.slice(lastIndex, match.index));
      const compId = match[1];
      if (this.excludeTracking && compId === this.siteSettings.tracking_component) { lastIndex = match.index + match[0].length; continue; }

      if (visited.includes(compId)) {
        parts.push(`<!-- Infinite loop detected: Component '${compId}' includes itself -->`);
      } else {
        const compData = await this.readComponent( compId);
        if (compData && !compData.is_ai_doc) this.includedComponentIds.add(compId);
        if (!compData || compData.is_ai_doc) {
          parts.push(`<!-- Component '${compId}' not found -->`);
        } else {
          if (compData.js) this.javascriptBuffer.set(compId,compData.js);
          let compHtml = compData.html || '';
          const compCss = compData.css || '';
          const isGlobal = !!compData.is_global;

          if (compCss) {
            if (isGlobal) {
              this.globalCssBuffer.push(`/* Component (Global): ${compId} */\n${compCss}`);
            } else {
              const prefixClass = `cmp-${compId}`;
              this.globalCssBuffer.push(
                `/* Component: ${compId} */\n${scopeCss(compCss, '.' + prefixClass)}`
              );
              compHtml = `<div class="${prefixClass}">${compHtml}</div>`;
            }
          }

          const expanded = await this.parseComponents(compHtml, [...visited, compId]);
          parts.push(expanded);
        }
      }

      lastIndex = regex.lastIndex;
    }

    parts.push(content.slice(lastIndex));
    return parts.join('');
  }

  // ---- replaceBasicTags ----
  private replaceBasicTags(
    text: string,
    pageData: PageData,
    pageTitle: string,
    pageDesc: string,
    pageKeywords: string,
    ogpImage: string
  ): string {
    const siteUrl = this.getSiteUrl();
    const id = this.currentPageId;
    const rootLink = this.getPageLink(id);
    const pageFullUrl = this.buildFullUrl(siteUrl, rootLink);

    const replacements: Array<[RegExp, string]> = [
      [/\{\{\s*SITE_NAME\s*\}\}/gi,        escapeHtml(this.siteSettings.site_name || '')],
      [/\{\{\s*SITE_DESCRIPTION\s*\}\}/gi, escapeHtml(this.siteSettings.description || '')],
      [/\{\{\s*SITE_KEYWORDS\s*\}\}/gi,    escapeHtml(this.siteSettings.keywords || '')],
      [/\{\{\s*SITE_OGP_IMAGE\s*\}\}/gi,   this.resolveAbsoluteUrl(resolveMediaPath(this.siteSettings.ogp_image || ''))],
      [/\{\{\s*PAGE_TITLE\s*\}\}/gi,       escapeHtml(pageData.title || '')],
      [/\{\{\s*PAGE_DESCRIPTION\s*\}\}/gi, escapeHtml(pageData.description || '')],
      [/\{\{\s*PAGE_KEYWORDS\s*\}\}/gi,    escapeHtml(pageData.keywords || '')],
      [/\{\{\s*PAGE_OGP_IMAGE\s*\}\}/gi,   this.resolveAbsoluteUrl(resolveMediaPath(pageData.ogp_image || ''))],
      [/\{\{\s*TITLE\s*\}\}/gi,            escapeHtml(pageData.title || (this.siteSettings.site_name || ''))],
      [/\{\{\s*DESCRIPTION\s*\}\}/gi,      escapeHtml(pageDesc)],
      [/\{\{\s*OGP_IMAGE\s*\}\}/gi,        this.resolveAbsoluteUrl(resolveMediaPath(ogpImage))],
      [/\{\{\s*FULL_TITLE\s*\}\}/gi,       escapeHtml(pageTitle)],
      [/\{\{\s*KEYWORDS\s*\}\}/gi,         escapeHtml(pageKeywords)],
      [/\{\{\s*SITE_URL\s*\}\}/gi,         siteUrl],
      [/\{\{\s*BASE_URL\s*\}\}/gi,         siteUrl],
      [/\{\{\s*PAGE_URL\s*\}\}/gi,         pageFullUrl],
      [/\{\{\s*UPDATE_DATE\s*\}\}/gi,      (pageData.updated_at || new Date().toISOString()).slice(0, 10)],
    ];

    for (const [pattern, replacement] of replacements) {
      text = text.replace(pattern, replacement);
    }

    // UPDATE_DATE:JP / UPDATE_DATE:SLASH
    const rawDate = pageData.updated_at || new Date().toISOString();
    text = text.replace(/\{\{\s*UPDATE_DATE:([A-Z]+)\s*\}\}/gi, (_, fmt) => this.formatDate(rawDate, fmt));

    // IS_NEW:N
    text = text.replace(/\{\{\s*IS_NEW:(\d+)\s*\}\}/gi, (_, days) =>
      this.isNew(rawDate, parseInt(days, 10)) ? 'new' : ''
    );

    return text;
  }

  private formatDate(dateStr: string, format: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    if (format === 'JP') {
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }
    if (format === 'SLASH') {
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    return d.toISOString().slice(0, 10);
  }

  private isNew(dateStr: string, days: number): boolean {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) < days * 86400 * 1000;
  }

  // ---- replaceSpecialTags (非同期) ----
  private async replaceSpecialTags(html: string): Promise<string> {
    html=html.replace(/\{\{\s*AI_QUESTION\s*(?::\s*([A-Za-z0-9_-]+)\s*)?\}\}/g,(_,section)=>`<div data-mikanbox-ai-question data-section="${escapeHtml(section||'')}" data-context="${escapeHtml(this.currentPageId)}"></div>`);
    const searchResults=new Map<string,string>();
    for(const tag of html.matchAll(/\{\{\s*SEARCH_RESULTS\s*(?::\s*([A-Za-z0-9_-]+)\s*)?\}\}/g)) {
      const id=tag[1]||'_search_result_item';
      if(!searchResults.has(id)) searchResults.set(id,await this.generateSearchResults(id));
    }
    // NAV_LINKS / NAV_CARDS
    const navMatches = [...html.matchAll(/\{\{\s*(NAV_LINKS|NAV_CARDS)\s*(?::\s*([^:}\s]*)\s*)?(?::\s*([a-zA-Z0-9_\-]+)\s*)?\}\}/gu)];
    for (const m of navMatches) {
      const tagType = m[1].trim();
      const category = (m[2] || '').trim();
      const compId = (m[3] || '').trim();
      let replacement: string;
      if (tagType === 'NAV_LINKS') {
        replacement = await this.generateNavLinks(category);
      } else {
        replacement = await this.generateNavCards(category, compId);
      }
      html = html.replace(m[0], () => replacement);
    }

    const searchTags=[...html.matchAll(/\{\{\s*SEARCH_RESULTS\s*(?::\s*([A-Za-z0-9_-]+)\s*)?\}\}/g)];
    for(const tag of searchTags) html=html.replace(tag[0],()=>searchResults.get(tag[1]||'_search_result_item')||'');

    // メディアタグ
    const mediaBase = this.getSiteUrl().replace(/\/$/, '') + '/media/';
    html = html.replace(/\{\{VIDEO:([a-zA-Z0-9_\-\.]+)\}\}/g,
      `<video src="${mediaBase}$1" controls style="max-width:100%; height:auto;"></video>`);
    html = html.replace(/\{\{IMAGE:([a-zA-Z0-9_\-\.]+)\}\}/g,
      `<img src="${mediaBase}$1" style="max-width:100%; height:auto;">`);
    html = html.replace(/\{\{AUDIO:([a-zA-Z0-9_\-\.]+)\}\}/g,
      `<audio src="${mediaBase}$1" controls style="width:100%; margin:10px 0;"></audio>`);

    // External Markdown is disabled until an explicit fetch/sanitization policy is implemented.
    html = html.replace(/\{\{EXT_MD:[^}]+\}\}/g, '<!-- External Markdown is not yet supported -->');

    // POST_MD:pageID#rowID:KEY
    const postRowMatches = [...html.matchAll(/\{\{POST_MD:([a-zA-Z0-9_\-/]+)#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)];
    for (const m of postRowMatches) {
      const postData = await this.readPage( m[1]);
      let replacement = '';
      if (postData?.content_md && (isPublicStatus(postData.status) || postData.status === 'db')) {
        const db: Record<string, string> = {};
        this.extractDataBlocks(postData.content_md, db);
        replacement = db[`#${m[2]}:${m[3]}`] || '';
      }
      html = html.replace(m[0], () => replacement);
    }

    // POST_MD::#rowID:KEY (自ページ)
    const selfRowMatches = [...html.matchAll(/\{\{POST_MD::#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)];
    for (const m of selfRowMatches) {
      html = html.replace(m[0], this.currentPageData[`#${m[1]}:${m[2]}`] || '');
    }

    // POST_MD:ID:KEY または POST_MD::KEY
    const postFieldMatches = [...html.matchAll(/\{\{POST_MD:([a-zA-Z0-9_\-/]*):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)];
    for (const m of postFieldMatches) {
      const postId = m[1], key = m[2];
      let replacement = '';
      if (!postId) {
        replacement = this.currentPageData[key] || '';
      } else {
        const postData = await this.readPage( postId);
        if (postData?.content_md && (isPublicStatus(postData.status) || postData.status === 'db')) {
          const db: Record<string, string> = {};
          this.extractDataBlocks(postData.content_md, db);
          replacement = db[key] || '';
        }
      }
      html = html.replace(m[0], () => replacement);
    }

    // POST_MD:ID (フルレンダリング)
    const postFullMatches = [...html.matchAll(/\{\{POST_MD:([a-zA-Z0-9_\-/]+)\}\}/g)];
    for (const m of postFullMatches) {
      const postId = m[1];
      const postData = await this.readPage( postId);
      let replacement = `<!-- Error: Post not found ${postId} -->`;
      if (postData?.content_md && (isPublicStatus(postData.status) || postData.status === 'db')) {
        const savedId = this.currentPageId;
        const savedData = { ...this.currentPageData };
        this.currentPageId = postId;
        this.currentPageData = {};
        let content = postData.content_md;
        const cm: Record<string, string> = {};
        content = this.protectCodeSpans(content, cm);
        content = this.extractDataBlocks(content, this.currentPageData);
        content = this.restoreCodeSpans(content, cm);
        const protected2 = content.replace(/\{\{[^}]+\}\}/g, (tag) =>
          '<!--MKNTG' + btoa(unescape(encodeURIComponent(tag))) + '-->'
        );
        let embedded = this.markdown.text(protected2);
        embedded = embedded.replace(/<!--MKNTG([a-zA-Z0-9+/=]+)-->/g, (_, b64) => {
          try { return decodeURIComponent(escape(atob(b64))); } catch { return ''; }
        });
        const postTitle = postData.title
          ? postData.title + ' - ' + (this.siteSettings.site_name || '')
          : (this.siteSettings.site_name || '');
        embedded = this.replaceBasicTags(
          embedded, postData, postTitle,
          postData.description || this.siteSettings.description || '',
          postData.keywords || this.siteSettings.keywords || '',
          postData.ogp_image || this.siteSettings.ogp_image || ''
        );
        replacement = embedded;
        this.currentPageId = savedId;
        this.currentPageData = savedData;
      }
      html = html.replace(m[0], () => replacement);
    }

    return html;
  }

  // ---- sanitizeExternalContent ----
  private sanitizeExternalContent(content: string): string {
    content = content.replace(/<script\b[^>]*>.*?<\/script>/gis, '');
    content = content.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    content = content.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
    return content;
  }

  // ---- extractDataBlocks ----
  extractDataBlocks(content: string, dataBlocks: Record<string, string>): string {
    // {{DATAROW:id}}...{{/DATAROW}}
    content = content.replace(
      /\{\{DATAROW:([a-zA-Z0-9_\-]+)\}\}(.*?)\{\{\/DATAROW\}\}/gs,
      (_, rowId, inner) => {
        // GHOST fields
        inner.replace(
          /\{\{DATA:([a-zA-Z][a-zA-Z0-9_]*):GHOST\}\}(.*?)\{\{\/DATA\}\}/gs,
          (_m: string, k: string, v: string) => { dataBlocks[`#${rowId}:${k}`] = v.trim(); return ''; }
        );
        // Visible fields
        inner.replace(
          /\{\{DATA:([a-zA-Z][a-zA-Z0-9_]*)\}\}(.*?)\{\{\/DATA\}\}/gs,
          (_m: string, k: string, v: string) => { dataBlocks[`#${rowId}:${k}`] = v.trim(); return ''; }
        );
        return '';
      }
    );
    // {{DATA:KEY:GHOST}}
    content = content.replace(
      /\{\{DATA:([a-zA-Z][a-zA-Z0-9_]*):GHOST\}\}(.*?)\{\{\/DATA\}\}/gs,
      (_, k, v) => { dataBlocks[k] = v.trim(); return ''; }
    );
    // {{DATA:KEY}} visible
    content = content.replace(
      /\{\{DATA:([a-zA-Z][a-zA-Z0-9_]*)\}\}(.*?)\{\{\/DATA\}\}/gs,
      (_, k, v) => { dataBlocks[k] = v.trim(); return v; }
    );
    return content;
  }

  // ---- applyPathCompletion ----
  private async applyPathCompletion(html: string): Promise<string> {
    const allPosts = this.snapshot ? this.snapshot.pages.map(p=>p.id) : await getSortedPageIds(this.env);
    const siteUrl = this.getSiteUrl();

    // Explicit media URLs are rooted at the site even on nested pages.
    html = html.replace(/(<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*)(["'])(?:\.\/)?media\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css)(?:[?#][^"']*)?)\2/gi,
      (_match,prefix,quote,path)=>`${prefix}${quote}${siteUrl.replace(/\/$/,'')}/media/${path}${quote}`);

    // 内部リンクを絶対URLに書き換え
    html = html.replace(/href=["'](\.?\/?)([ ^"']+)["']/gi, (match, prefix, url) => {
      if (/^(?:https?:\/\/|#|mailto:|\/)/i.test(url) || prefix === '/') return match;
      let checkId = url;
      if (checkId.toLowerCase().endsWith('.html')) checkId = checkId.slice(0, -5);
      checkId = checkId.replace(/^\/|\/$/g, '');
      const found = allPosts.find(pid => pid.toLowerCase() === checkId.toLowerCase());
      if (found) {
        return `href="${this.buildFullUrl(siteUrl, this.getPageLink(found))}"`;
      }
      if (/^[a-z0-9_\-/]+$/i.test(checkId)) {
        return `href="${this.buildFullUrl(siteUrl, this.getPageLink(checkId))}"`;
      }
      return match;
    });

    // ホームリンク "./" をサイトベースURLに
    html = html.replace(/href=["']\.\//g, `href="${siteUrl}"`);

    // メディアパスを絶対URLに
    const mediaBase = siteUrl.replace(/\/$/, '') + '/media/';
    html = html.replace(
      /<(img|video|audio|source)\b([^>]*)\bsrc=["']([^"'\s>]+)["']/gi,
      (m, tag, attrs, src) => {
        if (/^(?:https?:\/\/|data:)/i.test(src)) return m;
        const filename = src.split('/').pop() || src;
        return `<${tag}${attrs}src="${mediaBase}${filename}"`;
      }
    );

    return html;
  }

  private async generateSearchResults(componentId: string): Promise<string> {
    const t=createTranslator(this.siteSettings.system_lang==='en'?'en':'ja');
    const keyword=(new URL(this.request.url).searchParams.get('q')||'').trim().slice(0,200);
    if(!keyword)return `<p class="search-no-query">${escapeHtml(t('search_no_query'))}</p>`;
    const term=keyword.toLocaleLowerCase();
    const matches:Array<{id:string;page:PageData;text:string}>=[];
    for(const {id,data:page} of await this.publicPages()) {
      if(!page||!isPublicStatus(page.status)||id===this.currentPageId)continue;
      const text=(page.content_md||'').replace(/<[^>]*>/g,' ').replace(/\{\{[^}]+\}\}/g,' ').replace(/\s+/g,' ').trim();
      if(`${page.title} ${text}`.toLocaleLowerCase().includes(term)) matches.push({id,page,text});
    }
    if(!matches.length)return `<p class="search-no-results">${escapeHtml(t('search_no_results',keyword))}</p>`;
    const component=await this.readComponent(componentId);
    const usable=component&&!component.is_ai_doc?component:null;
    const template=usable?.html||'<article><h3><a href="{{RESULT_URL}}">{{RESULT_TITLE}}</a></h3><p>{{RESULT_SNIPPET}}</p><time>{{RESULT_DATE}}</time></article>';
    const prefix=`cmp-${componentId}`;
    if(usable?.css)this.globalCssBuffer.push(usable.is_global?usable.css:scopeCss(usable.css,'.'+prefix));
    if(usable?.js)this.javascriptBuffer.set(componentId,usable.js);
    const highlight=(text:string)=>{
      const index=text.toLocaleLowerCase().indexOf(term);
      return index<0?escapeHtml(text):escapeHtml(text.slice(0,index))+'<strong class="search-highlight">'+escapeHtml(text.slice(index,index+keyword.length))+'</strong>'+escapeHtml(text.slice(index+keyword.length));
    };
    const items=matches.map(({id,page,text})=>{
      const index=text.toLocaleLowerCase().indexOf(term),start=Math.max(0,index-60);
      const snippet=(start?'…':'')+text.slice(start,start+180)+(text.length>start+180?'…':'');
      const fields:Record<string,string>={RESULT_TITLE:highlight(page.title||id),RESULT_SNIPPET:highlight(snippet),RESULT_URL:escapeHtml(this.buildFullUrl(this.getSiteUrl(),this.getPageLink(id))+'#:~:text='+encodeURIComponent(keyword)),RESULT_DATE:escapeHtml((page.updated_at||'').slice(0,10))};
      return template.replace(/\{\{(RESULT_TITLE|RESULT_SNIPPET|RESULT_URL|RESULT_DATE)\}\}/g,(_,key)=>fields[key]);
    }).join('');
    return `<div class="search-results-list ${usable?.css&&!usable.is_global?prefix:''}">${items}</div>`;
  }

  // ---- generateNavLinks ----
  private async generateNavLinks(targetCategory: string): Promise<string> {
    const postsList = await this.publicPages();
    let html = '<ul class="nav-links">';

    for (const {id:postId,data:postInfo} of postsList) {
      if (!postInfo) continue;
      if (!isPublicStatus(postInfo.status)) continue;
      if ((postInfo.sort_order ?? 0) < 0) continue;

      const cats = (postInfo.category || '').split(',').map(s => s.trim()).filter(Boolean);

      if (targetCategory !== '') {
        if (targetCategory !== 'all' && !cats.includes(targetCategory)) continue;
      } else if (cats.length > 0) continue;

      const title = escapeHtml(postInfo.title || postId);
      const activeClass = this.currentPageId === postId ? ' class="active"' : '';
      const link = this.buildFullUrl(this.getSiteUrl(), this.getPageLink(postId));
      html += `<li${activeClass}><a href="${link}">${title}</a></li>`;
    }

    html += '</ul>';
    return html;
  }

  // ---- generateNavCards ----
  private async generateNavCards(targetCategory: string, templateCompId: string): Promise<string> {
    const postsList = await this.publicPages();
    const effectiveCompId = templateCompId || '_nav_card';
    const compData = await this.readComponent( effectiveCompId);
    let customTemplate: string | null = null;
    let prefixClass = '';

    if (compData) {
      customTemplate = compData.html || '';
      const compCss = compData.css || '';
      if (compCss) {
        if (compData.is_global) {
          this.globalCssBuffer.push(`/* Nav Card (Global): ${effectiveCompId} */\n${compCss}`);
        } else {
          prefixClass = `cmp-${effectiveCompId}`;
          this.globalCssBuffer.push(
            `/* Nav Card: ${effectiveCompId} */\n${scopeCss(compCss, '.' + prefixClass)}`
          );
        }
      }
    }

    let innerHtml = '';

    for (const {id:postId,data:postInfo} of postsList) {
      if (!postInfo) continue;
      if (!isPublicStatus(postInfo.status)) continue;
      if ((postInfo.sort_order ?? 0) < 0) continue;

      const cats = (postInfo.category || '').split(',').map(s => s.trim()).filter(Boolean);

      if (targetCategory !== '') {
        if (targetCategory !== 'all' && !cats.includes(targetCategory)) continue;
      } else if (cats.length > 0) continue;

      const title = escapeHtml(postInfo.title || postId);
      const desc = escapeHtml(postInfo.description || '');
      let rawImg = resolveMediaPath(postInfo.ogp_image || '');
      if (rawImg && !/^(?:https?:\/\/|data:)/.test(rawImg)) {
        rawImg = this.getSiteUrl().replace(/\/$/, '') + '/' + rawImg.replace(/^\//, '');
      }
      if (!rawImg) {
        rawImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='210'%3E%3Crect width='400' height='210' fill='%23e0e0e0'/%3E%3C/svg%3E";
      }
      const img = escapeHtml(rawImg);
      const link = this.buildFullUrl(this.getSiteUrl(), this.getPageLink(postId));
      const updateDate = (postInfo.updated_at || new Date().toISOString()).slice(0, 10);
      const isActive = this.currentPageId === postId ? 'active' : '';

      if (customTemplate) {
        let itemHtml = customTemplate
          .replace(/\{\{TITLE\}\}/g, title)
          .replace(/\{\{DESCRIPTION\}\}/g, desc)
          .replace(/\{\{LINK\}\}/g, link)
          .replace(/\{\{OGP_IMAGE\}\}/g, img)
          .replace(/\{\{PAGE_URL\}\}/g, link)
          .replace(/\{\{UPDATE_DATE\}\}/g, updateDate)
          .replace(/\{\{IS_ACTIVE\}\}/g, isActive);

        const rawDate = postInfo.updated_at || new Date().toISOString();
        itemHtml = itemHtml.replace(/\{\{UPDATE_DATE:([A-Z]+)\}\}/g, (_, fmt) => this.formatDate(rawDate, fmt));
        itemHtml = itemHtml.replace(/\{\{IS_NEW:(\d+)\}\}/g, (_, d) =>
          this.isNew(rawDate, parseInt(d, 10)) ? 'new' : ''
        );

        // POST_MD:: タグを展開
        if (postInfo.content_md) {
          const cardDataBlocks: Record<string, string> = {};
          this.extractDataBlocks(postInfo.content_md, cardDataBlocks);
          itemHtml = itemHtml.replace(/\{\{POST_MD::#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,
            (_, rowId, key) => cardDataBlocks[`#${rowId}:${key}`] || ''
          );
          itemHtml = itemHtml.replace(/\{\{POST_MD::([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,
            (_, key) => cardDataBlocks[key] || ''
          );
        }

        innerHtml += itemHtml;
      } else {
        const imgHtml = img ? `<div class="nav-card-img"><img src="${img}" alt=""></div>` : '';
        innerHtml += `<a href="${link}" class="nav-card">${imgHtml}<div class="nav-card-content"><h3 class="nav-card-title">${title}</h3>${desc ? `<p class="nav-card-desc">${desc}</p>` : ''}</div></a>`;
      }
    }

    const output = `<div class="nav-cards">${innerHtml}</div>`;
    return prefixClass ? `<div class="${prefixClass}">${output}</div>` : output;
  }

  // ---- コードスパン保護 ----
  private protectCodeSpans(content: string, codeMap: Record<string, string>): string {
    let count = Object.keys(codeMap).length;
    content = content.replace(/(`{3,}|~{3,})[^\n]*\n.*?\1/gs, (m) => {
      const key = `___CODEBLOCK${count++}___`;
      codeMap[key] = m;
      return key;
    });
    content = content.replace(/`[^`\n]+`/g, (m) => {
      const key = `___CODEBLOCK${count++}___`;
      codeMap[key] = m;
      return key;
    });
    return content;
  }

  private restoreCodeSpans(content: string, codeMap: Record<string, string>): string {
    for (const [key, val] of Object.entries(codeMap)) {
      content = content.replace(key, val);
    }
    return content;
  }
}
