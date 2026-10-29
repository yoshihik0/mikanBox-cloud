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
  async render(pageId: string, allowPrivate = false, previewData?: PageData): Promise<{ html: string; status: number }> {
    this.previewPage = previewData ? {id:pageId,data:previewData} : undefined;
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
    html = this.replaceBasicTags(html, pageData, pageTitle, pageDesc, pageKeywords, ogpImage);

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
    html = this.completeHead(html, pageTitle, pageDesc, this.resolveAbsoluteUrl(resolveMediaPath(ogpImage)), trackingCode ? trackingCode.head : trackingHtml);
    if (trackingCode) html = this.insertBodyStart(html, trackingCode.body);

    // 8. CSSバッファを処理してHEAD_CSSに差し込む
    const processedCss = this.globalCssBuffer.map(cssLine => {
      cssLine = this.replaceBasicTags(cssLine, pageData!, pageTitle, pageDesc, pageKeywords, ogpImage);
      // url(media/x.png) and url(images/x.png) point at the site's media folder from any page (as in the PHP edition)
      const cssMediaBase = this.getSiteBasePath() + 'media/';
      cssLine = cssLine.replace(/url\(\s*(["']?)(?:images|media)\/([^)"']+)\1\s*\)/gi, (_m, quote, path) => `url(${quote}${cssMediaBase}${path}${quote})`);
      return cssLine;
    });

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
      [/\{\{\s*SITE_NAME\s*\}\}/g,        escapeHtml(this.siteSettings.site_name || '')],
      [/\{\{\s*SITE_DESCRIPTION\s*\}\}/g, escapeHtml(this.siteSettings.description || '')],
      [/\{\{\s*SITE_KEYWORDS\s*\}\}/g,    escapeHtml(this.siteSettings.keywords || '')],
      [/\{\{\s*SITE_OGP_IMAGE\s*\}\}/g,   this.resolveAbsoluteUrl(resolveMediaPath(this.siteSettings.ogp_image || ''))],
      [/\{\{\s*PAGE_TITLE\s*\}\}/g,       escapeHtml(pageData.title || '')],
      [/\{\{\s*PAGE_DESCRIPTION\s*\}\}/g, escapeHtml(pageData.description || '')],
      [/\{\{\s*PAGE_KEYWORDS\s*\}\}/g,    escapeHtml(pageData.keywords || '')],
      [/\{\{\s*PAGE_OGP_IMAGE\s*\}\}/g,   this.resolveAbsoluteUrl(resolveMediaPath(pageData.ogp_image || ''))],
      [/\{\{\s*TITLE\s*\}\}/g,            escapeHtml(pageData.title || (this.siteSettings.site_name || ''))],
      [/\{\{\s*DESCRIPTION\s*\}\}/g,      escapeHtml(pageDesc)],
      [/\{\{\s*OGP_IMAGE\s*\}\}/g,        this.resolveAbsoluteUrl(resolveMediaPath(ogpImage))],
      [/\{\{\s*FULL_TITLE\s*\}\}/g,       escapeHtml(pageTitle)],
      [/\{\{\s*KEYWORDS\s*\}\}/g,         escapeHtml(pageKeywords)],
      [/\{\{\s*SITE_URL\s*\}\}/g,         siteUrl],
      [/\{\{\s*BASE_URL\s*\}\}/g,         siteUrl],
      [/\{\{\s*PAGE_URL\s*\}\}/g,         pageFullUrl],
      [/\{\{\s*UPDATE_DATE\s*\}\}/g,      (pageData.updated_at || new Date().toISOString()).slice(0, 10)],
    ];

    for (const [pattern, replacement] of replacements) {
      text = text.replace(pattern, replacement);
    }

    // UPDATE_DATE:JP / UPDATE_DATE:SLASH
    const rawDate = pageData.updated_at || new Date().toISOString();
    text = text.replace(/\{\{\s*UPDATE_DATE:([A-Z]+)\s*\}\}/g, (_, fmt) => this.formatDate(rawDate, fmt));

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
          '\u200B<!--MKNTG' + btoa(unescape(encodeURIComponent(tag))) + '-->\u200B'
        );
        let embedded = this.restoreMarkdownUrlTags(this.markdown.text(protected2));
        embedded = embedded.replace(/\u200B?<!--MKNTG([a-zA-Z0-9+/=]+)-->\u200B?/g, (_, b64) => {
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

    // 内部リンクを絶対URLに書き換え (the PHP renderer's rules: page IDs, with ?query and #fragment kept)
    html = html.replace(/href=["'](\.?\/?)([^"']+)["']/gi, (match, prefix, url) => {
      const original = prefix + url;
      // external links, anchors, mail and phone links, and root-relative paths stay as written
      if (/^(?:https?:\/\/|\/\/|#|mailto:|tel:)/i.test(original) || original.startsWith('/')) return match;
      const parts = original.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
      const path = parts ? parts[1] : original;
      const suffix = parts ? (parts[2] || '') + (parts[3] || '') : '';
      let checkId = path.replace(/^\/+|\/+$/g, '');
      if (/\/index\.html$/i.test(checkId)) checkId = checkId.slice(0, -11);
      else if (/\.html$/i.test(checkId)) checkId = checkId.slice(0, -5);
      const found = allPosts.find(pid => pid.toLowerCase() === checkId.toLowerCase());
      if (found) return `href="${this.buildFullUrl(siteUrl, this.getPageLink(found))}${suffix}"`;
      // looks like a page ID (letters, digits, - _ /) even if no such page exists yet
      if (/^[a-z0-9_\-/]+$/i.test(checkId)) return `href="${this.buildFullUrl(siteUrl, this.getPageLink(checkId))}"`;
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
        const imgHtml = img ? `<div class="nav-card-img"><img src="${img}" alt="" loading="lazy" decoding="async"></div>` : '';
        innerHtml += `<a href="${link}" class="nav-card">${imgHtml}<div class="nav-card-content"><h3 class="nav-card-title">${title}</h3>${desc ? `<p class="nav-card-desc">${desc}</p>` : ''}</div></a>`;
      }
    }

    const output = `<div class="nav-cards">${innerHtml}</div>`;
    return prefixClass ? `<div class="${prefixClass}">${output}</div>` : output;
  }

  // ---- コードスパン保護 ----
  // Restore URL tags in Markdown link attributes without activating code examples.
  private restoreMarkdownUrlTags(html: string): string {
    return html.replace(/<a\s+href="([^"]*)"/gi, (_, href: string) => '<a href="' +
      href.replace(/\u200B?&lt;!--MKNTG([a-zA-Z0-9+/=]+)--&gt;\u200B?/g, (placeholder, b64: string) => {
        try {
          const tag = decodeURIComponent(escape(atob(b64)));
          return /^\{\{\s*(?:SITE_URL|BASE_URL|PAGE_URL)\s*\}\}$/.test(tag) ? tag : placeholder;
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

  private restoreCodeSpans(content: string, codeMap: Record<string, string>): string {
    for (const [key, val] of Object.entries(codeMap)) {
      content = content.replace(key, val);
    }
    return content;
  }
}
