import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const pairs = [
  ['../shared/admin.css', 'public/mikanbox/admin.css'],
  ['../shared/ai-question.js', 'public/mikanbox/ai-question.js'],
  ['../shared/lang/ja.json', 'lang/ja.json'],
  ['../shared/lang/en.json', 'lang/en.json'],
  ['../help_ja.md', 'docs/help_ja.md'],
  ['../help_en.md', 'docs/help_en.md']
];
for (const [source, destination] of pairs) {
  const target = new URL(`../${destination}`, import.meta.url);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(`../${source}`, import.meta.url), target);
}
console.log('Copied six canonical files into Cloud only.');
const scriptFile=new URL('../public/mikanbox/ai-question.js',import.meta.url);
const script=await readFile(scriptFile,'utf8');
await writeFile(scriptFile,script.replace("const officialPublicMcpUrl = 'https://yoshihiko.com/mikanbox/mcp';","const officialPublicMcpUrl = new URL((script && script.dataset.publicMcp) || 'https://yoshihiko.com/mikanbox/mcp', document.baseURI).href;").replace('new URL(publicHelpUrls[language])','new URL(publicHelpUrls[language], document.baseURI)'));
