<style>.manual-version{font-size:.5em;font-weight:400;white-space:nowrap}</style>

# 🍊mikanBox Cloudflare Manual <small class="manual-version">v0.9.1</small>

This manual covers installation and the Cloudflare edition’s differences. For shared operations, see the [operation manual](https://yoshihiko.com/mikanbox/help_en.html).

## Setup and distribution

### New installation and publication

Use separate management and public Workers. With `workers.dev`, for example, an account subdomain `mikanbox-cloud` can produce management URL `https://admin.mikanbox-cloud.workers.dev/admin` and public URL `https://mikan.mikanbox-cloud.workers.dev/`. The management and public names `admin` and `mikan` are chosen separately; the account subdomain `mikanbox-cloud` is shared. A newly registered account subdomain must be available. Because the subdomain is public, avoid email usernames, login IDs, and other private personal information; choose a site-related name instead.

A custom domain can also be used for the public site. You can start with temporary `workers.dev` URLs and change to a custom domain later; the domain requires Cloudflare setup. An AI installer should first offer “Use a custom domain” and “Do not use one (or set it up later)”, briefly explain that it can be added later, and guide the user one step at a time. If selected, help connect an existing domain or obtain one; purchasing or transferring an existing domain is not always required. It should show the management and public addresses on separate lines and ask in plain language for their distinct first parts, instead of asking for "Worker names". With a custom public domain, show that domain and do not ask for a public `workers.dev` address or name. It should discover available account information itself, illustrate the URL format with neutral examples, ask the user to choose names, and confirm both resulting URLs before creating resources. It must not proactively recommend names; provide candidates only when asked, and never derive them from email addresses, login IDs, or account details. Example names must not be silently adopted. When an input form is available, group separate fields for the management name, public name only when needed, and account subdomain only if not yet registered. Show an existing subdomain as context.

To change the public URL later, connect the new domain to the public Worker, update `PUBLIC_SITE_URL` in the management configuration, and redeploy the management Worker. Rebuild from the admin screen, then verify the new URL, pages, images, sitemap, and RSS. External links and search results may also need migration. The management URL can be chosen separately; changing it may require device authentication again. Do not redeploy the public placeholder to an existing site.

1. Run `npm ci` and `npx wrangler login`, then check the account with `npx wrangler whoami`. Create a new database with `npx wrangler d1 create mikanbox-cloud` and note its ID.
2. Copy `wrangler.production.example.json` to `wrangler.production.json` and `wrangler.public.example.json` to `wrangler.public.json`. Set the same account ID in both `account_id` fields. Set the admin `name` and `vars.CLOUDFLARE_WORKER_NAME` to the management name; set the public `name` and admin `vars.CLOUDFLARE_PUBLIC_WORKER_NAME` to a different public name. Set `vars.CLOUDFLARE_ACCOUNT_ID` to the account ID and both `vars.CLOUDFLARE_D1_ID` and `d1_databases[0].database_id` to the new database ID. Set `PUBLIC_SITE_URL` to the actual public HTTPS origin without a path, for example `https://mikanbox-public.<subdomain>.workers.dev`. These local configuration files are excluded from Git.
3. Only for initial creation, run `npx wrangler deploy --config wrangler.public.json` to deploy the public placeholder. **Running this again on an existing public site replaces it with the placeholder.** Check the target name first.
4. Generate a unique cryptographically random `JWT_SECRET` and one-use `SETUP_TOKEN` for each installation and store them in `.env.production.secrets` as `KEY=value` lines. An AI installer generates them locally, never prints them in conversation or logs, and tells the user where to find the file for initial registration. Never publish or commit the secrets. Run `npx wrangler d1 migrations apply DB --remote --config wrangler.production.json`, then `npm run deploy:cloud`. Open `/admin` on the management URL in the browser you normally use and register the first device there. The browser that submits the token is registered, and the token can be used only once. Registration in an AI embedded browser does not automatically carry over to your normal browser. The AI should link to the local secrets file and ask you to open the management page in your usual browser and enter the token yourself, without asking you to paste it into chat. It need not repeat the publication setup and build instructions already shown in the management screen unless asked or a problem requires explanation. If another browser is already registered, use Site → Devices and users in that browser to create a device-add code for your normal browser.
5. Create a Cloudflare API token scoped to the intended account with Workers Scripts Edit permission and save it in Site → Cloudflare publication settings. This token is separate from Wrangler login. D1 export and restore additionally require D1 edit permission.
6. Build the static site from the page list and open the public URL. Verify anonymous access to the management side, public pages and images, private pages, updates and withdrawal. Keep the browser open until the build completes.

`npm run deploy:cloud` updates only the management Worker. The admin build updates the public Worker. The legacy `npm run publish:static` command cannot be used for a split site.

#### Device authentication

There are no passwords. The Devices and users section is normally closed, and changing the device expiry shows the result in place. Only registered devices (browsers) can open the admin screen. Each device keeps a random token in a cookie; D1 stores only its hash.

- **First device**: on the sign-in screen, enter `SETUP_TOKEN`, a username, a display name and a name for the device. A used `SETUP_TOKEN` never works again.
- **Adding a device**: on a registered device, open Site → Devices and users → Add a device, issue a code, and enter it on the new device's sign-in screen. That device is registered as the same user as whoever issued the code. Codes are valid for 3 hours and work once. To invite someone, issue an invite code under Invite someone and hand it over; the invited person chooses their own user ID and display name on the sign-in screen. After five wrong codes, entry is blocked for 15 minutes.
- **Expiry**: devices expire 30 (default), 90 or 180 days after last use. Each use extends it.
- **Stopping a device**: stop it from the list under Devices and users. For 3 days after being added with a code, a device cannot stop other devices, delete or change other users, restore users from a backup, or restore D1 to a point in time. Devices registered with `SETUP_TOKEN` have no such limit. Deleting a user also stops that user's devices and unused codes. When a new device is registered, other devices are told the next time they open the admin screen.
- **Recovery**: if every device is lost, set a new value with `wrangler secret put SETUP_TOKEN` and use Recovery on the sign-in screen with an existing username. Every registered device stops, and unused codes and the MCP key are cleared.
- Clearing browser cookies, switching browsers or using a private window is the same as losing the device. Keeping devices safe (screen lock, handling loss) is your responsibility.

## Overview

### Standard content

Initial setup imports the SQLite edition's standard content in the selected language: eight pages and eleven components for each of Japanese and English, including home, 404, search, examples, layouts, headers, footers, cards, and AI instruction samples. The read-only source is `../shared/import/`. Run `npm run sync:defaults` inside Cloud to refresh its copy without modifying either PHP edition.

Existing pages and components are preserved. On this review deployment, the temporary homepage is replaced only if it exactly matches the unedited page originally created during deployment. Settings, accounts, secrets, and the previous Cloud database are not part of this import.

The standard search form's `/index.php?page=search&q=...` and `/search?q=...` work. Results contain published pages only and exclude drafts, pending pages, and DB pages. AI instruction component IDs such as `DESIGN_sample.md` and `DESIGN.md` are supported. `{{AI_QUESTION}}` and `{{AI_QUESTION:section-id}}` are supported. External `EXT_MD` fetching remains unsupported. Sample images are not included; upload your images from the media screen.

## Pages and editing

See [Pages](https://yoshihiko.com/mikanbox/help_en.html#page-mgmt) and [Page editing](https://yoshihiko.com/mikanbox/help_en.html#page-edit) for shared operations.

### Implemented operations

- Page lists, search, category filtering, pagination, creation, editing, and deletion.
- Separate draft, pending and public statuses. The former DB status is the output format "mikanBox DB" (as in PHP 2.18.0).
- Memos, Markdown/HTML input, page CSS/JavaScript, SEO fields, and wrapper selection.
- Revision recording, selection of the last 50 revisions (visual editing keeps one per editing session), edit locks, and stale-edit protection.
- Draft and pending pages are private. Registered, signed-in editors can preview both; the labels describe workflow state and have identical access permissions.
- Component CRUD, part/wrapper/AI-document types, memos, CSS, and JavaScript.
- Site settings, language, site memo, adding and stopping devices, and inviting and deleting users.
- Changing your own display name (the field on your own user in "Devices and users"). The username cannot be changed.
- Image upload, streaming delivery and deletion without R2, up to 10 MB per file. Existing filenames are not overwritten.
- ZIP downloads of JSON content and media; these are not a complete D1 backup/restore.
- Bulk acquisition for pages, components, search, navigation, feeds, data backups and static builds avoids one query per content item. Platform data/CPU limits still apply.
- Category deletion also removes the category from affected pages and records revisions. Active edits or concurrent changes cancel the entire operation.
- D1 snapshots of public_static pages. Published HTML stays unchanged until rebuilt; changing a page to draft immediately prevents public access.

### Visual editing

Usage is the same as in the PHP editions; see [Visual Editing](https://yoshihiko.com/mikanbox/help_en.html#visual-edit). Open it from the visual-edit button in the page list (between the pencil and the preview), from the button at the top right of the page editor, or at `/admin/visual` (a page chooser), next to the management screen. What differs in the Cloud edition:

- **The public site**: a save changes the page on the management side. A published page is a static file, so the public site does not change until you publish it again (see Delivery and withdrawal). Saving a published page shows a note saying so.
- **History**: the time from opening the page to closing it counts as one editing session, and only the state before it is kept, once, in the page's history (small, frequent saves do not push older history out). Undo and redo cover the last three steps and are discarded when the session changes.
- **Conflicts and edit locks**: a save is refused unless the page is still as it was read. If another device or the management screen changed it, reload. A page another user is editing (edit lock) cannot be saved. After a visual save, a page editor that is still open holds stale content and cannot save it until reloaded.
- **Images**: the list is newest first and works the same with D1 or R2 storage. You can add png, jpg, gif and webp images (up to 10 MB and 40 megapixels) by pasting, dragging or choosing.
- **Safety limits**: it works only while a registered device is signed in. Writes are accepted only from this site's own screen with a CSRF token. No script of the page (inline, external, component JavaScript or uploaded JS) runs on this screen, because it would run with the administrator's session. Check parts that depend on JavaScript in the preview or on the public site.
- **Free plan and long pages**: live updates are mostly made in the browser and use no Worker CPU time or requests. When you edit a block with `{{…}}` tags, links within the site or images, among others, the server renders the whole body again (one render at a time). On the Cloudflare free plan, such renders can fail when they run back to back. In tests, bodies up to 20,000 characters did not fail; at 30,000 to 40,000 characters, some back-to-back renders failed. A failure shows "Could not update the page" in the panel, and saving still works. An open screen does not contact the server while idle.

Component JavaScript is available at `/component-js/ID.js`. Page/component JavaScript is administrator-authored code executed on public pages.

Draft/pending data cannot be read through public POST_MD embeds, navigation, feeds, or the data API.

The page editor's preview opens the content **being edited** (unsaved changes and new pages included) in a new tab through the admin screen; the note "Shows the content being edited (it is not saved)." sits beside the button. Nothing is saved, and the display stays isolated (scripts do not run on the admin origin). The edited content is kept on the server for 30 minutes only (at most four per user, readable only by that user). The page list has the globe icon to the public site instead of a preview (as in the PHP editions). HTML pages open at `/preview/ID`; Markdown-only, data-format and mikanBox DB pages open at `/admin?page_preview=ID`, which shows the actual output as UTF-8 plain text.

### Output formats (Cloud delivery)

Output formats (HTML, HTML + Markdown, Markdown, JSON/XML/CSV/text/JavaScript/CSS, mikanBox DB), their tag handling and URL rules are the same as in the PHP editions; see [Output formats](https://yoshihiko.com/mikanbox/help_en.html#output-formats). The Cloud public site is static files only, so a build publishes:

| Output format | Files published | `/ID` and `/ID/` open |
| :--- | :--- | :--- |
| HTML | `/ID.html` | the HTML (URL alias) |
| HTML + Markdown | `/ID.html` and `/ID.md` | the HTML (no extra alias) |
| Markdown | `/ID.md` | the Markdown (the alias points at `.md`) |
| Data formats | `/ID.extension` (e.g. `/news-list.json`) | 404 |
| mikanBox DB | `/api/ID.json` | 404 (`/api/ID` is an alias of `/api/ID.json`) |

- **Alias limit**: `/ID` and `/ID/` aliases count toward Cloudflare's 2,000-rule `_redirects` limit. Markdown-only pages only change the alias target, and data formats add none.
- **Content-Type**: each file is published with its type, such as `text/markdown; charset=utf-8` or `application/json; charset=utf-8`. When Cloudflare types a file by its extension, JSON and XML come without a charset, so mikanBox adds an exact `_headers` rule for each published JSON/XML data file and for `/api/ID.json` and `/api/ID` (no work for authors; `_headers` allows 100 rules in total, and files beyond that keep the extension-based type). Every response has `X-Content-Type-Options: nosniff`.
- **mikanBox DB**: `/api/ID.json` is the file and `/api/ID` returns the same JSON. Making the page a draft removes it at the next build.
- **`{{PAGE_URL:ID}}`**: the `?v=` of data and DB pages is the hash of the built file (the body's hash in previews).
- **`EXT_MD`** is not available in Markdown versions and data formats either (it outputs nothing).
- **Navigation**: lists (`NAV_LINKS`, `NAV_CARDS`, `@same`) show published pages only (not pending pages).
- **Visual editing** is unavailable for pages without HTML (Markdown only, data formats, mikanBox DB); its button is greyed out.

Page and settings saves compare their read snapshot with current storage and reject stale writes. A concurrent settings save cannot restore a revoked API key. Deleting an account stops its devices and cancels unused codes issued by them, including invitations.

Admin previews can display images before publication. Each referenced image receives a short-lived preview URL while the preview remains sandboxed.


## Site

See [Site](https://yoshihiko.com/mikanbox/help_en.html#site) for shared settings.

<a id="manual-update"></a>
### Manual updates (v0.6.6 and later)

For routine updates, select Update on GitHub in Site settings, press Run workflow on GitHub, wait for success, then reload the management page. There is no automatic update. You do not need to sync your repository or download files to your computer each time. Each run fetches the latest published release from `yoshihik0/mikanBox-cloud`, including published prereleases, but excluding unreleased development changes.

#### One-time setup

1. Place the upstream `.github/workflows/update-cloud.yml` in the default branch of a GitHub repository you control. Use your existing installation repository if available. Enable Actions in the Actions tab if disabled on a fork. Do not register your secrets in the upstream repository. Sites on v0.6.5 or earlier can run this workflow for the first update; the management link appears afterward.
2. In Settings → Secrets and variables → Actions → Repository secrets, add:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare token scoped to the target account with Workers Scripts Edit and D1 Edit permissions. If R2 is connected, also grant the permissions Wrangler needs to handle that binding.
   - `MIKANBOX_UPDATE_CONFIG`: the complete installation `wrangler.production.json` as JSON. Use current management Worker, account, D1, connected R2, routes and custom-domain settings. Do not use a sample or another site's configuration. Do not add JWT_SECRET, SETUP_TOKEN or API tokens to this JSON.
3. Open GitHub Actions → Update mikanBox Cloud → Run workflow. If the management settings already include manual updates, save your repository as `owner/repository` there. Updates through Actions configure the link automatically.

If Cloudflare Workers Builds or another system already deploys on GitHub pushes, disable that automatic deployment separately to keep updates manual. This workflow has no push or scheduled trigger.

#### Preservation and failures

The updater checks the existing management Worker and D1/R2 bindings, verifies the build, applies pending D1 migrations and deploys the management Worker. It does not initialize articles, images or settings; existing secrets including JWT_SECRET for registered devices and existing environment variables are retained. It does not overwrite the public Worker with a placeholder. Mismatched targets or unsupported additional bindings stop the update. Update the saved GitHub JSON when your bindings or routes change.

Save any needed backup before updating. Database migration and code deployment are not a single transaction. If a run fails, inspect the failed step, fix its configuration or permissions and run again. Applied migrations are not repeated. After success, reload the management page and check the version, articles and images. Use the management build when changes need to reach published pages.

Publication files are downloaded without executing code with management privileges. Public help permits only the product-provided script. Deleted pages still present on the public site remain marked as pending publication changes. Stopping a device also cancels its unused enrollment codes. Setup and recovery tokens can be consumed only once, including concurrent requests.

The admin screen checks the Cloud release manifest on GitHub and shows the installed and latest versions and whether an update is available. Check again refreshes release information; reload the page after updating to see the installed version. See the manual update setup below. `CLOUD_RELEASE_MANIFEST_URL` optionally selects an HTTPS Cloud release JSON.

### Delivery and withdrawal

Public pages are served as static files only. Viewing them runs neither the Worker nor D1, so it consumes no daily Worker requests and no D1 row reads. The former Worker delivery (the Worker serving built HTML from D1 or dynamic pages) and the `STATIC_DELIVERY` setting are gone.

Site search uses Google site search. `{{SEARCH_RESULTS}}` becomes a form that searches this site with Google (the site URL goes into `as_sitesearch`). The search page (ID `search`) is published statically too, and a query sent by the standard search box (`_search_box`) to `index.php?page=search&q=…` is passed straight on to Google by the search page. Only pages Google has indexed are found, newly published pages take a while to appear, and the words entered are sent to Google.

Pages have three statuses: draft, pending and public. There is no per-page choice between static and dynamic. Public pages are built into files for their output format (HTML, Markdown, JSON and so on) and published. Pages with the former DB status become public pages with the output format "mikanBox DB" through migration `0017`, backup restores, imports and MCP. Former dynamic pages become public through migration `0014` and when restoring backups. `public_dynamic` sent through MCP or imports is stored as public.

The build (rebuild and publish) button sits below the page list. Progress and results appear beside it, together with the number of pages whose changes are not on the public site and the time of the last publication.

#### Withdrawal

Files placed on the delivery target bypass the Worker, so deleting the source leaves the deployed file in place. Removing it from the delivery target is called withdrawal.

Pages are withdrawn by a build. Pages made private and pages deleted are removed from the delivery target then, along with their URL aliases. **They stay readable until you build.** After unpublishing, build as well.

The Media screen withdraws deleted images automatically. Renamed or converted images keep their old public version until the next build; see "Static image delivery".

### Separate public and admin Workers

Setting `CLOUDFLARE_PUBLIC_WORKER_NAME` (the public Worker's name) and `PUBLIC_SITE_URL` (the public site's URL) publishes pages to a separate Worker. The public Worker holds static files only and runs no code. The admin screen and MCP stay on the current Worker. New installations use this split configuration. Verify the destination before migrating an older installation. The public site URL appears next to the build controls on the page list and links to the public site.

- On the admin address, visitors without a session get no pages, images, component scripts or sitemaps, and search engines are told not to index it (`X-Robots-Tag: noindex`).
- A signed-in device opening `/about` on the admin address is sent to the preview (`/preview/about`). Previews carry a CSP `sandbox`, so page scripts cannot reach the admin screen. Inside a preview, page scripts cannot use cookies or `localStorage`.
- Public pages, sitemaps and RSS use `PUBLIC_SITE_URL` and never the admin address. Sitemaps, RSS and DB page JSON (`/api/page-id`) are published as files.
- Publication sends only changed files. Page hashes are stored at build time.
- The globe icon in the page list opens the page on the public site (the same role as in the PHP editions; check the content being edited with the page editor's preview). Blue means the public site shows the current content; grey means changes are not published yet. Drafts, pending pages and pages never published show it grey and unclickable. Parts that change because of other pages (a page list component, for instance) only update when you build.
- There is no sign-out button at the top. To stop using a device, stop it under Devices and users.
- The AI question box does not work on the public site. Site search uses Google, as described under Delivery and withdrawal.
- As in the PHP editions, the 404 page is never listed in sitemaps or RSS, split or not.

### Admin operations

Rebuild generates public HTML and updates static delivery together, removing unpublished or deleted pages. Previously published files remain until rebuilding. Images are delivered through the Worker and changes take effect directly. Keep the admin screen open while the browser performs these steps. Configure a dedicated token with Workers edit permission in Site settings. The installation target is fixed. The token is encrypted using a key derived from JWT_SECRET, never displayed again, and excluded from portable backups. Create it once: you only need a new one if the token is deleted or revoked in Cloudflare, its permissions change, JWT_SECRET changes, or the database is restored to a different state by a backup or Time Travel. While no token is set, a notice under “Build static site” in the page list says so. Expiring Wrangler login credentials are never copied into the Worker. The existing MCP build_ssg generates HTML only; delivery still requires the admin screen or the publication command. When Cloudflare returns error details, the error code and message are displayed. Publication requires the latest uploaded Worker version to match the deployed version. If they differ, deploy the intended version first. In split mode, saving the connection checks access to the public Worker; write permission is exercised during publication.

JPEG, PNG and WebP images can be resized and converted to WebP in the browser. Uploads default to a 2,000px maximum side. Existing conversion replaces the image and updates references with page history. GIF and SVG uploads preserve original bytes. Browser processing accepts dimensions up to 16,000px and 40 million pixels.

### Migrate from D1 to R2

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

### JSON backup and restore

Download a single JSON backup from Site settings and select that file to restore. It includes settings, all pages, components, revisions, HTML snapshots, users and original images. Images transfer in 500KB parts. Both operations start from a confirmation screen. Backups contain private content, API keys and authentication hashes: store them securely. Large backups consume browser memory and transfer time; keep the screen open. Metadata is limited to 20MB.

Normal restore preserves current site identity, API key, users and Cloudflare connection. Explicit account restoration also restores users; devices of users missing from the backup stop. Rebuild afterward. Restore stages and validates data before atomic replacement; missing parts or concurrent edits leave existing data intact. In D1 mode, existing, incoming and other staged images must total at most 450MB; R2 mode stages image bytes in R2, and actual D1 free space may impose a lower limit.

### D1 database backup

D1 SQL export and Time Travel are separate server operations available from Site settings with a token granting D1 edit permission. Free Time Travel covers the previous seven days and restores the whole database, including D1 original images (but not R2 image bytes), users and stored connection settings. D1 can be unavailable during SQL export; the UI polls through a short-lived encrypted capability without querying D1. Keep the screen open until completion. Time Travel does not rewind deployed static files; rebuild afterward and verify code/schema compatibility for older snapshots. Uploading a SQL file to restore D1 is not implemented in this admin UI.

Publication, backup and restore consume Worker requests and D1 reads/writes. Static delivery is free, but updates remain subject to account-wide daily limits. Updating the maximum 20,000 files daily is not guaranteed within the Free tier.

### Static HTML ZIP export

After a build, open the Data migration and import screen and choose Download static ZIP under Static HTML (ZIP). Choose `ID.html` or `ID/index.html`. The root `index` exports as `index.html`; directory-style IDs ending in `/index` retain `directory/index.html`. Output path collisions fail clearly.

Only currently public_static, already-built snapshots are included. Links to included pages, images and component scripts become relative paths. Referenced images and public assets are bundled. Dynamic pages, search and APIs retain live-site links. Credentials, settings, users and private pages are excluded. ZIP pages do not register WebMCP; AI question controls become links to Cloud help.

The complete ZIP is limited to 20 MB and a bounded image-query budget. Missing assets fail rather than returning an incomplete ZIP. Arbitrary runtime JavaScript requests and string-style CSS `@import` are not automatically converted. This is a static site export, not a full D1 backup.

macOS metadata files inside `__MACOSX` or starting with `._` are ignored automatically.

Open “How to arrange files in the ZIP” on the import screen to see the folder layout and resulting page IDs.

### Interrupted updates and restores

JSON restoration stages incoming data separately and replaces current data together only after validation. If communication fails while transferring images, select the backup file again and restart restoration. Reopening the screen does not resume at the previous transfer position.

If only the final restoration response is lost, the browser retries the same operation once and checks its recorded completion result. A completed restoration is not performed again, so later edits are not overwritten. If completion cannot be confirmed, reload and inspect pages and images before retrying. Restoring users may require signing in again.

If the screen says that restoration completed but publication failed, the restored data remains in place. Retry the site build from the page list instead of importing the backup again.

Program updates run the build, pending database migrations, and management Worker deployment in that order. A failed build leaves the database unchanged. If deployment fails after migrations, applied database changes remain. Inspect the failed step in the log, resolve its cause such as connectivity or permissions, and rerun the same update procedure. Do not remove migration records or repeat initial setup.

The import/export screen follows SQLite’s status cards, ZIP import, WordPress XML import and execution log, followed by CSV and Cloud-specific complete JSON backup/restore. ZIP/XML add content while retaining existing IDs; images, accounts and site settings are not imported. Limits: 20 MB files, 15 MB ZIP expansion, 1 MB imported content and 300 records. Settings fields and category add-button alignment use the shared PHP CSS.

Changing an unpublished image needs no Cloudflare publication settings. Deleting or renaming a published image publishes a withdrawal, so it does require the connection. Renaming uses the reference confirmation dialog. See “Migrate from D1 to R2” for storage limits, migration and complete backup behavior.



### Cloud-specific MCP

Generate a Cloud-specific API key in Site settings and connect to `/mcp` using a Bearer key from a separate workspace. The root `.mcp.json` remains dedicated to the official PHP server.

Current tools: `get_site_info`, `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page`, `list_components`, `get_component`, `create_component`, `update_component`, `delete_component`, `preview_page`, `get_revisions`, `get_settings`, `get_ai_context`, `list_ai_docs`, `get_ai_doc`, `update_ai_doc`, `upload_media`, and `build_ssg`.

SQLite-style flat field arguments and legacy `id` plus `data` are both accepted; do not specify the same field in both. Updates preserve unspecified fields. Call `get_site_info`, then `get_ai_context` on connection. AI document IDs may omit `.md`. `get_settings` excludes credentials and API keys, but includes working notes for authenticated AI clients. Editing requires exact IDs rather than public directory aliases.

`upload_media` accepts `filename` and `content_base64`, up to 10 MB for JPEG, PNG, GIF, WebP and SVG. Optional `category` allows ASCII letters, digits, underscores and hyphens and prefixes the filename. Duplicates fail instead of being overwritten. Large Base64 images have higher transfer and processing costs; use the ordinary media upload form as well. Audio/video and duplicate-name numbering differ from PHP. Administration aliases `/mikanBox/mcp` and `/mikanBox/mcp.php` require the same key.

Check the Cloud site's identity with `get_site_info` before writing. Its `version` changes when the product is updated: if it differs from the one you last saw, read the tool list and `get_ai_context` again. `preview_page` (read-only) shows how a page will be served in its output format before saving or publishing: with only `id` it is the saved page, with fields it renders them without saving (a new `id` works too; a title is then required). `get_ai_context` ends with a built-in document, `mikanbox-output-formats`, explaining how to choose `output_format`. Do not reuse the official site ID. A Cloud API key grants administrative content operations and must remain private.

### Public help and WebMCP

`/public-mcp` is anonymous and read-only, exposing only `search_help`, `get_help_section`, `get_product_info`, and `get_agent_instructions`. `/mcp` remains the authenticated administration endpoint. `/mikanBox/public-mcp.php` aliases the public endpoint.

Only the exact published `help_ja`/`help_en` pages are read. If unavailable, the bundled Cloud-specific manual is used. Draft, pending, DB, AI instructions, other pages and administrator data are excluded. After changing the Cloud manuals, run `node scripts/sync-cloud-help.mjs`; check/test/build also run it automatically. Human-readable help is `/public-help.html?language=ja` or `en`.

Public pages and the administration screen load the script that registers four help tools in a compatible browser/agent. Unsupported browsers skip registration while ordinary pages and AI question controls remain usable. This uses the [Chrome WebMCP API](https://developer.chrome.com/docs/ai/webmcp/imperative-api); availability depends on the browser and agent. AI question controls reference Cloud help and public MCP without transmitting API keys or administration URLs.

## Design

See [Design](https://yoshihiko.com/mikanbox/help_en.html#design-mgmt) for shared operations.

### Component list

The three editions share a filter selector to the right of “Ask AI”: All, Selected category, Page, Part, AI instructions and Standard components. Standard means an ID beginning with `_`. Omit this prefix for ordinary new or duplicated components; use it when standard classification is intended. Saving is not rejected.
“Selected category” uses the category at the top of the admin screen and matches component ID prefixes, just like media filenames: `apps_header` belongs to `apps`. With no category selected, it does not narrow the list.


Page and component CSS is inserted automatically across editions. `{{HEAD_CSS}}` optionally specifies the insertion point; only the first occurrence outputs CSS, and remaining tags are removed. If omitted, CSS is inserted before `</head>`, or at the beginning of the HTML if no closing head tag exists. Text inside comments or script/style/textarea/title elements is not treated as an insertion point.


Supports the None wrapper option, missing head metadata completion, a shared tracking ID or code (head and right after the opening body tag) and page exclusions. Page editor description/content spacing, Raw HTML checkbox placement and JavaScript field height match the PHP editions. See the bundled common help for details.

## Media

See [Media](https://yoshihiko.com/mikanbox/help_en.html#media-mgmt) for shared operations.

### Image uploads and limits

A page ID such as `test/index` works at `/test/index.html`, `/test/index/`, `/test/`, and `/test` once built. Static pages require a build. An exact `test` page takes precedence when present. These URLs resolve D1 pages; they do not create physical directories or HTML files.

Choose an image in the media section or drag it onto the screen. Click its filename to copy it; use `![Description](filename.png)` or `{{IMAGE:filename.png}}` in page content. A Download link saves each file individually.

The type filter and filename search sit in the heading row (the list follows what you type); category filtering and pagination use the configured media page size. The supported formats are explained inside Upload options. Files can be dropped only on the media section; elsewhere the pointer shows that dropping is not possible. Categories match images referenced by pages in that category or filenames starting with the category name and an underscore.

In D1 storage, Rename updates references in page content, CSS, JavaScript, OGP images and components. It cannot overwrite another file or change extensions. Memos and previous revisions remain unchanged; affected pages get new revisions. A lock or concurrent change cancels every write, including the image rename. Rebuild affected static pages; component changes invalidate all static snapshots. Large reference sets can exceed the operation limit. External sites and dynamically constructed JavaScript URLs are not updated.

- Each image: **10 MB** (10,000,000 bytes).
- D1 images: **400 MB** total. R2 removes this total-byte limit. Both modes allow **10,000 files**.
- Formats: **JPEG, PNG, GIF, WebP, SVG**. Extension and leading format signature must match. D1 audio/video uploads are unsupported.
- Duplicate names are rejected. Optional browser resizing and WebP conversion are available before storage; the stored original is the processed file.
- Media ZIP: **20 MB** total, with a file count that fits the request query budget (about 20 small images, or two 10 MB images). Download individually when exceeded.

Static builds add `width`, `height` and loading hints to local images (JPEG, PNG, GIF, WebP; not SVG), as the PHP editions do: the first large image gets `fetchpriority="high"`, later ones `loading="lazy"`. This applies to `![alt](filename)` and `{{IMAGE:}}`; a hand-written `<img>` is left alone. The size is read from the start of the image file and is not stored. One build looks up at most 30 images; any beyond that get no attributes. Live (unbuilt) rendering and the admin preview do not add them.

The D1-only 400 MB image allowance reserves space for content, history and database overhead. It does not apply to R2. Platform storage limits may be reached first.

[D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) includes 5 million rows read/day, 100,000 rows written/day, and 5 GB account-wide storage. [Workers Free](https://developers.cloudflare.com/workers/platform/limits/) allows 100,000 requests/day. D1 image reads use one row per 500 KB chunk. R2 image delivery reads D1 metadata and R2 objects. Allowances are shared with other account applications. Free-plan daily exhaustion stops operations until reset. The application does not change your plan automatically. Existing Paid contracts remain subject to their pricing.

Images are published after upload, including images used only in drafts. Do not upload images that must remain private. JavaScript and CSS files are published when the site is built.

Media omits the image conversion note and maximum-file-size line, and explains using files on a page: a bare filename in Markdown and `media/filename` in HTML. Existing `images/filename` references for images remain supported.

When renaming or converting to WebP, an existing target filename stops the operation before the original or published image is withdrawn. If a page whose references would change is being edited, save and close its editor first. Errors remain visible beside the image action.

### Media editing and categories



The media list retains its scroll position where possible after an operation. Image actions match PHP: “Resize▼”, “Rename▼”, then “Convert to WebP”. WebP conversion appears only for JPEG/PNG; renaming preserves the extension. Conversion uses `.webp` and updates page, component and common OGP references. The top category selection also filters media by filename prefix, while shared `g_` images remain visible; this does not mean only used images. Uploads receive the selected category prefix unless an alphanumeric prefix is already present.

### Static image delivery

Publication includes images. Every stored file is published, including files no page references, because dynamic pages read the same `/media/filename` paths as static pages.

Published images are served from Static Assets. Admin previews can show images before publication. Uploading an image in Media automatically adds that image to the delivery target without rebuilding pages. This needs the Cloudflare publication settings and the last publication state; if the target was changed elsewhere, build the site once. If publication fails, the image remains saved and the admin screen reports that it was not published. MCP uploads do not publish automatically.

The delivery target allows 20,000 files per version and 25 MiB per file. Images are limited to 10 MB each and 10,000 files, so pages and components fit within that budget alongside them.

Renaming or converting a published image keeps the old public image and HTML until the next build. The new image and references are saved in the admin, and the next build switches the public site. The old public filename cannot be reused until the build removes it. Deleting a published image still withdraws it from the delivery target first.

Replacing a file under the same name needs no withdrawal, because its public URL does not change. The delivery target keeps the previous content until the next publication.



### JS and CSS libraries

Media accepts browser-ready `.js` and `.css` files: nonempty UTF-8 text, up to 10 MB each, saved without rewriting code. The admin screen does not execute them. Copy the URL or embed tag from a card and paste tags into page content or component HTML. Uploads do not insert tags automatically. Only trusted administrators and API keys should upload code from a verified source. Format validation does not guarantee safe code.

Code files receive no category prefix, stay visible across category filters, and bypass image conversion. File-type filtering, same-extension renaming, and deletion are available. Existing names are rejected rather than overwritten. Uploading a folder hierarchy is not supported.

Files follow the existing D1/R2 media storage setting and keep `/media/filename` URLs. Complete JSON backup/restore and D1-to-R2 migration include them; code fields remain in D1. Static publication serves these files from the deployed static files; see "Static image delivery". Portable static ZIPs include files referenced by HTML.

## Tags

### Tags that are not available

- `{{EXT_MD:…}}` (fetching external Markdown or data) is not available in the Cloud edition. Nothing is shown where the tag is; only the comment `<!-- EXT_MD is not available in the Cloud edition -->` remains in the HTML (Markdown versions and data formats output nothing). It is not a feature for carrying data over. The editor's tag list and the bundled sample page say so.

You can use `{{SITE_URL}}` in Markdown link destinations. Tags inside code examples remain literal. Renaming an image also requests confirmation when it is used only as the site-wide OGP image.


### Protection and management notes in 0.7.1

Authenticated management MCP clients can read page, component and site notes as working context. Reading a note is not permission to publish it. Notes are excluded from public pages, public APIs and public-help MCP. Use separate management and public Workers for new installations and production deployment. Site HTML rendered on the management origin is always sandboxed, including previews with legacy configuration, so its scripts cannot access administration. Cloud does not provide a public demo mode.

### Changes in 0.8.0

The output formats of PHP 2.17.0–2.18.1 are ported: per-page output formats (HTML + Markdown, Markdown, data formats, mikanBox DB), `/ID.extension` URLs, `{{PAGE_URL:ID}}`, `{{CATEGORY}}`, categories starting with `_`, `sort`/`limit`/`sep`/`@same` for `NAV_LINKS` and `NAV_CARDS`, and the MCP fields `output_format`, `md_footer_comps` and `expand_tags`. MCP `update_page` keeps the date of a published page it edits (the date moves to now only when a page goes from not public to public). The admin page list is ordered like the PHP editions: pending, then `index`, then display order. Updating requires D1 migration `0017`.

### Changes in 0.8.1

The public site now serves `.md`, `.txt`, `.csv`, `.js`, `.css`, `.json` and `.xml` with `charset=utf-8` on Cloudflare's delivery too (in 0.8.0, Japanese text could be garbled when opened from the globe icon in the page list). The `/ID` and `/ID/` of Markdown-only pages and `/api/ID` of mikanBox DB get the same setting. Markdown versions, data formats and mikanBox DB are served with `Access-Control-Allow-Origin: *`, so Markdown viewers and scripts on other sites can read them (as in the PHP editions). Publish once more after updating for it to take effect. Opening a page editor from a page list filtered by category no longer clears the filter, and a new page starts with the filtered category.

### Changes in 0.8.2

The admin screens follow PHP 2.18.2. The browser tab title is "🍊site name". The page list has an output-format filter right of Help, combined with the category and search (kept when the page editor is opened and closed). Each page row has three actions: edit, visual editing and the globe icon (public site); check the content being edited with the page editor's preview. The media type filter and search moved to the heading row, and searches have one clear button (the browser's). Files can be dropped only on the media section. Selects have room right of their arrow. The MCP connection instructions and `get_ai_context` explain that a page is made readable as Markdown by setting its `output_format` to `html_md` or `md` (there is no site-wide switch).

### Changes in 0.8.3

Dates and times in the admin screen are shown in the viewer's own time zone (Japan time in Japan): "Last published", revision times, and the Added, Last used and Expires columns under Devices and users (they were shown in UTC before). The sign-in page now receives only the site name instead of the whole settings, and its tab title is "🍊site name - Sign in" (as in PHP).

### Changes in 0.9.0

The basics of operation, the motion of opening and closing editors, previews and MCP follow PHP 2.19.0. Updating requires D1 migration `0018` (the table holding previews for a short time).

- **Operation basics.** The browser's `alert`, `confirm` and `prompt` are gone from the admin screen (a test fails if one returns). Results go to the toast at the bottom right and confirmations are asked in the screen. This covers the copy success and failure messages, the missing CSV file, adding a category (an input field), deleting media, and the confirmations before restoring a backup or D1.
- **Actions without a reload.** Saving and deleting pages and components (a delete asks in the screen, then closes the editor and refreshes the list), saving the memo, site settings and update source, the actions under Devices and users (issuing and cancelling codes, stopping a device, the expiry period, the display name, deleting a user), publishing (afterwards only the list and the publish box are refreshed), and choosing or adding a category all run in the current screen. A new page or component becomes the editor of an existing one after its first save, without moving the screen (Delete and the revision list appear).
- **Opening and closing editors.** Page and design editors grow and shrink in. Opening scrolls to the top of the editor; closing refreshes the list and returns to the row that was edited. Filters, search and the list page are kept, unsaved changes are asked about in the screen, and Back/Forward work.
- **Where the whole screen is still reloaded (exceptions, with reasons).** Changing the language (every label changes); restoring a backup (the whole site and the accounts are replaced); switching media storage and cancelling its migration (the storage screen's premise changes); restoring D1 to a time (the whole database changes); stopping your own device (you are signed out); saving the connection settings and downloading a backup or SQL (the publish and backup sections change, or a file is saved).
- **Preview.** It shows the content being edited (see Preview above).
- **MCP.** Added `preview_page` (read-only). Added `version` to `get_site_info`, the connection guidance (read the tool list again when the version changes) and the built-in document `mikanbox-output-formats` at the end of `get_ai_context`. The AI instruction sample has one more line about output formats.
- **Other.** `/admin.php` is the same screen as `/admin` (the shared preview script uses that address). The shared `admin-ui.js` is copied from `shared/admin-ui.js` on every `npm run check`, `npm test` and `npm run build`.

### Changes in 0.9.1

Updating to 0.9.0 failed in the GitHub update workflow: the shared `admin-ui.js` was copied from a `shared/` folder outside the repository, which does not exist there. Where `shared/` is absent (CI and the update workflow) the committed `public/mikanbox/admin-ui.js` is now used as it is; a development workspace with `shared/` beside it still copies it.

The operations rewritten in 0.9.0 were each pressed in a development environment, and two problems were fixed: changing the language did not switch the screen (the language select is in a different form than the one that triggered the reload), and issuing a device code did not show the code (the form was replaced before the code could be put in).
