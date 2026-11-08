// ==========================================
// Page output formats (PHP 2.17.0–2.18.1, shared/lib/functions-common.php "Page output formats").
// A page is HTML by default. "html_md" adds a Markdown version at /id.md, "md" publishes only
// the Markdown version, the data formats publish the body as it is at /id.<extension>, and
// "db" (mikanBox DB) publishes the DATA/DATAROW data as JSON at /api/id.json.
// Function names follow the PHP ones (mikanBoxXxx → xxx) so the two are easy to compare.
// ==========================================
import type { PageData, ComponentData } from './types';

export type OutputFormat = 'html' | 'html_md' | 'md' | 'json' | 'xml' | 'csv' | 'txt' | 'js' | 'css' | 'db';
type Translator = (key: string, ...args: (string | number)[]) => string;

/** Output formats in the order the editor shows them. */
export const OUTPUT_FORMATS: OutputFormat[] = ['html', 'html_md', 'md', 'json', 'xml', 'csv', 'txt', 'js', 'css', 'db'];
/** Data formats: the body is published as it is, with no wrapper and no Markdown conversion. */
export const DATA_FORMATS: OutputFormat[] = ['json', 'xml', 'csv', 'txt', 'js', 'css'];
/** Extensions the URL rules give a meaning to (/id.<extension>). */
export const OUTPUT_EXTENSIONS = ['html', 'md', ...DATA_FORMATS] as const;
/** System files a page must not take over with its ID and extension. */
export const RESERVED_OUTPUT_FILES = ['sitemap.xml', 'rss.xml', 'podcast.xml'];

export const isDataFormat = (format: unknown): boolean => DATA_FORMATS.includes(format as OutputFormat);
/** mikanBox DB (2.18.0): replaces the former "DB" status. */
export const isApiFormat = (format: unknown): boolean => format === 'db';
export const formatHasHtml = (format: string): boolean => format === 'html' || format === 'html_md';
export const formatHasMarkdown = (format: string): boolean => format === 'html_md' || format === 'md';

/** The page's output format; anything unset or unknown is HTML. The legacy status "db" reads as "db". */
export function pageOutputFormat(page: Partial<PageData> | null | undefined): OutputFormat {
  if (page && (page.status as string) === 'db') return 'db';
  const format = page?.output_format ?? 'html';
  return OUTPUT_FORMATS.includes(format as OutputFormat) ? format as OutputFormat : 'html';
}

/** File extension of a data format, or "md" for the Markdown-only format. HTML and DB have none. */
export function formatExtension(format: string): string | null {
  if (isDataFormat(format)) return format;
  if (format === 'md') return 'md';
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
};
export const contentTypeForExtension = (extension: string): string => CONTENT_TYPES[extension] ?? 'text/html; charset=utf-8';

/** Tags are expanded by default in JSON, XML, CSV and text, and left alone in JavaScript and CSS. */
export const expandTagsDefault = (format: string): boolean => ['json', 'xml', 'csv', 'txt'].includes(format);

export function pageExpandsTags(page: Partial<PageData>): boolean {
  const format = pageOutputFormat(page);
  if (!isDataFormat(format)) return true;
  return typeof page.expand_tags === 'boolean' ? page.expand_tags : expandTagsDefault(format);
}

/** Pages that appear in NAV lists, sitemap and RSS: everything except data formats and mikanBox DB. */
export function pageIsListed(page: Partial<PageData>): boolean {
  const format = pageOutputFormat(page);
  return !isDataFormat(format) && !isApiFormat(format);
}

/**
 * Pages saved before 2.18.0 with the status "db" read as output format "db" + public.
 * The Cloud edition publishes statically only, so "public" is stored as 'public_static'.
 */
export function normalizeLegacyPage<T extends Partial<PageData> | null | undefined>(page: T): T {
  if (page && (page.status as string) === 'db') {
    const next = { ...page, status: 'public_static', output_format: 'db' } as Partial<PageData>;
    delete next.expand_tags;
    return next as T;
  }
  return page;
}

// ---- Categories: "_" marks structural ones; "@" is reserved for selectors such as @same ----
export const splitCategories = (category: unknown): string[] => String(category ?? '').split(',').map(c => c.trim()).filter(Boolean);
export const isStructuralCategory = (category: string): boolean => category.startsWith('_');
export const visibleCategories = (category: unknown): string[] => splitCategories(category).filter(c => !isStructuralCategory(c));
/** Structural categories after the ordinary ones, each group in alphabetical order (as in the PHP editor). */
export const sortCategories = (categories: string[]): string[] => [...categories].sort((a, b) =>
  Number(isStructuralCategory(a)) - Number(isStructuralCategory(b)) || (a < b ? -1 : a > b ? 1 : 0));

/** Footer component IDs, in order: wrappers, AI documents and unknown IDs are dropped. */
export async function normalizeFooterComponents(value: unknown, load: (id: string) => Promise<ComponentData | null>): Promise<string[]> {
  const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const ids: string[] = [];
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || ids.includes(id)) continue;
    const component = await load(id);
    if (!component || component.is_wrapper || component.is_ai_doc) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Output-format fields of a page from submitted values. `input` holds output_format,
 * md_footer_comps (array or comma-separated) and expand_tags; an absent key keeps the existing value.
 */
export async function pageFormatFields(input: Record<string, unknown>, existing: Partial<PageData> | null | undefined,
  load: (id: string) => Promise<ComponentData | null>): Promise<Pick<PageData, 'output_format' | 'md_footer_comps' | 'expand_tags'>> {
  let format = 'output_format' in input ? String(input.output_format) as OutputFormat : pageOutputFormat(existing);
  if (!OUTPUT_FORMATS.includes(format)) format = 'html';
  const footer = 'md_footer_comps' in input ? input.md_footer_comps : (existing?.md_footer_comps ?? []);
  const fields: Pick<PageData, 'output_format' | 'md_footer_comps' | 'expand_tags'> = {
    output_format: format,
    md_footer_comps: await normalizeFooterComponents(footer, load),
  };
  if (isDataFormat(format)) {
    if ('expand_tags' in input && input.expand_tags !== null && input.expand_tags !== undefined) fields.expand_tags = !!input.expand_tags;
    else if (typeof existing?.expand_tags === 'boolean' && pageOutputFormat(existing) === format) fields.expand_tags = existing.expand_tags;
    else fields.expand_tags = expandTagsDefault(format);
  }
  return fields;
}

/** Apply the format fields: expand_tags is kept only on data-format pages. */
export function withFormatFields(page: PageData, fields: Pick<PageData, 'output_format' | 'md_footer_comps' | 'expand_tags'>): PageData {
  const next: PageData = { ...page, ...fields };
  if (!isDataFormat(next.output_format)) delete next.expand_tags;
  return next;
}

/**
 * Check a page before it is saved (admin screen and MCP alike). Returns a translated
 * error message, or null. `oldId` is the ID the page had before this save ('' for a new page).
 * The Cloud edition always has a published URL, so formats with Markdown are always available.
 */
export function validatePageSave(id: string, oldId: string, data: Partial<PageData>, t: Translator): string | null {
  const isNewId = oldId === '' || oldId !== id;
  // IDs never contain dots: the extension comes from the output format.
  if (isNewId && id.includes('.')) return t('err_page_id_dot', id);
  for (const category of splitCategories(data.category)) {
    if (category.startsWith('@')) return t('err_category_reserved', category);
  }
  if (data.output_format !== undefined && !OUTPUT_FORMATS.includes(data.output_format as OutputFormat)) return t('err_output_format_invalid');
  const format = pageOutputFormat(data);
  if (id === '404' && format !== 'html') return t('err_output_format_404');
  const extension = formatExtension(format);
  if (extension !== null && RESERVED_OUTPUT_FILES.includes((id + '.' + extension).toLowerCase())) {
    return t('err_output_format_reserved', id + '.' + extension);
  }
  return null;
}

/** Encoded path of a page ID (each segment URL-encoded, the slashes kept). */
export const encodePageIdPath = (id: string): string => id.split('/').map(encodeURIComponent).join('/');

/**
 * The published file of a page (as the static site stores it): HTML at /id.html (/index.html),
 * Markdown-only at /id.md, data at /id.<extension>, mikanBox DB at /api/id.json.
 * HTML + Markdown publishes /id.html and, beside it, /id.md.
 */
export function publishedPath(id: string, page: Partial<PageData>): string {
  const format = pageOutputFormat(page);
  if (isApiFormat(format)) return '/api/' + id + '.json';
  const extension = formatExtension(format);
  if (extension !== null) return '/' + id + '.' + extension;
  return id === 'index' ? '/index.html' : '/' + id + '.html';
}

/** The public URL path visitors use: /id (or /) for HTML and Markdown-only pages, /id.<ext> for data, /api/id.json for DB. */
export function publicUrlPath(id: string, page: Partial<PageData>): string {
  const format = pageOutputFormat(page);
  if (isApiFormat(format)) return '/api/' + encodePageIdPath(id) + '.json';
  if (isDataFormat(format)) return '/' + encodePageIdPath(id) + '.' + format;
  return id === 'index' ? '/' : '/' + encodePageIdPath(id);
}

/** Sitemap and RSS URL of a page: Markdown-only pages point at /id.md (as in the PHP editions). */
export function feedPageUrl(siteUrl: string, id: string, page: Partial<PageData>): string {
  const format = pageOutputFormat(page);
  if (isApiFormat(format)) return siteUrl + '/api/' + id + '.json';
  if (format === 'md') return siteUrl + '/' + id + '.md';
  return siteUrl + '/' + (id === 'index' ? '' : id);
}

/**
 * Where the admin preview buttons (page list and page editor) open a page. HTML pages open
 * the preview of the page; Markdown-only, data and DB pages open /admin?page_preview=ID,
 * which answers with charset=utf-8 so the text is never garbled.
 */
export function adminPreviewUrl(id: string, page: Partial<PageData>): string {
  const format = pageOutputFormat(page);
  if (formatExtension(format) !== null || isApiFormat(format)) return '/admin?page_preview=' + encodeURIComponent(id);
  return '/preview/' + encodePageIdPath(id);
}

/** Short label for the page list (an extension code, not translated). */
export function formatBadge(format: OutputFormat): string {
  if (format === 'html_md') return '+MD';
  if (format === 'db') return 'DB';
  return (formatExtension(format) || '').toUpperCase();
}
