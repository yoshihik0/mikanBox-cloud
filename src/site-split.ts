import type {Env} from './types';
// The public site is an assets-only Worker at PUBLIC_SITE_URL, and this Worker serves only
// the admin screen, MCP and previews. Site content never runs on the admin origin, so
// scripts on public pages cannot reach the admin session. There is no other arrangement:
// without a public Worker of its own, the admin screen still works but nothing is published.
export const PUBLIC_WORKER_REQUIRED='公開用のWorkerを設定してください（CLOUDFLARE_PUBLIC_WORKER_NAME。管理用とは別の名前）。 / Set the public Worker (CLOUDFLARE_PUBLIC_WORKER_NAME, a name different from the management Worker).';
export function publicWorkerMissing(env:Env):boolean{
 const name=env.CLOUDFLARE_PUBLIC_WORKER_NAME||'';
 return !name||name===env.CLOUDFLARE_WORKER_NAME;
}
export function assertPublicWorker(env:Env):void{if(publicWorkerMissing(env))throw new Error(PUBLIC_WORKER_REQUIRED);}
export function publicOrigin(env:Env):string{
 let url:URL;try{url=new URL(env.PUBLIC_SITE_URL||'');}catch{throw new Error('PUBLIC_SITE_URL is not configured.');}
 if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new Error('PUBLIC_SITE_URL must use https.');
 return url.origin;
}
/** Renders and feeds built for the public site must carry the public origin, never the admin one. */
export function publicRequest(env:Env,request:Request):Request{
 const url=new URL(request.url),origin=publicOrigin(env);if(origin===url.origin)throw new Error('Public and management URLs must be different.');return new Request(origin+url.pathname+url.search);
}
// The preview shows site scripts on the admin origin. A sandboxed document gets an
// opaque origin, so those scripts run but cannot read admin pages or send its cookie.
export const PREVIEW_SANDBOX='sandbox allow-scripts allow-forms allow-popups allow-modals';
