// ==========================================
// mikanBox Markdown Parser (functions.php::MikanBoxMarkdown の移植)
// ==========================================

export class MikanBoxMarkdown {
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
        return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
      }
    );

    const lines = text.split('\n');
    const result: string[] = [];
    let currentParagraph: string[] = [];
    let inCodeBlock = false;

    const applyAttributes = (content: string, tag: string | null): string | [string, string, string] => {
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

      if (tag === null) return [content.trim(), idAttr, classAttr];
      return `<${tag}${idAttr}${classAttr}>${content.trim()}</${tag}>`;
    };

    const closeParagraph = () => {
      if (currentParagraph.length === 0) return;
      let content = currentParagraph.join('\n');
      content = this.parseInline(content);
      if (content.includes('\n')) {
        content = content.replace(/\n/g, '<br>\n');
      }
      result.push(applyAttributes(content, 'p') as string);
      currentParagraph = [];
    };

    for (const line of lines) {
      if (/^```/.test(line)) {
        closeParagraph();
        if (inCodeBlock) {
          result.push('</code></pre>');
          inCodeBlock = false;
        } else {
          result.push('<pre><code>');
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        result.push(this.escapeHtml(line));
        continue;
      }

      if (line.trim() === '') {
        closeParagraph();
        continue;
      }

      const isHtmlBlockLine = /^\s*(<\/?(!|html|head|body|link|meta|script|style|div|section|article|aside|header|footer|p|h[1-6]|ul|ol|li|table|blockquote|pre|form|!--))/i.test(line);

      if (isHtmlBlockLine) {
        closeParagraph();
        const [content, id, cls] = applyAttributes(this.parseInline(line), null) as [string, string, string];
        if (cls || id) {
          result.push(`<p${id}${cls}>${content}</p>`);
        } else {
          result.push(content);
        }
        continue;
      }

      const blockquoteMatch = line.match(/^\s*>(?:\s|　)?(.*)/);
      if (blockquoteMatch) {
        closeParagraph();
        result.push(`<blockquote>${this.parseInline(blockquoteMatch[1])}</blockquote>`);
        continue;
      }

      const headingMatch = line.match(/^\s*(#{1,6})(?:\s|　)+(.*)/);
      if (headingMatch) {
        closeParagraph();
        const level = headingMatch[1].length;
        result.push(applyAttributes(this.parseInline(headingMatch[2]), `h${level}`) as string);
        continue;
      }

      if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line)) {
        closeParagraph();
        result.push('<hr>');
        continue;
      }

      const ulMatch = line.match(/^\s*[\*\-\+](?:\s|　)+(.*)/);
      if (ulMatch) {
        closeParagraph();
        result.push(`<ul><li>${this.parseInline(ulMatch[1])}</li></ul>`);
        continue;
      }

      const olMatch = line.match(/^\s*\d+\.(?:\s|　)+(.*)/);
      if (olMatch) {
        closeParagraph();
        result.push(`<ol><li>${this.parseInline(olMatch[1])}</li></ol>`);
        continue;
      }

      currentParagraph.push(line);
    }

    closeParagraph();

    let output = result.join('\n');
    output = output.replace(/<\/ul>\n<ul>/g, '\n');
    output = output.replace(/<\/ol>\n<ol>/g, '\n');
    output=output.replace(/<p>\x05FENCE(\d+)\x05<\/p>/g,(_,index)=>fences[Number(index)] || '');
    return output;
  }

  parseInline(text: string): string {
    const map: Record<string, string> = {};
    let count = 0;

    // 1. インラインコードを保護
    text = text.replace(/`(.*?)`/g, (_, inner) => {
      const ph = `\x02CODE${count++}\x03`;
      map[ph] = `<code>${this.escapeHtml(inner)}</code>`;
      return ph;
    });

    // 2. 画像・リンク構文を保護
    text = text.replace(/!\[(.*?)\]\((.*?)\)/g, (_, alt, url) => {
      if (!/^(?:https?:\/\/|\/|media\/)/.test(url)) url = 'media/' + url;
      const ph = `\x02LINK${count++}\x03`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) url = '#';
      map[ph] = `<img src="${this.escapeHtml(url).replace(/"/g, '&quot;')}" alt="${this.escapeHtml(alt).replace(/"/g, '&quot;')}">`;
      return ph;
    });
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, (_, label, url) => {
      const ph = `\x02LINK${count++}\x03`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url.replace(/[\u0000-\u0020]/g,'')) && !/^(https?:|mailto:|tel:)/i.test(url)) url = '#';
      map[ph] = `<a href="${this.escapeHtml(url).replace(/"/g, '&quot;')}">${label}</a>`;
      return ph;
    });

    // 3. 太字・斜体・打ち消し
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');

    // 3.5 インラインspan: [text]{.class #id}
    text = text.replace(/\[([^\]]+)\]\{([^}]+)\}/g, (_, content, attrs) => {
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

    // 4. プレースホルダーを復元
    for (const [ph, html] of Object.entries(map)) {
      text = text.replace(ph, html);
    }

    return text;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
