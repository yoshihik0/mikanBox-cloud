// Plain HTTP is never used for the admin screens or the sign-in cookie: GET and HEAD go to the same
// address on https:// (301). wrangler dev on this computer (localhost, 127.0.0.1, [::1]) stays on http.
// No HSTS header: it would also bind other sites on the same host name.
const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','[::1]','::1']);
export function httpsRedirect(request: Request):Response|null {
  const url=new URL(request.url);
  if(url.protocol!=='http:'||LOCAL_HOSTS.has(url.hostname)||url.hostname.endsWith('.localhost'))return null;
  if(request.method!=='GET'&&request.method!=='HEAD')return null;
  url.protocol='https:';
  return new Response(null,{status:301,headers:{Location:url.toString(),'Cache-Control':'no-store'}});
}
