import type { Env } from './types';
import { loadSettings, loadPage, loadComponent, getMediaObject } from './storage';
import { MikanBoxRenderer } from './renderer';
import { generateSitemapXml, generateRssXml, generatePodcastXml } from './feeds';
import { handleAdmin } from './admin/index';
import { authenticatedUser } from './accounts';
import { validId } from './validation';
import { handleMcp } from './mcp';
import { handlePublicHelp } from './public-help';

async function route(request: Request, env: Env): Promise<Response> {
  const url=new URL(request.url),pathname=url.pathname;
  if(['/mcp','/mikanBox/mcp','/mikanBox/mcp.php'].includes(pathname))return handleMcp(request,env);
  if(['/public-mcp','/mikanBox/public-mcp.php','/public-help.html'].includes(pathname))return handlePublicHelp(request,env);
  if(['/admin','/admin/','/mikanBox/admin.php'].includes(pathname)) return handleAdmin(request,env);
  if(!['GET','HEAD'].includes(request.method)) return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  if(pathname==='/admin.css'||pathname.startsWith('/mikanbox/')) {
    if(!env.ASSETS) return new Response('Not Found',{status:404});
    const target=new URL(request.url);if(pathname==='/admin.css') target.pathname='/mikanbox/admin.css';
    return env.ASSETS.fetch(new Request(target,request));
  }
  if(pathname.startsWith('/media/')) {

    let key:string;try{key=decodeURIComponent(pathname.slice(7));}catch{return new Response('Not Found',{status:404});}
    if(!/^[A-Za-z0-9_.-]+$/.test(key)||key.includes('..')) return new Response('Not Found',{status:404});
    const object=await getMediaObject(env,key);if(!object)return new Response('Not Found',{status:404});
    const headers:Record<string,string>={'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','ETag':object.httpEtag,'Content-Length':String(object.size),'Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'};
    if(key.toLowerCase().endsWith('.svg'))headers['Content-Security-Policy']="sandbox; default-src 'none'; style-src 'unsafe-inline'";
    if(request.headers.get('If-None-Match')===object.httpEtag)return new Response(null,{status:304,headers});
    return new Response(object.body,{headers});
  }
  if(pathname.startsWith('/component-js/')) {
    const id=pathname.slice(14).replace(/\.js$/,'');
    if(!validId(id,true))return new Response('Not Found',{status:404});
    const component=await loadComponent(env,id);
    if(!component?.js||component.is_ai_doc)return new Response('Not Found',{status:404});
    return new Response(component.js,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
  }
  const settings=await loadSettings(env),renderer=new MikanBoxRenderer(env,settings,request);
  const preview=pathname.startsWith('/preview/');
  const pagePath=preview?pathname.slice(8):pathname;
  const id=pathname==='/index.php' ? (url.searchParams.get('page')||'index') : (decodeURIComponent(pagePath).replace(/^\/+|\/+$/g,'').replace(/\.html$/,'')||'index');
  if(id.startsWith('api/')) {
    const target=id.slice(4),data=await loadPage(env,target);
    if(!data||data.status!=='db')return Response.json({error:'not found'},{status:404});
    return Response.json(await renderer.getPageDataBlocks(target),{headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
  }
  const feed={ 'sitemap.xml':generateSitemapXml,'rss.xml':generateRssXml,'podcast.xml':generatePodcastXml }[id];
  if(feed)return new Response(await feed(env,settings,request),{headers:{'Content-Type':id==='sitemap.xml'?'application/xml; charset=utf-8':'application/rss+xml; charset=utf-8'}});
  if(!validId(id))return new Response('Not Found',{status:404});
  const data=await loadPage(env,id),auth=await authenticatedUser(request,env);
  if(preview&&!auth)return new Response('Unauthorized',{status:401,headers:{'Cache-Control':'no-store'}});
  if(data?.status==='public_static'&&!auth&&id!=='search') {
    if(env.STATIC_DELIVERY==='true')return new Response('Static page is not published.',{status:404,headers:{'Cache-Control':'no-store'}});
    const row=await env.DB.prepare(`SELECT html FROM static_pages WHERE id=(
      SELECT id FROM posts WHERE id=? OR id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1
    )`).bind(id,id+'/index',id).first<{html:string}>();
    return new Response(row?.html||'Static page has not been built.',{status:row?200:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});
  }
  const result=await renderer.render(id,!!auth);
  return new Response(result.html,{status:result.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin'}});
}
export default {
  async fetch(request: Request,env: Env):Promise<Response> {
    try {
      const original=await route(request,env);
      const response=new Response(original.body,{status:original.status,headers:original.headers});
      response.headers.set('X-Content-Type-Options','nosniff');
      response.headers.set('X-Mikanbox-Delivery','worker');
      const admin=['/admin','/admin/','/mikanBox/admin.php'].includes(new URL(request.url).pathname);
      if(admin)response.headers.set('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      if(request.method==='HEAD')return new Response(null,{status:response.status,headers:response.headers});
      return response;
    } catch(error) {
      console.error('Cloud request failed',error instanceof Error?error.name:'UnknownError');
      return new Response('Request could not be completed.',{status:500,headers:{'Cache-Control':'no-store'}});
    }
  }
};
