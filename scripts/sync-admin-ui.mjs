import {copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
// The shared admin behaviour (toast, in-screen confirmation, no-reload actions, editor motion) is
// canonical in shared/admin-ui.js. It is copied here when the workspace has shared/ (development).
// The copy in public/mikanbox/ is committed, so a checkout without shared/ (CI, the update
// workflow) uses it as it is, like the other synced files. It is never edited in Cloud.
const shared=new URL('../../shared/admin-ui.js',import.meta.url);
if(existsSync(shared)){await copyFile(shared,new URL('../public/mikanbox/admin-ui.js',import.meta.url));console.log('Copied shared/admin-ui.js.');}
else console.log('shared/ not found: using the committed public/mikanbox/admin-ui.js.');
