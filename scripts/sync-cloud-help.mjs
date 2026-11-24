import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
// The public help MCP falls back to a bundled copy of the one public manual: the workspace-root
// help_ja.md / help_en.md, which are published as the official site's help pages. The bundle in
// src/ is committed, so a checkout without the workspace (CI, the update workflow) uses it as it is.
const manual=lang=>new URL(`../../help_${lang}.md`,import.meta.url);
if(['ja','en'].every(lang=>existsSync(manual(lang)))){
  const documents={};
  for(const lang of ['ja','en'])documents[lang]=await readFile(manual(lang),'utf8');
  await writeFile(new URL('../src/cloud-help-data.json',import.meta.url),JSON.stringify(documents,null,2)+'\n');
  console.log('Bundled the official manual for the public help MCP.');
}else console.log('Workspace manuals not found: using the committed src/cloud-help-data.json.');
// The shared admin behaviour (toast, in-screen confirmation, no-reload actions, editor motion) is
// canonical in shared/admin-ui.js. It is copied here when the workspace has shared/ (development).
// The copy in public/mikanbox/ is committed, so a checkout without shared/ (CI, the update
// workflow) uses it as it is, like the other synced files. It is never edited in Cloud.
const shared=new URL('../../shared/admin-ui.js',import.meta.url);
if(existsSync(shared)){await copyFile(shared,new URL('../public/mikanbox/admin-ui.js',import.meta.url));console.log('Copied shared/admin-ui.js.');}
else console.log('shared/ not found: using the committed public/mikanbox/admin-ui.js.');
