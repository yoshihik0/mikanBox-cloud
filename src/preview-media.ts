import type {Env} from './types';
import {validMediaName} from './media-policy';

// A preview document has an opaque sandbox origin and cannot use the admin
// cookie for its images. Grant short-lived access only to each referenced file.
const lifetime = 600;
const encoder = new TextEncoder();
const allowed = /\.(?:jpe?g|png|gif|webp|svg)$/i;
const key = (secret:string) => crypto.subtle.importKey('raw', encoder.encode('preview-media:' + secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
const b64 = (bytes:ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = (value:string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const signatureText = (name:string,expires:number) => encoder.encode(name+'\n'+expires);

export async function verifyPreviewMedia(secret:string,name:string,expiresText:string,signature:string):Promise<boolean> {
  if(!secret || !validMediaName(name) || !allowed.test(name) || !/^\d{10}$/.test(expiresText) || !/^[A-Za-z0-9_-]{43}$/.test(signature))return false;
  const expires=Number(expiresText),now=Math.floor(Date.now()/1000);
  if(expires<=now||expires>now+lifetime)return false;
  try{return await crypto.subtle.verify('HMAC',await key(secret),decode(signature),signatureText(name,expires));}catch{return false;}
}

export async function previewMediaUrls(html:string,env:Env,request:Request,siteUrl?:string):Promise<string> {
  if(!env.JWT_SECRET) throw new Error('Preview image signing is unavailable.');
  const adminOrigin=new URL(request.url).origin;
  const publicOrigin=env.PUBLIC_SITE_URL ? new URL(env.PUBLIC_SITE_URL).origin : adminOrigin;
  let siteOrigin=adminOrigin;
  try { if(siteUrl) siteOrigin=new URL(siteUrl).origin; } catch {}
  const expires=Math.floor(Date.now()/1000)+lifetime;
  const matches=[...html.matchAll(/(?:https?:\/\/[^\s"'()<>]+)?\/media\/([A-Za-z0-9_.-]+)(?:\?[^\s"'()<>]*)?/gi)];
  const signed=new Map<string,string>();
  for(const match of matches) {
    const original=match[0],name=match[1];
    if(!validMediaName(name)||!allowed.test(name))continue;
    if(/^https?:/i.test(original)) {try{const origin=new URL(original).origin;if(origin!==adminOrigin&&origin!==publicOrigin&&origin!==siteOrigin)continue;}catch{continue;}}
    if(!signed.has(name)) {
      const sig=b64(await crypto.subtle.sign('HMAC',await key(env.JWT_SECRET),signatureText(name,expires)));
      signed.set(name,`${adminOrigin}/preview-media/${encodeURIComponent(name)}?expires=${expires}&sig=${sig}`);
    }
  }
  return html.replace(/(?:https?:\/\/[^\s"'()<>]+)?\/media\/([A-Za-z0-9_.-]+)(?:\?[^\s"'()<>]*)?/gi,(original,name:string)=>{
    if(/^https?:/i.test(original)){try{const origin=new URL(original).origin;if(origin!==adminOrigin&&origin!==publicOrigin&&origin!==siteOrigin)return original;}catch{return original;}}
    return signed.get(name)||original;
  });
}
