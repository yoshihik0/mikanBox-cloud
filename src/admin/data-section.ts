type Translator = (key: string, ...args: (string | number)[]) => string;
const h=(value: unknown)=>String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const icon=(name: string)=>`<span class="material-symbols-outlined icon">${name}</span>`;
const csrfField=(token: string)=>`<input type="hidden" name="csrf_token" value="${h(token)}">`;
const TEXTS=['transfer_reading','transfer_nothing','transfer_not_zip','transfer_bad_json','transfer_confirm_title','transfer_confirm_replace','transfer_btn_replace','transfer_sending_data','transfer_sending_media','transfer_publishing','transfer_publish_failed','transfer_done','transfer_refused','transfer_media_failed','transfer_build_hint'];

/**
 * The site screen's "Data management": the site's figures, Save and Read, the same structure and wording as
 * the PHP editions (shared/views/data-transfer-sections.php). The Cloud edition adds its own sections after
 * them ($extraHtml): restoring D1 to a past time and exporting the public site.
 */
export interface TransferStats {pages:number;components:number;users:number;media:number;mediaBytes:number;databaseBytes:number|null}
const size=(b:number)=>b>=1048576?`${(b/1048576).toFixed(1)} MB`:`${(b/1024).toFixed(1)} KB`;
export function renderTransferSections(opts: {t: Translator; csrf: string; cloudReady: boolean; extraHtml: string; stats: TransferStats}): string {
  const {t,csrf,stats}=opts,texts=Object.fromEntries(TEXTS.map(key=>[key,t(key)]));
  const figures=[['pages',stats.pages],['components',stats.components],['users',stats.users],['media',stats.media],['media_size',size(stats.mediaBytes)],...(stats.databaseBytes!==null?[['database',size(stats.databaseBytes)]]:[])];
  return `${`<ul class="transfer-stats">${figures.map(([key,value])=>`<li>${h(t('transfer_stats_'+key))} <strong>${h(value)}</strong></li>`).join('')}</ul>`}
        <section id="transfer-export" class="data-tool-card">
          <h2>${icon('download')} ${h(t('transfer_export_title'))}</h2>
          <p>${h(t('transfer_export_hint'))}</p>
          <form method="post" class="transfer-export-form" data-transfer="export">${csrfField(csrf)}<input type="hidden" name="save_action" value="transfer_export">
            <div class="flex-row flex-row-wrap items-center">
              <label class="transfer-field">${h(t('transfer_contents_label'))} <select name="contents"><option value="both">${h(t('transfer_contents_both'))}</option><option value="data">${h(t('transfer_contents_data'))}</option><option value="media">${h(t('transfer_contents_media'))}</option>${opts.cloudReady?`<option value="database">${h(t('transfer_contents_database'))}</option>`:''}</select></label>
              <label class="transfer-field transfer-revisions"><input type="checkbox" name="include_revisions" value="1"> ${h(t('transfer_include_revisions'))}</label>
              <label class="transfer-field transfer-match-filter" title="${h(t('transfer_match_filter_hint'))}"><input type="checkbox" name="match_filter" value="1"> ${h(t('transfer_match_filter'))}</label>
              <button type="submit" class="btn btn-gray btn-small">${icon('download')} ${h(t('transfer_btn_export'))}</button>
            </div>
            <span data-transfer-status role="status"></span>
          </form>
        </section>
        <section id="transfer-import" class="data-tool-card">
          <h2>${icon('upload')} ${h(t('transfer_import_title'))}</h2>
          <p>${h(t('transfer_import_hint'))}</p>
          <form data-transfer="import" data-messages="${h(JSON.stringify(texts))}">${csrfField(csrf)}
            <input type="file" name="files" multiple required accept=".zip,.xml,.jpg,.jpeg,.png,.gif,.webp,.svg,.js,.css">
            <fieldset class="transfer-modes"><legend>${h(t('transfer_mode_label'))}</legend>
              <label><input type="radio" name="mode" value="add" checked> ${h(t('transfer_mode_add'))}</label>
              <label><input type="radio" name="mode" value="overwrite"> ${h(t('transfer_mode_overwrite'))}</label>
              <label><input type="radio" name="mode" value="replace"> ${h(t('transfer_mode_replace'))}</label>
            </fieldset>
            <p class="sub-text">${h(t('transfer_import_note'))}</p>
            <button type="submit" class="btn btn-blue btn-small">${icon('upload')} ${h(t('transfer_btn_import'))}</button>
            <span data-transfer-status role="status"></span>
          </form>
        </section>
        ${opts.extraHtml}`;
}
