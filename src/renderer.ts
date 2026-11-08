// ==========================================
// mikanBox Renderer (renderer.php の移植)
// ==========================================
// PHP版のMikanBoxRendererクラスをasync/awaitベースに変換

import type { Env, PageData, ComponentData, Settings } from './types';
import { MikanBoxMarkdown } from './markdown';
import { imageSize } from './image-size';
import { scopeCss } from './cssScope';
import { createTranslator } from './i18n';
import { trackingSnippets } from './tracking';
import {
  loadPage, loadComponent, getSortedPageIds, isPublicStatus, listPages, getMediaHeader,
} from './storage';
import { validMediaName } from './media-policy';
import {
  pageOutputFormat, isDataFormat, isApiFormat, formatExtension, formatHasMarkdown, pageExpandsTags, pageIsListed,
  normalizeLegacyPage, splitCategories, visibleCategories, normalizeFooterComponents, encodePageIdPath, type OutputFormat,
} from './output-formats';

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
/** PHP htmlspecialchars($v, ENT_QUOTES): single quotes too. */
function escapeQuotes(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#039;');
}
/** First 8 hex digits of SHA-256 (PHP: substr(hash('sha256', $v), 0, 8)). */
async function hash8(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** String.replace with an async replacer, applied to every match in order. */
async function replaceAsync(text: string, pattern: RegExp, replacer: (...match: string[]) => Promise<string>): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    parts.push(text.slice(last, m.index!));
    parts.push(await replacer(...(m as unknown as string[])));
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.join('');
}

type PageEntry = { id: string; data: PageData };
type NavOptions = { category: string; component: string; sort: '' | 'new' | 'old'; limit: number; sep: string };
type NavGroup = { label: string | null; items: PageEntry[] };
const hashStack: string[] = [];

export type ImageSizeCache = Map<string, { width: number; height: number } | null>;

export class MikanBoxRenderer {
  // Image sizes: markers are put in while rendering and filled in at the end (see applyImageSizes).
  private imageSizes = false;
  private imageCache: ImageSizeCache = new Map();
  private imageSeq = 0;
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
  private previewPage?:{id:string,data:PageData};
  private navigationPages?:Promise<Array<{id:string,data:PageData}>>;
  private snapshot?:{pages:Array<{id:string,data:PageData}>,components:Array<{id:string,data:ComponentData}>};
  private componentCache=new Map<string,Promise<ComponentData|null>>();
  // Output formats (2.17.0): 'html' renders the page, 'md' its Markdown version,
  // 'data' the body of a data-format page (json, xml, csv, txt, js, css).
  private outputMode: 'html' | 'md' | 'data' = 'html';
  private dataFormat = '';
  private linkToMarkdown = false;   // in Markdown versions, link to other pages' Markdown versions
  private currentPageInfo: Partial<PageData> = {};  // stored fields of the page being rendered (for @same)
  private pageFormats = new Map<string, OutputFormat>();
  private pageIndexLoaded?: Promise<void>;
  private dataHashes = new Map<string, string>();  // static build: page ID => hash of its built data output
  /** Formats of every page, for the link rules (one light query, or the build snapshot). */
  private loadPageIndex(): Promise<void> {
    return this.pageIndexLoaded ??= (async () => {
      if (this.snapshot) { for (const p of this.snapshot.pages) this.pageFormats.set(p.id, pageOutputFormat(p.data)); return; }
      const rows = await this.env.DB.prepare("SELECT id,status,json_extract(data,'$.output_format') format FROM posts").all<{ id: string; status: string; format: string | null }>();
      for (const row of rows.results) this.pageFormats.set(row.id, pageOutputFormat({ status: row.status as PageData['status'], output_format: (row.format || undefined) as OutputFormat | undefined }));
    })().then(() => { if (this.previewPage) this.pageFormats.set(this.previewPage.id, pageOutputFormat(this.previewPage.data)); });
  }
  setDataHashes(hashes: Map<string, string>) { this.dataHashes = new Map(hashes); }
  private publicPages() {return this.navigationPages??=Promise.resolve(this.snapshot?.pages||listPages(this.env)).then(pages=>pages.filter(p=>isPublicStatus(p.data.status)));}
  private readPage(id:string) {if(this.previewPage?.id===id)return Promise.resolve(this.previewPage.data);return this.snapshot?Promise.resolve(this.snapshot.pages.find(p=>p.id===id)?.data||this.snapshot.pages.find(p=>p.id===id+'/index')?.data||null):loadPage(this.env,id);}
  private readComponent(id:string) {
    if(!this.componentCache.has(id))this.componentCache.set(id,this.snapshot?Promise.resolve(this.snapshot.components.find(c=>c.id===id)?.data||null):loadComponent(this.env,id));
    return this.componentCache.get(id)!;
  }

  constructor(env: Env, settings: Settings, request: Request, snapshot?:{pages:Array<{id:string,data:PageData}>,components:Array<{id:string,data:ComponentData}>},options?:{imageSizes?:boolean,imageCache?:ImageSizeCache}) {
    this.env = env;
    // Reading image headers costs a query each, so it is on for static builds (a snapshot) and off for live rendering unless asked.
    this.imageSizes = options?.imageSizes ?? !!snapshot;
    if (options?.imageCache) this.imageCache = options.imageCache;
    this.siteSettings = {
      site_name: 'mikanBox',
      description: '',
      keywords: '',
      ogp_image: '',
      ssg_root_url: '',
      ...settings,
    };
    this.markdown = new MikanBoxMarkdown();
    this.markdown.imageAttributes = (url) => this.imageMarker(url);
    this.request = request;
    this.snapshot=snapshot;
  }

  getSiteUrl(): string {
    const ssgRootUrl = (this.siteSettings.ssg_root_url || '').trim().replace(/\/$/, '');
    if (ssgRootUrl) return ssgRootUrl;
    // 分離構成では、プレビューでも公開側のURLを使う（管理側のアドレスを出さない）
    if (this.env.PUBLIC_SITE_URL) return this.env.PUBLIC_SITE_URL.trim().replace(/\/$/, '');
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

  /**
   * Root-relative link of a page. Everything with an extension lives at /id.<extension>:
   * data pages, Markdown-only pages, and (inside Markdown versions) pages that also publish
   * a Markdown version. mikanBox DB pages live at /api/id.json.
   */
  getPageLink(postId: string): string {
    const root = this.getSiteBasePath();
    const format = this.pageFormats.get(postId) ?? 'html';
    let extension = formatExtension(format);
    if (extension === null && format === 'html_md' && this.linkToMarkdown) extension = 'md';
    if (isApiFormat(format)) return root + 'api/' + encodePageIdPath(postId) + '.json';
    if (extension !== null) return root + encodePageIdPath(postId) + '.' + extension;
    const id = postId === 'index' ? '' : postId;
    return id === '' ? root : root + id + '/';
  }

  private buildPageUrl(postId: string): string {
    return this.buildFullUrl(this.getSiteUrl(), this.getPageLink(postId));
  }

  /** /id.<extension> as an absolute URL (Markdown versions and data pages). */
  private extensionUrl(pageId: string, extension: string): string {
    return this.getSiteUrl().replace(/\/$/, '') + '/' + encodePageIdPath(pageId) + '.' + extension;
  }

  private resolveAbsoluteUrl(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//.test(url)) return url;
    return this.getSiteUrl().replace(/\/$/, '') + '/' + url.replace(/^\//, '');
  }

  // ---- Public API: DATA/DATAROWブロックをJSON構造で返す ----
  async getPageDataBlocks(pageId: string, given?: PageData): Promise<object | null> {
    const postData = given ?? await this.readPage( pageId);
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
  async render(pageId: string, allowPrivate = false, previewData?: PageData): Promise<{ html: string; status: number }> {
    this.previewPage = previewData ? {id:pageId,data:normalizeLegacyPage(previewData)} : undefined;
    this.outputMode = 'html';
    this.dataFormat = '';
    this.linkToMarkdown = false;
    await this.loadPageIndex();
    this.currentPageId = pageId;
    this.globalCssBuffer = [];
    this.javascriptBuffer.clear();
    this.includedComponentIds.clear();
    this.expansionCount = 0;
    this.imageSeq = 0;
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
    if (!isPublicStatus(pageData.status) && !allowPrivate) {
      return { html: '<h1>404 Not Found</h1>', status: 404 };
    }
    this.currentPageInfo = pageData;

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
      // A zero-width space on both sides keeps a line that starts or ends with a tag from looking
      // adjacent to an HTML tag to the Markdown parser's <br> logic (same as the PHP renderer).
      const protectedMd = contentMd.replace(/\{\{[^}]+\}\}/g, (m) =>
        '\u200B<!--MKNTG' + btoa(unescape(encodeURIComponent(m))) + '-->\u200B'
      );
      contentHtml = this.restoreMarkdownUrlTags(this.markdown.text(protectedMd));
      contentHtml = contentHtml.replace(/\u200B?<!--MKNTG([a-zA-Z0-9+/=]+)-->\u200B?/g, (_, b64) => {
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

    // Code or ID settings win over the legacy tracking component and are inserted verbatim.
    const trackingCode = this.excludeTracking ? null : trackingSnippets(this.siteSettings);
    const trackingId = trackingCode ? '' : String(this.siteSettings.tracking_component || '');
    const tracking = trackingId ? await this.readComponent(trackingId) : null;
    let trackingHtml = '';
    const trackingMarker = '\x02TRACKING\x03';
    if (!this.excludeTracking && tracking && !tracking.is_ai_doc && !tracking.is_wrapper && !this.includedComponentIds.has(trackingId)) {
      trackingHtml = await this.parseComponents('{{COMPONENT:' + trackingId + '}}');
      html += trackingMarker + trackingHtml;
    }

    // 5. 基本タグを展開
    html = await this.replaceBasicTags(html, pageData, pageTitle, pageDesc, pageKeywords, ogpImage);

    // 6. ナビゲーション・特殊タグを展開
    html = await this.replaceSpecialTags(html);

    // 7. パス補完
    html = await this.applyPathCompletion(html);

    // 7.5 コードブロック内のエスケープされたプレースホルダーを復元
    html = html.replace(/\u200B?&lt;!--MKNTG([a-zA-Z0-9+/=]+)--&gt;\u200B?/g, (_, b64) => {
      try { return escapeHtml(decodeURIComponent(escape(atob(b64)))); } catch { return ''; }
    });

    const trackingOffset = html.indexOf(trackingMarker);
    trackingHtml = trackingOffset >= 0 ? html.slice(trackingOffset + trackingMarker.length) : '';
    if (trackingOffset >= 0) html = html.slice(0, trackingOffset);
    html = html.replace(/\x04COMMENT(\d+)\x04/g,(_,index)=>comments[Number(index)] || '');
    let headExtra = trackingCode ? trackingCode.head : trackingHtml;
    // A page that also publishes a Markdown version announces it, the way RSS is discovered.
    if (pageOutputFormat(pageData) === 'html_md') {
      headExtra = '<link rel="alternate" type="text/markdown" href="' + escapeQuotes(this.extensionUrl(responseStatus === 200 ? pageId : '404', 'md')) + '">' + headExtra;
    }
    html = this.completeHead(html, pageTitle, pageDesc, this.resolveAbsoluteUrl(resolveMediaPath(ogpImage)), headExtra);
    if (trackingCode) html = this.insertBodyStart(html, trackingCode.body);

    // 8. CSSバッファを処理してHEAD_CSSに差し込む
    const processedCss: string[] = [];
    for (let cssLine of this.globalCssBuffer) {
      cssLine = await this.replaceBasicTags(cssLine, pageData!, pageTitle, pageDesc, pageKeywords, ogpImage);
      // url(media/x.png) and url(images/x.png) point at the site's media folder from any page (as in the PHP edition)
      const cssMediaBase = this.getSiteBasePath() + 'media/';
      cssLine = cssLine.replace(/url\(\s*(["']?)(?:images|media)\/([^)"']+)\1\s*\)/gi, (_m, quote, path) => `url(${quote}${cssMediaBase}${path}${quote})`);
      processedCss.push(cssLine);
    }

    const uniqueCss = [...new Set(processedCss)];
    const cssTag = `<style>\n${uniqueCss.join('\n')}\n</style>`;
    html = this.embedCss(html, cssTag, uniqueCss.length > 0);

    html = this.enforceStandardMode(html);
    if (pageData.js) this.javascriptBuffer.set('page:'+pageId, pageData.js);
    const jsTags = [...this.javascriptBuffer.values()].map(js=>`<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`).join('\n');
    if (/\{\{\s*HEAD_JS\s*\}\}/i.test(html)) html=html.replace(/\{\{\s*HEAD_JS\s*\}\}/gi,()=>jsTags);
    else if (jsTags) html=html.includes('</body>')?html.replace('</body>',jsTags+'</body>'):html+jsTags;
    const origin=new URL(this.request.url).origin;
    const aiScript=`<script src="/mikanbox/ai-question.js" data-mcp-endpoint="/public-mcp" data-public-mcp="${escapeHtml(origin)}/public-mcp" data-help-ja="${escapeHtml(origin)}/public-help.html?language=ja" data-help-en="${escapeHtml(origin)}/public-help.html?language=en" defer></script>`;
    html=html.includes('</body>')?html.replace('</body>',()=>aiScript+'</body>'):html+aiScript;
    html = html.replace(/\x04COMMENT(\d+)\x04/g,(_,index)=>comments[Number(index)] || '');
    html = await this.applyImageSizes(html);
    return { html, status: responseStatus };
  }

  /** A placeholder attribute for a local raster image, in generation order; empty for anything else. */
  private imageMarker(url: string): string {
    if (!this.imageSizes || /^(?:https?:)?\/\//i.test(url)) return '';
    const name = url.split(/[?#]/)[0].split('/').pop() || '';
    if (!validMediaName(name) || /\.svg$/i.test(name)) return '';
    return ` data-mkn-dim="${this.imageSeq++}:${name}"`;
  }

  /** Replace the markers with width/height and the loading hints, as PHP's mediaImgAttrs() does. */
  private async applyImageSizes(html: string): Promise<string> {
    const markers = [...html.matchAll(/ data-mkn-dim="(\d+):([^"]+)"/g)];
    if (!markers.length) return html;
    for (const name of new Set(markers.map(m => m[2]))) {
      if (this.imageCache.has(name) || this.imageCache.size >= 30) continue;
      let size = null;
      try { const header = await getMediaHeader(this.env, name); size = header ? imageSize(header) : null; } catch { size = null; }
      this.imageCache.set(name, size);
    }
    const attributes = new Map<string, string>();
    let largeSeen = false;
    for (const m of [...markers].sort((a, b) => Number(a[1]) - Number(b[1]))) {
      const size = this.imageCache.get(m[2]);
      if (!size) { attributes.set(m[1], ''); continue; }
      let attrs = ` width="${size.width}" height="${size.height}"`;
      if (size.width >= 200 || size.height >= 200) {
        if (!largeSeen) { largeSeen = true; attrs += ' fetchpriority="high"'; } else attrs += ' loading="lazy" decoding="async"';
      }
      attributes.set(m[1], attrs);
    }
    return html.replace(/ data-mkn-dim="(\d+):[^"]+"/g, (_m, seq) => attributes.get(seq) || '');
  }


  private insertBodyStart(html: string, code: string): string {
    if (!code) return html;
    const pattern = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const body = [...html.matchAll(pattern)].find(token => /^<body\b/i.test(token[0]));
    if (!body) return html;
    const at = body.index! + body[0].length;
    return html.slice(0, at) + code + html.slice(at);
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
  private async replaceBasicTags(
    text: string,
    pageData: PageData,
    pageTitle: string,
    pageDesc: string,
    pageKeywords: string,
    ogpImage: string
  ): Promise<string> {
    const siteUrl = this.getSiteUrl();
    const id = this.currentPageId;
    const value = (v: unknown) => this.escapeValue(String(v ?? ''));
    const url = (v: unknown) => this.escapeUrl(String(v ?? ''));
    // Markdown versions and data pages always live at /id.<extension>.
    const ownExtension = this.outputMode === 'md' ? 'md' : this.outputMode === 'data' ? this.dataFormat : null;
    const pageFullUrl = ownExtension !== null ? this.extensionUrl(id, ownExtension) : this.buildFullUrl(siteUrl, this.getPageLink(id));

    const replacements: Record<string, string> = {
      SITE_NAME: value(this.siteSettings.site_name || ''),
      SITE_DESCRIPTION: value(this.siteSettings.description || ''),
      SITE_KEYWORDS: value(this.siteSettings.keywords || ''),
      SITE_OGP_IMAGE: url(this.resolveAbsoluteUrl(resolveMediaPath(this.siteSettings.ogp_image || ''))),
      PAGE_TITLE: value(pageData.title || ''),
      PAGE_DESCRIPTION: value(pageData.description || ''),
      PAGE_KEYWORDS: value(pageData.keywords || ''),
      PAGE_OGP_IMAGE: url(this.resolveAbsoluteUrl(resolveMediaPath(pageData.ogp_image || ''))),
      TITLE: value(pageData.title || (this.siteSettings.site_name || '')),
      DESCRIPTION: value(pageDesc),
      OGP_IMAGE: url(this.resolveAbsoluteUrl(resolveMediaPath(ogpImage))),
      FULL_TITLE: value(pageTitle),
      KEYWORDS: value(pageKeywords),
      SITE_URL: url(siteUrl),
      BASE_URL: url(siteUrl),
      PAGE_URL: url(pageFullUrl),
      UPDATE_DATE: value((pageData.updated_at || new Date().toISOString()).slice(0, 10)),
    };
    text = text.replace(new RegExp('\\{\\{\\s*(' + Object.keys(replacements).join('|') + ')\\s*\\}\\}', 'g'), (_m, key: string) => replacements[key]);

    // CATEGORY: categories except structural "_" ones; CATEGORY:all includes them.
    text = text.replace(/\{\{\s*CATEGORY(?::\s*(all)\s*)?\}\}/g, (_m, all) => this.formatCategories(pageData.category || '', !!all));

    // PAGE_URL:ID — URL of another page, with its extension (and ?v= for data pages).
    text = await replaceAsync(text, /\{\{\s*PAGE_URL:\s*([A-Za-z0-9_\-\/]+)\s*\}\}/g, async (_m, target) => this.escapeUrl(await this.pageUrlTag(target)));

    // UPDATE_DATE:JP / UPDATE_DATE:SLASH
    const rawDate = pageData.updated_at || new Date().toISOString();
    text = text.replace(/\{\{\s*UPDATE_DATE:([A-Z]+)\s*\}\}/g, (_, fmt) => this.escapeValue(this.formatDate(rawDate, fmt)));

    // IS_NEW:N
    text = text.replace(/\{\{\s*IS_NEW:(\d+)\s*\}\}/g, (_, days) =>
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
    // NAV_LINKS / NAV_CARDS, with named options :sort=new|old, :limit=N, :sep=text, and the @same selector.
    html = await this.replaceNavTags(html);

    const searchTags=[...html.matchAll(/\{\{\s*SEARCH_RESULTS\s*(?::\s*([A-Za-z0-9_-]+)\s*)?\}\}/g)];
    for(const tag of searchTags) html=html.replace(tag[0],()=>searchResults.get(tag[1]||'_search_result_item')||'');

    // メディアタグ
    const mediaBase = this.getSiteUrl().replace(/\/$/, '') + '/media/';
    html = html.replace(/\{\{VIDEO:([a-zA-Z0-9_\-\.]+)\}\}/g,
      `<video src="${mediaBase}$1" controls style="max-width:100%; height:auto;"></video>`);
    html = html.replace(/\{\{IMAGE:([a-zA-Z0-9_\-\.]+)\}\}/g,
      (_m, name) => `<img src="${mediaBase}${name}" style="max-width:100%; height:auto;"${this.imageMarker(name)}>`);
    html = html.replace(/\{\{AUDIO:([a-zA-Z0-9_\-\.]+)\}\}/g,
      `<audio src="${mediaBase}$1" controls style="width:100%; margin:10px 0;"></audio>`);

    // External Markdown is disabled until an explicit fetch/sanitization policy is implemented.
    html = html.replace(/\{\{EXT_MD:[^}]+\}\}/g, '<!-- EXT_MD is not available in the Cloud edition -->');

    // POST_MD:pageID#rowID:KEY
    const postRowMatches = [...html.matchAll(/\{\{POST_MD:([a-zA-Z0-9_\-/]+)#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)];
    for (const m of postRowMatches) {
      const postData = await this.readPage( m[1]);
      let replacement = '';
      if (postData?.content_md && isPublicStatus(postData.status)) {
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
        if (postData?.content_md && isPublicStatus(postData.status)) {
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
      if (postData?.content_md && isPublicStatus(postData.status)) {
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
          '\u200B<!--MKNTG' + btoa(unescape(encodeURIComponent(tag))) + '-->\u200B'
        );
        let embedded = this.restoreMarkdownUrlTags(this.markdown.text(protected2));
        embedded = embedded.replace(/\u200B?<!--MKNTG([a-zA-Z0-9+/=]+)-->\u200B?/g, (_, b64) => {
          try { return decodeURIComponent(escape(atob(b64))); } catch { return ''; }
        });
        const postTitle = postData.title
          ? postData.title + ' - ' + (this.siteSettings.site_name || '')
          : (this.siteSettings.site_name || '');
        embedded = await this.replaceBasicTags(
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
    await this.loadPageIndex();
    const allPosts = [...this.pageFormats.keys()];
    const siteUrl = this.getSiteUrl();

    // Explicit media URLs are rooted at the site even on nested pages.
    html = html.replace(/(<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*)(["'])(?:\.\/)?media\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css)(?:[?#][^"']*)?)\2/gi,
      (_match,prefix,quote,path)=>`${prefix}${quote}${siteUrl.replace(/\/$/,'')}/media/${path}${quote}`);

    // 内部リンクを絶対URLに書き換え (the PHP renderer's rules: page IDs, with ?query and #fragment kept)
    html = html.replace(/href=["'](\.?\/?)([^"']+)["']/gi, (match, prefix, url) => {
      const resolved = this.resolveInternalLink(prefix + url, allPosts);
      return resolved === null ? match : `href="${resolved}"`;
    });

    // ホームリンク "./" をサイトベースURLに
    html = html.replace(/href=["']\.\/["']/g, `href="${siteUrl}"`);

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
    // the same for url(media/x.png) in inline styles
    html = html.replace(/url\(\s*(["']?)(?:images|media)\/([^)"']+)\1\s*\)/gi, (_m, quote, path) => `url(${quote}${mediaBase}${path}${quote})`);

    return html;
  }

  // The Cloud edition publishes statically, so there is no server to run a search.
  // {{SEARCH_RESULTS}} becomes a Google site search form. Visitors arriving from the
  // standard search box (index.php?page=search&q=…, redirected here) go straight to
  // Google, and other legacy index.php?page=… links go to that page.
  private async generateSearchResults(_componentId: string): Promise<string> {
    const en=this.siteSettings.system_lang==='en';
    const site=this.getSiteUrl().replace(/^https?:\/\//,'').replace(/\/$/,'');
    const text=en
      ?{placeholder:'Enter a keyword...',button:'Search',note:'Searches this site with Google. Only pages Google has indexed are found.'}
      :{placeholder:'キーワードを入力...',button:'検索',note:'Googleで、このサイトの中を検索します。Googleに登録されたページだけが見つかります。'};
    return `<form class="mikan-search-form mikan-google-search" action="https://www.google.com/search" method="get">
<input type="hidden" name="as_sitesearch" value="${escapeHtml(site)}">
<div class="mikan-search-input-container"><input type="search" name="q" class="mikan-search-input" required placeholder="${escapeHtml(text.placeholder)}"><button type="submit" class="mikan-search-button">${escapeHtml(text.button)}</button></div>
<p class="mikan-search-note">${escapeHtml(text.note)}</p>
</form>
<script>(function(){var p=new URLSearchParams(location.search),page=p.get('page'),q=p.get('q');
if(page&&page!=='search'&&/^[A-Za-z0-9_-][A-Za-z0-9_\/-]*$/.test(page)){var to=new URL('/'+page,location.origin);if(to.origin===location.origin){location.replace(to.href);return;}}
if(q)location.replace('https://www.google.com/search?'+new URLSearchParams({q:q,as_sitesearch:${JSON.stringify(site).replace(/</g,'\\u003c')}}));})();</script>`;
  }

  /** The document starts with exactly one <!DOCTYPE html> (standards mode), wherever the layout put its own. */
  private enforceStandardMode(html: string): string {
    if (!html.includes('<html') && !html.includes('<!DOCTYPE')) return html;
    return '<!DOCTYPE html>\n' + html.replace(/<!DOCTYPE[^>]*>/gi, '').trim();
  }

  // ---- コードスパン保護 ----
  // Restore URL tags in Markdown link attributes without activating code examples.
  private restoreMarkdownUrlTags(html: string): string {
    return html.replace(/<a\s+href="([^"]*)"/gi, (_, href: string) => '<a href="' +
      href.replace(/\u200B?&lt;!--MKNTG([a-zA-Z0-9+/=]+)--&gt;\u200B?/g, (placeholder, b64: string) => {
        try {
          const tag = decodeURIComponent(escape(atob(b64)));
          return /^\{\{\s*(?:SITE_URL|BASE_URL|PAGE_URL(?::[A-Za-z0-9_\-\/]+)?)\s*\}\}$/.test(tag) ? tag : placeholder;
        } catch { return placeholder; }
      }) + '"');
  }

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

  // One pass over the text (a replace per placeholder made long pages with many code spans quadratic).
  // Like the PHP renderer's str_replace, every occurrence of a placeholder is restored.
  private restoreCodeSpans(content: string, codeMap: Record<string, string>): string {
    return content.replace(/___CODEBLOCK\d+___/g, key => Object.hasOwn(codeMap, key) ? codeMap[key] : key);
  }

  // ==========================================
  // Navigation lists: NAV_LINKS / NAV_CARDS
  // ==========================================

  private replaceNavTags(text: string): Promise<string> {
    return replaceAsync(text, /\{\{\s*(NAV_LINKS|NAV_CARDS)\s*((?::[^:}]*)*)\}\}/gu, async (whole, tagType, args) => {
      const options = this.parseNavArguments(args);
      if (options === null) return whole;
      return this.renderNav(tagType, options);
    });
  }

  /**
   * Positional arguments (category, card component) followed by named options.
   * A value runs to the next ":" or "}}"; in sep, \n and \t mean newline and tab.
   */
  private parseNavArguments(argumentString: string): NavOptions | null {
    const options: NavOptions = { category: '', component: '', sort: '', limit: 0, sep: '' };
    const positional: string[] = [];
    const tokens = argumentString === '' ? [] : argumentString.slice(1).split(':');
    for (const token of tokens) {
      const named = token.match(/^\s*(sort|limit|sep)=([\s\S]*)$/);
      if (named) {
        if (named[1] === 'sort') {
          const sort = named[2].trim();
          options.sort = sort === 'new' || sort === 'old' ? sort : '';
        } else if (named[1] === 'limit') {
          options.limit = Math.max(0, parseInt(named[2].trim(), 10) || 0);
        } else {
          options.sep = named[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        }
        continue;
      }
      if (token.includes('=')) continue; // unknown option
      positional.push(token.trim());
    }
    options.category = positional[0] ?? '';
    options.component = positional[1] ?? '';
    if (options.component !== '' && !/^[A-Za-z0-9_\-]+$/.test(options.component)) return null;
    return options;
  }

  /** Listable pages in display order, matching a category ('' = none, 'all' = every page). */
  private async navCandidates(category: string, options: NavOptions): Promise<PageEntry[]> {
    let items: PageEntry[] = [];
    for (const { id, data } of await this.publicPages()) {
      if (!data) continue;
      if ((data.sort_order ?? 0) < 0) continue;
      // Data-format pages are parts of a site, not content, so lists never show them.
      if (!pageIsListed(data)) continue;
      const cats = splitCategories(data.category);
      if (category !== '') {
        if (category !== 'all' && !cats.includes(category)) continue;
      } else if (cats.length > 0) continue;
      items.push({ id, data });
    }
    if (options.sort !== '') {
      // Array.prototype.sort is stable, so pages with the same date keep their display order.
      const direction = options.sort === 'new' ? -1 : 1;
      const key = (item: PageEntry) => String(item.data.updated_at ?? '');
      items.sort((a, b) => direction * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    }
    if (options.limit > 0) items = items.slice(0, options.limit);
    return items;
  }

  private async renderNav(tagType: string, options: NavOptions): Promise<string> {
    if (options.category !== '@same') {
      return this.renderNavGroups(tagType, options, [{ label: null, items: await this.navCandidates(options.category, options) }]);
    }
    // @same: pages sharing a non-structural category with the page being shown.
    const groups: NavGroup[] = [];
    for (const category of visibleCategories(this.currentPageInfo.category)) {
      let items = (await this.navCandidates(category, { ...options, limit: 0 })).filter(item => item.id !== this.currentPageId);
      if (options.limit > 0) items = items.slice(0, options.limit);
      groups.push({ label: category, items });
    }
    if (!groups.length) return '';
    if (groups.length === 1) groups[0].label = null;
    return this.renderNavGroups(tagType, options, groups);
  }

  /** groups: one unlabelled group for a flat list, or labelled groups per category. */
  private async renderNavGroups(tagType: string, options: NavOptions, groups: NavGroup[]): Promise<string> {
    const grouped = groups[0].label !== null;
    const sep = options.sep;

    if (this.outputMode !== 'html') {
      const isMarkdown = this.outputMode === 'md';
      let template: string | null = null;
      const effectiveCompId = options.component || '_nav_card';
      if (tagType === 'NAV_CARDS' && !isMarkdown) {
        const compData = await this.readComponent(effectiveCompId);
        template = compData ? String(compData.html ?? '') : null;
      }
      const parts: string[] = [];
      for (const group of groups) {
        const lines: string[] = [];
        for (const item of group.items) {
          if (template !== null) {
            lines.push(this.renderCardItem(item.id, item.data, template));
          } else {
            const line = '- [' + this.escapeMarkdownLinkText(item.data.title || item.id) + '](' + this.escapeMarkdownUrl(this.buildPageUrl(item.id)) + ')';
            lines.push((grouped ? '  ' : '') + (isMarkdown ? line : this.escapeValue(line)));
          }
        }
        let joined = lines.join(sep !== '' ? sep : (template !== null ? '' : '\n'));
        if (grouped && isMarkdown) {
          joined = '- ' + this.escapeMarkdownLinkText(group.label!) + (joined !== '' ? '\n' + joined : '');
        }
        parts.push(joined);
      }
      return parts.filter(part => part !== '').join(sep !== '' && !isMarkdown ? sep : '\n');
    }

    if (tagType === 'NAV_LINKS') {
      const renderLinks = (items: PageEntry[]) => items.map(item => {
        const title = escapeQuotes(item.data.title || item.id);
        const activeClass = this.currentPageId === item.id ? ' class="active"' : '';
        return `<li${activeClass}><a href="${this.buildPageUrl(item.id)}">${title}</a></li>`;
      }).join(sep);
      if (!grouped) return '<ul class="nav-links">' + renderLinks(groups[0].items) + '</ul>';
      let html = '<ul class="nav-links">';
      for (const group of groups) {
        html += '<li class="nav-group"><span class="nav-group-label">' + escapeQuotes(group.label!) + '</span>'
          + '<ul class="nav-links">' + renderLinks(group.items) + '</ul></li>';
      }
      return html + '</ul>';
    }

    // NAV_CARDS in HTML
    const effectiveCompId = options.component || '_nav_card';
    const compData = await this.readComponent(effectiveCompId);
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
          this.globalCssBuffer.push(`/* Nav Card: ${effectiveCompId} */\n${scopeCss(compCss, '.' + prefixClass)}`);
        }
      }
    }
    const renderCards = (items: PageEntry[]) => {
      const cards = items.map(item => this.renderCardItem(item.id, item.data, customTemplate));
      if (items.length && customTemplate && compData?.js && !compData.is_ai_doc) this.javascriptBuffer.set(effectiveCompId, compData.js);
      return cards.join(sep);
    };
    let output: string;
    if (!grouped) {
      output = '<div class="nav-cards">' + renderCards(groups[0].items) + '</div>';
    } else {
      output = '';
      for (const group of groups) {
        output += '<div class="nav-group"><div class="nav-group-label">' + escapeQuotes(group.label!) + '</div>'
          + '<div class="nav-cards">' + renderCards(group.items) + '</div></div>';
      }
    }
    return prefixClass ? `<div class="${prefixClass}">${output}</div>` : output;
  }

  /** One card: the item component filled with this page's values, escaped for the output. */
  private renderCardItem(postId: string, postInfo: PageData, customTemplate: string | null): string {
    const isHtml = this.outputMode === 'html';
    const esc = isHtml ? (v: string) => escapeQuotes(v) : (v: string) => this.escapeValue(v);
    const title = esc(postInfo.title || postId);
    const desc = esc(postInfo.description || '');
    let rawImg = resolveMediaPath(postInfo.ogp_image || '');
    if (rawImg && !/^(?:https?:\/\/|data:)/.test(rawImg)) rawImg = this.resolveAbsoluteUrl(rawImg);
    if (!rawImg && isHtml) {
      rawImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='210'%3E%3Crect width='400' height='210' fill='%23e0e0e0'/%3E%3C/svg%3E";
    }
    const img = esc(rawImg);
    let link = this.buildPageUrl(postId);
    if (!isHtml) link = this.escapeValue(link);
    const updateDate = (postInfo.updated_at || new Date().toISOString()).slice(0, 10);
    const isActive = this.currentPageId === postId ? 'active' : '';

    if (!customTemplate) {
      const imgHtml = img ? `<div class="nav-card-img"><img src="${img}" alt="" loading="lazy" decoding="async"></div>` : '';
      return `<a href="${link}" class="nav-card">${imgHtml}<div class="nav-card-content"><h3 class="nav-card-title">${title}</h3>${desc ? `<p class="nav-card-desc">${desc}</p>` : ''}</div></a>`;
    }
    const values: Record<string, string> = { TITLE: title, DESCRIPTION: desc, LINK: link, OGP_IMAGE: img, PAGE_URL: link, UPDATE_DATE: updateDate, IS_ACTIVE: isActive };
    let itemHtml = customTemplate.replace(/\{\{(TITLE|DESCRIPTION|LINK|OGP_IMAGE|PAGE_URL|UPDATE_DATE|IS_ACTIVE)\}\}/g, (_m, key: string) => values[key]);
    itemHtml = itemHtml.replace(/\{\{\s*CATEGORY(?::\s*(all)\s*)?\}\}/g, (_m, all) => this.formatCategories(postInfo.category || '', !!all));
    const rawDate = postInfo.updated_at || new Date().toISOString();
    itemHtml = itemHtml.replace(/\{\{UPDATE_DATE:([A-Z]+)\}\}/g, (_, fmt) => this.formatDate(rawDate, fmt));
    itemHtml = itemHtml.replace(/\{\{IS_NEW:(\d+)\}\}/g, (_, d) => this.isNew(rawDate, parseInt(d, 10)) ? 'new' : '');
    // Expand POST_MD:: tags using this card's own DATA blocks
    if (postInfo.content_md) {
      const cardDataBlocks: Record<string, string> = {};
      this.extractDataBlocks(postInfo.content_md, cardDataBlocks);
      const valueOut = isHtml ? (v: string) => v : (v: string) => this.escapeValue(v);
      itemHtml = itemHtml.replace(/\{\{POST_MD::#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, rowId, key) => valueOut(cardDataBlocks[`#${rowId}:${key}`] || ''));
      itemHtml = itemHtml.replace(/\{\{POST_MD::([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, key) => valueOut(cardDataBlocks[key] || ''));
    }
    return itemHtml;
  }

  // ==========================================
  // Escaping by output
  // ==========================================

  /** A text value: HTML-escaped in HTML, as it is in Markdown, escaped for the data format otherwise. */
  private escapeValue(value: string): string {
    if (this.outputMode === 'html') return escapeHtml(value);
    if (this.outputMode === 'md') return value;
    return this.escapeForData(value);
  }

  /** A URL value: as it is in HTML and Markdown, escaped for the data format otherwise. */
  private escapeUrl(value: string): string {
    return this.outputMode === 'data' ? this.escapeForData(value) : value;
  }

  private escapeForData(value: string): string {
    switch (this.dataFormat) {
      case 'json':
        // PHP json_encode with JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES (line separators stay escaped).
        return JSON.stringify(String(value)).slice(1, -1).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
      case 'xml':
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      case 'csv':
        return /[",\r\n]/.test(value) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
      default:
        return String(value);
    }
  }

  private escapeMarkdownLinkText(text: string): string {
    return String(text).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  }

  private escapeMarkdownUrl(url: string): string {
    return String(url).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  /** {{CATEGORY}}: spans in HTML, comma-separated elsewhere. */
  private formatCategories(category: string, includeStructural: boolean): string {
    const cats = includeStructural ? splitCategories(category) : visibleCategories(category);
    if (this.outputMode === 'html') return cats.map(c => '<span class="category">' + escapeQuotes(c) + '</span>').join(' ');
    return this.escapeValue(cats.join(', '));
  }

  // ==========================================
  // {{PAGE_URL:ID}}
  // ==========================================

  /** The page's URL with its extension; data and DB pages carry ?v=<hash of content>. */
  private async pageUrlTag(targetId: string): Promise<string> {
    const target = await this.readPage(targetId);
    if (!target) return '';
    let url = this.buildPageUrl(targetId);
    const format = pageOutputFormat(target);
    if (isDataFormat(format) || isApiFormat(format)) url += '?v=' + await this.dataVersion(targetId, target);
    return url;
  }

  /** Static builds hash the built output; previews (never cached) hash the body. */
  private async dataVersion(pageId: string, pageData: PageData): Promise<string> {
    if (!this.snapshot) return hash8(String(pageData.content_md ?? ''));
    const known = this.dataHashes.get(pageId);
    if (known) return known;
    if (hashStack.includes(pageId)) return hash8(String(pageData.content_md ?? ''));
    hashStack.push(pageId);
    let output: string | null;
    try {
      const builder = new MikanBoxRenderer(this.env, this.siteSettings, this.request, this.snapshot, { imageSizes: false });
      builder.setDataHashes(this.dataHashes);
      output = isApiFormat(pageOutputFormat(pageData)) ? await builder.renderApi(pageId) : await builder.renderData(pageId);
    } finally {
      hashStack.pop();
    }
    const value = await hash8(String(output ?? ''));
    this.dataHashes.set(pageId, value);
    return value;
  }

  static dataHash(output: string): Promise<string> { return hash8(output); }

  // ==========================================
  // Markdown versions, data pages and mikanBox DB
  // ==========================================

  private async beginOutput(pageId: string, mode: 'md' | 'data', format: string, pageData: PageData, previewData?: PageData) {
    this.previewPage = previewData ? { id: pageId, data: normalizeLegacyPage(previewData) } : this.previewPage;
    await this.loadPageIndex();
    if (previewData) this.pageFormats.set(pageId, pageOutputFormat(previewData));
    this.outputMode = mode;
    this.dataFormat = format;
    this.linkToMarkdown = mode === 'md';
    this.currentPageId = pageId;
    this.currentPageData = {};
    this.currentPageInfo = pageData;
    this.globalCssBuffer = [];
    this.javascriptBuffer.clear();
    this.includedComponentIds.clear();
  }

  private endOutput() {
    this.outputMode = 'html';
    this.dataFormat = '';
    this.linkToMarkdown = false;
  }

  /** Public pages are readable by everyone; drafts and pending pages only when the caller allows private content. */
  private accessible(pageData: PageData, allowPrivate: boolean): boolean {
    return isPublicStatus(pageData.status) || allowPrivate;
  }

  /**
   * mikanBox DB: the DATA/DATAROW data of a published page as JSON, the body of /api/ID.json
   * (and its alias /api/ID). Returns null for other formats and unpublished pages.
   */
  async renderApi(pageId: string, previewData?: PageData): Promise<string | null> {
    const pageData = normalizeLegacyPage(previewData ?? await this.readPage(pageId));
    if (!pageData || !isApiFormat(pageOutputFormat(pageData)) || !isPublicStatus(pageData.status)) return null;
    // PHP json_encode(JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT): the same bytes in every edition ("/" is written "\/").
    return JSON.stringify(await this.getPageDataBlocks(pageId, pageData), null, 4).replace(/\//g, '\\/');
  }

  /**
   * The body of a data-format page, as it is, with tags expanded when the page asks for it.
   * Returns null when the page does not exist, is not a data page, or is private.
   */
  async renderData(pageId: string, previewData?: PageData, allowPrivate = false): Promise<string | null> {
    const pageData = normalizeLegacyPage(previewData ?? await this.readPage(pageId));
    if (!pageData) return null;
    const format = pageOutputFormat(pageData);
    if (!isDataFormat(format) || !this.accessible(pageData, allowPrivate)) return null;
    let body = String(pageData.content_md ?? '');
    if (!pageExpandsTags(pageData)) return body;
    await this.beginOutput(pageId, 'data', format, pageData, previewData);
    try {
      body = this.extractDataBlocks(body, this.currentPageData);
      body = await this.includeComponentsAsText(body);
      body = this.removeFunctionalTags(body);
      body = await this.replaceBasicTags(body, pageData, ...this.pageMeta(pageData));
      body = await this.replaceNavTags(body);
      body = await this.replaceTextContentTags(body);
      return body;
    } finally {
      this.endOutput();
    }
  }

  /**
   * The Markdown version: front matter, the saved Markdown with tags handled for Markdown
   * readers, then the chosen footer components. Every URL is absolute. Returns null when the
   * page has no Markdown version or is private.
   */
  async renderMarkdown(pageId: string, previewData?: PageData, allowPrivate = false): Promise<string | null> {
    const pageData = normalizeLegacyPage(previewData ?? await this.readPage(pageId));
    if (!pageData) return null;
    if (!formatHasMarkdown(pageOutputFormat(pageData)) || !this.accessible(pageData, allowPrivate)) return null;
    await this.beginOutput(pageId, 'md', '', pageData, previewData);
    try {
      const body = await this.markdownText(String(pageData.content_md ?? ''), pageData);
      const footers: string[] = [];
      for (const componentId of await normalizeFooterComponents(pageData.md_footer_comps ?? [], id => this.readComponent(id))) {
        const component = await this.readComponent(componentId);
        const footer = (await this.markdownText(String(component?.html ?? ''), pageData)).trim();
        if (footer !== '') footers.push(footer);
      }
      const quote = (v: unknown) => '"' + String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, '\\n') + '"';
      const front = ['---', 'title: ' + quote(pageData.title ?? pageId), 'date: ' + String(pageData.updated_at || new Date().toISOString()).slice(0, 10)];
      if (String(pageData.description ?? '').trim() !== '') front.push('description: ' + quote(String(pageData.description).trim()));
      if (pageOutputFormat(pageData) === 'html_md') {
        this.linkToMarkdown = false;
        front.push('url: ' + quote(this.buildPageUrl(pageId)));
        this.linkToMarkdown = true;
      }
      const categories = visibleCategories(pageData.category);
      if (categories.length) front.push('categories: ' + quote(categories.join(', ')));
      front.push('---');
      let output = front.join('\n') + '\n\n' + body.trim();
      if (footers.length) output += '\n\n' + footers.join('\n\n');
      return output + '\n';
    } finally {
      this.endOutput();
    }
  }

  /** Output for the editor preview: what the page actually publishes (drafts included). */
  async renderPreview(pageId: string, pageData: PageData): Promise<{ type: string; body: string; status: number }> {
    const format = pageOutputFormat(pageData);
    const published = { ...normalizeLegacyPage(pageData), status: 'public_static' } as PageData;
    if (isApiFormat(format)) return { type: 'text/plain; charset=utf-8', body: String(await this.renderApi(pageId, published) ?? ''), status: 200 };
    if (isDataFormat(format)) return { type: 'text/plain; charset=utf-8', body: String(await this.renderData(pageId, published) ?? ''), status: 200 };
    if (format === 'md') return { type: 'text/plain; charset=utf-8', body: String(await this.renderMarkdown(pageId, published) ?? ''), status: 200 };
    const result = await this.render(pageId, true, pageData);
    return { type: 'text/html; charset=utf-8', body: result.html, status: result.status };
  }

  /** Tag handling and link completion for Markdown text (the page body or a footer component). */
  private async markdownText(text: string, pageData: PageData, depth = 0): Promise<string> {
    text = text.replace(/\r\n|\r/g, '\n');
    // Code and HTML comments stay exactly as written. Code first, so "<!--" inside a code span does not start a comment.
    const codeMap: Record<string, string> = {};
    text = this.protectCodeSpans(text, codeMap);
    text = text.replace(/<!--[\s\S]*?-->/g, m => {
      const key = `\x02MDKEEP${Object.keys(codeMap).length}\x03`;
      codeMap[key] = m;
      return key;
    });
    text = this.extractDataBlocks(text, this.currentPageData);
    // Components are design: only the chosen footer components reach the Markdown version.
    text = text.replace(/\{\{\s*COMPONENT:[^}]*\}\}/g, '');
    text = this.removeFunctionalTags(text);
    text = await this.replaceBasicTags(text, pageData, ...this.pageMeta(pageData));
    text = await this.replaceNavTags(text);
    text = await this.replaceTextContentTags(text, depth);
    text = this.completeMarkdownLinks(text);
    // Removed tags can leave runs of empty lines; code blocks are still protected here.
    text = text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
    // Restore in reverse order: a comment may contain a code placeholder.
    for (const [key, original] of Object.entries(codeMap).reverse()) text = text.split(key).join(original);
    return text;
  }

  private pageMeta(pageData: PageData): [string, string, string, string] {
    const site = this.siteSettings;
    const siteName = String(site.site_name || '');
    return [
      pageData.title !== undefined ? pageData.title + ' - ' + siteName : siteName,
      pageData.description || String(site.description || ''),
      pageData.keywords || String(site.keywords || ''),
      pageData.ogp_image || String(site.ogp_image || ''),
    ];
  }

  /** Functions and decoration that mean nothing outside an HTML page. */
  private removeFunctionalTags(text: string): string {
    return text.replace(/\{\{\s*(?:AI_QUESTION(?::[^}]*)?|SEARCH_RESULTS(?::[^}]*)?|CONTENT|HEAD_CSS|IS_ACTIVE)\s*\}\}/gu, '');
  }

  /** In data pages, a component is inserted as plain text (no scope wrapper, CSS or JS). */
  private includeComponentsAsText(text: string, visited: string[] = []): Promise<string> {
    return replaceAsync(text, /\{\{COMPONENT:([a-zA-Z0-9_\-]+)\}\}/g, async (_m, id) => {
      if (visited.includes(id) || visited.length > 32) return '';
      const component = await this.readComponent(id);
      if (!component || component.is_ai_doc) return '';
      return this.includeComponentsAsText(String(component.html ?? ''), [...visited, id]);
    });
  }

  /** POST_MD and media tags for Markdown versions and data pages. EXT_MD is not available in the Cloud edition. */
  private async replaceTextContentTags(text: string, depth = 0): Promise<string> {
    const isMarkdown = this.outputMode === 'md';
    const out = (v: string) => isMarkdown ? String(v) : this.escapeValue(String(v));
    const mediaUrl = (file: string) => this.resolveAbsoluteUrl('media/' + file);

    text = text.replace(/\{\{IMAGE:([a-zA-Z0-9_\-\.]+)\}\}/g, (_m, file) => isMarkdown ? '![](' + this.escapeMarkdownUrl(mediaUrl(file)) + ')' : out(mediaUrl(file)));
    text = text.replace(/\{\{(?:AUDIO|VIDEO):([a-zA-Z0-9_\-\.]+)\}\}/g, (_m, file) => isMarkdown ? '[' + this.escapeMarkdownLinkText(file) + '](' + this.escapeMarkdownUrl(mediaUrl(file)) + ')' : out(mediaUrl(file)));
    text = text.replace(/\{\{EXT_MD:[^}]+\}\}/g, '');

    const pageBlocks = async (pageId: string): Promise<Record<string, string>> => {
      const postData = await this.readPage(pageId);
      if (!postData?.content_md || !isPublicStatus(postData.status)) return {};
      const blocks: Record<string, string> = {};
      this.extractDataBlocks(postData.content_md, blocks);
      return blocks;
    };
    text = await replaceAsync(text, /\{\{POST_MD:([a-zA-Z0-9_\-\/]+)#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, async (_m, id, row, key) => out((await pageBlocks(id))[`#${row}:${key}`] ?? ''));
    text = text.replace(/\{\{POST_MD::#([a-zA-Z0-9_\-]+):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_m, row, key) => out(this.currentPageData[`#${row}:${key}`] ?? ''));
    text = await replaceAsync(text, /\{\{POST_MD:([a-zA-Z0-9_\-\/]*):([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, async (_m, id, key) =>
      out(id === '' ? (this.currentPageData[key] ?? '') : ((await pageBlocks(id))[key] ?? '')));
    // POST_MD:ID — the other page's body
    text = await replaceAsync(text, /\{\{POST_MD:([a-zA-Z0-9_\-\/]+)\}\}/g, async (_m, id) => {
      const postData = await this.readPage(id);
      if (!postData?.content_md || !isPublicStatus(postData.status) || depth >= 5) return '';
      if (!isMarkdown) {
        const blocks: Record<string, string> = {};
        return out(this.extractDataBlocks(String(postData.content_md), blocks));
      }
      const savedId = this.currentPageId, savedData = this.currentPageData;
      this.currentPageId = id;
      this.currentPageData = {};
      try {
        return (await this.markdownText(String(postData.content_md), postData, depth + 1)).trim();
      } finally {
        this.currentPageId = savedId;
        this.currentPageData = savedData;
      }
    });
    return text;
  }

  /** Markdown links and images: internal links resolve like HTML links; everything becomes absolute. */
  private completeMarkdownLinks(text: string): string {
    const allPosts = [...this.pageFormats.keys()];
    const siteUrl = this.getSiteUrl().replace(/\/$/, '');
    const origin = siteUrl.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? siteUrl;
    return text.replace(/(!?)\[((?:\\.|[^\[\]\n\\])*)\]\(\s*([^)\s]+)((?:\s+"[^"\n]*")?)\s*\)/gu, (whole, bang, label, url, title) => {
      if (/^(?:[a-z][a-z0-9+.\-]*:|\/\/|#)/i.test(url)) return whole;
      let resolved: string | null;
      if (bang === '!') {
        const path = url.split(/[?#]/)[0] || url;
        resolved = siteUrl + '/media/' + (path.replace(/\/+$/, '').split('/').pop() || path);
      } else {
        resolved = this.resolveInternalLink(url, allPosts);
        if (resolved === null) {
          if (url === './' || url === '.') resolved = siteUrl + '/';
          else if (url.startsWith('/')) resolved = origin + url;
          else resolved = siteUrl + '/' + url.replace(/^(?:\.\/)+/, '');
        }
      }
      return bang + '[' + label + '](' + this.escapeMarkdownUrl(resolved) + title + ')';
    });
  }

  /**
   * Shared by HTML (href="…") and Markdown ([…](…)) link completion: which page a written
   * link target means, and the URL it should point at. Returns null to leave the link as written.
   */
  private resolveInternalLink(originalUrl: string, allPosts: string[]): string | null {
    // external links, anchors, mail and phone links stay as written
    if (/^(?:https?:\/\/|\/\/|#|mailto:|tel:)/i.test(originalUrl)) return null;
    const markdownRoot = this.outputMode === 'md' && originalUrl.startsWith('/');
    // root-relative paths stay as written in HTML
    if (!markdownRoot && originalUrl.startsWith('/')) return null;
    const parts = originalUrl.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
    let path = parts ? parts[1] : originalUrl;
    const suffix = parts ? (parts[2] || '') + (parts[3] || '') : '';
    if (markdownRoot && path.startsWith('/')) {
      const basePath = this.getSiteBasePath().replace(/^\/+|\/+$/g, '');
      path = path.replace(/^\/+/, '');
      if (basePath !== '' && (path === basePath || path.startsWith(basePath + '/'))) path = path.slice(basePath.length).replace(/^\/+/, '');
    }
    if (this.outputMode === 'md') path = path.replace(/^(?:(?:\.\/)|(?:\.\.\/))+/, '');
    // Normalize generated URL forms for comparison with page IDs.
    let checkId = path.replace(/^\/+|\/+$/g, '');
    const lower = checkId.toLowerCase();
    if (lower.endsWith('/index.html')) checkId = checkId.slice(0, -11);
    else if (lower.endsWith('.html')) checkId = checkId.slice(0, -5);
    else if (lower.endsWith('.md')) checkId = checkId.slice(0, -3);
    if (checkId === '' && this.outputMode === 'md') checkId = 'index';
    const found = allPosts.find(pid => pid.toLowerCase() === checkId.toLowerCase());
    if (found) return this.buildPageUrl(found) + suffix;
    // looks like a page ID (letters, digits, - _ /) even if no such page exists yet
    if (/^[a-z0-9_\-/]+$/i.test(checkId)) return this.buildPageUrl(checkId);
    return null;
  }
}
