<style>.manual-version{font-size:.5em;font-weight:400;white-space:nowrap}</style>

# 🍊mikanBox Cloudflare Development Manual <small class="manual-version">v0.6.0</small>

This edition is under development. It targets the SQLite edition's UI and features, but full compatibility has not been reached. Changes to existing editions are limited to the explicitly requested common settings correction; existing data and the official server are unchanged.

The admin operations below describe v0.4.3. Automatic admin publication and D1 operations require a dedicated Cloudflare token and cannot run where it is unconfigured. Verification using that token and complete UI parity remain pending.

The user's explicit 2026-10-04 request authorizes common settings layout, input styling, explanatory text, SSG hint weight and site URL fallback changes in all three editions. The original protected hashes remain intact; reviewed changes are recorded separately. Site environment is advisory metadata, not an access or write restriction. Site URL identifies the site to AI and defaults to the index page location independently of SSG output.

The admin version comparison uses Cloud versions, not PHP releases. This deployment reads its dedicated `/mikanbox/cloud-release.json` feed. Other installations without `CLOUD_RELEASE_MANIFEST_URL` show that release information is unpublished. The HTTPS JSON document contains `edition: "cloud"`, `version: "0.5.0"` and an optional HTTPS `url`. One-click code updates are not implemented. Updates deploy a new Worker and any required D1 migrations; this differs from rebuilding static assets.

Media omits the image conversion note and maximum-file-size line, and explains using files on a page: a bare filename in Markdown and `media/filename` in HTML. Existing `images/filename` references for images remain supported.

## Delivery modes and withdrawal (development v0.6.0)

The delivery mode is fixed at installation. `STATIC_DELIVERY` in the `vars` of the production `wrangler.production.json` is applied as a Worker environment variable by `wrangler deploy`. The admin screen cannot change it. It can be edited as a Worker environment variable in the Cloudflare dashboard, but the next `wrangler deploy` restores the value from the configuration file. Publication inherits the bindings of the version it runs against.

- **Static delivery** (`STATIC_DELIVERY` is `true`): published pages and images are served from the deployed static files. Viewing them runs neither the Worker nor D1, so it consumes no daily Worker requests and no D1 row reads.
- **Worker delivery** (default): the Worker serves static pages from the HTML built in D1. Viewing them consumes Worker and D1 allowances. There is no delivery target, so site generation only regenerates HTML.

Which mode an installation runs in is shown in Site generation on the Site screen.

Choosing static or dynamic per page is separate from this. A page published as static gets its HTML built during site generation; a dynamic page is generated per request. Dynamic pages are handled by the Worker in both delivery modes.

### Withdrawal

Under static delivery, files placed on the delivery target bypass the Worker, so deleting the source leaves the deployed file in place. Removing it from the delivery target is called withdrawal.

Pages are withdrawn by site generation. Pages made private and pages deleted are removed from the delivery target then, along with their URL aliases. **They stay readable until you run site generation.** After taking a page out of publication, run site generation as well.

Images are withdrawn automatically by the Media screen; see "Static image delivery" below.

Worker delivery has no delivery target and therefore no withdrawal step: private and deleted pages take effect at once.

## Separate public and admin Workers (prototype)

Setting `CLOUDFLARE_PUBLIC_WORKER_NAME` (the public Worker's name) and `PUBLIC_SITE_URL` (the public site's URL) publishes pages to a separate Worker. The public Worker holds static files only and runs no code. The admin screen and MCP stay on the current Worker. Without these settings, everything runs on one Worker as before.

- On the admin address, visitors without a session get no pages, images, component scripts or sitemaps, and search engines are told not to index it (`X-Robots-Tag: noindex`).
- A signed-in device opening `/about` on the admin address is sent to the preview (`/preview/about`). Previews carry a CSP `sandbox`, so page scripts cannot reach the admin screen. Inside a preview, page scripts cannot use cookies or `localStorage`.
- Public pages, sitemaps and RSS use `PUBLIC_SITE_URL` and never the admin address. Sitemaps, RSS and DB page JSON (`/api/page-id`) are published as files.
- Publication sends only changed files. Page hashes are stored at build time.
- Site search and the AI question box do not work on the public site. The search page is left out of sitemaps and RSS.
- As in the PHP editions, the 404 page is never listed in sitemaps or RSS, split or not.

## Static image delivery (development v0.6.0)

Publication includes images. Every stored file is published, including files no page references, because dynamic pages read the same `/media/filename` paths as static pages.

Published images are served from Static Assets and reach neither the Worker nor D1 nor R2, so viewing them consumes no daily Worker requests and no D1 row reads. Images not yet published have no static file, so the request falls through to the Worker, which serves them from D1/R2. An uploaded image therefore appears at once in draft previews and on dynamic pages, without waiting for a publication.

The delivery target allows 20,000 files per version and 25 MiB per file. Images are limited to 10 MB each and 10,000 files, so pages and components fit within that budget alongside them.

Static files bypass the Worker, so a published image must leave the delivery target before its source can be deleted or renamed. Deleting or renaming in Media withdraws the file first — a publication that excludes that path — and then performs the requested operation. It is one action and it does not rebuild pages. If the withdrawal fails, the original file is kept and the operation stops.

Replacing a file under the same name needs no withdrawal, because its public URL does not change. The delivery target keeps the previous content until the next publication.

Installations that do not use static delivery continue to serve every image through the Worker.

## JS and CSS libraries (development v0.5.1)

Media accepts browser-ready `.js` and `.css` files: nonempty UTF-8 text, up to 10 MB each, saved without rewriting code. The admin screen does not execute them. Copy the URL or embed tag from a card and paste tags into page content or component HTML. Uploads do not insert tags automatically. Only trusted administrators and API keys should upload code from a verified source. Format validation does not guarantee safe code.

Code files receive no category prefix, stay visible across category filters, and bypass image conversion. File-type filtering, same-extension renaming, and deletion are available. Existing names are rejected rather than overwritten. Uploading a folder hierarchy is not supported.

Files follow the existing D1/R2 media storage setting and keep `/media/filename` URLs. Complete JSON backup/restore and D1-to-R2 migration include them; code fields remain in D1. Static publication serves these files from the deployed static files; see "Static image delivery" below. Portable static ZIPs include files referenced by HTML.

## Migrate from D1 to R2 (development v0.5.0)

Start with D1 without enabling R2. Site → Media storage shows the current storage and usage and provides “Migrate from D1 to R2”. Only image storage switches; content, settings, users and other records remain in D1.

R2 requires registering a payment method even when usage stays in the free allowance. Enable R2, create a bucket, and bind it to the Worker as `MEDIA`. Local Wrangler includes a test binding; production does not yet include R2. Add this configuration to `wrangler.production.json`, replace the bucket name, and deploy the code. Connecting a bucket alone does not switch storage.

```json
"r2_buckets": [{"binding": "MEDIA", "bucket_name": "your-bucket-name"}]
```

Start from the confirmation screen. Each image is copied and its checksum and R2 write are verified. D1 originals remain visible while image additions, modifications and deletions are paused. Resume or cancel from the same menu after closing the browser. After all images are verified, one database transaction removes D1 image bytes and switches pointers to R2. Incomplete, failed and cancelled migrations retain D1 originals. There is no reverse-switch menu after successful migration. Save a complete JSON backup first. Image URLs and content filenames stay unchanged.

D1 image storage is limited to 400 MB. D1 Free allows 500 MB per database; Paid allows 10 GB per database and requires a separate plan upgrade. R2 removes the 400 MB combined image limit, retaining 10 MB per image and 10,000 images. R2 Standard’s account-wide monthly free allowance is 10 GB-month, one million Class A operations and ten million Class B operations. These are billing allowances, not hard limits; excess usage is charged.

Site settings display D1 database size and tracked R2 storage, including temporary and retained images, with a notice near 80% of the free storage allowance. Other sites and untracked bucket objects are excluded. Check account totals, requests, billing and alerts in Cloudflare. Billing alerts do not stop usage. Removing D1 images does not necessarily shrink allocated database storage immediately.

R2 writes use new immutable objects followed by atomic D1 pointer changes. “Clean unused temporary images” removes up to 20 unreferenced images retained for at least 24 hours, excluding live migration and restore objects. Complete JSON backups include image bytes and can restore to either storage mode while preserving the destination’s storage choice. D1 restoration is limited to 400 MB images and 450 MB of existing plus staged images; both current and temporary R2 images count toward storage usage. D1 Time Travel and SQL export do not contain R2 image bytes; older pointers may reference already-cleaned objects. Use complete JSON backups with R2.

Images keep the stable `/media/filename` public URL in both storage modes. Published images are served from Static Assets; images not yet published are served by the Worker from D1/R2. Built page HTML is also served directly from Static Assets. Updated page/component references after renaming or WebP conversion still require the usual rebuild and publication to update deployed HTML. See "Static image delivery" below.

Run `node scripts/test-r2-local.mjs` from the Cloud directory to test the official local Worker, D1 and R2 bindings without registering a payment method. It creates disposable isolated state, runs 15 integration checks covering migration/cancellation, image operations and backup restoration, then removes the state. It does not use existing local data or remote services. Local integration testing does not verify live R2 permissions, network access or billing. Results are saved to `artifacts/r2-local-system-test.json`.

References: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 setup](https://developers.cloudflare.com/r2/get-started/), [Usage-based billing](https://developers.cloudflare.com/billing/understand/usage-based-billing/).


## v0.4.3 admin operations

Rebuild generates public HTML and updates static delivery together, removing unpublished or deleted pages. Previously published files remain until rebuilding. Images are delivered through the Worker and changes take effect directly. Keep the admin screen open while the browser performs these steps. Configure a dedicated token with Workers edit permission in Site settings. The installation target is fixed. The token is encrypted using a key derived from JWT_SECRET, never displayed again, and excluded from portable backups. Expiring Wrangler login credentials are never copied into the Worker. The existing MCP build_ssg generates HTML only; delivery still requires the admin screen or the publication command.

JPEG, PNG and WebP images can be resized and converted to WebP in the browser. Uploads default to a 2,000px maximum side. Existing conversion replaces the image and updates references with page history. GIF and SVG uploads preserve original bytes. Browser processing accepts dimensions up to 16,000px and 40 million pixels.

### Device authentication (prototype)

There are no passwords. Only registered devices (browsers) can open the admin screen. Each device keeps a random token in a cookie; D1 stores only its hash.

- **First device**: on the sign-in screen, enter `SETUP_TOKEN`, a username, a display name and a name for the device. A used `SETUP_TOKEN` never works again.
- **Adding a device**: on a registered device, open Site → Devices and users → Add a device, issue a code, and enter it on the new device's sign-in screen. Codes are valid for 3 hours and work once. To invite someone, choose their username and display name under Invite someone. After five wrong codes, entry is blocked for 15 minutes.
- **Expiry**: devices expire 30 (default), 90 or 180 days after last use. Each use extends it.
- **Stopping a device**: stop it from the list under Devices and users. For 3 days after being added with a code, a device cannot stop other devices, delete or change other users, restore users from a backup, or restore D1 to a point in time. Devices registered with `SETUP_TOKEN` have no such limit. Deleting a user also stops that user's devices and unused codes. When a new device is registered, other devices are told the next time they open the admin screen.
- **Recovery**: if every device is lost, set a new value with `wrangler secret put SETUP_TOKEN` and use Recovery on the sign-in screen with an existing username. Every registered device stops, and unused codes and the MCP key are cleared.
- Clearing browser cookies, switching browsers or using a private window is the same as losing the device. Keeping devices safe (screen lock, handling loss) is your responsibility.

### JSON backup and restore

Download a single JSON backup from Site settings and select that file to restore. It includes settings, all pages, components, revisions, HTML snapshots, users and original images. Images transfer in 500KB parts. Both operations require the current administrator password. Backups contain private content, API keys and authentication hashes: store them securely. Large backups consume browser memory and transfer time; keep the screen open. Metadata is limited to 20MB.

Normal restore preserves current site identity, API key, users and Cloudflare connection. Explicit account restoration also restores users; devices of users missing from the backup stop. Rebuild afterward. Restore stages and validates data before atomic replacement; missing parts or concurrent edits leave existing data intact. In D1 mode, existing, incoming and other staged images must total at most 450MB; R2 mode stages image bytes in R2, and actual D1 free space may impose a lower limit.

### D1 database backup

D1 SQL export and Time Travel are separate server operations available from Site settings with a token granting D1 edit permission. Free Time Travel covers the previous seven days and restores the whole database, including D1 original images (but not R2 image bytes), users and stored connection settings. D1 can be unavailable during SQL export; the UI polls through a short-lived encrypted capability without querying D1. Keep the screen open until completion. Time Travel does not rewind deployed static files; rebuild afterward and verify code/schema compatibility for older snapshots. Uploading a SQL file to restore D1 is not implemented in this admin UI.

Publication, backup and restore consume Worker requests and D1 reads/writes. Static delivery is free, but updates remain subject to account-wide daily limits. Updating the maximum 20,000 files daily is not guaranteed within the Free tier.

## Architecture

The admin sidebar logo displays “mikanBox” and “cloud” on two lines, matching the flat edition's layout.

Cloudflare Workers runs the application. D1 stores content and settings. Images initially use D1 and can migrate to R2 through Image storage, as described in the v0.5.0 section.

The stylesheet, AI-question browser script, and translations are copies of the shared canonical sources. Screen templates and main browser interactions are Cloud-specific implementations. Sharing CSS does not guarantee complete screen parity.

## Local development

Run these commands inside `mikanBox-cloud/`:

```sh
npm ci
npm run prepare:local
npm run db:local
npm run dev
```

Open `http://localhost:8787/admin`. Enter the setup token, a username, a display name and a name for this device. The setup token is the `SETUP_TOKEN` in this directory's `.dev.vars`. Each token value works once. Never publish or commit `.dev.vars`.

Local D1/R2 state lives in `.wrangler/state/`. The database ID is a local placeholder, not a production connection. The live smoke test uses a separate `.wrangler/smoke-state/`. Existing edition data is not imported automatically.

```sh
npm run check
npm test
npm run build
```

`build` performs a dry run without publishing. If Wrangler cannot write to its default log directory, set `WRANGLER_LOG_PATH=.wrangler/logs` to keep logs inside the Cloud directory.

## Standard content

Initial setup imports the SQLite edition's standard content in the selected language: eight pages and eleven components for each of Japanese and English, including home, 404, search, examples, layouts, headers, footers, cards, and AI instruction samples. The read-only source is `../shared/import/`. Run `npm run sync:defaults` inside Cloud to refresh its copy without modifying either PHP edition.

Existing pages and components are preserved. On this review deployment, the temporary homepage is replaced only if it exactly matches the unedited page originally created during deployment. Settings, accounts, secrets, and the previous Cloud database are not part of this import.

The standard search form's `/index.php?page=search&q=...` and `/search?q=...` work. Results contain published pages only and exclude drafts, pending pages, and DB pages. AI instruction component IDs such as `DESIGN_sample.md` and `DESIGN.md` are supported. `{{AI_QUESTION}}` and `{{AI_QUESTION:section-id}}` are supported. External `EXT_MD` fetching remains unsupported. Sample images are not included; upload your images from the media screen.

## Implemented operations

- Page lists, search, category filtering, pagination, creation, editing, and deletion.
- Separate draft, pending, public_dynamic, public_static, and DB statuses.
- Memos, Markdown/HTML input, page CSS/JavaScript, SEO fields, and wrapper selection.
- Revision recording, selection of the last 50 revisions, edit locks, and stale-edit protection.
- Token-based pending previews; authenticated administrators can preview drafts.
- Component CRUD, part/wrapper/AI-document types, memos, CSS, and JavaScript.
- Site settings, language, site memo, adding and stopping devices, and inviting and deleting users.
- Username/display-name changes. Registered devices keep working under the new username.
- Image upload, streaming delivery and deletion without R2, up to 10 MB per file. Existing filenames are not overwritten.
- ZIP downloads of JSON content and media; these are not a complete D1 backup/restore.
- Bulk acquisition for pages, components, search, navigation, feeds, data backups and static builds avoids one query per content item. Platform data/CPU limits still apply.
- Category deletion also removes the category from affected pages and records revisions. Active edits or concurrent changes cancel the entire operation.
- D1 snapshots of public_static pages. Published HTML stays unchanged until rebuilt; changing a page to draft immediately prevents public access.

Component JavaScript is available at `/component-js/ID.js`. Page/component JavaScript is administrator-authored code executed on public pages.

Pages with DB status expose DATA/DATAROW through `/api/ID`. Draft/pending data cannot be read through public POST_MD embeds, navigation, feeds, or the data API.

Page and settings saves compare their read snapshot with current storage and reject stale writes. A concurrent settings save cannot restore a revoked API key. Deleting an account stops its devices.

## Image uploads and limits

A page ID such as `test/index` works at `/test/index.html`, `/test/index/`, `/test/`, and `/test` in both dynamic and static publication modes. Static pages require a build. An exact `test` page takes precedence when present. These URLs resolve D1 pages; they do not create physical directories or HTML files.

Choose an image in the media section or drag it onto the screen. Click its filename to copy it; use `![Description](filename.png)` or `{{IMAGE:filename.png}}` in page content. A Download link saves each file individually.

Filename search, category filtering and pagination use the configured media page size. Categories match images referenced by pages in that category or filenames starting with the category name and an underscore.

In D1 storage, Rename updates references in page content, CSS, JavaScript, OGP images and components. It cannot overwrite another file or change extensions. Memos and previous revisions remain unchanged; affected pages get new revisions. A lock or concurrent change cancels every write, including the image rename. Rebuild affected static pages; component changes invalidate all static snapshots. Large reference sets can exceed the operation limit. External sites and dynamically constructed JavaScript URLs are not updated.

- Each image: **10 MB** (10,000,000 bytes).
- D1 images: **400 MB** total. R2 removes this total-byte limit. Both modes allow **10,000 files**.
- Formats: **JPEG, PNG, GIF, WebP, SVG**. Extension and leading format signature must match. D1 audio/video uploads are unsupported.
- Duplicate names are rejected. v0.4.3 adds optional browser resizing and WebP conversion before storage; the stored original is the processed file.
- Media ZIP: **20 MB** total, with a file count that fits the request query budget (about 20 small images, or two 10 MB images). Download individually when exceeded.

The D1-only 400 MB image allowance reserves space for content, history and database overhead. It does not apply to R2. Platform storage limits may be reached first.

[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) includes 5 million rows read/day, 100,000 rows written/day, and 5 GB account-wide storage. [Workers Free](https://developers.cloudflare.com/workers/platform/limits/) allows 100,000 requests/day. D1 image reads use one row per 500 KB chunk. R2 image delivery reads D1 metadata and R2 objects. Allowances are shared with other account applications. Free-plan daily exhaustion stops operations until reset. The application does not change your plan automatically. Existing Paid contracts remain subject to their pricing.

## Cloud-specific MCP

Generate a Cloud-specific API key in Site settings and connect to `/mcp` using a Bearer key from a separate workspace. The root `.mcp.json` remains dedicated to the official PHP server.

Current tools: `get_site_info`, `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page`, `list_components`, `get_component`, `create_component`, `update_component`, `delete_component`, `get_revisions`, `get_settings`, `get_ai_context`, `list_ai_docs`, `get_ai_doc`, `update_ai_doc`, `upload_media`, and `build_ssg`.

SQLite-style flat field arguments and legacy `id` plus `data` are both accepted; do not specify the same field in both. Updates preserve unspecified fields. Call `get_site_info`, then `get_ai_context` on connection. AI document IDs may omit `.md`. `get_settings` excludes credentials, API keys and administrator memos. Editing requires exact IDs rather than public directory aliases.

`upload_media` accepts `filename` and `content_base64`, up to 10 MB for JPEG, PNG, GIF, WebP and SVG. Optional `category` allows ASCII letters, digits, underscores and hyphens and prefixes the filename. Duplicates fail instead of being overwritten. Large Base64 images have higher transfer and processing costs; use the ordinary media upload form as well. Audio/video and duplicate-name numbering differ from PHP. Administration aliases `/mikanBox/mcp` and `/mikanBox/mcp.php` require the same key.

Check the Cloud site's identity with `get_site_info` before writing. Do not reuse the official site ID. A Cloud API key grants administrative content operations and must remain private.

## Public help and WebMCP

`/public-mcp` is anonymous and read-only, exposing only `search_help`, `get_help_section`, `get_product_info`, and `get_agent_instructions`. `/mcp` remains the authenticated administration endpoint. `/mikanBox/public-mcp.php` aliases the public endpoint.

Only the exact published `help_ja`/`help_en` pages are read. If unavailable, the bundled Cloud-specific manual is used. Draft, pending, DB, AI instructions, other pages and administrator data are excluded. After changing the Cloud manuals, run `node scripts/sync-cloud-help.mjs`; check/test/build also run it automatically. Human-readable help is `/public-help.html?language=ja` or `en`.

Public pages and the administration screen load the script that registers four help tools in a compatible browser/agent. Unsupported browsers skip registration while ordinary pages and AI question controls remain usable. This uses the [Chrome WebMCP API](https://developer.chrome.com/docs/ai/webmcp/imperative-api); availability depends on the browser and agent. AI question controls reference Cloud help and public MCP without transmitting API keys or administration URLs.

## Static HTML ZIP export

Build static pages in Site settings, then choose Download static ZIP. Choose `ID.html` or `ID/index.html`. The root `index` exports as `index.html`; directory-style IDs ending in `/index` retain `directory/index.html`. Output path collisions fail clearly.

Only currently public_static, already-built snapshots are included. Links to included pages, images and component scripts become relative paths. Referenced images and public assets are bundled. Dynamic pages, search and APIs retain live-site links. Credentials, settings, users and private pages are excluded. ZIP pages do not register WebMCP; AI question controls become links to Cloud help.

The complete ZIP is limited to 20 MB and a bounded image-query budget. Missing assets fail rather than returning an incomplete ZIP. Arbitrary runtime JavaScript requests and string-style CSS `@import` are not automatically converted. This is a static site export, not a full D1 backup.

## Protecting existing editions

Write only inside the Cloud directory during this work. Do not run `../shared/sync.sh`, which overwrites files in both PHP editions. To refresh shared copies, use the Cloud-only `npm run sync:assets`. Changes to canonical shared sources require a separate review of their impact on existing editions.

The initial hashes of both PHP editions, shared files, and root configuration/manuals are recorded in `.baseline/protected-files.json`. `npm run check` verifies that they remain unchanged. On another checkout, record a baseline before development; never overwrite an existing baseline to hide changes.

## Remaining compatibility work

Matching the SQLite edition remains the goal. Full visual and interaction parity is not yet guaranteed.

- Exact screen layout/spacing, editor opening/closing and AJAX behavior.
- PHP self-updates/rollback, SQLite file import/export and migration tools. Cloud uses the JSON restore described above.
- Additional static-export settings and reproducing dynamic search in exported files.
- Complete Markdown/CSS/tag compatibility. EXT_MD remains disabled pending a safe external-fetch policy.
- Exact MCP response/error/timestamp parity and additional operational tools.
- Explicit migration of existing content and production performance/capacity validation.

## Production

The review URL is `https://example.invalid/`, with admin at `/admin`. `wrangler.production.json` uses Workers and D1 without enabling R2 or upgrading the plan. Usage is subject to the current account plan and free tier limits. The media screen supports D1 image uploads and displays storage usage.

The old D1 database `mikanbox` remains unchanged; this version uses the separate `mikanbox-cloud` database. Old content has not been migrated. Deployment switches the existing `mikanbox` Worker's code and database binding. The official PHP server and PHP editions remain separate.

Production secrets are in `.env.production.secrets`, separate from local secrets. Never publish or commit it. For initial setup, open `/admin`, enter the file's `SETUP_TOKEN`, and choose a username, display name and a device name. Each token value works once.

```sh
WRANGLER_LOG_PATH=.wrangler/logs npx wrangler d1 migrations apply DB --remote --config wrangler.production.json
WRANGLER_LOG_PATH=.wrangler/logs npx wrangler deploy --config wrangler.production.json --secrets-file .env.production.secrets
```

The previous Cloud version is `ccf6e1be-645c-4a53-831c-99d9e33ded9a`. Its retained database allows a rollback to be considered. New content does not automatically sync to the old database.

## Direct delivery of public pages and all images

Administration, editing, search, MCP and APIs run through the Worker. Built public_static HTML and published images are served directly by Static Assets. Images not yet published are read by the Worker from D1 or the selected R2 storage.

In v0.3.0, the admin build saved HTML snapshots and `npm run publish:static` in this workspace updated delivery. v0.4.3 adds automatic admin publication through the dedicated token described above. The workspace command remains usable until that token is configured.

Publication downloads files individually. Dynamic pages, drafts, pending pages, settings, credentials and AI documents are excluded. Search stays on the Worker even when its page status is static. HTML and image changes are applied together by switching deployments. Editing is temporarily blocked during publication.

Published pages are withdrawn by site generation, and deleting or renaming a published image withdraws it automatically from the Media screen. Component JS withdrawal requires a publication. Previously cached browser copies cannot be recalled. See "Delivery modes and withdrawal" above.

Workers Free supports 20,000 static files and 25 MiB per file, with 2,000 URL aliases. Images now count toward static publication files (up to 10,000 of them). Images, administration, search, dynamic pages and publication consume Worker/D1/R2 allowances. Use the publication command for code updates to retain deployed HTML.

### Media editing and categories

Image actions match PHP: “Resize▼”, “Rename▼”, then “Convert to WebP”. WebP conversion appears only for JPEG/PNG; renaming preserves the extension. Conversion uses `.webp` and updates page, component and common OGP references. The top category selection also filters media by filename prefix, while shared `g_` images remain visible; this does not mean only used images. Uploads receive the selected category prefix unless an alphanumeric prefix is already present.

### Component list

The three editions share a filter selector to the right of “Ask AI”: All, Selected category, Page, Part, AI instructions and Standard components. Standard means an ID beginning with `_`. Omit this prefix for ordinary new or duplicated components; use it when standard classification is intended. Saving is not rejected.
“Selected category” uses the category at the top of the admin screen and matches component ID prefixes, just like media filenames: `apps_header` belongs to `apps`. With no category selected, it does not narrow the list.


Page and component CSS is inserted automatically across editions. `{{HEAD_CSS}}` optionally specifies the insertion point; only the first occurrence outputs CSS, and remaining tags are removed. If omitted, CSS is inserted before `</head>`, or at the beginning of the HTML if no closing head tag exists. Text inside comments or script/style/textarea/title elements is not treated as an insertion point.


Supports the None wrapper option, missing head metadata completion, a shared tracking part and page exclusions. Page editor description/content spacing, Raw HTML checkbox placement and JavaScript field height match the PHP editions. See the bundled common help for details.

The import/export screen follows SQLite’s status cards, ZIP import, WordPress XML import and execution log, followed by CSV and Cloud-specific complete JSON backup/restore. ZIP/XML add content while retaining existing IDs; images, accounts and site settings are not imported. Limits: 20 MB files, 15 MB ZIP expansion, 1 MB imported content and 300 records. Settings fields and category add-button alignment use the shared PHP CSS.

Changing an unpublished image needs no Cloud publication connection. Deleting or renaming a published image publishes a withdrawal, so it does require the connection. Renaming uses the reference confirmation dialog. See the v0.5.0 section for storage limits, migration and complete backup behavior.
