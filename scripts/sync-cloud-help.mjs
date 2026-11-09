import {copyFile,readFile,writeFile} from 'node:fs/promises';
const documents={};
for(const lang of ['ja','en'])documents[lang]=await readFile(new URL(`../docs/cloud_${lang}.md`,import.meta.url),'utf8');
await writeFile(new URL('../src/cloud-help-data.json',import.meta.url),JSON.stringify(documents,null,2)+'\n');
console.log('Bundled the two Cloud-specific manuals.');
// The shared admin behaviour (toast, in-screen confirmation, no-reload actions, editor motion) is
// canonical in shared/admin-ui.js. shared/sync-cloud.sh does not carry it, so it is copied here,
// on every check, test and build, and never edited in Cloud.
await copyFile(new URL('../../shared/admin-ui.js',import.meta.url),new URL('../public/mikanbox/admin-ui.js',import.meta.url));
console.log('Copied shared/admin-ui.js.');
