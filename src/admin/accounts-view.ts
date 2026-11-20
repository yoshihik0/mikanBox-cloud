import type {Device,DeviceCode} from '../devices';
import {EXPIRY_CHOICES,PROBATION_DAYS,CODE_HOURS,INVITE_HOURS,onProbation} from '../devices';
import type {User} from '../accounts';
import {localTime} from './local-time';
type Translator=(key:string,...args:(string|number)[])=>string;
const h=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const csrfField=(csrf:string)=>`<input type="hidden" name="csrf_token" value="${h(csrf)}">`;
const icon=(name:string)=>`<span class="material-symbols-outlined icon">${name}</span>`;
// Shown in the viewer's local time (see local-time.ts).
const when=(ms:number,lang:string)=>localTime(ms,lang);
const headingStyle='font-size: 0.95rem; margin: 18px 0 12px; color: var(--text); border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;';
const boxStyle='margin-top: 15px; margin-bottom: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa;';
const boxSummaryStyle='padding: 10px 15px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-bottom: none; background: transparent;';
const boxBodyStyle='padding: 15px; border-top: 1px solid #e2e8f0; background: #fff; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;';
/**
 * Users and devices of the Cloud edition. There are no passwords: devices are trusted and stopped one by one.
 * Structure and wording follow the SQLite edition's views/device-accounts.php (same keys); only the recovery
 * note differs. A newly issued code is put, once, under the button that issued it (see cloud-admin.js).
 */
export function renderAccountsSection(opts:{t:Translator;lang:string;csrf:string;users:User[];me:Device;devices:Device[];codes:DeviceCode[];expiryDays:number}):string {
 const {t,lang,csrf,me}=opts,names=new Map(opts.devices.map(d=>[d.id,d.name]));
 const probation=onProbation(me);
 const codeSlot=(invite:boolean)=>`<div data-issued-code-slot="${invite?'invite':'own'}" data-note="${h(t('device_code_panel_note',invite?INVITE_HOURS:CODE_HOURS))}"></div>`;
 const codeRows=opts.codes.map(c=>`<tr><td>${c.username===''?h(t('device_invite_mark')):`<code>${h(c.username)}</code>${c.display_name?` (${h(t('device_invite_mark'))})`:''}`}</td><td>${h(names.get(c.created_by)||'—')}</td><td>${when(c.expires_at,lang)}</td><td class="account-actions"><form method="post" class="inline" data-ajax data-refresh="#users-mgmt">${csrfField(csrf)}<input type="hidden" name="save_action" value="device_code_cancel"><input type="hidden" name="code_hash" value="${h(c.code_hash)}"><button type="submit" class="btn btn-gray btn-small">${h(t('device_btn_cancel_code'))}</button></form></td></tr>`).join('');
 const deviceRow=(d:Device)=>{
  const isMe=d.id===me.id;
  return `<tr><td>${h(d.name)}${isMe?` <span class="sub-text">(${h(t('device_this_device'))})</span>`:''}</td><td>${when(d.created_at,lang)}</td><td>${when(d.last_used_at,lang)}</td><td>${when(d.expires_at,lang)}</td><td class="account-actions">${isMe||!probation?`<form method="post" class="inline" data-ajax data-refresh="#users-mgmt" data-confirm="${h(isMe?t('device_confirm_stop_self'):t('device_confirm_stop_other'))}" data-confirm-ok="${h(t('btn_ok'))}">${csrfField(csrf)}<input type="hidden" name="save_action" value="device_revoke"><input type="hidden" name="device_id" value="${h(d.id)}"><button type="submit" class="btn btn-red btn-small">${h(t('device_btn_stop'))}</button></form>`:''}</td></tr>`;
 };
 const userBlock=(u:User)=>{
  const own=opts.devices.filter(d=>d.username===u.username),self=u.username===me.username;
  const head=`<div class="account-user-head"><span class="account-user-name">${h(u.display_name)}<code>${h(u.username)}</code></span>${!self&&opts.users.length>1&&!probation?`<form method="post" class="inline" data-ajax data-refresh="#users-mgmt" data-confirm="${h(t('confirm_delete_user',u.display_name))}" data-confirm-ok="${h(t('btn_delete'))}">${csrfField(csrf)}<input type="hidden" name="save_action" value="delete_user"><input type="hidden" name="username" value="${h(u.username)}"><button type="submit" class="btn btn-red btn-small">${h(t('btn_delete'))}</button></form>`:self?`<span class="sub-text">${h(t('label_logged_in'))}</span>`:''}</div>`;
  const table=own.length?`<div class="account-table-wrap"><table class="account-table"><thead><tr><th>${h(t('device_col_device'))}</th><th>${h(t('device_col_added'))}</th><th>${h(t('device_col_last_used'))}</th><th>${h(t('device_col_expires'))}</th><th></th></tr></thead><tbody>${own.map(deviceRow).join('')}</tbody></table></div>`:`<p class="account-user-empty">${h(t('device_no_devices'))}</p>`;
  const nameForm=self?`<form method="post" class="account-name-form" data-ajax data-refresh="#users-mgmt">${csrfField(csrf)}<input type="hidden" name="save_action" value="update_user"><input type="hidden" name="old_username" value="${h(u.username)}"><input type="hidden" name="username" value="${h(u.username)}"><label for="my-display-name">${h(t('device_display_name_label'))}</label><input type="text" id="my-display-name" name="display_name" required maxlength="120" value="${h(u.display_name)}"><button type="submit" class="btn btn-gray btn-small">${h(t('btn_save'))}</button></form>`:'';
  return `<div class="account-user">${head}${table}${nameForm}</div>`;
 };
 return `<div id="users-mgmt"><div class="section-container section-tight"><details class="section-accordion"><summary class="header section-header accordion-summary"><h2 class="accordion-title">${h(t('device_section_title'))} <span class="accordion-arrow">▼</span></h2></summary><div class="editor-container editor-container-sub">
 <p class="sub-text sub-text-intro">${h(t('device_section_intro'))}</p>
 ${probation?`<p class="error" role="status">${h(t('device_probation_notice',PROBATION_DAYS))}</p>`:''}
 <div id="users-list-wrap"><h3 style="${headingStyle}">${h(t('device_users_devices_title'))}</h3>${opts.users.map(userBlock).join('')}</div>
 <details class="section-accordion" style="${boxStyle}"><summary class="header section-header accordion-summary" style="${boxSummaryStyle}"><h3 style="font-size: 0.95rem; margin: 0; color: var(--text); display: inline-flex; align-items: center; gap: 8px; pointer-events: none;">${icon('add')} ${h(t('device_add_summary'))}</h3><span class="accordion-arrow" style="font-size: 0.75rem; opacity: 0.5;">▼</span></summary>
 <div style="${boxBodyStyle}"><p class="sub-text">${h(t('device_add_intro'))}</p><form method="post" data-ajax>${csrfField(csrf)}<input type="hidden" name="save_action" value="device_code_create"><button type="submit" class="btn btn-blue btn-small">${icon('add')} ${h(t('device_btn_issue_code'))}</button></form>${codeSlot(false)}
 <h4 style="margin: 20px 0 10px; font-size: 0.9rem;">${h(t('device_invite_title'))}</h4><p class="sub-text">${h(t('device_invite_admin_intro'))}</p><form method="post" data-ajax>${csrfField(csrf)}<input type="hidden" name="save_action" value="device_code_create"><input type="hidden" name="invite" value="1"><button type="submit" class="btn btn-blue btn-small">${icon('add')} ${h(t('device_btn_invite'))}</button></form>${codeSlot(true)}</div></details>
 ${codeRows?`<h3 style="${headingStyle}">${h(t('device_codes_title'))}</h3><div class="account-table-wrap"><table class="account-table"><thead><tr><th>${h(t('device_col_user'))}</th><th>${h(t('device_col_issued_by'))}</th><th>${h(t('device_col_expires'))}</th><th></th></tr></thead><tbody>${codeRows}</tbody></table></div>`:''}
 <form method="post" class="device-expiry-form" data-ajax data-refresh="#users-mgmt">${csrfField(csrf)}<input type="hidden" name="save_action" value="device_expiry"><label>${h(t('device_expiry_label'))} <select name="days">${EXPIRY_CHOICES.map(d=>`<option value="${d}"${d===opts.expiryDays?' selected':''}>${h(t('device_days',d))}</option>`).join('')}</select></label><button type="submit" class="btn btn-gray btn-small">${h(t('btn_save'))}</button></form>
 <p class="sub-text">${h(t('device_recovery_note_cloud'))}</p>
 </div></details></div></div>`;
}
