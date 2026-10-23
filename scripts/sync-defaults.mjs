import {readdir,readFile,writeFile} from 'node:fs/promises';
const presets={};
for(const lang of ['ja','en']) {
  presets[lang]={pages:{},components:{}};
  for(const [directory,key] of [['posts','pages'],['components','components']]) {
    const source=new URL(`../../shared/import/${lang}/${directory}/`,import.meta.url);
    for(const filename of (await readdir(source)).sort()) {
      if(!filename.endsWith('.json'))continue;
      const data=JSON.parse(await readFile(new URL(filename,source),'utf8'));
      // Repair invalid selector semicolons in the shared header copy, without changing its source.
      if(key==='components'&&filename==='_header.json') data.css=data.css.replace(/(^\s*\.[^{}\r\n;]+);(\s*\{)/gm,'$1$2');
      presets[lang][key][filename.slice(0,-5)]=data;
    }
  }
}
await writeFile(new URL('../src/defaults-data.json',import.meta.url),JSON.stringify(presets,null,2)+'\n');
console.log('Copied standard Japanese/English content into Cloud only.');
