import type {Env} from './types';
export const cloudTarget=(env:Env)=>({account:env.CLOUDFLARE_ACCOUNT_ID||'',worker:env.CLOUDFLARE_WORKER_NAME||'',database:env.CLOUDFLARE_D1_ID||''});
const encode=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function key(env:Env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('cloud-connection:'+env.JWT_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function cloudConfigured(env:Env){return !!env.CLOUDFLARE_API_TOKEN||!!await env.DB.prepare("SELECT key FROM settings WHERE key='cloud_connection'").first();}
export async function saveCloudToken(env:Env,token:string){
 if(!/^[A-Za-z0-9_-]{20,200}$/.test(token))throw new Error('Invalid Cloudflare API token.');
 const target=cloudTarget(env),worker=env.CLOUDFLARE_PUBLIC_WORKER_NAME||target.worker;if(!target.account||!worker)throw new Error('Cloudflare deployment target is not configured.');
 await cloudResult(env,`/workers/scripts/${worker}/deployments`,{},token);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(token));
 await env.DB.prepare("INSERT INTO settings(key,value) VALUES('cloud_connection',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({iv:encode(iv),cipher:encode(new Uint8Array(cipher))})).run();
}
export async function cloudToken(env:Env){
 if(env.CLOUDFLARE_API_TOKEN)return env.CLOUDFLARE_API_TOKEN;
 const row=await env.DB.prepare("SELECT value FROM settings WHERE key='cloud_connection'").first<{value:string}>();if(!row)throw new Error('サイト設定でCloudflare配信用トークンを設定してください。 / Configure the Cloudflare deployment token in Site settings.');
 try{const value=JSON.parse(row.value);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv)},await key(env),decode(value.cipher)));}catch{throw new Error('Cloudflare connection must be configured again.');}
}
type CloudResponse<T>={success:boolean;result:T;errors?:Array<{code?:number;message?:string}>};
function cloudError(status:number,body:Partial<CloudResponse<unknown>>|null){
 const details=Array.isArray(body?.errors)?body.errors.filter(e=>typeof e?.message==='string').map(e=>[typeof e.code==='number'?String(e.code):'',e.message].filter(Boolean).join(': ')).join('; '):'';
 return new Error('Cloudflare operation failed ('+status+').'+(details?' '+details.slice(0,1000):''));
}
export async function cloudRequest(env:Env,path:string,init:RequestInit={},token?:string):Promise<Response>{
 const target=cloudTarget(env);if(!/^[a-f0-9]{32}$/.test(target.account)||!path.startsWith('/'))throw new Error('Cloudflare target is not configured.');
 const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+(token||await cloudToken(env)));
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+target.account+path,{...init,headers});
 if(!response.ok){let body:Partial<CloudResponse<unknown>>|null=null;try{body=await response.json();}catch{}throw cloudError(response.status,body);}return response;
}
export async function cloudResult<T=any>(env:Env,path:string,init:RequestInit={},token?:string):Promise<T>{
 const response=await cloudRequest(env,path,init,token);const body=await response.json() as CloudResponse<T>;if(!body.success)throw cloudError(response.status,body);return body.result;
}
export async function d1Export(env:Env,currentBookmark?:string){
 const target=cloudTarget(env);if(!target.database)throw new Error('D1 target is not configured.');
 return cloudResult(env,`/d1/database/${target.database}/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({output_format:'polling',...(currentBookmark?{current_bookmark:currentBookmark}: {})})});
}
// D1 is unavailable during export. Polling therefore uses a short-lived,
// encrypted capability rather than reading sessions or credentials from D1.
export async function beginD1Export(env:Env,origin:string){
 const token=await cloudToken(env),target=cloudTarget(env);
 const result=await cloudResult(env,`/d1/database/${target.database}/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({output_format:'polling'})},token);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const payload={scope:'d1-export-poll',origin,token,bookmark:result.at_bookmark,expires:Date.now()+15*60*1000,target};
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(JSON.stringify(payload)));
 return {export:result,capability:encode(iv)+'.'+encode(new Uint8Array(cipher))};
}
export async function pollD1Export(env:Env,capability:string,origin:string){
 let value:any;
 try{if(capability.length>5000)throw new Error();const [iv,cipher]=capability.split('.');value=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await key(env),decode(cipher))));}catch{throw new Error('Invalid export session.');}
 if(value.scope!=='d1-export-poll'||value.origin!==origin||value.expires<Date.now()||JSON.stringify(value.target)!==JSON.stringify(cloudTarget(env)))throw new Error('Export session expired or invalid.');
 return cloudResult(env,`/d1/database/${value.target.database}/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({output_format:'polling',current_bookmark:value.bookmark})},value.token);
}
export async function prepareD1Download(env:Env,result:any,origin:string) {
 if(result?.status!=='complete'||typeof result.result?.signed_url!=='string')return {export:result};
 const url=new URL(result.result.signed_url);
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid export download URL.');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const value={scope:'d1-export-download',origin,target:cloudTarget(env),expires:Date.now()+15*60*1000,url:url.href};
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(JSON.stringify(value)));
 const {result:_result,...safe}=result;
 return {export:safe,download_capability:encode(iv)+'.'+encode(new Uint8Array(cipher))};
}
export async function openD1Download(env:Env,capability:string,origin:string):Promise<string> {
 let value:any;
 try{if(capability.length>10000)throw new Error();const [iv,cipher]=capability.split('.');value=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await key(env),decode(cipher))));}catch{throw new Error('Invalid download session.');}
 if(value.scope!=='d1-export-download'||value.origin!==origin||value.expires<Date.now()||JSON.stringify(value.target)!==JSON.stringify(cloudTarget(env)))throw new Error('Download session expired or invalid.');
 const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid export download URL.');return url.href;
}
export async function d1Restore(env:Env,timestamp:string){
 const target=cloudTarget(env),date=new Date(timestamp);if(!target.database||!Number.isFinite(date.getTime())||date.getTime()>Date.now())throw new Error('Invalid restore time.');
 return cloudResult(env,`/d1/database/${target.database}/time_travel/restore?timestamp=${encodeURIComponent(date.toISOString())}`,{method:'POST'});
}
