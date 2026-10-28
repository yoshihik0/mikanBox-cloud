# mikanBox Cloudflare版（開発中）

SQLite版のUI・機能を基準にしたCloudflare Workers + D1版です（D1で開始し、R2へ移行可能）。
既存版への書き込みを避け、Cloudフォルダ内で独立して実装・検証します。
まだSQLite版との完全互換・完全なUI一致には達していません。

- [日本語の開発マニュアル](docs/cloud_ja.md)
- [English development manual](docs/cloud_en.md)
- ローカル起動: `npm ci` → `npm run prepare:local` → `npm run db:local` → `npm run dev`
- 検証: `npm run check`、`npm test`、`npm run build`（公開しないdry run）。共通ファイルの開発時保護チェックは、保護ベースラインと隣接するPHP版がある開発環境で `npm run check:protected` を実行します。
- R2結合テスト: `node scripts/test-r2-local.mjs`（公式ローカル環境・専用一時データ。契約や支払い登録不要）
- 標準コンテンツをCloudにだけコピー: `npm run sync:defaults`（ページ8件＋コンポーネント11件／言語）
- 共通アセットをCloudにだけコピー: `npm run sync:assets`
- **この作業では `../shared/sync.sh` を実行しない。** 既存PHP版へ書き込むためです。

画面と保存はCloud専用の `src/admin/`、`src/storage.ts` 等へ分離しています。
共通CSS・ブラウザ用AI質問スクリプト・翻訳の正本は `../shared/` で、Cloud側の
対応ファイルは生成コピーです。`docs/help_ja.md` / `docs/help_en.md` は既存PHP版の
正本のコピーであり、Cloud固有の対応範囲は上記の開発マニュアルを参照してください。

公開描画・Markdown・CSSスコープ・フィード・ZIP生成の土台は、以前の
`mikanBox-old/mikan-cloud/worker/src/` のコードを参照して移植しました。
認証・管理操作はCloud内で見直し、共有JSONの翻訳、履歴・承認状態・JS・HTML入力・
MCP・静的スナップショット等を追加しています。旧設定・秘密・データはコピーしていません。

ルート `.mcp.json` は公式PHPサイト専用のままです。CloudサイトのMCP操作は
別ワークスペースで行ってください。新規インストールは管理用Workerと静的ファイル専用の公開用Workerを分けます。両方の名前と公開URLを決め、[新規インストール手順](docs/cloud_ja.md#新規インストールと公開)に従って設定・作成してください。設定例は `wrangler.production.example.json` と `wrangler.public.example.json` です。各自の設定ファイルと秘密はGitに含めません。
初期状態はR2なしで画像をD1に分割保存します（1画像10 MB・合計400 MB・10,000件）。サイトの「メディアの保存先」から、準備したR2へコピー・確認後に切り替えられます。R2は支払い方法の登録が必要で、無料枠の超過は課金対象です。公開構成にR2はまだ設定していません。詳細は開発マニュアルのv0.5.0の節を参照してください。
旧Cloud版のDBを保持し、新D1 `mikanbox-cloud` に分離しています。
初回設定は `/admin` で各自が用意した `.env.production.secrets` の `SETUP_TOKEN` を使ってください。 AIによる導入でも、作成前に管理用・公開用のURLとWorker名を利用者に確認します。設定例の名前を無断で使いません。 `workers.dev` で仮に始め、あとから独自ドメインへ変更することもできます。必要な準備と変更作業は[新規インストール手順](docs/cloud_ja.md#新規インストールと公開)を参照してください。

Cloud 0.2.0では管理MCPのSQLite形式引数、AI指示書・画像アップロード、公開ヘルプMCPとWebMCP、AI質問欄、画像検索/ページ送り/参照更新付き名前変更、カテゴリー削除、アカウント名変更、静的ZIP出力に対応します。管理MCPは `/mcp`（キー必須）、公開ヘルプは `/public-mcp`（読み取り専用）、人向けCloudヘルプは `/public-help.html?language=ja` です。詳細と残る差はCloud専用マニュアルを参照してください。

メディアには画像に加え、UTF-8のJS・CSSライブラリ（1ファイル10 MB以下）を保存できます。保存先はメディア設定のD1/R2に従い、公開URLは `/media/ファイル名` のままです。コード欄のJS/CSSはD1です。

手動アップデートは、管理画面 → GitHub Actions → Run workflow で実行できます。[初回設定](docs/cloud_ja.md#manual-update)で自分のリポジトリと更新先を登録してください。毎回のダウンロード・リポジトリ同期は不要で、自動更新は行いません。
