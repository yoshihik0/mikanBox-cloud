const {environment}=require('./fixtures.cjs');
function r2Environment(mode='r2') {
 const env=environment(),objects=new Map();
 env.MEDIA={
  objects,
  async put(key,value,options={}) {const data=value instanceof Uint8Array?value.slice():new Uint8Array(await new Response(value).arrayBuffer());objects.set(key,{data,options});return {key,size:data.length};},
  async get(key,options={}) {const item=objects.get(key);if(!item)return null;let data=item.data.slice();const range=options.range;if(range)data=data.slice(range.offset,range.offset+range.length);return {key,size:item.data.length,body:new ReadableStream({start(c){c.enqueue(data);c.close();}}),httpMetadata:item.options.httpMetadata||{},arrayBuffer:async()=>data.buffer};},
  async delete(key){for(const k of Array.isArray(key)?key:[key])objects.delete(k);}
 };
 if(mode==='r2')env.sqlite.exec("INSERT INTO settings(key,value) VALUES('media_storage','r2')");
 return env;
}
module.exports={r2Environment};
