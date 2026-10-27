(() => {
  const MAX_FILE = 20 * 1024 * 1024;
  const MAX_ENTRIES = 1000;
  const MAX_EXPANDED = 15 * 1024 * 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const english = document.documentElement.lang === 'en';
  const msg=(ja,en)=>english?en:ja;

  function field(node, ns, name) {
    return node.getElementsByTagNameNS(ns, name)[0]?.textContent || '';
  }

  function htmlToMarkdown(html) {
    const root = new DOMParser().parseFromString(html, 'text/html').body;
    const convert = element => Array.from(element.childNodes).map(node => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase(), content = convert(node);
      if (/^h[1-6]$/.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${content}\n`;
      if (tag === 'strong' || tag === 'b') return `**${content}**`;
      if (tag === 'em' || tag === 'i') return `*${content}*`;
      if (tag === 'a') return `[${content}](${node.getAttribute('href') || ''})`;
      if (tag === 'img') return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
      if (tag === 'li') return `* ${content}\n`;
      if (tag === 'blockquote') return `\n> ${content}\n`;
      if (tag === 'br') return '\n';
      if (tag === 'p' || tag === 'div') return `\n${content}\n`;
      if (tag === 'script' || tag === 'style') return '';
      return content;
    }).join('');
    return convert(root).replace(/\n{3,}/g, '\n\n').trim();
  }

  function parseWxr(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(msg('XMLの解析に失敗しました。','The XML file could not be parsed.'));
    const wpNode=doc.getElementsByTagNameNS('*','post_type')[0];
    const contentNode=doc.getElementsByTagNameNS('*','encoded')[0];
    const wp=wpNode?.namespaceURI||'http://wordpress.org/export/1.2/';
    const content=contentNode?.namespaceURI||'http://purl.org/rss/1.0/modules/content/';
    const items = Array.from(doc.getElementsByTagName('item'));
    const pages = [];
    for (const item of items) {
      const postType = field(item, wp, 'post_type');
      if (postType !== 'post' && postType !== 'page') continue;
      const title = item.getElementsByTagName('title')[0]?.textContent || '';
      const categories = Array.from(item.getElementsByTagName('category'));
      const category = categories.find(node => node.getAttribute('domain') === 'category')?.textContent || '';
      const raw = {
        title,
        slug: field(item, wp, 'post_name'),
        postId: field(item, wp, 'post_id'),
        status: field(item, wp, 'status'),
        date: field(item, wp, 'post_date'),
        category,
        content_md: htmlToMarkdown(field(item, content, 'encoded'))
      };
      pages.push(raw);
    }
    if (!pages.length) throw new Error(msg('投稿または固定ページが見つかりません。','No WordPress posts or pages were found.'));
    return { pages };
  }

  async function unzip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let eocd = -1;
    for (let i = Math.max(0, bytes.length - 65557); i <= bytes.length - 22; i++) {
      if (view.getUint32(i, true) === 0x06054b50) eocd = i;
    }
    if (eocd < 0) throw new Error(msg('有効なZIPファイルではありません。','The file is not a valid ZIP archive.'));
    if(view.getUint16(eocd+4,true)!==0||view.getUint16(eocd+6,true)!==0)throw new Error(msg('複数ディスクZIPには対応していません。','Multi-disk ZIP files are unsupported.'));
    const count = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
    if (count > MAX_ENTRIES || centralOffset + centralSize > eocd) throw new Error(msg('ZIP内のファイル数または構造が上限を超えています。','The ZIP has too many entries or an invalid directory.'));
    const files = new Map(); let at = centralOffset, total = 0;
    for (let i = 0; i < count; i++) {
      if (at+46>bytes.length||view.getUint32(at, true) !== 0x02014b50) throw new Error(msg('ZIPの一覧が破損しています。','The ZIP directory is damaged.'));
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), expectedCrc=view.getUint32(at+16,true), packed = view.getUint32(at + 20, true);
      const size = view.getUint32(at + 24, true), nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true), localAt = view.getUint32(at + 42, true);
      if(at+46+nameLen+extraLen+commentLen>bytes.length)throw new Error(msg('ZIPの一覧が破損しています。','The ZIP directory is damaged.'));
      const name = decoder.decode(bytes.slice(at + 46, at + 46 + nameLen)).replaceAll('\\', '/');
      at += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      if(name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').includes('..'))throw new Error(msg('ZIPに安全でないファイルパスがあります。','The ZIP contains an unsafe file path.'));
      if (flags & 1) throw new Error(msg('暗号化されたZIPには対応していません。','Encrypted ZIP entries are unsupported.'));
      if (method!==0&&method!==8) throw new Error(msg(`ZIP圧縮方式 ${method} には対応していません。`,`ZIP compression method ${method} is unsupported.`));
      if (size > MAX_EXPANDED || (total += size) > MAX_EXPANDED) throw new Error(msg('ZIPの展開サイズが上限を超えています。','The expanded ZIP exceeds the size limit.'));
      if (localAt+30>bytes.length||view.getUint32(localAt, true) !== 0x04034b50) throw new Error(msg('ZIPファイル項目が破損しています。','A ZIP entry is damaged.'));
      const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
      if(start+packed>centralOffset)throw new Error(msg('ZIPファイル項目が破損しています。','A ZIP entry is damaged.'));
      if(files.has(name))throw new Error(msg(`ZIP内に同じファイル名があります: ${name}`,`The ZIP contains duplicate paths: ${name}`));
      const compressed = bytes.slice(start, start + packed);
      let data;
      if (method === 0) data = compressed;
      else {
        if (!('DecompressionStream' in window)) throw new Error(msg('このブラウザーではZIPの解凍に対応していません。','This browser cannot decompress ZIP files.'));
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        data = await readLimited(stream,Math.min(MAX_EXPANDED,size));
      }
      if (data.length !== size||crc32(data)!==expectedCrc) throw new Error(msg('ZIPファイル項目のサイズまたはチェックサムが一致しません。','A ZIP entry failed its size or checksum check.'));
      files.set(name, data);
    }
    return files;
  }

  async function readLimited(stream,limit){
    const reader=stream.getReader(),chunks=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new Error(msg('ZIPの展開サイズが上限を超えています。','The expanded ZIP exceeds the size limit.'));}chunks.push(value);}}
    finally{reader.releaseLock();}
    const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
  }
  function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}

  function parsePackageFiles(files) {
    const json = new Map();
    for (const [name, bytes] of files) {
      const parts = name.replace(/^\.\//, '').split('/');
      if (parts.includes('__MACOSX') || parts.some(part => part.startsWith('._'))) continue;
      if (!name.toLowerCase().endsWith('.json')) continue;
      const clean = name.replace(/^\.\//, '');
      try { json.set(clean, JSON.parse(decoder.decode(bytes))); } catch (error) {
        if(/(?:^|\/)(?:posts|components)\//.test(clean))throw new Error(msg(`パッケージ内のJSONを解析できません: ${clean}`,`Could not parse package JSON: ${clean}`));
      }
    }
    const paths = [...json.keys()];
    let prefix = '';
    for (const path of paths) {
      for (const directory of ['posts/','components/']) {
        const at=path.indexOf(directory);
        if(at>=0 && (prefix==='' || at<prefix.length)) prefix=path.slice(0,at);
      }
      if(path.endsWith('/settings.json')) {
        const root=path.slice(0,-'settings.json'.length);
        if(prefix==='' || root.length<prefix.length) prefix=root;
      }
    }
    const pages = [], components = [];
    for (const [path, data] of json) {
      const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      if (!relative.endsWith('.json')) continue;
      const id = relative.slice(0, -5);
      if (relative.startsWith('posts/') && data && typeof data === 'object' && !Array.isArray(data)) pages.push({id: id.slice(6), data});
      if (relative.startsWith('components/') && data && typeof data === 'object' && !Array.isArray(data)) components.push({id: id.slice(11), data});
    }
    if (!pages.length && !components.length) throw new Error(msg('posts/ または components/ のJSONデータが見つかりません。','No posts/ or components/ JSON data was found.'));
    return {pages, components};
  }

  function setLog(message, kind='info') {
    const log = document.querySelector('[data-import-log]');
    if (!log) return;
    const line = document.createElement('div'); line.className = `import-log-${kind}`; line.textContent = message; log.prepend(line);
  }

  async function submitImport(form, action, payload) {
    const status=form.querySelector('[data-import-status]');
    const button=form.querySelector('button[type="submit"],button:not([type])');
    if(button) button.disabled=true;
    if(status) status.textContent=msg('解析・インポート中…','Parsing and importing…');
    try {
      const data=new FormData(form); data.delete('package_zip'); data.delete('wp_xml'); data.set('ajax_request','1'); data.set('save_action',action); data.set('import_payload',JSON.stringify(payload));
      const response=await fetch('/admin',{method:'POST',body:data,credentials:'same-origin',headers:{'Accept':'application/json'}});
      const result=await response.json();
      if(!response.ok || !result.success) throw new Error(result.error || result.message || msg('インポートに失敗しました。','Import failed.'));
      const done=english?`Import complete: ${result.pages} pages, ${result.components} components; ${result.skippedPages + result.skippedComponents} skipped`:`インポート完了: ページ ${result.pages} 件、コンポーネント ${result.components} 件、${result.skippedPages + result.skippedComponents} 件をスキップ`;
      for(const key of ['pages','components']){const total=document.querySelector('[data-import-total="'+key+'"]');if(total)total.textContent=String(Number(total.textContent)+result[key]);}
      setLog(done,'success'); if(status) status.textContent=done;
    } catch(error) {
      const errorMessage=error instanceof Error?error.message:msg('インポートに失敗しました。','Import failed.');setLog(errorMessage,'error');if(status)status.textContent=errorMessage;
    } finally { if(button)button.disabled=false; }
  }

  document.querySelectorAll('form[data-content-import]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const file=form.querySelector('input[type="file"]')?.files?.[0];
    if(!file)return;
    if(file.size>MAX_FILE){setLog(msg('ファイルサイズは20 MB以下にしてください。','Choose a file smaller than 20 MB.'),'error');return;}
    try {
      if(form.dataset.contentImport==='package') {
        const payload=parsePackageFiles(await unzip(file));
        await submitImport(form,'content_import_package',payload);
      } else {
        const payload=parseWxr(await file.text());
        await submitImport(form,'content_import_wordpress',payload);
      }
    } catch(error) { const errorMessage=error instanceof Error?error.message:msg('ファイルを解析できません。','The file could not be parsed.');setLog(errorMessage,'error'); }
  }));
  if(window.__MIKANBOX_IMPORT_TEST__)window.__MIKANBOX_IMPORT_TEST__={parseWxr,unzip,parsePackageFiles,crc32};
})();
