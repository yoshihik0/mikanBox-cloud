import {readFile,writeFile} from 'node:fs/promises';
const documents={};
for(const lang of ['ja','en'])documents[lang]=await readFile(new URL(`../docs/cloud_${lang}.md`,import.meta.url),'utf8');
await writeFile(new URL('../src/cloud-help-data.json',import.meta.url),JSON.stringify(documents,null,2)+'\n');
console.log('Bundled the two Cloud-specific manuals.');
