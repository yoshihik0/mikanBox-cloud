import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import auth from '../.test-build/src/auth.js';
const base='https://example.invalid';
const account=JSON.parse(await readFile('artifacts/image-test-account.json','utf8'))[0]?.results[0];if(!account)throw new Error('No existing admin account; no account will be created by this test.');
const vars=await readFile('.env.production.secrets','utf8');const secret=vars.match(/^JWT_SECRET=(.+)$/m)[1];
const session=await auth.createSessionToken(secret,account.username,account.auth_version);
const headers={Cookie:auth.setSessionCookie(session.token).split(';')[0]};
const admin=await(await fetch(base+'/admin?view=media',{headers})).text();assert.match(admin,/id="upload-form"/);assert.match(admin,/400 MB/);const csrf=admin.match(/window.CSRF_TOKEN = "([^"]+)"/)[1];
const image=new Uint8Array(10_000_000);image.set(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64'));
const name='image-verification-'+randomUUID()+'.png';let created=false;
try {
 const form=new FormData();form.set('save_action','upload_media');form.set('csrf_token',csrf);form.set('ajax_request','1');form.set('image',new File([image],name,{type:'image/png'}));
 const upload=await fetch(base+'/admin',{method:'POST',headers,body:form});const result=await upload.json();assert.equal(result.success,true,result.message);created=true;
 const actual=await fetch(base+'/media/'+name);assert.equal(actual.status,200);assert.deepEqual(new Uint8Array(await actual.arrayBuffer()),image);
 assert.equal((await fetch(base+'/media/'+name,{method:'HEAD'})).status,200);
 assert.equal((await fetch(base+'/media/'+name,{headers:{'If-None-Match':actual.headers.get('etag')}})).status,304);
 await writeFile('artifacts/image-remote-verification.json',JSON.stringify({passed:true,url:base,size:10_000_000,storage:'D1',upload:true,exactDownload:true,head:true,etag:true},null,2));
 console.log('Cloudflare production D1: 10 MB authenticated upload and exact streamed download, HEAD and ETag passed.');
} finally {
 if(created){const result=await(await fetch(base+'/admin',{method:'POST',headers,body:new URLSearchParams({save_action:'delete_media',csrf_token:csrf,file:name,ajax_request:'1'})})).json();assert.equal(result.success,true);assert.equal((await fetch(base+'/media/'+name)).status,404);console.log('Only the newly created verification image was removed.');}
}
