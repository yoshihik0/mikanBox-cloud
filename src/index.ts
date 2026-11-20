import type { Env } from './types';
import { loadSettings, loadPage, isPublicStatus } from './storage';
import { MikanBoxRenderer } from './renderer';
import { generateSitemapXml, generateRssXml, generatePodcastXml } from './feeds';
import { handleAdmin } from './admin/index';
import { handleVisual } from './visual';
import { authenticatedUser } from './accounts';
import { auditMark, claimAudit, noteVersion } from './audit';
import { CLOUD_VERSION } from './version';
import { validId } from './validation';
import { handleMcp } from './mcp';
import { handlePublicHelp } from './public-help';
import { PREVIEW_SANDBOX } from './site-split';
import { httpsRedirect } from './https-redirect';
import { pageOutputFormat, formatHasHtml, formatHasMarkdown, isDataFormat, isApiFormat, contentTypeForExtension } from './output-formats';

const notFoundText=()=>new Response('Not Found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
const textOutput=(body:string,type:string)=>new Response(body,{headers:{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':PREVIEW_SANDBOX}});

/** Changes a request makes are recorded by the database; afterwards they get who made them (src/audit.ts). */
async function withAudit(request:Request,env:Env,handler:()=>Promise<Response>,actorOf:()=>Promise<string>):Promise<Response>{
  if(request.method!=='POST')return handler();
  const since=await auditMark(env);
  try{return await handler();}
  finally{await claimAudit(env,since,request,actorOf);}
}
const userOf=(request:Request,env:Env)=>async()=>(await authenticatedUser(request,env))?.user.username||'';
async function route(request: Request, env: Env): Promise<Response> {
  const url=new URL(request.url),pathname=url.pathname;
  if(pathname.startsWith('/admin')||pathname.startsWith('/mcp')||pathname.startsWith('/mikanBox/'))await noteVersion(env,CLOUD_VERSION);   // no request: the record must not carry the address of whoever happened to come first
  if(['/mcp','/mikanBox/mcp','/mikanBox/mcp.php'].includes(pathname)){let actor='MCP';return withAudit(request,env,()=>handleMcp(request,env,name=>{if(name)actor='MCP ('+name+')';}),async()=>actor);}
  if(['/public-mcp','/mikanBox/public-mcp.php','/public-help.html'].includes(pathname))return handlePublicHelp(request,env);
  if(['/admin','/admin/','/admin.php','/mikanBox/admin.php'].includes(pathname)) return withAudit(request,env,()=>handleAdmin(request,env),userOf(request,env));
  if(['/admin/visual','/admin/visual/'].includes(pathname)) return withAudit(request,env,()=>handleVisual(request,env),userOf(request,env));
  if(!['GET','HEAD'].includes(request.method)) return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  if(pathname==='/admin.css'||pathname.startsWith('/mikanbox/')) {
    if(!env.ASSETS) return new Response('Not Found',{status:404});
    const target=new URL(request.url);if(pathname==='/admin.css') target.pathname='/mikanbox/admin.css';
    return env.ASSETS.fetch(new Request(target,request));
  }
  // The public site lives on its own Worker. Here, nothing of the site is served
  // without a session, and signed-in users are sent to the preview of the same path.
  if(!await authenticatedUser(request,env))return new Response('Not Found',{status:404,headers:{'Cache-Control':'no-store'}});
  const direct=['/media/','/preview/','/api/'].some(prefix=>pathname.startsWith(prefix))||['/sitemap.xml','/rss.xml','/podcast.xml'].includes(pathname);
  if(!direct)return Response.redirect(new URL('/preview'+pathname+url.search,url).href,302);
  // Media files live on the public site; signed-in users opening /media/… here are sent there.
  if(pathname.startsWith('/media/'))return env.PUBLIC_SITE_URL?Response.redirect(env.PUBLIC_SITE_URL.replace(/\/$/,'')+pathname,302):new Response('Not Found',{status:404});
  const settings=await loadSettings(env),renderer=new MikanBoxRenderer(env,settings,request);
  const preview=pathname.startsWith('/preview/');
  const pagePath=preview?pathname.slice(8):pathname;
  let rawId:string;try{rawId=pathname==='/index.php' ? (url.searchParams.get('page')||'index') : (decodeURIComponent(pagePath).replace(/^\/+|\/+$/g,'')||'index');}catch{return new Response('Not Found',{status:404});}
  if(rawId.startsWith('api/')) {
    // mikanBox DB: /api/ID.json, and the older /api/ID as its alias.
    let target=rawId.slice(4);if(target.endsWith('.json')&&!await loadPage(env,target))target=target.slice(0,-5);
    const data=validId(target)?await loadPage(env,target):null;
    const apiHeaders={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
    if(!data||!isApiFormat(pageOutputFormat(data)))return Response.json({error:'not found'},{status:404,headers:apiHeaders});
    const body=await renderer.renderApi(target);
    if(body===null)return Response.json({error:'forbidden'},{status:403,headers:apiHeaders});
    return new Response(body,{headers:{...apiHeaders,'Content-Type':'application/json; charset=utf-8'}});
  }
  // Everything with an extension lives at /id.<extension>: .html for HTML, .md for the Markdown version, data formats by their own.
  const extension=rawId.match(/^(.+)\.(html|md|json|xml|csv|txt|js|css)$/);
  const id=extension&&!['sitemap.xml','rss.xml','podcast.xml'].includes(rawId)?extension[1]:rawId;
  const ext=extension&&id!==rawId?extension[2]:null;
  const feed={ 'sitemap.xml':generateSitemapXml,'rss.xml':generateRssXml,'podcast.xml':generatePodcastXml }[id];
  if(feed)return new Response(await feed(env,settings,request),{headers:{'Content-Type':id==='sitemap.xml'?'application/xml; charset=utf-8':'application/rss+xml; charset=utf-8'}});
  if(!validId(id))return ext&&ext!=='html'?notFoundText():new Response('Not Found',{status:404});
  const data=await loadPage(env,id),auth=await authenticatedUser(request,env);
  if(preview&&!auth)return new Response('Unauthorized',{status:401,headers:{'Cache-Control':'no-store'}});
  // Public pages are served only as published static files; the Worker never renders them for visitors.
  if(data&&isPublicStatus(data.status)&&!auth)return ext&&ext!=='html'?notFoundText():new Response('Not Found',{status:404,headers:{'Cache-Control':'no-store'}});
  // The URL rules of the output formats (as in the PHP editions and the published _redirects).
  const format=pageOutputFormat(data);
  if(data&&(ext==='md'||(ext===null&&format==='md'))) {
    if(!formatHasMarkdown(format))return notFoundText();
    const body=await renderer.renderMarkdown(id,undefined,!!auth);
    return body===null?notFoundText():textOutput(body,contentTypeForExtension('md'));
  }
  if(ext&&ext!=='html') {
    if(!data||format!==ext||!isDataFormat(format))return notFoundText();
    const body=await renderer.renderData(id,undefined,!!auth);
    return body===null?notFoundText():textOutput(body,contentTypeForExtension(ext));
  }
  // HTML URLs of pages without HTML answer with the site's 404 page.
  const result=await renderer.render(data&&!formatHasHtml(format)?'\u0000missing':id,!!auth);
  const html = result.html;
  return new Response(html,{status:result.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':PREVIEW_SANDBOX}});
}
export default {
  async fetch(request: Request,env: Env):Promise<Response> {
    try {
      const toHttps=httpsRedirect(request);
      if(toHttps)return toHttps;
      const original=await route(request,env);
      const response=new Response(original.body,{status:original.status,headers:original.headers});
      response.headers.set('X-Content-Type-Options','nosniff');
      response.headers.set('X-Mikanbox-Delivery','worker');
      const admin=['/admin','/admin/','/admin.php','/mikanBox/admin.php'].includes(new URL(request.url).pathname);
      if(admin && !response.headers.has('Content-Security-Policy'))response.headers.set('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      response.headers.set('X-Robots-Tag','noindex, nofollow');
      if(new URL(request.url).pathname.startsWith('/preview/'))response.headers.set('Content-Security-Policy',PREVIEW_SANDBOX);
      if(request.method==='HEAD')return new Response(null,{status:response.status,headers:response.headers});
      return response;
    } catch(error) {
      console.error('Cloud request failed',error instanceof Error?error.name:'UnknownError');
      return new Response('Request could not be completed.',{status:500,headers:{'Cache-Control':'no-store'}});
    }
  }
};
