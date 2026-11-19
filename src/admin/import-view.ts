import {CLOUD_VERSION} from '../version';

type Translator = (key: string, ...args: (string | number)[]) => string;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}

function icon(name: string): string {
  return `<span class="material-symbols-outlined icon">${name}</span>`;
}

function csrfField(token: string): string {
  return `<input type="hidden" name="csrf_token" value="${escapeHtml(token)}">`;
}

/** Cloud import screen: SQLite converter structure, with Cloud backup controls appended. */
export function renderImportView(opts: {
  t: Translator;
  csrf: string;
  lang: string;
  stats: { pages: number; components: number; users: number; media: number; mediaBytes: number; dbSize?: string };
  cloudBackupHtml: string;
}): string {
  const {t,csrf,lang,stats,cloudBackupHtml}=opts;
  const en=lang==='en';
  const size=stats.mediaBytes>=1048576?`${(stats.mediaBytes/1048576).toFixed(1)} MB`:`${Math.round(stats.mediaBytes/1024)} KB`;
  const packageHint=t('import_zip_hint');
  const wxrHint=t('import_wp_hint');
  return `<div id="data-import" class="section-anchor">
    <main class="data-tool">
      <header class="data-tool-header"><div class="data-tool-logo">🍊</div><div><h1>${en?'Data migration and import':'データ移行・インポート'}</h1><p>${en?'Review Cloud data and import external content.':'Cloudのデータ状態を確認し、外部コンテンツをインポートします。'}</p></div></header>
      <div class="data-tool-content">
      <div class="data-tool-grid">
        <section class="data-tool-card"><h2>${icon('database')} ${en?'Cloud database status':'Cloudデータベース状態'}</h2><ul class="import-status-list">
          ${stats.dbSize?`<li>${en?'Database size':'データベース容量'}: <strong>${escapeHtml(stats.dbSize)}</strong></li>`:''}<li>${en?'Pages':'登録ページ'}: <strong data-import-total="pages">${stats.pages}</strong></li><li>${en?'Components':'登録コンポーネント'}: <strong data-import-total="components">${stats.components}</strong></li><li>${en?'Users':'登録ユーザー'}: <strong>${stats.users}</strong></li></ul></section>
        <section class="data-tool-card"><h2>${icon('image')} ${en?'Media status':'メディア状態'}</h2><ul class="import-status-list">
          <li>${en?'Stored media files':'登録メディアファイル'}: <strong>${stats.media}</strong></li><li>${en?'Total media size':'メディア総容量'}: <strong>${escapeHtml(size)}</strong></li></ul></section>
      </div>
      <section id="zip-import" class="data-tool-card">
        <h2>${icon('upload_file')} ${en?'Content package (ZIP) import':'コンテンツパッケージ（ZIP）インポート'}</h2>
        <p>${escapeHtml(packageHint)}</p>
        <form data-content-import="package" enctype="multipart/form-data"><input type="hidden" name="csrf_token" value="${escapeHtml(csrf)}"><input type="hidden" name="save_action" value="content_import_package">
          <div class="flex-row flex-row-wrap items-center"><input type="file" name="package_zip" accept=".zip,application/zip" required><button class="btn btn-orange btn-small">${icon('publish')} ${en?'Upload and import':'アップロードしてインポート'}</button></div><span role="status" data-import-status></span>
        </form>
        <details class="package-layout-guide">
          <summary>${t('package_layout_title')} <span class="accordion-arrow" aria-hidden="true">▼</span></summary>
          <p>${t('package_layout_intro')}</p>
          <pre>posts/
  coffee/
    index.json  → coffee/index
    menu.json   → coffee/menu
components/
  coffee_layout.json</pre>
          <p>${t('package_layout_notes')}</p>
        </details>
      </section>
      <section id="wp-import" class="data-tool-card">
        <h2>${icon('description')} ${en?'WordPress content migration (XML import)':'WordPressデータ移行（XMLインポート）'}</h2>
        <p>${escapeHtml(wxrHint)}</p>
        <form data-content-import="wordpress" enctype="multipart/form-data"><input type="hidden" name="csrf_token" value="${escapeHtml(csrf)}"><input type="hidden" name="save_action" value="content_import_wordpress">
          <div class="flex-row flex-row-wrap items-center"><input type="file" name="wp_xml" accept=".xml,text/xml,application/xml" required><button class="btn btn-orange btn-small">${icon('publish')} ${en?'Parse XML and import':'XMLを解析してインポート'}</button></div><span role="status" data-import-status></span>
        </form>
      </section>
      <section id="import-log" class="data-tool-card"><h2>${icon('receipt_long')} ${en?'Execution log':'実行ログ'}</h2><div class="data-tool-log" aria-live="polite" data-import-log>${en?'Choose an import file to begin.':'インポートするファイルを選択してください。'}</div></section>
      ${cloudBackupHtml}
      </div>
      <footer class="data-tool-footer"><a href="/admin">${icon('arrow_back')} ${en?'Back to administration':'管理画面へ戻る'}</a><span>© ${new Date().getFullYear()} mikanBox Cloud</span></footer>
    </main>
  </div><script src="/mikanbox/cloud-import.js?v=${escapeHtml(CLOUD_VERSION)}-2" defer></script>`;
}
