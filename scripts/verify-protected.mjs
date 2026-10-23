import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const cloud = fileURLToPath(new URL('../', import.meta.url));
const root = path.dirname(cloud.replace(/\/$/, ''));
const baselinePath = path.join(cloud, '.baseline/protected-files.json');
let baseline;
try { baseline = JSON.parse(await readFile(baselinePath, 'utf8')); }
catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error('Protected baseline missing. Record the PHP/shared baseline before development; do not reset an existing baseline.');
  }
  throw error;
}
const failures = [];
// Keep the original baseline intact. Explicitly authorized common-edition
// changes are recorded separately, with both the original and reviewed hashes.
let authorized = {};
for (const ledger of ['authorized-common-settings.json', 'authorized-css-placement.json', 'authorized-js-editor-help.json', 'authorized-common-head.json', 'authorized-media-interface.json', 'authorized-r2-storage.json', 'authorized-code-media.json', 'authorized-admin-copy.json', 'authorized-manual-structure.json', 'authorized-english-promotion.json', 'authorized-deploy-credentials.json', 'authorized-initial-content.json', 'authorized-generated-media-config.json', 'authorized-ssg-root-url.json', 'authorized-static-label.json']) {
  try { Object.assign(authorized, JSON.parse(await readFile(path.join(cloud, '.baseline', ledger), 'utf8')).files); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const metadata = relative => relative.split(path.sep).includes('.git');
const digestOf = async relative => {
  try { return createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex'); }
  catch { return null; }
};
let reviewed = 0;
for (const [relative, expected] of Object.entries(baseline)) {
  if (metadata(relative)) continue; // Git may refresh its index during read-only status checks.
  const approved = authorized[relative];
  if (approved && approved.before !== expected) { failures.push(`invalid authorization: ${relative}`); continue; }
  const digest = await digestOf(relative);
  // A reviewed removal records after: null, so the file has to be absent now.
  if (approved && approved.after === null) {
    if (digest === null) reviewed++;
    else failures.push(`should be removed: ${relative}`);
    continue;
  }
  if (digest === null) { failures.push(`missing: ${relative}`); continue; }
  if (digest !== (approved?.after ?? expected)) failures.push(`changed: ${relative}`);
  else if (approved) reviewed++;
}
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (metadata(relative)) continue;
    if (entry.isDirectory()) { await walk(relative); continue; }
    if (!entry.isFile() || relative in baseline) continue;
    // A reviewed addition records before: null, since the original baseline has no hash for it.
    const approved = authorized[relative];
    if (!approved) { failures.push(`added: ${relative}`); continue; }
    if (approved.before !== null) { failures.push(`invalid authorization: ${relative}`); continue; }
    if (await digestOf(relative) !== approved.after) failures.push(`changed: ${relative}`);
    else reviewed++;
  }
}
for (const directory of ['mikanBox-flat', 'mikanBox-sqlite', 'shared']) await walk(directory);
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Original baseline retained; ${reviewed} authorized shared files match. Other source files unchanged.`);
