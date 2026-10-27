const {test}=require('node:test');const assert=require('node:assert/strict');
const {environment,login,post,call}=require('./fixtures.cjs');
const {savePage,uploadMedia}=require('../.test-build/src/storage.js');
const {saveWithRevision}=require('../.test-build/src/revisions.js');
const {assertNotPublished}=require('../.test-build/src/publication-state.js');
test('publication endpoints require authentication and a lease prevents simultaneous edits',async()=>{
 const env=environment(),auth=await login(env);
 assert.doesNotMatch(await(await call(env,'/admin?publication_manifest=1')).text(),/entries/);
 const begin=await post(env,auth,{save_action:'begin_publication'});assert.ok(begin.data.lease);
 const edit=await post(env,auth,{save_action:'save_page',id:'blocked',title:'Blocked',status:'draft'});assert.equal(edit.response.status,400);assert.match(edit.data.message,/Publication/);
 const record=await post(env,auth,{save_action:'record_publication',paths:'["/page.html"]',publication_lease:begin.data.lease});assert.equal(record.data.success,true);
 await post(env,auth,{save_action:'end_publication',publication_lease:begin.data.lease});
 env.STATIC_DELIVERY='true';await assert.rejects(assertNotPublished(env,['/page.html']),/Withdraw/);
 await savePage(env,'page',{title:'Public',status:'public_static',revision_tag:'r'});
 await saveWithRevision(env,'page','page',{title:'Private',status:'draft'},'test','r');
 assert.equal(env.sqlite.prepare("SELECT status FROM posts WHERE id='page'").get().status,'draft');
});
test('public images remain readable directly after static publication and authenticated originals can be previewed',async()=>{
 const env=environment(),auth=await login(env),bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
 await uploadMedia(env,'one.png',bytes.buffer,'image/png');env.STATIC_DELIVERY='true';
 const publicImage=await call(env,'/media/one.png');assert.equal(publicImage.status,200);assert.deepEqual(new Uint8Array(await publicImage.arrayBuffer()),bytes);
 const preview=await call(env,'/admin?media_preview=one.png',null,auth.cookie);assert.equal(preview.status,200);assert.deepEqual(new Uint8Array(await preview.arrayBuffer()),bytes);
});
test('a published image must be withdrawn before deletion; rename retains the published path',async()=>{
 const env=environment(),auth=await login(env),bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
 await uploadMedia(env,'kept.png',bytes.buffer,'image/png');
 env.STATIC_DELIVERY='true';
 const begin=await post(env,auth,{save_action:'begin_publication'});
 await post(env,auth,{save_action:'record_publication',paths:'["/media/kept.png"]',publication_lease:begin.data.lease});
 await post(env,auth,{save_action:'end_publication',publication_lease:begin.data.lease});

 // The button reads this flag to decide whether to withdraw first.
 const status=await post(env,auth,{save_action:'media_reference_status',file:'kept.png'});
 assert.equal(status.data.published,true);

 const blocked=await post(env,auth,{save_action:'delete_media',file:'kept.png'});
 assert.equal(blocked.response.status,400);assert.match(blocked.data.message,/Withdraw/);
 const renamed=await post(env,auth,{save_action:'rename_media',file:'kept.png',new_name:'moved.png',confirmed:'1'});
 assert.equal(renamed.data.success,true,renamed.data.message);
 const state=JSON.parse(env.sqlite.prepare("SELECT value FROM settings WHERE key='static_publication'").get().value);
 assert.ok(state.paths.includes('/media/kept.png'));
 const reuse=await post(env,auth,{save_action:'rename_media',file:'moved.png',new_name:'kept.png',confirmed:'1'});
 assert.equal(reuse.response.status,400);assert.match(reuse.data.message,/公開中|still published/);

 // Withdrawing republishes without that path, after which the source can go.
 const withdraw=await post(env,auth,{save_action:'begin_publication'});
 await post(env,auth,{save_action:'record_publication',paths:'[]',publication_lease:withdraw.data.lease});
 await post(env,auth,{save_action:'end_publication',publication_lease:withdraw.data.lease});
 const deleted=await post(env,auth,{save_action:'delete_media',file:'moved.png'});
 assert.equal(deleted.data.success,true);
 assert.equal(env.sqlite.prepare("SELECT key FROM media WHERE key='moved.png'").get(),undefined);
});
