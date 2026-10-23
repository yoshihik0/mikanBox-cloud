export const MEDIA_FILE_LIMIT=10_000_000;
export const MEDIA_TOTAL_LIMIT=100_000_000_000;
export const MEDIA_COUNT_LIMIT=10_000;
export const MEDIA_CHUNK_SIZE=500_000;
export const MEDIA_ZIP_LIMIT=20_000_000;
export function validMediaName(name:string) {
  return name.length>0&&name.length<=180&&/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)&&!name.includes('..')&&!/\.(?:php[0-9]*|phtml|phar|cgi|pl|py|sh|shtml|asp|aspx|jsp)(?:\.|$)/i.test(name);
}
export function imageType(bytes:Uint8Array,extension:string):string|null {
  const is=(expected:number[],offset=0)=>expected.every((v,i)=>bytes[offset+i]===v);
  const text=(a:number,b:number)=>String.fromCharCode(...bytes.subarray(a,b));
  if(['jpg','jpeg'].includes(extension)&&is([255,216,255]))return 'image/jpeg';
  if(extension==='png'&&is([137,80,78,71,13,10,26,10]))return 'image/png';
  if(extension==='gif'&&['GIF87a','GIF89a'].includes(text(0,6)))return 'image/gif';
  if(extension==='webp'&&text(0,4)==='RIFF'&&text(8,12)==='WEBP')return 'image/webp';
  if(extension==='svg') {
    const head=new TextDecoder().decode(bytes.subarray(0,4096)).replace(/^\uFEFF/,'').replace(/<\?xml[^>]*\?>|<!--[\s\S]*?-->/g,'').trimStart();
    if(/^<svg(?:\s|>)/i.test(head))return 'image/svg+xml';
  }
  return null;
}

export const CODE_MEDIA_TYPES:Record<string,string>={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
export function isCodeMedia(name:string):boolean {return Object.hasOwn(CODE_MEDIA_TYPES,name.split('.').pop()!.toLowerCase());}
export function mediaType(bytes:Uint8Array,extension:string):string|null {
  if(Object.hasOwn(CODE_MEDIA_TYPES,extension)) {
    if(!bytes.length||bytes.length>MEDIA_FILE_LIMIT||bytes.includes(0))return null;
    try {new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{return null;}
    return CODE_MEDIA_TYPES[extension];
  }
  return imageType(bytes,extension);
}
