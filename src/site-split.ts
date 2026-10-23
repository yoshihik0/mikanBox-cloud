import type {Env} from './types';
// Split mode: the public site is an assets-only Worker at PUBLIC_SITE_URL and this
// Worker serves only the admin screen, MCP and previews. Site content never runs
// on the admin origin, so scripts on public pages cannot reach the admin session.
export const splitMode=(env:Env)=>!!env.CLOUDFLARE_PUBLIC_WORKER_NAME;
export function publicOrigin(env:Env):string{
 let url:URL;try{url=new URL(env.PUBLIC_SITE_URL||'');}catch{throw new Error('PUBLIC_SITE_URL is not configured.');}
 if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new Error('PUBLIC_SITE_URL must use https.');
 return url.origin;
}
/** Renders and feeds built for the public site must carry the public origin, never the admin one. */
export function publicRequest(env:Env,request:Request):Request{
 if(!splitMode(env))return request;
 const url=new URL(request.url);return new Request(publicOrigin(env)+url.pathname+url.search);
}
// The preview shows site scripts on the admin origin. A sandboxed document gets an
// opaque origin, so those scripts run but cannot read admin pages or send its cookie.
export const PREVIEW_SANDBOX='sandbox allow-scripts allow-forms allow-popups allow-modals';
