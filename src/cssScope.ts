// Cloud-local CSS scoping. Keep functional selectors, strings, and keyframes intact.
function splitSelectors(source:string):string[] {
  const result:string[]=[];let start=0,depth=0,quote='';
  for(let i=0;i<source.length;i++) {
    const ch=source[i];
    if(quote){if(ch==='\\')i++;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='('||ch==='[')depth++;
    if(ch===')'||ch===']')depth--;
    if(ch===','&&depth===0){result.push(source.slice(start,i));start=i+1;}
  }
  result.push(source.slice(start));return result.map(x=>x.trim()).filter(Boolean);
}
function delimiter(source:string,start:number,closing=false) {
  let quote='',depth=closing?1:0,parens=0;
  for(let i=start;i<source.length;i++) {
    const ch=source[i];
    if(quote){if(ch==='\\')i++;else if(ch===quote)quote='';continue;}
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='/'&&source[i+1]==='*'){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+1;continue;}
    if(ch==='('||ch==='[')parens++;
    if(ch===')'||ch===']')parens--;
    if(parens)continue;
    if(closing){if(ch==='{')depth++;if(ch==='}'&&--depth===0)return i;}
    else if(ch==='{'||ch===';')return i;
  }
  return source.length;
}
export function scopeCss(css:string,prefix:string):string {
  if(!css.trim())return '';
  const tags:string[]=[];
  css=css.replace(/\{\{[^}]+\}\}/g,tag=>`___MIKANTAG${tags.push(tag)-1}___`);
  let result='',position=0;
  while(position<css.length) {
    const opening=delimiter(css,position),prelude=css.slice(position,opening).trim();
    if(opening===css.length){result+=css.slice(position);break;}
    if(css[opening]===';'){result+=css.slice(position,opening+1);position=opening+1;continue;}
    const end=delimiter(css,opening+1,true);
    const body=css.slice(opening+1,end);
    const cleanPrelude=prelude.replace(/\/\*[\s\S]*?\*\//g,'').trim();
    if(/^@(media|supports|container|layer|scope|document)\b/i.test(cleanPrelude)) {
      result+=`${prelude}{${scopeCss(body,prefix)}}`;
    } else if(cleanPrelude.startsWith('@')) {
      result+=`${prelude}{${body}}`;
    } else {
      const scoped=splitSelectors(prelude).map(selector=>{
        if(selector===prefix||selector.startsWith(prefix+' '))return selector;
        if(/^(:root|html|body)(?=[\s.#[>:]|$)/.test(selector))return selector.replace(/^(:root|html|body)/,prefix);
        return `${prefix} ${selector}`;
      });
      result+=scoped.join(', ')+`{${body}}`;
    }
    position=end+1;
  }
  return result.replace(/___MIKANTAG(\d+)___/g,(_,index)=>tags[Number(index)]||'');
}
