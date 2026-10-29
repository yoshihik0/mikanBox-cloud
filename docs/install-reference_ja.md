<style>.manual-version{font-size:.5em;font-weight:400;white-space:nowrap}</style>

# 🍊mikanBox Cloudflare版 インストール手順リファレンス

AIがインストールを進めるとき、および自分でコマンドを実行してインストールする人のための詳細手順です。通常の利用者向けの説明は[Cloud版マニュアル](cloud_ja.md#新規インストールと公開)にあります。AIの対話方針は、リポジトリの `AGENTS.md` の「Installing for a user」に従います。

ここでは新しいサイトを作る手順を説明します。既存サイトの更新では、D1やWorkerを新規作成せず、[アップデート手順](#manual-update)を参照してください。

#### 最初に用意するもの

- Cloudflareアカウント、GitHubアカウント、インターネット接続、Node.jsとnpm、ターミナル。Cloudflareの画面や料金・無料枠は変更されることがあります。
- 管理画面と公開サイトの名前。独自ドメインを使う場合は、Cloudflareでそのドメインを接続する準備。
- 設置先の正確な設定ファイルと秘密情報を安全に保管できる場所。これらはGitHubに公開しません。

[Cloud版のリリース一覧](https://github.com/yoshihik0/mikanBox-cloud/releases)で使用する公開リリースを開き、Assetsの **Source code (zip)** をダウンロードして展開します。公開プレリリースを選ぶこともできます。端末のターミナルで展開したフォルダへ移動してから、以下のコマンドを実行します。`npm ci` はそのフォルダの `package-lock.json` に従って必要なツールを準備します。Cloudflareにログインするブラウザでは、設置するアカウントを選んでください。Wranglerの認可画面に「Wrangler wants to access your account」と表示されたら対象アカウントを確認し、**Authorize** を押します。「Authorization granted to Wrangler」と表示されたらターミナルに戻ります。

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

`whoami` に表示されたアカウントを確認し、以下の手順に進みます。ログイン済みであっても対象のアカウントが違う場合は設置しないでください。管理用・公開用の名前、アカウントID、D1 ID、設定ファイルは後で更新するために控えておきます。メールアドレスやトークンは公開URLやGitには含めません。


管理用と公開用の2つのWorkerを使います。`workers.dev` を使う場合、例えば共通のサブドメインが `mikanbox-cloud` なら、管理画面を `https://admin.mikanbox-cloud.workers.dev/admin`、公開サイトを `https://mikan.mikanbox-cloud.workers.dev/` のようにできます。`admin` と `mikan` はそれぞれ管理用・公開用に決める名前で、共通の `mikanbox-cloud` はCloudflareアカウントのサブドメインです。新しく登録するサブドメインは、ほかで使われていないものを選びます。サブドメインは公開URLに含まれるため、メールアドレスの一部やログインIDなどを使わず、サイトに関係する名前などを選んでください。

公開サイトには独自ドメインも使えます。まず `workers.dev` の仮URLで始め、あとから独自ドメインに変えることもできます。独自ドメインにはCloudflareでの準備が必要です。AIによる導入では、まず「独自ドメインを使用する」「使用しない（または、あとで設定する）」を確認します。使用する場合は、取得済みドメインの接続または新規取得の方法を案内します。既存ドメインの購入や移転が必須とは限りません。「Worker名」と尋ねるのではなく、管理画面と公開サイトのアドレスをそれぞれ改行して示し、先頭の選べる部分を平易に尋ねます。独自ドメインを使わない場合は管理用と公開用の2つの名前を別にします。独自ドメインを使う場合は公開用の `workers.dev` アドレスや名前を尋ねず、独自ドメインを表示します。アカウントのサブドメインなど確認できる情報はAIが調べ、URLの形式を例で説明し、名前は利用者に選んでもらって、作成前に管理・公開の両URLを確認します。AIから名前を推奨せず、候補を求められた場合にだけ答えます。メールアドレスやログイン情報から名前を推測・提案しません。設定例の名前は無断で使いません。入力フォームが使える場合は、管理用の名前と、必要な場合だけ公開用の名前・未登録のサブドメインを、別々の入力欄にまとめます。登録済みのサブドメインは確認結果として表示します。

公開URLをあとから変更する場合は、新しいドメインを公開用Workerに接続し、管理側の `PUBLIC_SITE_URL` を更新して管理用Workerをデプロイし直します。その後、管理画面で再構築し、新URL・ページ・画像・サイトマップ・RSSを確認します。外部リンクや検索結果の移行も必要になる場合があります。管理URLは別に選べます。管理URLの変更時は端末の再認証が必要になる場合があります。既存サイトに公開用の初期ページを再デプロイしないでください。

1. `npm ci`、`npx wrangler login` を実行し、`npx wrangler whoami` で対象アカウントを確認します。`npx wrangler d1 create mikanbox-cloud` で新しいD1を作成し、表示されたIDを控えます。
2. `wrangler.production.example.json` を `wrangler.production.json` に、`wrangler.public.example.json` を `wrangler.public.json` にコピーします。両ファイルの `account_id` に同じアカウントIDを設定します。管理側の `name` と `vars.CLOUDFLARE_WORKER_NAME` を同じ管理用の名前に、公開側の `name` と管理側の `vars.CLOUDFLARE_PUBLIC_WORKER_NAME` を同じ別の公開用の名前にします。管理側の `vars.CLOUDFLARE_ACCOUNT_ID` にアカウントIDを、`vars.CLOUDFLARE_D1_ID` と `d1_databases[0].database_id` に作成したD1のIDを設定します。`PUBLIC_SITE_URL` には実際の公開用HTTPS URLをパスなしで設定します（例 `https://mikanbox-public.<サブドメイン>.workers.dev`）。各設定ファイルはGitに含めません。
3. 初回だけ `npx wrangler deploy --config wrangler.public.json` を実行し、公開用Workerに初期ページを配置します。**既存の公開サイトにこのコマンドを再実行するとサイトが初期ページに置き換わります。** 初期作成前に対象名を確認してください。
秘密ファイルをまだ作っていない新規サイトでは、例えば次のコマンドで2つの値を生成できます。既存ファイルがある場合は上書きせずエラーで止まります。登録時はファイル内の `SETUP_TOKEN` の値だけを自分のブラウザに入力してください。

```sh
node -e "const fs=require('node:fs'),c=require('node:crypto'); fs.writeFileSync('.env.production.secrets', 'JWT_SECRET='+c.randomBytes(32).toString('hex')+'\nSETUP_TOKEN='+c.randomBytes(32).toString('hex')+'\n', {flag:'wx',mode:0o600})"
```

このファイルは手順4のマイグレーションとデプロイの**前**に作成します。既存サイトの更新にはこの生成コマンドを使いません。

4. インストールごとに暗号学的に安全な乱数で `JWT_SECRET` と一度だけ使う `SETUP_TOKEN` を生成し、`.env.production.secrets` に `KEY=value` 形式で保存します。AIによる導入でもローカルで生成し、値を会話やログに表示せず、初回登録に使うファイルの場所を利用者に伝えます。秘密は公開・コミットしません。`npx wrangler d1 migrations apply DB --remote --config wrangler.production.json`、`npm run deploy:cloud` の順に実行します。**普段使うブラウザ**で管理URLの `/admin` を開き、初回端末を登録します。トークンを入力したブラウザが登録され、トークンは一度しか使えません。AIの内蔵ブラウザで登録すると、普段のブラウザには自動で引き継がれません。AIはローカルの秘密ファイルへのリンクを示し、普段使うブラウザで管理画面を開いてトークンを入力するよう伝えます。トークンを会話へ貼るよう求めません。公開設定とビルドの詳細は管理画面の案内に任せ、問題がある場合や尋ねられた場合に説明します。初期設定画面では「初期設定トークン（SETUP_TOKEN）」「ユーザーID」「表示名」「この端末の名前」を入力し、「この端末を登録」を押します。すでに別のブラウザで登録した場合は、登録済みブラウザの「サイト」→「端末とユーザー」から追加コードを作り、普段のブラウザを追加できます。
5. Cloudflareで対象アカウントに限定した Workers Scripts Edit 権限のAPIトークンを作成し、管理画面の「サイト」→「Cloudflare公開設定」に保存します。Wranglerログインとは別のトークンです。D1の書き出し・復元も使う場合は別途D1編集権限が必要です。
6. ページ一覧の「静的サイトをビルド」で公開し、公開URLを開きます。管理側の匿名アクセス、公開ページと画像、非公開ページ、更新と取り下げを確認します。ブラウザは完了まで開いておきます。

`npm run deploy:cloud` は管理用Workerだけを更新します。公開用Workerは管理画面のビルドで更新します。旧 `npm run publish:static` は分離構成では使用できません。
