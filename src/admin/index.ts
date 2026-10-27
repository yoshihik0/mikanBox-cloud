import {mediaStorageMode} from '../media-mode';
import {beginMediaMigration,copyMediaMigrationImage,finishMediaMigration,cancelMediaMigration,migrationStatus} from '../media-migration';
import {cleanMediaObjects} from '../r2-media';
import {importContentPackage,importWordPressContent} from '../content-import';
import {latestCloudRelease} from '../cloud-release';
import {exportBackupManifest,exportBackupMediaPart,validateExportSnapshot,createBackupRestore,stageBackupMediaPart,commitBackupRestore,abortBackupRestore} from '../backup-restore';
import {cloudConfigured,saveCloudToken,cloudTarget,beginD1Export,pollD1Export,prepareD1Download,openD1Download,d1Restore,cloudToken} from '../cloudflare-api';
import {beginPublication,hashPublicationFiles,preparePublication,uploadPublicationFile,finishPublication,cancelPublication} from '../publication-service';
import {replaceMediaImage} from '../media-transform';
import {trackingIdValid,trackingLegacyHtml,trackingSnippets} from '../tracking';
import type { Env, PageData, ComponentData } from '../types';
import { loadSettings, saveSettings, loadPage, getSortedPageIds, loadComponent, saveComponent, deleteComponent, listComponentIds, listPages, listComponents, listMediaFiles, uploadMedia, deleteMedia, renameMedia, mediaUsage, getMediaObject, buildDataBackupZip, buildMediaBackupZip } from '../storage';
import { verifyCsrf } from '../auth';
import { authenticatedUser, getUser, listUsers, addInitialUser, rateLimit } from '../accounts';
import { onProbation, PROBATION_DAYS, createDevice, claimCode, codeKind, issueCode, cancelCode, revokeDevice, setExpiryDays, setupTokenUsable, consumeSetupToken, clearDeviceCookie, listDevices, listCodes, unseenDevices, expiryFrom } from '../devices';
import { renderAccountsSection } from './accounts-view';
import { MikanBoxRenderer } from '../renderer';
import { previewMediaUrls } from '../preview-media';
import { PREVIEW_SANDBOX } from '../site-split';
import { publicationStatus } from '../publish-status';
import { pageId, componentId, pageStatus } from '../validation';
import { revisions, saveWithRevision } from '../revisions';
import { buildStatic } from '../ssg';
import { installDefaults } from '../defaults';
import {mediaReferenceCount,mediaHasLockedReferences,renameMediaReferences,removeCategory} from '../content-operations';
import {assertNotPublished,checkPublicationLock,isPublished} from '../publication-state';
import {publicationManifest,readPublicationEntry} from '../static-publication';
import {buildStaticExportZip} from '../static-export';
import { MEDIA_FILE_LIMIT,MEDIA_TOTAL_LIMIT,MEDIA_COUNT_LIMIT,imageType,validMediaName,mediaType,isCodeMedia } from '../media-policy';
import { getSystemLanguage, createTranslator } from '../i18n';
import { renderLoginPage, renderAdminShell, renderPagesView, renderPageEditor, renderDesignView, renderDesignEditor, renderMediaView, renderSiteView, renderImportView } from './views';
const html = (body: string, status = 200) => new Response(body, {status, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
const json = (body: unknown, status = 200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const val = (f: FormData, key: string) => String(f.get(key) || '');
const help = (lang: string) => `/public-help.html?language=${lang}`;
function editorPage(form:FormData,current:PageData|null):PageData {
  return {title:val(form,'title'),status:pageStatus(val(form,'status')||'draft'),category:val(form,'category').trim(),sort_order:Number(val(form,'sort_order'))||0,
    updated_at:val(form,'updated_at')||new Date().toISOString().slice(0,19).replace('T',' '),wrapper_comp:val(form,'wrapper_comp')||'_layout',memo:val(form,'memo'),
    description:val(form,'description'),keywords:val(form,'keywords'),ogp_image:val(form,'ogp_image'),content_md:val(form,'content_md'),css:val(form,'css'),js:val(form,'js'),is_html:form.has('is_html'),exclude_tracking:form.has('tracking_option_present')?form.has('exclude_tracking'):!!current?.exclude_tracking,preview_token:current?.preview_token};
}
function redirect(location: string, cookie?: string) {
  const headers: Record<string,string> = {Location:location,'Cache-Control':'no-store'};
  if (cookie) headers['Set-Cookie']=cookie;
  return new Response(null,{status:303,headers});
}
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  if (!env.JWT_SECRET || env.JWT_SECRET.length<32) return html('Authentication secret is not configured.',503);
  if (!['GET','POST'].includes(request.method)) return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, POST'}});
  const url=new URL(request.url);
  if(request.method==='POST'&&url.searchParams.has('d1_export_poll')){
    if(request.headers.get('Origin')!==url.origin)return json({success:false,message:'Invalid origin.'},403);
    try{const data=await request.json() as {capability:string};return json({success:true,...await prepareD1Download(env,await pollD1Export(env,data.capability,url.origin),url.origin)});}catch{return json({success:false,message:'Export polling failed or expired.'},400);}
  }
  const settings=await loadSettings(env);
  const lang=getSystemLanguage(settings,request.headers.get('Accept-Language')||''), t=createTranslator(lang);
  const users=await listUsers(env), initial=users.length===0, auth=await authenticatedUser(request,env);
  const form=request.method==='POST' ? await request.formData().catch(()=>null) : null;
  if (request.method==='POST' && (!form || (request.headers.get('Origin') && request.headers.get('Origin')!==url.origin))) return html(t('err_csrf'),403);
  // Before sign-in there is no session, so these forms carry a double-submit token.
  const loginCsrf=request.headers.get('Cookie')?.match(/(?:^|;\s*)login_csrf=([A-Za-z0-9-]+)/)?.[1]||crypto.randomUUID();
  // Users exist but no device does (an upgraded site): only the setup token can register one.
  const noDevices=!initial&&!auth&&(await listDevices(env)).length===0;
  const loginResponse=(error='',status=200,inviteStep?:{code:string;device_name:string;username?:string;display_name?:string})=>{const response=html(renderLoginPage({lang,initial,noDevices,error,t,csrf:loginCsrf,inviteStep}),status);response.headers.append('Set-Cookie',`login_csrf=${loginCsrf}; Secure; SameSite=Strict; HttpOnly; Path=/; Max-Age=900`);return response;};
  if (form?.has('login_action')) {
    if(!verifyCsrf(val(form,'csrf_token'),loginCsrf))return html(t('err_csrf'),403);
    let error='';
    let inviteStep:{code:string;device_name:string;username?:string;display_name?:string}|undefined;
    try {
      const key=`${request.headers.get('CF-Connecting-IP')||'local'}|device`;
      if (await rateLimit(env,key)) throw new Error('しばらく待ってから再試行してください。 / Try again later.');
      const action=val(form,'login_action'),deviceName=val(form,'device_name');
      let device:{cookie:string}|null=null;
      if (action==='setup') {
        // SETUP_TOKEN registers the first device, and later serves as recovery.
        if (!await setupTokenUsable(env,val(form,'setup_token'))) {await rateLimit(env,key,true);throw new Error('初期設定トークンを確認してください。使用済みのトークンは使えません。 / Check the setup token. A used token does not work again.');}
        const username=val(form,'username').trim();
        if (initial) {
          if (settings.password_hash) throw new Error('既存認証データの移行が必要です。 / Existing authentication requires explicit migration.');
          await addInitialUser(env,username,val(form,'display_name'));
          if (!settings.site_id) {
            settings.site_id=`site-${crypto.randomUUID()}`; settings.site_environment=env.SITE_ENVIRONMENT||'local'; settings.site_name||='🍊mikanBox';
            if (!await saveSettings(env,settings)) throw new Error(t('err_save_failed'));
          }
          await installDefaults(env,lang);
        } else if (!await getUser(env,username)) throw new Error('ユーザー名を確認してください。 / Check the username.');
        await consumeSetupToken(env,!initial);
        device=await createDevice(env,username,deviceName,request,'setup');
      } else if (action==='claim' && !initial) {
        const code=val(form,'code'),kind=await codeKind(env,code);
        if (!kind) {await rateLimit(env,key,true);throw new Error('コードを確認してください。期限切れや使用済みのコードは使えません。 / Check the code. Expired or used codes do not work.');}
        // A valid invite: the invited person now chooses their own user ID and display name.
        if (kind==='invite' && !form.has('username')) return loginResponse('',200,{code,device_name:deviceName});
        if (kind==='invite') inviteStep={code,device_name:deviceName,username:val(form,'username'),display_name:val(form,'display_name')};
        device=await claimCode(env,code,deviceName,request,kind==='invite'?{username:val(form,'username'),display_name:val(form,'display_name')}:undefined);
        if (!device) {await rateLimit(env,key,true);throw new Error('コードを確認してください。期限切れや使用済みのコードは使えません。 / Check the code. Expired or used codes do not work.');}
      } else throw new Error('Invalid login action.');
      await env.DB.prepare('DELETE FROM login_attempts WHERE id=?').bind(key).run();
      return redirect(url.pathname,device.cookie);
    } catch(e) {error=e instanceof Error && !/D1_|SQLITE_|constraint|UNIQUE/.test(e.message)?e.message:t('err_save_failed');}
    return loginResponse(error,400,inviteStep);
  }
  if (!auth) return loginResponse();
  const csrf=auth.session.csrf;
  if(request.method==='GET'&&url.searchParams.has('media_preview')) {
    const key=url.searchParams.get('media_preview')||'';if(!validMediaName(key))return new Response('Not Found',{status:404});
    const object=await getMediaObject(env,key);if(!object)return new Response('Not Found',{status:404});
    return new Response(object.body,{headers:{'Content-Type':isCodeMedia(key)?'text/plain; charset=utf-8':object.httpMetadata?.contentType||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','ETag':object.httpEtag||'', 'Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
  }
  if(request.method==='GET'&&url.searchParams.has('publication_manifest'))return json(await publicationManifest(env));
  if(request.method==='GET'&&url.searchParams.has('publication_file')) {
    const entry=await readPublicationEntry(env,request,url.searchParams.get('publication_file')||'');
    return entry?new Response(entry.body.buffer as ArrayBuffer,{headers:{'Content-Type':entry.contentType,'Cache-Control':'no-store'}}):new Response('Not Found',{status:404});
  }
  let editId=url.searchParams.get('edit'), view=url.searchParams.get('view')||'pages';
  if(view==='design') view='components';
  let message=!form&&url.searchParams.get('saved')==='1'?t('msg_update_success'):'',success=true,statusCode=200,issuedCode='',newApiKey='',uploadedName='';
  if(form) {
    if(!verifyCsrf(val(form,'csrf_token'),csrf)) return json({success:false,message:t('err_csrf')},403);
    const action=val(form,'save_action');
    if(action==='preview_page' && url.searchParams.has('editor_preview')) {
      try {
        const id=pageId(val(form,'id').trim()||'preview');
        const oldId=val(form,'old_id');
        const current=oldId?await loadPage(env,pageId(oldId)):null;
        const data=editorPage(form,current);
        const renderer=new MikanBoxRenderer(env,settings,request);
        const rendered=await renderer.render(id,true,data);
        const content=await previewMediaUrls(rendered.html,env,request,renderer.getSiteUrl());
        return new Response(content,{status:rendered.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':PREVIEW_SANDBOX}});
      } catch(error) {return html(error instanceof Error?error.message:'Preview failed.',400);}
    }
    try {
      await checkPublicationLock(env,val(form,'publication_lease'));
      // A device added within the probation period cannot take access away from others,
      // so a leaked add code cannot be used to lock the original owner out.
      const lockout=['delete_user','restore_d1_time'].includes(action)||(action==='update_user'&&val(form,'old_username')!==auth.user.username)||(action==='restore_backup_json'&&val(form,'restore_users')==='1');
      if(lockout&&onProbation(auth.device))throw new Error(`追加から${PROBATION_DAYS}日間の端末では、この操作はできません。 / A device added within ${PROBATION_DAYS} days cannot do this.`);
      if(settings.demo_mode) throw new Error(t('msg_demo_mode'));
      switch(action) {
        case 'publication_begin': return json({success:true,...await beginPublication(env,request,auth.user.username,val(form,'rebuild')==='1',JSON.parse(val(form,'excluded')||'[]'),val(form,'media_only'))});
        case 'publication_hashes': await hashPublicationFiles(env,val(form,'publication_lease'),auth.user.username,JSON.parse(val(form,'items')));return json({success:true});
        case 'publication_prepare': return json({success:true,...await preparePublication(env,val(form,'publication_lease'),auth.user.username)});
        case 'publication_upload': {const file=form.get('asset_data');if(!(file instanceof File))throw new Error('Missing upload.');return json({success:true,...await uploadPublicationFile(env,val(form,'publication_lease'),auth.user.username,val(form,'hash'),file)});}
        case 'publication_finish': return json({success:true,...await finishPublication(env,val(form,'publication_lease'),auth.user.username)});
        case 'publication_cancel': await cancelPublication(env,val(form,'publication_lease'),auth.user.username);return json({success:true});
        case 'download_backup_json': {
          return json({success:true,manifest:await exportBackupManifest(env)});
        }
        case 'backup_media_part': return json({success:true,part:await exportBackupMediaPart(env,val(form,'file'),Number(val(form,'index')),JSON.parse(val(form,'expected')))});
        case 'backup_export_validate': await validateExportSnapshot(env,JSON.parse(val(form,'manifest')));return json({success:true});
        case 'restore_backup_json': {
          const stage=await createBackupRestore(env,JSON.parse(val(form,'manifest')),{restoreUsers:val(form,'restore_users')==='1'});
          await env.DB.prepare('UPDATE backup_sessions SET owner=? WHERE id=?').bind(auth.user.username,stage).run();
          return json({success:true,stage});
        }
        case 'backup_restore_part': case 'backup_restore_commit': case 'backup_restore_abort': {
          const stage=val(form,'stage'),owned=await env.DB.prepare('SELECT id FROM backup_sessions WHERE id=? AND owner=?').bind(stage,auth.user.username).first();if(!owned)throw new Error('Restore session not found.');
          if(action==='backup_restore_part'){await stageBackupMediaPart(env,stage,JSON.parse(val(form,'part')));return json({success:true});}
          if(action==='backup_restore_abort'){await abortBackupRestore(env,stage);return json({success:true});}
          return json({success:true,...await commitBackupRestore(env,stage)});
        }
        case 'save_cloud_connection': {
          const target=cloudTarget(env);if(val(form,'cloud_account_id')!==target.account||val(form,'cloud_worker_name')!==target.worker)throw new Error('Cloudflare target must match this installation.');
          if(val(form,'cloud_api_token'))await saveCloudToken(env,val(form,'cloud_api_token'));break;
        }
        case 'begin_d1_export': {const started=await beginD1Export(env,url.origin);return json({success:true,capability:started.capability,...await prepareD1Download(env,started.export,url.origin)});}
        case 'download_d1_export': {
          const downloadUrl=await openD1Download(env,val(form,'capability'),url.origin);
          const upstream=await fetch(downloadUrl,{redirect:'manual'});
          if(!upstream.ok||!upstream.body)throw new Error('D1 export download failed.');
          return new Response(upstream.body,{headers:{'Content-Type':'application/sql','Content-Disposition':'attachment; filename="mikanbox-d1.sql"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
        }
        case 'restore_d1_time': {return json({success:true,restore:await d1Restore(env,val(form,'restore_at'))});}
        case 'begin_publication': {
          const lease=crypto.randomUUID(),value=JSON.stringify({lease,expires:Date.now()+30*60*1000});
          const saved=await env.DB.prepare("INSERT INTO settings(key,value) VALUES('publication_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.expires')<?").bind(value,Date.now()).run();
          if(!saved.meta.changes)throw new Error('Publication is already running.');return json({success:true,lease});
        }
        case 'end_publication': await env.DB.prepare("DELETE FROM settings WHERE key='publication_lock' AND json_extract(value,'$.lease')=?").bind(val(form,'publication_lease')).run();return json({success:true});
        case 'record_publication': {
          const lock=await env.DB.prepare("SELECT value FROM settings WHERE key='publication_lock'").first<{value:string}>();
          if(!lock||JSON.parse(lock.value).lease!==val(form,'publication_lease')||JSON.parse(lock.value).expires<Date.now())throw new Error('Publication lease expired.');
          let paths=JSON.parse(val(form,'paths'));if(!Array.isArray(paths)||paths.length>20000||paths.some(p=>typeof p!=='string'||!p.startsWith('/')))throw new Error('Invalid publication.');
          if(form.has('stage')){const old=await env.DB.prepare("SELECT value FROM settings WHERE key='static_publication'").first<{value:string}>();paths=[...new Set([...paths,...(old?JSON.parse(old.value).paths||[]:[])])];}
          await env.DB.prepare("INSERT INTO settings(key,value) VALUES('static_publication',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({paths,published_at:new Date().toISOString()})).run();return json({success:true});
        }
        case 'generate_api_key': settings.api_key=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');if(!await saveSettings(env,settings))throw new Error(t('err_save_failed'));newApiKey=String(settings.api_key);message=t('msg_mcp_key_generated');break;
        case 'build_ssg': await buildStatic(env,request);break;
        case 'logout': await revokeDevice(env,auth.device,auth.device.id);return redirect(url.pathname,clearDeviceCookie());
        case 'content_import_package': case 'content_import_wordpress': {
          const raw=val(form,'import_payload');
          if(new TextEncoder().encode(raw).length>1_100_000)throw new Error('The import payload exceeds 1 MB.');
          const result=action==='content_import_package'?await importContentPackage(env,JSON.parse(raw)):await importWordPressContent(env,JSON.parse(raw));
          return json({success:true,...result});
        }
        case 'save_page': {
          const id=pageId(val(form,'id').trim()||`page_${Date.now()}`),oldId=val(form,'old_id');
          if(oldId) pageId(oldId);
          const current=oldId?await loadPage(env,oldId):null;
          const lock=await env.DB.prepare('SELECT owner FROM edit_locks WHERE post_id=? AND expires_at>?').bind(oldId||id,Date.now()).first<{owner:string}>();
          if(lock&&lock.owner!==auth.user.username) throw new Error('他のユーザーが編集中です。 / Another user is editing this page.');
          const data:PageData=editorPage(form,current);data.preview_token||=crypto.randomUUID();
          if(!Number.isFinite(data.sort_order)||Math.abs(data.sort_order||0)>2147483647) throw new Error('Invalid sort order.');
          await saveWithRevision(env,id,oldId,data,auth.user.username,val(form,'expected_revision')); editId=id;message=t('msg_page_saved',id);
          if(form.has('save_and_preview')) return redirect(`/preview/${id}`);
          break;
        }
        case 'change_status': case 'save_page_status': {
          const id=pageId(val(form,'id')),data=await loadPage(env,id); if(!data) throw new Error('Page not found.');
          const expected=data.revision_tag||'';data.status=pageStatus(val(form,'status'));data.preview_token||=crypto.randomUUID();
          await saveWithRevision(env,id,id,data,auth.user.username,expected);break;
        }
        case 'delete_page': {
          const id=pageId(val(form,'old_id')||val(form,'id'));
          const lock=await env.DB.prepare('SELECT owner FROM edit_locks WHERE post_id=? AND expires_at>?').bind(id,Date.now()).first<{owner:string}>();
          if(lock&&lock.owner!==auth.user.username) throw new Error('Another user is editing this page.');
          await env.DB.batch([env.DB.prepare('DELETE FROM posts WHERE id=?').bind(id),env.DB.prepare('DELETE FROM post_revisions WHERE post_id=?').bind(id),env.DB.prepare('DELETE FROM edit_locks WHERE post_id=?').bind(id),env.DB.prepare('DELETE FROM static_pages WHERE id=?').bind(id)]);editId=null;break;
        }
        case 'save_comp': {
          const id=componentId(val(form,'id')),oldId=val(form,'old_id'); if(oldId) componentId(oldId);
          if(id!==oldId&&await loadComponent(env,id)) throw new Error('Component ID already exists.');
          if(oldId&&(oldId!==id||val(form,'comp_type')==='ai_doc'))await assertNotPublished(env,['/component-js/'+oldId+'.js']);
          const kind=val(form,'comp_type')||(form.has('is_wrapper')?'wrapper':'part');if(!['part','wrapper','ai_doc'].includes(kind)) throw new Error('Invalid component type.');
          const data:ComponentData={html:val(form,'html'),css:val(form,'css'),js:val(form,'js'),memo:val(form,'memo'),is_global:!form.has('use_scope'),is_wrapper:kind==='wrapper',is_ai_doc:kind==='ai_doc'};
          if(oldId&&oldId!==id) {
            const r=await env.DB.prepare('UPDATE components SET id=?,data=?,is_wrapper=? WHERE id=?').bind(id,JSON.stringify(data),data.is_wrapper?1:0,oldId).run();
            if(!r.meta.changes) throw new Error('Component not found.');
          } else if(!await saveComponent(env,id,data)) throw new Error(t('err_save_failed'));
          editId=id;message=t('msg_comp_saved',id);break;
        }
        case 'delete_comp': await assertNotPublished(env,['/component-js/'+val(form,'old_id')+'.js']);if(!await deleteComponent(env,componentId(val(form,'old_id')||val(form,'id')))) throw new Error(t('err_save_failed'));editId=null;break;
        case 'save_settings': {
          if(form.has('tracking_id')||form.has('tracking_head_code')||form.has('tracking_body_code')){
            const id=val(form,'tracking_id').trim().toUpperCase();
            settings.tracking_id=trackingIdValid(id)?id:'';
            settings.tracking_head_code=val(form,'tracking_head_code').trim();
            settings.tracking_body_code=val(form,'tracking_body_code').trim();
            // A legacy tracking component moves into the code field on save; one that cannot move stays until code or an ID replaces it.
            const legacy=settings.tracking_component?await loadComponent(env,String(settings.tracking_component)):null;
            if(trackingLegacyHtml(legacy)!==null||trackingSnippets(settings)!==null)settings.tracking_component='';
          }
          for(const field of ['site_name','description','keywords','ogp_image','site_url','site_environment','category_candidates']) if(form.has(field)) settings[field]=val(form,field);
          if(settings.site_url){let parsed:URL;try{parsed=new URL(settings.site_url);}catch{throw new Error('Invalid site URL.');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('Invalid site URL.');settings.site_url=settings.site_url.trim().replace(/\/+$/,'');}
          if(form.has('site_environment')&&!['production','staging','development','local','unspecified'].includes(val(form,'site_environment')))throw new Error('Invalid site environment.');
          for(const field of ['pages_per_page','media_per_page']) if(form.has(field)) settings[field]=Math.min(500,Math.max(1,Number(val(form,field))||30));
          if(form.has('system_lang')) {const next=val(form,'system_lang');if(!['','auto','ja','en'].includes(next)) throw new Error('Invalid language.');settings.system_lang=next;}
          if(!await saveSettings(env,settings)) throw new Error(t('err_save_failed'));break;
        }
        case 'save_memo': case 'save_prompt': {const field=action==='save_memo'?'memo':'ai_prompt';settings[field]=val(form,field);if(!await saveSettings(env,settings)) throw new Error(t('err_save_failed'));break;}
        case 'device_code_create': {
          // Shown in the section itself: a toast would vanish before the code could be copied.
          issuedCode=await issueCode(env,auth.device,val(form,'invite')==='1');
          message=lang==='ja'?'追加用のコードを発行しました。「端末とユーザー」の上部に表示しています。':'A device code was issued. It is shown at the top of Devices and users.';break;
        }
        case 'device_code_cancel': await cancelCode(env,val(form,'code_hash'));break;
        case 'device_revoke': {
          await revokeDevice(env,auth.device,val(form,'device_id'));
          if(val(form,'device_id')===auth.device.id)return redirect(url.pathname,clearDeviceCookie());break;
        }
        case 'device_expiry': await setExpiryDays(env,Number(val(form,'days')));break;
        case 'update_user': {
          const old=val(form,'old_username'),name=val(form,'username'),display=val(form,'display_name').trim();
          if(!/^[A-Za-z0-9_-]{1,80}$/.test(name)||!display||display.length>120)throw new Error('Check username and display name.');
          const previous=await getUser(env,old);if(!previous)throw new Error('Account not found.');
          const generationBytes=crypto.getRandomValues(new Uint32Array(2)),generation=2+generationBytes[0]*1048576+(generationBytes[1]&1048575);
          const changed=await env.DB.batch([
            env.DB.prepare('UPDATE users SET username=?,display_name=?,auth_version=? WHERE username=? AND auth_version=?').bind(name,display,generation,old,previous.auth_version),
            env.DB.prepare('UPDATE device_sessions SET username=? WHERE username=? AND EXISTS(SELECT 1 FROM users WHERE username=? AND auth_version=?)').bind(name,old,name,generation),
            env.DB.prepare('DELETE FROM edit_locks WHERE owner=? AND EXISTS(SELECT 1 FROM users WHERE username=? AND auth_version=?)').bind(old,name,generation)
          ]);
          if(!changed[0].meta.changes)throw new Error('Account changed; reload and retry.');
          break;
        }
        case 'delete_user': {
          const name=val(form,'username');if(name===auth.user.username) throw new Error('自分自身は削除できません。 / Cannot delete your current account.');
          // Stop the user's devices too, so recreating the same username never revives them.
          await env.DB.batch([env.DB.prepare('DELETE FROM users WHERE username=?').bind(name),env.DB.prepare('UPDATE device_sessions SET revoked_at=? WHERE username=? AND revoked_at IS NULL').bind(Date.now(),name),env.DB.prepare('DELETE FROM device_codes WHERE username=?').bind(name)]);break;
        }
        case 'acquire_lock': {
          const id=pageId(val(form,'id'));
          const r=await env.DB.prepare(`INSERT INTO edit_locks(post_id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(post_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE edit_locks.owner=excluded.owner OR edit_locks.expires_at<?`).bind(id,auth.user.username,Date.now()+120000,Date.now()).run();
          if(!r.meta.changes) throw new Error('Another user is editing this page.');return json({success:true});
        }
        case 'release_lock': await env.DB.prepare('DELETE FROM edit_locks WHERE post_id=? AND owner=?').bind(val(form,'id'),auth.user.username).run();return json({success:true});
        case 'add_category': case 'delete_category': {
          const cat=val(form,'category').trim();if(!cat||cat.includes(',')||cat.length>100) throw new Error('Invalid category.');
          if(action==='delete_category'){await removeCategory(env,cat,auth.user.username);break;}
          const cats=new Set((settings.category_candidates||'').split(',').map(x=>x.trim()).filter(Boolean));
          if(action==='add_category') cats.add(cat);else cats.delete(cat);settings.category_candidates=[...cats].sort().join(', ');
          if(!await saveSettings(env,settings)) throw new Error(t('err_save_failed'));break;
        }
        case 'edit_media': case 'resize_media': case 'convert_media_webp': {
          const file=form.get('image'),old=val(form,'source_file')||val(form,'file');
          const target=val(form,'new_filename')||old;if(!validMediaName(old)||!validMediaName(target))throw new Error('Check the filename.');

          if(target!==old&&await isPublished(env,'/media/'+target))throw new Error(lang==='ja'?'変更先の名前は公開中です。サイトをビルドしてから再度お試しください。':'The target name is still published. Build the site before reusing it.');
          if(!(file instanceof File)){if(action!=='edit_media'||target===old)throw new Error('No changes to save.');await renameMediaReferences(env,old,target,auth.user.username);break;}
          const bytes=new Uint8Array(await file.arrayBuffer());
          if(action==='convert_media_webp'&&(!/\.(?:jpe?g|png)$/i.test(old)||!target.endsWith('.webp')||imageType(bytes,'webp')!=='image/webp')) throw new Error('Invalid WebP conversion.');
          if(target!==old)await renameMediaReferences(env,old,target,auth.user.username,{bytes,expectedEtag:val(form,'source_etag')});
          else await replaceMediaImage(env,old,bytes,val(form,'source_etag'));break;
        }
        case 'upload_media': {
          const file=form.get('image');
          if(!(file instanceof File)||!file.size||file.size>MEDIA_FILE_LIMIT)throw new Error(lang==='ja'?'1ファイル10 MB以下のファイルを選んでください。':'Choose a file up to 10 MB.');
          let name=file.name.replace(/[^A-Za-z0-9_.-]/g,'_').replace(/\.[^.]+$/,ext=>ext.toLowerCase());const category=(val(form,'cat')||url.searchParams.get('cat')||'').replace(/[^A-Za-z0-9_-]/g,'_');
          if(!isCodeMedia(name)&&category&&!/^[A-Za-z0-9]+_/.test(name))name=category+'_'+name;
          const ext=name.split('.').pop()?.toLowerCase()||'';
          if(!validMediaName(name))throw new Error(lang==='ja'?'ファイル名を確認してください。':'Check the filename.');
          if(await isPublished(env,'/media/'+name))throw new Error(lang==='ja'?'このファイル名は公開中です。別の名前を使うか、サイトをビルドしてからお試しください。':'This filename is still published. Choose another name or build the site first.');
          const bytes=await file.arrayBuffer();
          const type=mediaType(new Uint8Array(bytes),ext);
          if(!type)throw new Error(lang==='ja'?'JPEG・PNG・GIF・WebP・SVG、またはUTF-8のJS・CSSを選んでください。':'Choose a JPEG, PNG, GIF, WebP, SVG, or UTF-8 JS/CSS file.');
          if(await getMediaObject(env,name))throw new Error(lang==='ja'?'同名のファイルがあります。名前を変えてください。':'A file with this name exists. Choose another name.');
          if(!await uploadMedia(env,name,bytes,type))throw new Error(lang==='ja'?'保存できませんでした。空き容量と同名ファイルを確認してください。':'Save failed. Check available storage and duplicate filenames.');uploadedName=name;break;
        }
        case 'delete_media': {const name=val(form,'file');if(!/^[A-Za-z0-9_.-]+$/.test(name)||name.includes('..')) throw new Error('Invalid media name.');await assertNotPublished(env,['/media/'+name]);if(!await deleteMedia(env,name)) throw new Error(t('err_save_failed'));break;}
        case 'begin_media_migration': {
          return json({success:true,migration:await beginMediaMigration(env)});
        }
        case 'copy_media_migration': return json({success:true,migration:await copyMediaMigrationImage(env,val(form,'migration_id'))});
        case 'finish_media_migration': await finishMediaMigration(env,val(form,'migration_id'));return json({success:true});
        case 'cancel_media_migration': await cancelMediaMigration(env,val(form,'migration_id'));return json({success:true});
        case 'cleanup_media': {const removed=await cleanMediaObjects(env);return json({success:true,message:lang==='en'?`${removed} unused images removed.`:`未使用の画像を${removed}件削除しました。`});}
        case 'media_reference_status': {
          const name=val(form,'file');if(!validMediaName(name)||!await getMediaObject(env,name))throw new Error('Image not found.');
          const count=await mediaReferenceCount(env,name);
          const target=val(form,'target');
          if(target && !validMediaName(target))throw new Error('Invalid target filename.');
          return json({success:true,count,published:await isPublished(env,'/media/'+name),locked:await mediaHasLockedReferences(env,name),target_exists:!!target&&target!==name&&(!!await getMediaObject(env,target)||await isPublished(env,'/media/'+target)),message:t('media_rename_in_use_confirm',count)});
        }
        case 'rename_media': {
          if(await isPublished(env,'/media/'+val(form,'new_name')))throw new Error(lang==='ja'?'変更先の名前は公開中です。サイトをビルドしてから再度お試しください。':'The target name is still published. Build the site before reusing it.');
          const count=await mediaReferenceCount(env,val(form,'file'));
          if(count&& !form.has('confirmed'))return json({success:false,require_confirm:true,message:t('media_rename_in_use_confirm',count)});

          await renameMediaReferences(env,val(form,'file'),val(form,'new_name'),auth.user.username,undefined,val(form,'confirmed')!=='0');break;
        }
        case 'download_backup_data': case 'download_backup_media': {
          const zip=action==='download_backup_data'?await buildDataBackupZip(env):await buildMediaBackupZip(env);
          return new Response(zip.buffer as ArrayBuffer,{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="mikanbox_cloud_${action==='download_backup_data'?'data':'media'}.zip"`,'Cache-Control':'no-store'}});
        }
        case 'download_static_zip': {
          const structure=val(form,'structure');if(!['flat','directory'].includes(structure))throw new Error('Invalid export structure.');
          const zip=await buildStaticExportZip(env,request,{structure:structure as 'flat'|'directory',siteUrl:settings.ssg_root_url||env.PUBLIC_SITE_URL||undefined});
          return new Response(zip.buffer as ArrayBuffer,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="mikanbox_static.zip"','Cache-Control':'no-store'}});
        }
        default: throw new Error('未対応の操作です。 / Unsupported action.');
      }
      message||=t('msg_update_success');
    } catch(e) {success=false;statusCode=400;message=e instanceof Error&&(e.message.startsWith('Cloudflare operation failed')||!/D1_|SQLITE_|constraint|UNIQUE/.test(e.message))?e.message:t('err_save_failed');}
    if(form.has('ajax_request')) return json({success,message,editId,...(issuedCode?{issued_code:issuedCode}:{}),...(newApiKey?{mcp_api_key:newApiKey}:{}),...(uploadedName?{uploaded_name:uploadedName}:{})},statusCode);
    // A new device code is shown once on this response, never put in a URL.
    if(success&&action==='device_code_create')view='site';
    else if(success) {
      const params=new URLSearchParams(url.searchParams);params.delete('new');if(editId)params.set('edit',editId);else params.delete('edit');params.set('saved','1');
      return redirect(`${url.pathname}?${params}`);
    }
  }
  let editData:PageData|ComponentData|null=null;
  const pageRevisions=view==='pages'&&editId?await revisions(env,editId):[];
  if(editId) {
    editData=view==='components'?await loadComponent(env,editId):await loadPage(env,editId);
    if(view==='pages'&&url.searchParams.has('rev')) {const r=pageRevisions.find(r=>r.id===Number(url.searchParams.get('rev')));if(r&&editData)editData={...JSON.parse(r.data),revision_tag:(editData as PageData).revision_tag};}
  }
  const pages=await listPages(env),components=await listComponents(env);
  const files=await listMediaFiles(env),cats=new Set((settings.category_candidates||'').split(',').map(x=>x.trim()).filter(Boolean));
  for(const p of pages)for(const c of(p.data.category||'').split(',').map(x=>x.trim()).filter(Boolean))cats.add(c);
  const allCategories=[...cats].sort(),category=url.searchParams.get('cat')||'',query=url.searchParams.get('q')||'';
  const filtered=pages.filter(p=>(!category||(p.data.category||'').split(',').map(x=>x.trim()).includes(category))&&(!query||`${p.id} ${p.data.title} ${p.data.content_md||''}`.toLowerCase().includes(query.toLowerCase())));
  const perPage=Math.min(500,Math.max(1,Number(settings.pages_per_page)||30)),totalPages=Math.max(1,Math.ceil(filtered.length/perPage)),pageNumber=Math.min(totalPages,Math.max(1,Number(url.searchParams.get('p_pages'))||1));
  const hasNew=url.searchParams.has('new'),helpFile=help(lang);
  const pageEditorHtml=view==='pages'&&(editId||hasNew)?renderPageEditor({t,editId,editData:editData as PageData|null,csrf,helpFile,wrapperComponents:components.filter(c=>c.data.is_wrapper),allCategories,settings:{...settings,_site_base:url.origin},revisions:pageRevisions,selectedRevision:pageRevisions.find(r=>r.id===Number(url.searchParams.get('rev')))}):'';
  const designEditorHtml=view==='components'&&(editId||hasNew)?renderDesignEditor({t,editId,editData:editData as ComponentData|null,csrf,helpFile}):'';
  const cloudReady=await cloudConfigured(env);
  const pagesHtml=renderPagesView({t,pages:filtered.slice((pageNumber-1)*perPage,pageNumber*perPage),view,editId,hasNew,csrf,helpFile,settings,query,category,pageNumber,totalPages,lang,publication:await publicationStatus(env,url.origin,pages),cloudReady,publicUrl:env.CLOUDFLARE_PUBLIC_WORKER_NAME ? env.PUBLIC_SITE_URL || '' : ''});
  const mediaQuery=url.searchParams.get('q_media')||'',mediaCategory=category,ignoreMediaCategory=url.searchParams.get('media_all')==='1';
  const mediaTypeFilter=['image','audio','video','js','css'].includes(url.searchParams.get('media_type')||'')?url.searchParams.get('media_type')!:'';
  const extensions:Record<string,string[]>={image:['jpg','jpeg','png','gif','webp','svg'],audio:['mp3','m4a'],video:['mp4'],js:['js'],css:['css']};
  const mediaFiles=files.filter(f=>(!mediaTypeFilter||extensions[mediaTypeFilter].includes(f.key.split('.').pop()!.toLowerCase()))&&(!mediaQuery||f.key.toLowerCase().includes(mediaQuery.toLowerCase()))&&(!mediaCategory||ignoreMediaCategory||isCodeMedia(f.key)||f.key.startsWith('g_')||f.key.split('_').slice(0,-1).includes(mediaCategory)));
  const mediaPerPage=Math.min(500,Math.max(1,Number(settings.media_per_page)||100)),mediaTotalPages=Math.max(1,Math.ceil(mediaFiles.length/mediaPerPage)),mediaPage=Math.min(mediaTotalPages,Math.max(1,Number(url.searchParams.get('p_media'))||1));
  const references:Record<string,string[]>={};const mediaNames=new Set(files.map(f=>f.key));
  for(const item of [...pages.map(p=>({id:p.id,text:[p.data.content_md,p.data.css,p.data.js,p.data.ogp_image].join('\n')})),...components.filter(c=>!c.data.is_ai_doc).map(c=>({id:'component: '+c.id,text:[c.data.html,c.data.css,c.data.js].join('\n')}))])for(const name of new Set(item.text.match(/[A-Za-z0-9_.-]+\.(?:jpe?g|png|gif|webp|svg)/gi)||[]))if(mediaNames.has(name))(references[name]||=[]).push(item.id);
  const designHtml=renderDesignView({t,components,view,editId,hasNew,helpFile}),mediaHtml=renderMediaView({t,files:mediaFiles.slice((mediaPage-1)*mediaPerPage,mediaPage*mediaPerPage),csrf,helpFile,mediaEnabled:true,lang,references,usage:await mediaUsage(env),storageMode:await mediaStorageMode(env),query:mediaQuery,mediaType:mediaTypeFilter,category:mediaCategory,ignoreCategory:ignoreMediaCategory,categories:allCategories,page:mediaPage,totalPages:mediaTotalPages,totalFiles:mediaFiles.length});
  if(url.searchParams.has('ajax_editor'))return html(view==='components'?designEditorHtml:pageEditorHtml);
  if(url.searchParams.has('ajax_media'))return html(mediaHtml);
  if(url.searchParams.has('ajax_pages'))return html(pagesHtml);
  if(url.searchParams.has('ajax_comps'))return html(designHtml);
  const databaseProbe=await env.DB.prepare('SELECT 1').run();
  const d1Bytes=typeof databaseProbe.meta.size_after==='number'?databaseProbe.meta.size_after:null;
  const storageMode=await mediaStorageMode(env),migration=await migrationStatus(env);
  const target=cloudTarget(env),displaySettings={...settings,storage_migrated:url.searchParams.get('storage_migrated')==='1',media_storage:storageMode,r2_configured:!!env.MEDIA,d1_bytes:d1Bytes,media_migration:migration,r2_bytes:(await env.DB.prepare('SELECT COALESCE(SUM(size),0) bytes FROM r2_objects').first<{bytes:number}>())?.bytes||0,cloud_connection_ready:cloudReady,cloud_account_id:target.account,cloud_worker_name:target.worker};
  const siteHtml=view==='import'?renderImportView({t,csrf,lang,stats:{pages:pages.length,components:components.length,users:users.length,media:files.length,mediaBytes:files.reduce((sum,file)=>sum+file.size,0)},cloudReady}):renderSiteView({t,trackingLegacy:(()=>{const id=String(settings.tracking_component||''),data=components.find(c=>c.id===id)?.data;return{id,html:trackingLegacyHtml(data),exists:!!data&&!data.is_ai_doc&&!data.is_wrapper};})(),settings:displaySettings,csrf,helpFile,users,username:auth.user.username,accountsHtml:renderAccountsSection({lang,csrf,users,me:auth.device,devices:await listDevices(env),codes:await listCodes(env),expiryDays:expiryFrom(settings),issuedCode}),lang,release:await latestCloudRelease(env,url.searchParams.has('refresh_updates'))});
  const unseen=await unseenDevices(env,auth.device);
  if(unseen.length)message=(message?message+' ':'')+(lang==='ja'?'新しい端末が登録されました: ':'New device registered: ')+unseen.map(d=>`${d.name} (${d.username})`).join(', ')+(lang==='ja'?'。心当たりがなければ「端末とユーザー」で止めてください。':'. If you do not recognise it, stop it under Devices and users.');
  return html(renderAdminShell({lang,t,view,editId,hasNew,helpFile,message,csrf,settings:{...settings,_public_url:env.CLOUDFLARE_PUBLIC_WORKER_NAME ? env.PUBLIC_SITE_URL||'' : ''},pagesHtml,pageEditorHtml,siteHtml,designHtml,designEditorHtml,mediaHtml,
    mediaEnabled:true,aiPromptJson:JSON.stringify(settings.ai_prompt||'').replace(/</g,'\\u003c'),allCategories,category}),statusCode);
}
