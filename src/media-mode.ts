import type {Env} from './types';
export async function mediaStorageMode(env:Env):Promise<'d1'|'r2'>{
 const row=await env.DB.prepare("SELECT value FROM settings WHERE key='media_storage'").first<{value:string}>();return row?.value==='r2'?'r2':'d1';
}
export async function assertMediaUnlocked(env:Env):Promise<void>{
 if(await env.DB.prepare("SELECT key FROM settings WHERE key='media_storage_lock'").first())throw new Error('画像をR2へ移行中です。移行を完了するか中止してください。 / Finish or cancel the R2 migration before editing images.');
}
export const MEDIA_UNLOCKED_SQL="NOT EXISTS(SELECT 1 FROM settings WHERE key='media_storage_lock')";
export const MEDIA_MODE_SQL="CASE WHEN (SELECT value FROM settings WHERE key='media_storage')='r2' THEN 'r2' ELSE 'd1' END";
