import assert from 'node:assert/strict';import {readdir,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const base=process.env.MIKANBOX_CLOUD_URL?.replace(/\/$/,'');if(!base||!/^https:\/\//.test(base))throw new Error('Set MIKANBOX_CLOUD_URL to the intended HTTPS site URL.');
const expectedVersion=JSON.parse(await readFile('package.json','utf8')).version;
const indexStatic=await readFile('.publication/index.html').then(()=>true,()=>false);
const staticPaths=[...(indexStatic?['/','/index.html']:[]),'/sample_page','/sample_page/','/sample_page.html','/sample_markdown','/sample_tags'];
for(const path of staticPaths){const response=await fetch(base+path);assert.equal(response.status,200,path);assert.equal(response.headers.get('X-Mikanbox-Delivery'),'static',path);assert.match(response.headers.get('Content-Type'),/text\/html/,path);}
for(const path of [...(indexStatic?[]:['/','/index.html']),'/search?q=mikan','/search.html?q=mikan','/admin','/public-mcp?action=get_product_info&language=ja','/sitemap.xml']){const response=await fetch(base+path);assert.equal(response.status,200,path);assert.equal(response.headers.get('X-Mikanbox-Delivery'),'worker',path);}
const images=await readdir('.publication/media').catch(()=>[]);
for(const image of images){const response=await fetch(base+'/media/'+encodeURIComponent(image));assert.equal(response.status,200);assert.equal(response.headers.get('X-Mikanbox-Delivery'),'static');const original=await readFile('.publication/media/'+image);const served=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(served).digest('hex'),createHash('sha256').update(original).digest('hex'));}
assert.equal((await fetch(base+'/media/missing-image.png')).status,404);assert.equal((await fetch(base+'/preview/index')).status,401);
const help=await(await fetch(base+'/public-mcp?action=get_product_info&language=ja')).json();assert.equal(help.version,expectedVersion);
const release=await(await fetch(base+'/mikanbox/cloud-release.json')).json();assert.equal(release.edition,'cloud');assert.equal(release.version,expectedVersion);
await writeFile('artifacts/static-remote-verification.json',JSON.stringify({passed:true,version:expectedVersion,indexDelivery:indexStatic?'static':'worker',staticPaths,images:images.length,originalImageBytesPreserved:true,adminSearchMcpRemainWorker:true,privatePreviewProtected:true,releaseFeedVerified:true},null,2));
console.log('Public static pages, aliases, all image bytes, dynamic search/admin/MCP and private preview passed.');
