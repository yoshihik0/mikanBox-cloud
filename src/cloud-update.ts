import type {Env} from './types';
import {CLOUD_VERSION} from './version';
import {cloudConfigured} from './cloudflare-api';
import {audit} from './audit';
import {latestCloudRelease} from './cloud-release';
import {acquireCloudUpdate,applyCloudUpdateMigrations,readCloudUpdate,setCloudUpdatePhase,type CloudUpdatePhase} from './cloud-update-state';
import {compareVersions,versionPattern,CloudUpdateError,updateManifest,updatePackage,type UpdateManifest} from './cloud-update-package';
import {activeUpdateVersion,activateVersion,checkCandidate,stageVersion,validatedSettings} from './cloud-update-deploy';

export {CloudUpdateError};
interface Plan {owner:string;manifest:UpdateManifest;previous:string;candidate?:string;deployStarted?:number}
async function readPlan(env:Env):Promise<Plan|null>{
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='cloud_update_plan'").first<{value:string}>();
  return row?JSON.parse(row.value) as Plan:null;
}
async function savePlan(env:Env,plan:Plan) {
  const result=await env.DB.prepare(`
    INSERT INTO settings(key,value) SELECT 'cloud_update_plan',? WHERE EXISTS
    (SELECT 1 FROM settings WHERE key='cloud_update' AND json_extract(value,'$.owner')=?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).bind(JSON.stringify(plan),plan.owner).run();
  if(!result.meta.changes)throw new Error('Update expired');
}
const expired=()=>new CloudUpdateError('更新の有効時間が切れました。サイト画面で再確認してください。 / This update expired. Refresh the Site screen.');
const busy=()=>new CloudUpdateError('別の更新が進行中です。 / Another update is running.');
function report(jobId:string,stage:CloudUpdatePhase){
  return {jobId,stage,status:stage==='succeeded'?'complete' as const:'running' as const};
}
export async function runCloudUpdateStep(env:Env,actor:string,version:string,jobId:string){
  if(!versionPattern.test(version)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)||!actor)
    throw new CloudUpdateError('更新リクエストが無効です。 / Invalid update request.');
  const owner=JSON.stringify([actor,jobId]);
  // Serialize concurrent polls, including retries after a lost HTTP response. The token fences unlocks.
  const nonce=crypto.randomUUID();
  const step=await env.DB.prepare(`INSERT INTO settings(key,value) VALUES('cloud_update_step',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.expires')<=?`)
    .bind(JSON.stringify({nonce,expires:Date.now()+240000}),Date.now()).run();
  if(!step.meta.changes){
    const active=await readCloudUpdate(env.DB);
    if(active?.owner===owner && active.version===version)return report(jobId,active.phase);
    throw busy();
  }
  try {
    const state=await readCloudUpdate(env.DB);
    if(!state||state.owner!==owner){
      if(state&&state.expires>Date.now())throw busy();
      if(compareVersions(version,CLOUD_VERSION)<=0)throw expired();
      if(!await cloudConfigured(env))throw new CloudUpdateError('サイトのCloudflare公開設定にトークンを保存してください。 / Save the Cloudflare token in Site settings.');
      if(!await acquireCloudUpdate(env.DB,version,owner))throw busy();
      await audit(env,'system_update_started',{actor,from:CLOUD_VERSION,to:version});
      return report(jobId,'validating');
    }
    if(state.version!==version)throw expired();
    if(state.phase==='succeeded')return report(jobId,state.phase);
    if(state.phase==='failed')throw new CloudUpdateError(state.message||'更新に失敗しました。 / Update failed.');
    if(state.expires<=Date.now())throw expired();
    const phase=state.phase;
    try {
      await setCloudUpdatePhase(env.DB,owner,phase);
      let next:CloudUpdatePhase;
      if(phase==='validating'){
        const release=await latestCloudRelease(env,true);
        if(!release.outdated||release.version!==version)throw new CloudUpdateError('最新版を再確認してください。 / Refresh the available release.');
        const manifest=await updateManifest(version);
        await validatedSettings(env);
        const previous=await activeUpdateVersion(env);
        const earlier=await readPlan(env);
        const candidate=earlier?.previous===previous&&earlier.manifest.sha256===manifest.sha256?earlier.candidate:undefined;
        await savePlan(env,{owner,manifest,previous,candidate});
        next='uploading';
      } else {
        const plan=await readPlan(env);
        if(!plan||plan.owner!==owner||plan.manifest.version!==version)throw expired();
        if(phase==='uploading'){
          const payload=await updatePackage(plan.manifest);
          plan.candidate=await stageVersion(env,plan.manifest,payload,plan.previous,plan.candidate);
          await savePlan(env,plan);
          next='migrating';
        }else{
          if(!plan.candidate)throw expired();
          if(phase==='migrating'){
            const payload=await updatePackage(plan.manifest);
            await checkCandidate(env,plan.previous,plan.candidate);
            await applyCloudUpdateMigrations(env.DB,owner,payload.migrations);
            plan.deployStarted=Date.now();
            await savePlan(env,plan);
            next='deploying';
          }else if(phase==='deploying'){
            try {
              await activateVersion(env,plan.previous,plan.candidate);
            }catch(error){
              // A deployment may have reached Cloudflare even when its acknowledgement was lost.
              if(await activeUpdateVersion(env)!==plan.candidate)throw error;
            }
            next='verifying';
          }else{
            if(await activeUpdateVersion(env)!==plan.candidate)throw new CloudUpdateError('配信中の版が変わりました。Cloudflareでデプロイ履歴を確認してください。 / The active deployment changed. Check Cloudflare Deployments.');
            // A fresh authenticated request reaching the target Worker verifies its code, D1 and session.
            if(CLOUD_VERSION!==version){
              if(Date.now()-(plan.deployStarted||0)>5*60*1000)throw expired();
              return report(jobId,'verifying');
            }
            next='succeeded';
          }
        }
      }
      await setCloudUpdatePhase(env.DB,owner,next);
      return report(jobId,next);
    }catch(error){
      const safe=error instanceof CloudUpdateError?error:new CloudUpdateError('更新を完了できませんでした。適用済みのDB変更は再試行時にスキップされます。 / Update stopped. Applied database migrations will be skipped on retry.');
      await setCloudUpdatePhase(env.DB,owner,'failed',safe.message);
      await audit(env,'system_update_failed',{actor,target:phase,to:version});
      throw safe;
    }
  }finally {
    await env.DB.prepare("DELETE FROM settings WHERE key='cloud_update_step' AND json_extract(value,'$.nonce')=?").bind(nonce).run();
  }
}
