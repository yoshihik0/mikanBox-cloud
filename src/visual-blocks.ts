// Visual editing: block splitting and markers. A port of shared/lib/visual-blocks.php; keep the two in step
// (tests/visual-blocks.test.cjs runs the same cases as shared/tests/visual_blocks_test.php).
// PHP's \s and trim() are ASCII-only, so the classes below are spelled out instead of using JS \s and trim().
import type { PageData } from './types';

export interface VisualBlock { start: number; end: number; text: string; list: boolean; pendingBlank?: boolean }

const WS = '[ \\t\\n\\x0B\\f\\r]';
const blank = (line: string) => /^[ \t\n\r\0\x0B]*$/.test(line);
const escapeChar = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Compiled once: these run for every line of every live preview.
const closingFences = new Map<string, RegExp>();
const closingFence = (fence: [string, number], line: string) => {
  const key = fence[0] + fence[1];
  let re = closingFences.get(key);
  if (!re) closingFences.set(key, re = new RegExp(`^${WS}*${escapeChar(fence[0])}{${fence[1]},}${WS}*$`));
  return re.test(line);
};
const OPENING_FENCE = new RegExp(`^${WS}*(\`{3,}|~{3,})`);
const LIST_START = new RegExp(`^${WS}*([-*+]|\\d+[.)])${WS}`);
const INDENTED = new RegExp(`^${WS}{2,}\\S`);
const openingFence = (line: string) => OPENING_FENCE.exec(line);
const count = (re: RegExp, s: string) => (s.match(re) || []).length;
const DATA_OPEN = /\{\{DATA(?:ROW)?:[^}]*\}\}/g;
const DATA_CLOSE = /\{\{\/DATA(?:ROW)?\}\}/g;

/** How many tags a line leaves open. Comments, self-closing and void tags are not counted; <p> may omit its end tag, so it is not counted. */
function htmlDepthDelta(line: string): number {
  line = line.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)(div|section|article|aside|header|footer|main|nav|ul|ol|table|details|figure|form|blockquote|pre|span|a|script|style)\b[^>]*?(\/?)>/gi;
  let d = 0, m: RegExpExecArray | null;
  while ((m = re.exec(line))) { if (m[3] === '/') continue; d += m[1] === '/' ? -1 : 1; }
  return d;
}

/** Lines between a tag opening and closing (blank lines there do not split a block). A tag that never closes is skipped. */
function htmlProtectedLines(lines: string[]): Set<number> {
  const n = lines.length, deltas: number[] = []; let fence: [string, number] | null = null;
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (fence) { if (closingFence(fence, l)) fence = null; deltas[i] = 0; continue; }
    const m = openingFence(l);
    if (m) { fence = [m[1][0], m[1].length]; deltas[i] = 0; continue; }
    deltas[i] = htmlDepthDelta(l);
  }
  const prot = new Set<number>(); let i = 0;
  while (i < n) {
    if (deltas[i] <= 0) { i++; continue; }
    let depth = 0, end = -1;
    for (let j = i; j < n; j++) { depth += deltas[j]; if (depth <= 0) { end = j; break; } }
    if (end < 0) { i++; continue; }
    for (let k = i; k <= end; k++) prot.add(k);
    i = end + 1;
  }
  return prot;
}

/** Splits Markdown into blank-line-separated blocks (a code fence or a {{DATA…}} range is one block; so is HTML until it closes). */
export function splitBlocks(src: string): VisualBlock[] {
  const lines = src.split('\n'), blocks: VisualBlock[] = [], prot = htmlProtectedLines(lines);
  let cur: VisualBlock | null = null, fence: [string, number] | null = null, dataDepth = 0;
  const isListStart = (l: string) => LIST_START.test(l);
  const isIndented = (l: string) => INDENTED.test(l);
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  // HTML that is still open (the next line is in the same range): a DATA range or code fence closing here does not end the block
  const inHtml = (i: number) => prot.has(i) && prot.has(i + 1);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (fence) {
      cur!.end = i;
      if (closingFence(fence, l)) { fence = null; if (!inHtml(i)) flush(); }
      continue;
    }
    if (dataDepth > 0) {
      cur!.end = i;
      dataDepth += count(DATA_OPEN, l) - count(DATA_CLOSE, l);
      if (dataDepth <= 0) { dataDepth = 0; if (!inHtml(i)) flush(); }
      continue;
    }
    if (blank(l)) {
      if (cur && prot.has(i)) cur.end = i; else if (cur) cur.pendingBlank = true;
      continue;
    }
    if (cur && cur.pendingBlank) {
      if (cur.list && (isListStart(l) || isIndented(l))) { cur.pendingBlank = false; cur.end = i; continue; }
      flush();
    }
    if (!cur) cur = { start: i, end: i, list: isListStart(l), text: '' }; else cur.end = i;
    const m = openingFence(l), opens = count(DATA_OPEN, l);
    if (m) fence = [m[1][0], m[1].length];
    else if (opens) { dataDepth = opens - count(DATA_CLOSE, l); if (dataDepth <= 0) dataDepth = 0; }
  }
  flush();
  for (const b of blocks) { b.text = lines.slice(b.start, b.end + 1).join('\n'); delete b.pendingBlank; }
  return blocks;
}

/** Wraps each block in <!--fv:start-end--> … <!--/fv--> (blocks were already separated by blank lines). */
export function injectMarkers(md: string): string {
  const lines = md.split('\n'), out: string[] = []; let i = 0;
  for (const b of splitBlocks(md)) {
    while (i < b.start) out.push(lines[i++]);
    out.push(`<!--fv:${b.start}-${b.end}-->`, '');
    while (i <= b.end) out.push(lines[i++]);
    out.push('', '<!--/fv-->');
  }
  while (i < lines.length) out.push(lines[i++]);
  return out.join('\n');
}

/** Removes the <p> that Markdown puts around a marker. The browser side adds data-ln between the markers. */
export function applyMarkers(html: string): string {
  return html.replace(new RegExp(`<p>${WS}*(<!--/?fv(?::\\d+-\\d+)?-->)${WS}*</p>${WS}*`, 'g'), '$1');
}

/** A Raw HTML page with <html> or <body>: markers have no place to go, so the screen walks the document tree instead. */
export function isDoc(data: Pick<PageData, 'is_html' | 'content_md'>): boolean {
  return !!data.is_html && /<(?:html|body)\b/i.test(String(data.content_md ?? ''));
}
