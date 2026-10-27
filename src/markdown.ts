// ==========================================
// mikanBox Markdown Parser (functions.php::MikanBoxMarkdown の移植)
// ==========================================

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', Tab: '\t', NewLine: '\n',
  lpar: '(', rpar: ')', sol: '/', lsqb: '[', rsqb: ']', period: '.', comma: ',', semi: ';', num: '#',
  percnt: '%', plus: '+', equals: '=', quest: '?', excl: '!', commat: '@', dollar: '$',
};

/** HTML character references (numeric and the common named ones) back to characters. */
function decodeAttribute(value: string): string {
  return String(value).replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, (whole, dec, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function encodeAttribute(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * The URL of a Markdown link, decoded. A scheme other than http, https, mailto or tel
 * (javascript:, data:, vbscript:, ...) becomes "#". Browsers ignore tabs, line breaks and
 * leading control characters inside a scheme, so "java<TAB>script:" is checked as "javascript:".
 */
function markdownLinkUrl(raw: string): string {
  const url = decodeAttribute(raw);
  const probe = url.replace(/[\t\n\r\0]/g, '').replace(/^[\x00-\x20]+/, '');
  const scheme = probe.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
  return scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase()) ? '#' : url;
}

export class MikanBoxMarkdown {
  /** Extra attributes for an image URL (set by the renderer; empty when it adds none). */
  imageAttributes: (url: string) => string = () => '';
  text(text: string): string {
    if (!text) return '';

    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Protect fenced code before tables and inline syntax are processed.
    const fences: string[] = [], linesBefore = text.split('\n'), protectedLines: string[] = [];
    for (let index = 0; index < linesBefore.length; index++) {
      const opening = linesBefore[index].match(/^ {0,3}(`{3,}|~{3,})([^`~]*)$/);
      if (!opening) { protectedLines.push(linesBefore[index]); continue; }
      const content: string[] = [];
      const closing = new RegExp('^ {0,3}' + opening[1][0] + '{' + opening[1].length + ',}\\s*$');
      while (++index < linesBefore.length && !closing.test(linesBefore[index])) content.push(linesBefore[index]);
      const language = opening[2].trim().match(/^[A-Za-z0-9_-]+$/)?.[0] || '';
      const code = `<pre><code${language ? ` class="language-${language}"` : ''}>${this.escapeHtml(content.join('\n'))}</code></pre>`;
      protectedLines.push('\x05FENCE' + (fences.push(code) - 1) + '\x05');
    }
    text = protectedLines.join('\n');


    // テーブルを先に処理（GFM形式）
    text = text.replace(
      /^(\|.+)\n(\|[\s\-:|]+)\n((?:\|.+\n?)+)/gm,
      (_, headerRow, sepRow, bodyRows) => {
        const sepCells = sepRow.trim().replace(/^\||\|$/g, '').split('|').map((s: string) => s.trim());
        const aligns = sepCells.map((s: string) => {
          const l = s.startsWith(':'), r = s.endsWith(':');
          if (l && r) return ' style="text-align:center"';
          if (r) return ' style="text-align:right"';
          if (l) return ' style="text-align:left"';
          return '';
        });
        const headers = headerRow.trim().replace(/^\||\|$/g, '').split('|').map((s: string) => s.trim());
        let thead = '<tr>';
        headers.forEach((h: string, i: number) => {
          thead += `<th${aligns[i] ?? ''}>${this.parseInline(h)}</th>`;
        });
        thead += '</tr>';
        let tbody = '';
        for (const row of bodyRows.trimEnd().split('\n')) {
          const r = row.trim();
          if (!r || r[0] !== '|') continue;
          const cells = r.replace(/^\||\|$/g, '').split('|').map((s: string) => s.trim());
          tbody += '<tr>';
          cells.forEach((cell: string, i: number) => {
            tbody += `<td${aligns[i] ?? ''}>${this.parseInline(cell)}</td>`;
          });
          tbody += '</tr>';
        }
        return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>${bodyRows.endsWith('\n') ? '\n' : ''}`;
      }
    );

    const lines = text.split('\n');
    const result: string[] = [];
    let currentParagraph: string[] = [];
    let inHtmlBlock = false;
    let prevWasBlank = true;               // the start of the content counts as "after a blank line"
    let paragraphStartedAfterBlank = true; // decides whether a paragraph gets <p>

    // {.class #id} at the end of a block becomes its attributes
    const applyAttributes = (content: string, tag: string): string => {
      let idAttr = '';
      let classAttr = '';
      const attrMatch = content.match(/\s*\{([.#][^{}]+)\}\s*$/);
      if (attrMatch) {
        const attrString = attrMatch[1];
        content = content.replace(/\s*\{[.#][^{}]+\}\s*$/, '');
        const classMatches = [...attrString.matchAll(/\.([\w-]+)/g)];
        if (classMatches.length) classAttr = ` class="${classMatches.map(m => m[1]).join(' ')}"`;
        const idMatch = attrString.match(/#([\w-]+)/);
        if (idMatch) idAttr = ` id="${idMatch[1]}"`;
      }
      return `<${tag}${idAttr}${classAttr}>${content.trim()}</${tag}>`;
    };

    // followedByBlank=false means an HTML block follows without a blank line: no <p> then.
    const closeParagraph = (followedByBlank = true) => {
      if (currentParagraph.length === 0) return;
      let content = currentParagraph.join('\n');
      if (content.includes('\n')) {
        // a last line that only holds {.class} is an attribute list: join it to the line before
        content = content.replace(/\n(\s*\{[.#][^{}]+\}\s*)$/, ' $1');
        // no <br> right next to an HTML tag
        content = content.replace(/(?<!>)\n(?!<)/g, '<br>\n');
      }
      content = this.parseInline(content);
      // A paragraph that is only a protected {{TAG}} may expand to a block element; <p> around it is invalid HTML.
      const isTagOnly = /^\s*​?<!--MKNTG[a-zA-Z0-9+/=]+-->​?\s*$/.test(content);
      if (paragraphStartedAfterBlank && followedByBlank && !isTagOnly) result.push(applyAttributes(content, 'p'));
      else result.push(content.trim());
      currentParagraph = [];
    };

    const htmlBlockTags = 'a|address|article|aside|blockquote|body|button|canvas|caption|col|colgroup|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|meta|nav|noscript|ol|optgroup|option|p|pre|script|section|select|source|span|style|summary|table|tbody|td|tfoot|th|thead|title|tr|ul|video|audio';
    const htmlBlockStart = new RegExp('^\\s*(<\\/?(?:' + htmlBlockTags + '|!--|!DOCTYPE)[\\s\\/>])', 'i');
    const htmlBlockEnd = new RegExp('^\\s*<\\/(?:' + htmlBlockTags + ')\\s*>\\s*$', 'i');
    const selfContainedA = new RegExp('(?:<\\/(?:' + htmlBlockTags + ')\\s*>|\\/>|-->)\\s*$', 'i');
    const selfContainedB = /^\s*<(?:hr|link|meta|source|col)\b[^>]*>\s*$/i;

    for (const line of lines) {
      // A protected code fence is a block of its own.
      if (/^\x05FENCE\d+\x05$/.test(line)) {
        closeParagraph(true);
        result.push(line);
        prevWasBlank = true;
        continue;
      }

      // Inside an HTML block the lines are left alone until a blank line or a lone closing tag.
      if (inHtmlBlock) {
        if (line.trim() === '') {
          inHtmlBlock = false;
          prevWasBlank = true;
        } else {
          result.push(line);
          if (htmlBlockEnd.test(line)) {
            inHtmlBlock = false;
            prevWasBlank = false;
          }
        }
        continue;
      }

      if (line.trim() === '') {
        closeParagraph(true);
        prevWasBlank = true;
        continue;
      }

      if (htmlBlockStart.test(line)) {
        closeParagraph(false);
        result.push(line);
        // HTML that is complete on its own line does not open a block
        if (!(selfContainedA.test(line) || selfContainedB.test(line))) inHtmlBlock = true;
        prevWasBlank = false;
        continue;
      }

      let matches: RegExpMatchArray | null;
      if ((matches = line.match(/^\s*>(?:\s|　)?(.*)/))) {
        closeParagraph(true);
        result.push(applyAttributes(this.parseInline(matches[1]), 'blockquote'));
        prevWasBlank = true;
      } else if ((matches = line.match(/^\s*(#{1,6})(?:\s|　)+(.*)/))) {
        closeParagraph(true);
        result.push(applyAttributes(this.parseInline(matches[2]), `h${matches[1].length}`));
        prevWasBlank = true;
      } else if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line)) {
        closeParagraph(true);
        result.push('<hr>');
        prevWasBlank = true;
      } else if ((matches = line.match(/^\s*[\*\-\+](?:\s|　)+(.*)/))) {
        closeParagraph(true);
        result.push('<ul>' + applyAttributes(this.parseInline(matches[1]), 'li') + '</ul>');
        prevWasBlank = true;
      } else if ((matches = line.match(/^\s*\d+\.(?:\s|　)+(.*)/))) {
        closeParagraph(true);
        result.push('<ol>' + applyAttributes(this.parseInline(matches[1]), 'li') + '</ol>');
        prevWasBlank = true;
      } else {
        if (currentParagraph.length === 0) paragraphStartedAfterBlank = prevWasBlank;
        currentParagraph.push(line);
        prevWasBlank = false;
      }
    }

    closeParagraph(true);

    let output = result.join('\n');
    output = output.replace(/<\/ul>\n<ul>/g, '\n');
    output = output.replace(/<\/ol>\n<ol>/g, '\n');
    // consecutive quote lines become one blockquote, joined by <br> like lines inside a paragraph
    output = output.replace(/<\/blockquote>\n<blockquote>/g, '<br>\n');
    output = output.replace(/\x05FENCE(\d+)\x05/g, (_, index) => fences[Number(index)] || '');
    return output;
  }

  parseInline(text: string): string {
    const map: Record<string, string> = {};
    let count = 0;

    // 1. protect inline code
    text = text.replace(/`(.*?)`/g, (_, inner) => {
      const ph = `\x02CODE${count++}\x03`;
      map[ph] = `<code>${this.escapeHtml(inner)}</code>`;
      return ph;
    });

    // 2. protect image and link syntax so _ inside a URL is not read as italic.
    // URLs and alt text go into attributes: decode, check, then encode.
    text = text.replace(/!\[(.*?)\]\((.*?)\)/g, (_, alt, rawUrl) => {
      let url = decodeAttribute(rawUrl);
      if (!/^(?:https?:\/\/|\/|media\/)/.test(url)) url = 'media/' + url;
      const ph = `\x02LINK${count++}\x03`;
      map[ph] = `<img src="${encodeAttribute(url)}" alt="${encodeAttribute(decodeAttribute(alt))}"${this.imageAttributes(url)}>`;
      return ph;
    });
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, (_, label, rawUrl) => {
      const ph = `\x02LINK${count++}\x03`;
      map[ph] = `<a href="${encodeAttribute(markdownLinkUrl(rawUrl))}">${label}</a>`;
      return ph;
    });

    // 3. bold, italic, strikethrough
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');

    // 3.5 inline span with class/id: [text]{.class #id}
    // Nested spans work: the innermost ones (no [ ] inside) become placeholders first and the
    // loop repeats until nothing changes, so [[save]{.icon} Save]{.btn} is read from the inside out.
    let previous: string | null = null;
    let guard = 0;
    while (previous !== text && guard++ < 10) {
      previous = text;
      text = text.replace(/\[([^\[\]]+)\]\{([^}]+)\}/g, (_, content, attrs) => {
        let classAttr = '';
        let idAttr = '';
        const classMatches = [...attrs.matchAll(/\.([\w-]+)/g)];
        if (classMatches.length) classAttr = ` class="${classMatches.map((m: RegExpMatchArray) => m[1]).join(' ')}"`;
        const idMatch = attrs.match(/#([\w-]+)/);
        if (idMatch) idAttr = ` id="${idMatch[1]}"`;
        const ph = `\x02SPAN${count++}\x03`;
        map[ph] = `<span${idAttr}${classAttr}>${content}</span>`;
        return ph;
      });
    }

    // 4. restore placeholders, newest first: an outer span's HTML may hold earlier placeholders
    for (const [ph, html] of Object.entries(map).reverse()) text = text.split(ph).join(html);

    return text;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
