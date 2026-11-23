import type {Env} from './types';
import {cloudResult,cloudTarget} from './cloudflare-api';
import {CloudUpdateError,type UpdateManifest,type UpdatePackage} from './cloud-update-package';

const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const mismatch=()=>new CloudUpdateError('管理Workerの設定を確認してください。追加バインディングのあるサイトは手動更新を使えます。 / Verify the management Worker configuration. Use the manual update for custom bindings.');
const changed=()=>new CloudUpdateError('別のWorker版が見つかりました。Cloudflareのデプロイ履歴を確認してください。 / The Worker version changed. Check Cloudflare Deployments.');
export async function updateApi<T>(env:Env,path:string,init:RequestInit={},token?:string):Promise<T> {
  try{return await cloudResult<T>(env,path,{...init,signal:AbortSignal.timeout(25000)},token);}
  catch(e){
    if(e instanceof Error && /\((401|403)\)/.test(e.message))throw new CloudUpdateError('Cloudflare公開設定のトークンに、管理Workerの Workers Scripts Edit 権限が必要です。 / The publication token needs Workers Scripts Edit for the management Worker.');
    throw new CloudUpdateError('Cloudflare APIへの接続に失敗しました。デプロイ履歴を確認して再試行してください。 / The Cloudflare request failed. Check Deployments and retry.');
  }
}
function root(env:Env){
  const {account,worker,database}=cloudTarget(env);
  if(!/^[a-f0-9]{32}$/.test(account)||!/^[-a-z0-9]{1,63}$/.test(worker)||!/^[a-f0-9-]{36}$/.test(database)||
     !env.CLOUDFLARE_PUBLIC_WORKER_NAME||env.CLOUDFLARE_PUBLIC_WORKER_NAME===worker)throw mismatch();
  return '/workers/scripts/'+worker;
}
type LiveBinding={name:string;type:string;text?:string;id?:string};
interface LiveSettings {
  bindings:LiveBinding[];
  compatibility_flags?:string[]; placement?:unknown; limits?:unknown; observability?:unknown;
  tail_consumers?:unknown; logpush?:boolean;
}
export async function validatedSettings(env:Env):Promise<LiveSettings> {
  const settings=await updateApi<LiveSettings>(env,root(env)+'/settings');
  const bindings=settings.bindings||[];
  const plain=Object.fromEntries(bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
  const {account,worker,database}=cloudTarget(env);
  if(plain.CLOUDFLARE_ACCOUNT_ID!==account||plain.CLOUDFLARE_WORKER_NAME!==worker||plain.CLOUDFLARE_D1_ID!==database||
     plain.CLOUDFLARE_PUBLIC_WORKER_NAME!==env.CLOUDFLARE_PUBLIC_WORKER_NAME||
     !bindings.some(b=>b.name==='JWT_SECRET'&&b.type==='secret_text')||
     !bindings.some(b=>b.name==='DB'&&b.type==='d1'&&b.id===database)||!bindings.some(b=>b.type==='assets'&&b.name==='ASSETS')||
     bindings.some(b=>!['plain_text','secret_text','json'].includes(b.type)&&!(b.type==='d1'&&b.name==='DB')&&!(b.type==='assets'&&b.name==='ASSETS')))throw mismatch();
  return settings;
}
export async function activeUpdateVersion(env:Env){
  const response=await updateApi<{deployments:{versions:{version_id:string;percentage:number}[]}[]}>(env,root(env)+'/deployments');
  const versions=response.deployments?.[0]?.versions;
  if(versions?.length!==1||versions[0].percentage!==100||!versions[0].version_id)throw changed();
  return versions[0].version_id;
}
interface Candidate {id:string;annotations?:Record<string,string>}
async function latestUpload(env:Env){
  const result=await updateApi<{items:Candidate[]}>(env,root(env)+'/versions?per_page=1');
  const version=result.items?.[0];
  if(!version?.id)throw changed();
  return version;
}
// The matched tag lets a retry recover a version whose upload response was lost.
const candidateTag=(previous:string,digest:string)=>'mikanbox-'+previous+'-'+digest.slice(0,32);
export async function stageVersion(env:Env,m:UpdateManifest,p:UpdatePackage,previous:string,knownCandidate?:string) {
  const settings=await validatedSettings(env);
  const tag=candidateTag(previous,m.sha256);
  async function existing(){
    const latest=await latestUpload(env);
    if(await activeUpdateVersion(env)!==previous)throw changed();
    if(latest.id===previous)return '';
    if(latest.id===knownCandidate || latest.annotations?.['workers/tag']===tag)return latest.id;
    const detail=await updateApi<Candidate>(env,root(env)+'/versions/'+encodeURIComponent(latest.id));
    if(detail.id===latest.id && detail.annotations?.['workers/tag']===tag)return latest.id;
    throw changed();
  }
  const prepared=await existing();
  if(prepared)return prepared;
  const manifest=Object.fromEntries(p.assets.map(a=>[a.path,{hash:a.hash,size:a.size}]));
  const session=await updateApi<{jwt:string;buckets:string[][]}>(env,root(env)+'/assets-upload-session',post({manifest}));
  if(!session.jwt||!Array.isArray(session.buckets))throw changed();
  let completion=session.buckets.length?'':session.jwt;
  const files=new Map(p.assets.map(a=>[a.hash,a]));
  for(const bucket of session.buckets){
    const form=new FormData();
    for(const hash of bucket){
      const a=files.get(hash);
      if(!a)throw changed();
      form.set(hash,new Blob([a.content],{type:a.type}),hash);
    }
    const result=await updateApi<{jwt?:string}>(env,'/workers/assets/upload?base64=true',{method:'POST',body:form},session.jwt);
    if(result.jwt)completion=result.jwt;
  }
  if(!completion)throw changed();
  const raced=await existing();
  if(raced)return raced;
  // Version uploads leave routes and domains in place. Keep secrets on Cloudflare and use the verified D1.
  const metadata={
    main_module:p.main.name, compatibility_date:m.compatibility_date,compatibility_flags:settings.compatibility_flags,
    placement:settings.placement,limits:settings.limits,observability:settings.observability,
    tail_consumers:settings.tail_consumers,logpush:settings.logpush,
    bindings:[{name:'DB',type:'d1',id:env.CLOUDFLARE_D1_ID},{name:'ASSETS',type:'assets'}],
    keep_bindings:['plain_text','json','secret_text'],assets:{jwt:completion,config:{run_worker_first:true}},
    annotations:{'workers/message':'mikanBox Cloud '+m.version,'workers/tag':tag}
  };
  const form=new FormData();
  form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
  form.set(p.main.name,new Blob([p.main.content],{type:'application/javascript+module'}),p.main.name);
  const uploaded=await updateApi<Candidate>(env,root(env)+'/versions',{method:'POST',body:form});
  if(!uploaded.id)throw changed();
  return uploaded.id;
}
export async function checkCandidate(env:Env,previous:string,candidate:string) {
  const active=await activeUpdateVersion(env);
  if(active!==previous&&active!==candidate)throw changed();
  if((await latestUpload(env)).id!==candidate)throw changed();
  return active;
}
export async function activateVersion(env:Env,previous:string,candidate:string){
  if(await checkCandidate(env,previous,candidate)===candidate)return;
  await updateApi(env,root(env)+'/deployments',post({strategy:'percentage',versions:[{version_id:candidate,percentage:100}]}));
}
