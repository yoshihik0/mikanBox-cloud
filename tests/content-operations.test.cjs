const {test}=require('node:test');const assert=require('node:assert/strict');
const {environment,login,post,call}=require('./fixtures.cjs');
const {savePage,loadPage,saveComponent,loadComponent,saveSettings,loadSettings,uploadMedia,getMediaObject,listMediaFiles}=require('../.test-build/src/storage.js');
const {renameMediaReferences,removeCategory}=require('../.test-build/src/content-operations.js');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=','base64');
async function upload(env,name){assert.equal(await uploadMedia(env,name,Uint8Array.from(image).buffer,'image/png'),true);}
test('image rename updates exact references, preserves history and invalidates static output atomically',async()=>{
 const env=environment();await upload(env,'old.png');await savePage(env,'a',{title:'A',status:'public_static',content_md:'![image](old.png) [x](/media/old.png) bigger_old.png',ogp_image:'old.png',memo:'old.png'});
 await savePage(env,'unrelated',{title:'Other',status:'public_static'});await saveComponent(env,'header',{html:'<img src="/media/old.png">',css:'a{background:url(old.png)}',js:'const image="old.png";'});
 env.sqlite.exec("INSERT INTO static_pages(id,html,built_at) VALUES('a','old HTML','today');INSERT INTO static_pages(id,html,built_at) VALUES('unrelated','old component HTML','today')");
 assert.deepEqual(await renameMediaReferences(env,'old.png','new.png','admin'),{pages:1,components:1});
 const p=await loadPage(env,'a');assert.match(p.content_md,/\(new.png\).*\/media\/new.png/);assert.match(p.content_md,/bigger_old.png/);assert.equal(p.ogp_image,'new.png');assert.equal(p.memo,'old.png');assert.ok(p.revision_tag);
 const comp=await loadComponent(env,'header');assert.match(comp.html,/new.png/);assert.match(comp.css,/new.png/);assert.match(comp.js,/new.png/);
 assert.equal(await getMediaObject(env,'old.png'),null);assert.ok(await getMediaObject(env,'new.png'));assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM static_pages').get().n,0);
 assert.match(env.sqlite.prepare('SELECT data FROM post_revisions').get().data,/old.png/);assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'operation:%'").get().n,0);
});
test('image rename cannot overwrite media, modify locked pages or leave partial data on a race',async()=>{
 const env=environment();await upload(env,'old.png');await upload(env,'taken.png');await savePage(env,'a',{title:'A',status:'draft',content_md:'old.png'});
 await assert.rejects(renameMediaReferences(env,'old.png','taken.png','admin'));assert.equal((await loadPage(env,'a')).content_md,'old.png');
 env.sqlite.prepare('INSERT INTO edit_locks VALUES(?,?,?)').run('a','other',Date.now()+60000);
 await assert.rejects(renameMediaReferences(env,'old.png','new.png','admin'));assert.ok(await getMediaObject(env,'old.png'));assert.equal(await getMediaObject(env,'new.png'),null);env.sqlite.exec('DELETE FROM edit_locks');
 const batch=env.DB.batch.bind(env.DB);env.DB.batch=async statements=>{env.sqlite.prepare('UPDATE posts SET data=? WHERE id=?').run(JSON.stringify({title:'A',status:'draft',content_md:'concurrent'}),'a');return batch(statements);};
 await assert.rejects(renameMediaReferences(env,'old.png','new.png','admin'));assert.equal((await loadPage(env,'a')).content_md,'concurrent');assert.ok(await getMediaObject(env,'old.png'));assert.equal(await getMediaObject(env,'new.png'),null);assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM post_revisions').get().n,0);
});
test('category deletion removes references across many pages with history and constant queries',async()=>{
 const env=environment();await saveSettings(env,{category_candidates:'news,other',api_key:'keep-key'});
 for(let i=0;i<80;i++)await savePage(env,'p'+i,{title:'Page',status:'draft',category:'news, other',content_md:'keep'});
 let queries=0;const prepare=env.DB.prepare.bind(env.DB);env.DB.prepare=(...args)=>{queries++;return prepare(...args);};
 assert.equal(await removeCategory(env,'news','admin'),80);assert.ok(queries<15);assert.equal((await loadSettings(env)).api_key,'keep-key');assert.equal((await loadSettings(env)).category_candidates,'other');assert.equal((await loadPage(env,'p1')).category,'other');assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM post_revisions').get().n,80);
});
test('media search, category filters and page size settings are honored',async()=>{
 const env=environment(),auth=await login(env);const settings=await loadSettings(env);settings.media_per_page=1;await saveSettings(env,settings);
 await upload(env,'first.png');await upload(env,'second.png');await savePage(env,'news',{title:'News',status:'draft',category:'news',content_md:'![x](second.png)'});
 let h=await(await call(env,'/admin?view=media',undefined,auth.cookie)).text();assert.equal((h.match(/class="media-card"/g)||[]).length,1);assert.match(h,/p_media=2/);
 h=await(await call(env,'/admin?view=media&q_media=second',undefined,auth.cookie)).text();assert.match(h,/second.png/);assert.doesNotMatch(h,/first.png/);
 await upload(env,'news_cover.png');await upload(env,'g_logo.png');settings.media_per_page=100;await saveSettings(env,settings);
 h=await(await call(env,'/admin?view=media&cat=news',undefined,auth.cookie)).text();assert.match(h,/news_cover.png/);assert.match(h,/g_logo.png/);assert.doesNotMatch(h,/second.png/);assert.doesNotMatch(h,/first.png/);assert.match(h,/name="save_action" value="resize_media"/);assert.match(h,/name="save_action" value="convert_media_webp"/);assert.match(h,/name="save_action" value="rename_media"/);
 h=await(await call(env,'/admin?view=media&cat=news&media_all=1',undefined,auth.cookie)).text();assert.match(h,/first.png/);assert.match(h,/second.png/);
});
test('renaming an account keeps its devices signed in under the new name',async()=>{
 const env=environment(),auth=await login(env);
 const r=await post(env,auth,{save_action:'update_user',old_username:'admin',username:'renamed',display_name:'New Name'});assert.equal(r.data.success,true);
 assert.equal(env.sqlite.prepare("SELECT display_name FROM users WHERE username='renamed'").get().display_name,'New Name');assert.equal(env.sqlite.prepare("SELECT username FROM users WHERE username='admin'").get(),undefined);
 assert.equal(env.sqlite.prepare('SELECT username FROM device_sessions').get().username,'renamed');
 assert.doesNotMatch(await(await call(env,'/admin',undefined,auth.cookie)).text(),/name="login_action"/);
});

test('unified edit route renames converted images and references including common OGP',async()=>{
 const env=environment(),auth=await login(env);await upload(env,'photo.png');await savePage(env,'linked',{title:'Linked',status:'draft',content_md:'![photo](/media/photo.png)',css:'url(photo.png)',js:'const image="photo.png";',ogp_image:'photo.png'});await saveComponent(env,'picture',{html:'<img src="photo.png">'});const settings=await loadSettings(env);settings.ogp_image='photo.png';await saveSettings(env,settings);
 const webp=new TextEncoder().encode('RIFFxxxxWEBPdata');const before=await getMediaObject(env,'photo.png');
 const r=await multipart(env,auth,{save_action:'edit_media',file:'photo.png',source_file:'photo.png',new_filename:'news_photo.webp',source_etag:before.httpEtag,image:new File([webp],'news_photo.webp',{type:'image/webp'})});assert.equal(r.data.success,true,r.data.message);
 assert.equal(await getMediaObject(env,'photo.png'),null);assert.ok(await getMediaObject(env,'news_photo.webp'));const page=await loadPage(env,'linked');for(const field of ['content_md','css','js','ogp_image'])assert.match(page[field],/news_photo.webp/);assert.match((await loadComponent(env,'picture')).html,/news_photo.webp/);assert.equal((await loadSettings(env)).ogp_image,'news_photo.webp');
 const renamed=await post(env,auth,{save_action:'edit_media',file:'news_photo.webp',new_filename:'news_final.webp'});assert.equal(renamed.data.success,true,renamed.data.message);assert.match((await loadPage(env,'linked')).content_md,/news_final.webp/);
});
test('Cloud uploads inherit the top category prefix without double prefixes',async()=>{
 const env=environment(),auth=await login(env);
 for(const [original,expected] of [['photo.png','news_photo.png'],['g_logo.png','g_logo.png']]){const r=await multipart(env,auth,{save_action:'upload_media',image:new File([image],original,{type:'image/png'})},'/admin?cat=news');assert.equal(r.data.success,true,r.data.message);assert.ok(await getMediaObject(env,expected));}
});

async function multipart(env,auth,data,url='/admin'){
 const form=new FormData();for(const [key,value]of Object.entries({...data,csrf_token:auth.csrf_token,ajax_request:'1'}))form.set(key,value);
 const response=await require('../.test-build/src/index.js').default.fetch(new Request('https://cloud.test'+url,{method:'POST',headers:{Cookie:auth.cookie},body:form}),env);
 return {response,data:await response.json()};
}

test('rename preflight counts exact content references and file-only confirmation preserves links',async()=>{
 const env=environment(),auth=await login(env);await upload(env,'old.png');
 await savePage(env,'used',{title:'Used',content_md:'old.png old.png',status:'draft'});await savePage(env,'similar',{title:'Similar',content_md:'bigger_old.png',status:'draft'});await saveComponent(env,'used',{html:'old.png'});
 const info=await post(env,auth,{save_action:'media_reference_status',file:'old.png'});assert.equal(info.data.count,2);assert.equal(info.data.success,true);
 const ask=await post(env,auth,{save_action:'rename_media',file:'old.png',new_name:'new.png'});assert.equal(ask.data.require_confirm,true);assert.ok(await getMediaObject(env,'old.png'));
 const renamed=await post(env,auth,{save_action:'rename_media',file:'old.png',new_name:'new.png',confirmed:'0'});assert.equal(renamed.data.success,true,renamed.data.message);assert.ok(await getMediaObject(env,'new.png'));assert.equal((await loadPage(env,'used')).content_md,'old.png old.png');assert.equal((await loadComponent(env,'used')).html,'old.png');
});

test('WebP conversion updates saved page and component references through the actual admin action',async()=>{
 const env=environment(),auth=await login(env);await upload(env,'photo.png');
 await savePage(env,'image-test',{title:'Test',status:'draft',content_md:'![img](photo.png)',css:'background:url(photo.png)',js:'const image="photo.png"',ogp_image:'photo.png'});
 await saveComponent(env,'image-part',{html:'<img src="photo.png">',css:'background:url(photo.png)',js:'const image="photo.png"'});
 const webp=new TextEncoder().encode('RIFFxxxxWEBPdata'),before=await getMediaObject(env,'photo.png');
 const r=await multipart(env,auth,{save_action:'convert_media_webp',file:'photo.png',source_file:'photo.png',new_filename:'photo.webp',source_etag:before.httpEtag,image:new File([webp],'photo.webp',{type:'image/webp'})});
 assert.equal(r.data.success,true,r.data.message);assert.equal(await getMediaObject(env,'photo.png'),null);assert.ok(await getMediaObject(env,'photo.webp'));
 const page=await loadPage(env,'image-test'),part=await loadComponent(env,'image-part');for(const value of [page.content_md,page.css,page.js,page.ogp_image,part.html,part.css,part.js])assert.match(value,/photo\.webp/);
});

test('WebP conversion with an existing target reports the collision and preserves all data',async()=>{
 const env=environment(),auth=await login(env);await upload(env,'photo.png');const webp=new TextEncoder().encode('RIFFxxxxWEBPdata');await uploadMedia(env,'photo.webp',webp.buffer,'image/webp');
 await savePage(env,'linked',{title:'Linked',status:'draft',content_md:'![photo](photo.png)'});
 const status=await post(env,auth,{save_action:'media_reference_status',file:'photo.png',target:'photo.webp'});assert.equal(status.data.target_exists,true);
 const before=await getMediaObject(env,'photo.png');const r=await multipart(env,auth,{save_action:'convert_media_webp',file:'photo.png',source_file:'photo.png',new_filename:'photo.webp',source_etag:before.httpEtag,image:new File([webp],'photo.webp',{type:'image/webp'})});
 assert.equal(r.data.success,false);assert.match(r.data.message,/already exists/);assert.ok(await getMediaObject(env,'photo.png'));assert.ok(await getMediaObject(env,'photo.webp'));assert.equal((await loadPage(env,'linked')).content_md,'![photo](photo.png)');
});

test('published conversion preserves the old published path and protects it from reuse',async()=>{
 const env=environment(),auth=await login(env);await upload(env,'photo.png');
 await savePage(env,'linked',{title:'Linked',status:'draft',content_md:'photo.png'});
 env.sqlite.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?)").run(JSON.stringify({paths:['/media/photo.png','/page.html']}));
 const webp=new TextEncoder().encode('RIFFxxxxWEBPdata'),before=await getMediaObject(env,'photo.png');
 const r=await multipart(env,auth,{save_action:'convert_media_webp',file:'photo.png',source_file:'photo.png',new_filename:'photo.webp',source_etag:before.httpEtag,image:new File([webp],'photo.webp',{type:'image/webp'})});
 assert.equal(r.data.success,true,r.data.message);assert.equal((await loadPage(env,'linked')).content_md,'photo.webp');
 assert.deepEqual(JSON.parse(env.sqlite.prepare("SELECT value FROM settings WHERE key='static_publication'").get().value).paths,['/media/photo.png','/page.html']);
 const uploadAttempt=await multipart(env,auth,{save_action:'upload_media',image:new File([image],'photo.png',{type:'image/png'})});assert.equal(uploadAttempt.data.success,false);assert.match(uploadAttempt.data.message,/公開中|still published/);
});
