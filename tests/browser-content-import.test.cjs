const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function storedZip(entries, corruptCrc=false){
  const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
  for(const [name,text] of entries){const n=enc.encode(name),body=enc.encode(text),crc=crc32(body)^(corruptCrc?1:0);const local=new Uint8Array(30+n.length+body.length),v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0,true);v.setUint16(8,0,true);v.setUint32(14,crc,true);v.setUint32(18,body.length,true);v.setUint32(22,body.length,true);v.setUint16(26,n.length,true);local.set(n,30);local.set(body,30+n.length);locals.push(local);
    const central=new Uint8Array(46+n.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(10,0,true);c.setUint32(16,crc,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,n.length,true);c.setUint32(42,offset,true);central.set(n,46);centrals.push(central);offset+=local.length;}
  const centralBytes=centrals.reduce((a,b)=>a+b.length,0),eocd=new Uint8Array(22),e=new DataView(eocd.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralBytes,true);e.setUint32(16,offset,true);
  return Buffer.concat([...locals,...centrals,eocd]);
}
function parser(){const source=fs.readFileSync('public/mikanbox/cloud-import.js','utf8'),window={__MIKANBOX_IMPORT_TEST__:true},document={documentElement:{lang:'en'},querySelectorAll:()=>[]};vm.runInNewContext(source,{window,document,TextEncoder,TextDecoder,Uint8Array,DataView,Blob,Response,DecompressionStream,Map,Set,Array,Object,Math,Error,JSON});return window.__MIKANBOX_IMPORT_TEST__;}

test('browser ZIP parser extracts package JSON and ignores imported site settings',async()=>{
  const api=parser();
  const zip=storedZip([
    ['theme/settings.json','{"site_id":"remote","api_key":"never import"}'],
    ['theme/posts/hello.json','{"title":"Hello","status":"draft","content_md":"Hi"}'],
    ['theme/components/header.json','{"html":"<header>Hi</header>"}']
  ]);
  const files=await api.unzip({arrayBuffer:async()=>zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength)});
  const payload=api.parsePackageFiles(files);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)),{
    pages:[{id:'hello',data:{title:'Hello',status:'draft',content_md:'Hi'}}],
    components:[{id:'header',data:{html:'<header>Hi</header>'}}]
  });
});

test('browser ZIP parser rejects unsafe paths and corrupt checksums',async()=>{
  const api=parser();
  const badPath=storedZip([['../posts/escape.json','{}']]);
  await assert.rejects(api.unzip({arrayBuffer:async()=>badPath.buffer.slice(badPath.byteOffset,badPath.byteOffset+badPath.byteLength)}),/unsafe file path/);
  const damaged=storedZip([['posts/a.json','{}']],true);
  await assert.rejects(api.unzip({arrayBuffer:async()=>damaged.buffer.slice(damaged.byteOffset,damaged.byteOffset+damaged.byteLength)}),/checksum/);
});

test('browser package parser rejects malformed content records instead of partially importing',()=>{
  const api=parser();
  assert.throws(()=>api.parsePackageFiles(new Map([['posts/page.json',new TextEncoder().encode('{broken')]])),/Could not parse package JSON/);
});
