<style>.manual-version{font-size:.5em;font-weight:400;white-space:nowrap}</style>

# 🍊mikanBox Cloudflare Manual <small class="manual-version">v0.19.1</small>

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

`npm run deploy:cloud` updates only the management Worker. The admin build updates the public Worker.

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
- Revision recording, the newest 10 revisions kept per page, older ones removed automatically (visual editing keeps one per editing session), edit locks, and stale-edit protection.
- Draft and pending pages are private. Registered, signed-in editors can preview both; the labels describe workflow state and have identical access permissions.
- Component CRUD, part/wrapper/AI-document types, memos, CSS, and JavaScript.
- Site settings, language, site memo, adding and stopping devices, and inviting and deleting users.
- Changing your own display name (the field on your own user in "Devices and users"). The username cannot be changed.
- Image upload, streaming delivery and deletion, stored in D1, up to 10 MB per file. Existing filenames are not overwritten.
- ZIP downloads of JSON content and media; these are not a complete D1 backup/restore.
- Bulk acquisition for pages, components, search, navigation, feeds, data backups and static builds avoids one query per content item. Platform data/CPU limits still apply.
- Category deletion also removes the category from affected pages and records revisions. Active edits or concurrent changes cancel the entire operation.
- D1 snapshots of public_static pages. Published HTML stays unchanged until rebuilt; changing a page to draft immediately prevents public access.

### Visual editing

Usage is the same as in the PHP editions; see [Visual Editing](https://yoshihiko.com/mikanbox/help_en.html#visual-edit). Open it from the visual-edit button in the page list (between the pencil and the preview), from the button at the top right of the page editor, or at `/admin/visual` (a page chooser), next to the management screen. What differs in the Cloud edition:

- **The public site**: a save changes the page on the management side. A published page is a static file, so the public site does not change until you publish it again (see Delivery and withdrawal). Saving a published page shows a note saying so.
- **History**: the time from opening the page to closing it counts as one editing session, and only the state before it is kept, once, in the page's history (small, frequent saves do not push older history out). Undo and redo cover the last three steps and are discarded when the session changes.
- **Conflicts and edit locks**: a save is refused unless the page is still as it was read. If another device or the management screen changed it, reload. A page another user is editing (edit lock) cannot be saved. After a visual save, a page editor that is still open holds stale content and cannot save it until reloaded.
- **Images**: the list is newest first. You can add png, jpg, gif and webp images (up to 10 MB and 40 megapixels) by pasting, dragging or choosing.
- **Safety limits**: it works only while a registered device is signed in. Writes are accepted only from this site's own screen with a CSRF token. No script of the page (inline, external, component JavaScript or uploaded JS) runs on this screen, because it would run with the administrator's session. Check parts that depend on JavaScript in the preview or on the public site.
- **Free plan and long pages**: live updates are mostly made in the browser and use no Worker CPU time or requests. When you edit a block with `{{…}}` tags, links within the site or images, among others, the server renders the whole body again (one render at a time). On the Cloudflare free plan, such renders can fail when they run back to back. In tests, bodies up to 20,000 characters did not fail; at 30,000 to 40,000 characters, some back-to-back renders failed. A failure shows "Could not update the page" in the panel, and saving still works. An open screen does not contact the server while idle.

Page and component JavaScript fields are embedded in the HTML of the pages that use them. Upload standalone JavaScript files to Media.

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

For routine updates, select Update on GitHub in Site settings, press Run workflow on GitHub, wait for success, then reload the management page. There is no automatic update. You do not need to sync your repository or download files to your computer each time. Each run fetches the latest published release from `yoshihik0/mikanBox-cloud`, including published prereleases, but excluding unreleased development changes. From v0.10.3 the workflow first resolves the commit the release tag points to, checks out only that commit and confirms it before preparing and deploying anything; the GitHub actions it uses (`actions/checkout` and others) are pinned to the commits of their official releases. Your copy of the workflow is not updated automatically: press **Sync fork** in your repository, or replace `.github/workflows/update-cloud.yml` with the latest one. An older workflow still updates, but without the commit check.

#### One-time setup

1. Place the upstream `.github/workflows/update-cloud.yml` in the default branch of a GitHub repository you control. Use your existing installation repository if available. Enable Actions in the Actions tab if disabled on a fork. Do not register your secrets in the upstream repository. Sites on v0.6.5 or earlier can run this workflow for the first update; the management link appears afterward.
2. In Settings → Secrets and variables → Actions → Repository secrets, add:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare token scoped to the target account with Workers Scripts Edit and D1 Edit permissions.
   - `MIKANBOX_UPDATE_CONFIG`: the complete installation `wrangler.production.json` as JSON. Use current management Worker, account, D1, routes and custom-domain settings. Do not use a sample or another site's configuration. Do not add JWT_SECRET, SETUP_TOKEN or API tokens to this JSON.
3. Open GitHub Actions → Update mikanBox Cloud → Run workflow. If the admin screen already has "Set up updates connected to GitHub", save your repository as `owner/repository` there. Updates through Actions configure the link automatically.

If Cloudflare Workers Builds or another system already deploys on GitHub pushes, disable that automatic deployment separately to keep updates manual. This workflow has no push or scheduled trigger.

#### Preservation and failures

The updater checks the existing management Worker and D1 binding, verifies the build, applies pending D1 migrations and deploys the management Worker. It does not initialize articles, images or settings; existing secrets including JWT_SECRET for registered devices and existing environment variables are retained. It does not overwrite the public Worker with a placeholder. Mismatched targets or unsupported additional bindings stop the update. Update the saved GitHub JSON when your bindings or routes change.

Save any needed backup before updating. Database migration and code deployment are not a single transaction. If a run fails, inspect the failed step, fix its configuration or permissions and run again. Applied migrations are not repeated. After success, reload the management page and check the version, articles and images. Use the management build when changes need to reach published pages.

Publication files are downloaded without executing code with management privileges. Public help permits only the product-provided script. Deleted pages still present on the public site remain marked as pending publication changes. Stopping a device also cancels its unused enrollment codes. Setup and recovery tokens can be consumed only once, including concurrent requests.

The admin screen checks the releases published on GitHub (from v0.10.3 the release feed, so changes on a development branch alone do not change it) and shows the installed and latest versions and whether an update is available. Check again refreshes release information without reloading the screen and shows the result at the bottom right (from v0.11.1); reload the page after updating to see the installed version. See the manual update setup below. `CLOUD_RELEASE_MANIFEST_URL` optionally selects an HTTPS Cloud release JSON instead.

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

<a id="public-worker"></a>
From v0.10.3, without a public Worker (with a name different from the management Worker), building, publishing and automatic image publication deploy nothing, because pages published to the management Worker would run their JavaScript on the admin address. The build button then shows "Set a public Worker". Set the public Worker with the management Worker's variables `CLOUDFLARE_PUBLIC_WORKER_NAME` (the public Worker's name) and `PUBLIC_SITE_URL` (the public site's URL): write them under `vars` in the installation's `wrangler.production.json` and deploy the management Worker again. See the [detailed reference (installation)](https://github.com/yoshihik0/mikanBox-cloud/blob/HEAD/docs/reference_ja.md#インストール手順). Sites installed and updated with the official steps already have them.

From v0.12.0 a local `wrangler dev` uses the same arrangement (the former publication to a single Worker is gone, for development too). Without a public Worker the management Worker still returns only the admin screen, MCP and previews, and no site content to anyone who is not signed in.

- On the admin address, visitors without a session get no pages, images, component scripts or sitemaps, and search engines are told not to index it (`X-Robots-Tag: noindex`).
- From v0.10.2, the admin address opened with `http://` moves to the same address on `https://` (when a page is opened; `localhost` and similar addresses of a local `wrangler dev` stay as they are).
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

### Storage

Pages, history and settings are kept in the D1 database; media files (images, and uploaded JS and CSS) are kept on the public site. D1 keeps only the information about each media file (name, size and so on). No payment method has to be registered with Cloudflare to stay within the free plan.

- The top of Site → Data management shows the D1 database size; a notice appears there when it passes 450 MB.
- Media may hold files of up to 10 MB each and 10,000 files (Cloudflare's free plan allows 20,000 files of up to 25 MiB each on the public site). The media screen warns when the file count passes 90% of the limit.
- The public site is the only place the media is kept. Save it regularly with "Save" (JSON and media) under Site → Data management.

References: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Recent operations

Site → Recent operations shows the records in three tabs (Important, Site edits, Failed sign-ins), newest first (the same items and display as PHP).

“Site edits” records every addition, change and deletion of pages, components, media and site settings (including the Cloudflare connection), whether it was made in the admin screen, in visual editing, through MCP or by importing data (from 0.16.0). Rewriting only the content of a page that is already public is recorded too. Saving the same item several times within 10 minutes by the same person is one line, and an import is one “Data imported” line. For site settings, only the names of the settings that changed are recorded, never their values.

“Important” holds MCP enabled/stopped and key issued, devices registered/stopped and codes issued, deleted users, recovery and data restores. The latest 50 important operations, the latest 50 failed sign-ins and the latest 500 site edits are kept, so a run of failed sign-ins or of edits never pushes out the important records. A fingerprint (SHA-256) of the content before and after each change is kept but not shown. IP addresses are partly hidden. Changes made to D1 directly in the Cloudflare dashboard or with wrangler are recorded with an empty actor, since who made them is unknown.

“Check for tampering”, above the version display on the Site screen, looks for changes that are not in the history and shows the result under the button. It runs only when you press it, and page views are not affected. It checks two things.

- **Files of the public site**: the published text files (HTML and so on) and the media js, css, svg and html files are compared with the fingerprints recorded at publication. Your browser reads them from the public site and checks them, so a large site does not run into the limits of Cloudflare's free plan. Files that changed and files that disappeared are listed (unknown files added to the public site cannot be listed, so they are not found). Images, audio and video are not checked.
- **Stored data**: the content of pages, components and site settings is compared with the last “after” fingerprint in the history. Changes made to D1 directly in the Cloudflare dashboard or with wrangler are found this way.

The Cloud edition's program is the deployed Worker itself and there is no way to rewrite files on a server, so program files are not checked; the result says so. If nothing is found, the result says so with the time of the check. If what is found is your own change, press “This is my change (accept)” and the present state becomes the new basis (the acceptance is recorded as an important operation). Anyone with access to D1 or to deployment can also rewrite the records. This is a clue for noticing a problem, not protection against intrusion.

In the history tables, records whose person and IP range have not appeared in any earlier record, or whose actor is empty, get a light background color (there is no setting; nothing is colored while there are no records yet). Such records of the last 30 days are also listed in the result as “Unusual operations”.

### Save and Read

The figures, "Save", "Read" and "Export the public site" look and work as in the PHP editions ([Data management](https://yoshihiko.com/mikanbox/help_en.html#site-data-mgmt)); a ZIP saved here can be read into a PHP site too. What differs in Cloud:

- **Save**: the browser reads each media file from the public site and puts it in the ZIP. If a public file differs from its record, saving stops: build the site and save again. "Database" saves the whole D1 database (pages, settings, accounts and the media information) as one SQL file, without the media files themselves; load it into a Cloudflare database with `wrangler d1 execute`. It can be chosen once a token with D1 edit permission is set in the Cloudflare publication settings.
- **Read**: media that are read are sent to the public site at once (the whole site is built) and join the media list once the public site carries them. If sending fails, the media are not read: read the same file again. When only pages are read, build the site to update the public pages, as in PHP.
- **Export the public site**: the browser reads the published files from the public site.
- A large site takes time; keep the screen open until it finishes.

### Restore D1 to a past time

Returns the database to a time within Cloudflare's retention period (the last 7 days on the free plan). The public site is not changed: to restore it, build the site.

### Interrupted updates

Program updates run the build, pending database migrations, and management Worker deployment in that order. A failed build leaves the database unchanged.

### Cloud-specific MCP

In “MCP API key” on the Site screen, name a Cloud-specific API key after the AI tool or machine that will use it and issue it. A separate key for each tool or machine shows in the history which one acted and lets you revoke them one at a time (from 0.19.0; up to 20). Connect to `/mcp` with the key in an `Authorization: Bearer` or `X-API-Key` header from a separate workspace. Clearing “Enable MCP” and saving refuses every MCP connection while keeping the key (as in PHP); each key's last use is shown in the list (recorded at most once an hour per key). The root `.mcp.json` remains dedicated to the official PHP server. The key is shown only once, when it is issued, and the server keeps only its fingerprint (SHA-256) (from 0.18.0); if you lose it, revoke that key in the list and issue a new one.

Current tools: `get_site_info`, `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page`, `list_components`, `get_component`, `create_component`, `update_component`, `delete_component`, `preview_page`, `get_revisions`, `get_settings`, `get_ai_context`, `list_ai_docs`, `get_ai_doc`, `update_ai_doc`, `upload_media`, and `build_ssg`.

SQLite-style flat field arguments and legacy `id` plus `data` are both accepted; do not specify the same field in both. Updates preserve unspecified fields. Call `get_site_info`, then `get_ai_context` on connection. AI document IDs may omit `.md`. `get_settings` excludes credentials and API keys, but includes working notes for authenticated AI clients. Editing requires exact IDs rather than public directory aliases.

`upload_media` accepts `filename` and `content_base64`, up to 10 MB for JPEG, PNG, GIF, WebP, SVG and UTF-8 JS/CSS, and puts the file on the public site at once (when the site was never published, or Cloudflare asks for other files again, it says to build from the admin screen). Optional `category` allows ASCII letters, digits, underscores and hyphens and prefixes the filename. Duplicates fail instead of being overwritten. Large Base64 images have higher transfer and processing costs; use the ordinary media upload form as well. Audio/video and duplicate-name numbering differ from PHP. Administration aliases `/mikanBox/mcp` and `/mikanBox/mcp.php` require the same key.

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

Choose an image in the media section or drag it onto the screen. The file is sent to the public site first and appears in the media list once it is confirmed there (images used only in drafts are published too; do not upload images that must remain private). If it cannot be sent, nothing is recorded. Click a filename to copy it; use `![Description](filename.png)` or `{{IMAGE:filename.png}}` in content.

- Each file: **10 MB**, up to **10,000 files**.
- Formats: **JPEG, PNG, GIF, WebP, SVG** and UTF-8 **JS/CSS**. Extension and leading format signature must match. Audio/video are not supported.
- Duplicate names are rejected.
- When the site was never published, the first upload builds and publishes the whole site.

### Media editing

Resizing and WebP conversion run in the browser; the processed image is sent to the public site, then replaces the image in the list. WebP conversion asks for confirmation first. Renaming updates references in page content, CSS, JavaScript, OGP images and components; it cannot overwrite another file or change extensions.

### Media on the public site

- A renamed or converted image stays on the public site under its old name too until the next build (published pages still refer to it); the next build leaves only the new name. The old name cannot be reused until then.
- Deleting a published image withdraws it from the public site first; this needs the Cloudflare publication connection.
- Admin previews show images from the public site. Opening `/media/…` on the admin address leads to the public site.
- Static builds add `width`, `height` and loading hints to local images, as the PHP editions do.

### JS and CSS libraries

Media accepts browser-ready `.js` and `.css` files: nonempty UTF-8 text, up to 10 MB each, kept as they are and put on the public site at once, like images. The admin screen does not execute them. No category prefix or image conversion applies. The public URL is `/media/filename`.

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

### Changes in 0.9.2

The page list search now filters as you type, like the media search (the list changes 250 ms after you type, and the search term stays in the URL; clearing it with the browser's own × shows every page at once). Before, you pressed Enter to search. The README features now mention Markdown output and the other output formats (JSON, XML, CSV, text, JavaScript, CSS and mikanBox DB).

### Changes in 0.9.3

Follows PHP 2.19.2.

- **Closing editors.** Closing a page or design editor first scrolls smoothly to the top of the list, then the editor shrinks away in 260 ms (opening takes 320 ms). Before, the shrinking looked instant. Returning to the edited row is gone.
- **Confirmations.** With unsaved changes you get the same three choices as in the PHP edition (Save and close, Discard and close, Cancel) when closing an editor, opening another, or switching revision. If the save fails, the prompt stays open. The media rename confirmation now looks like PHP's. Deleting and the other confirmations already used the same component as the PHP edition. Unsaved changes are counted separately for the page editor and the design editor.
- **Delete buttons.** Deleting asks for confirmation even when a required field such as the title is empty (the browser's input check no longer stops it).
- **Data migration screen.** `/admin?view=import` is unchanged (the SQLite edition was rebuilt to match it).

### Changes in 0.9.4

The order of closing an editor follows PHP 2.19.3 (page and design editors alike). (1) It fades out in place (about 200 ms; the height does not change). (2) The screen scrolls smoothly to the top of the list (300-600 ms, by distance). (3) Only after the scroll ends is the editor removed. With reduced motion (`prefers-reduced-motion`) it closes at once. This replaces the 0.9.3 "scroll, then shrink" motion.

### Changes in 0.10.0

The admin page list order follows PHP 2.20.0.

- **The default order ("Display order")** now matches the public lists (`NAV_LINKS` and `NAV_CARDS`): pending, then `index`, then display order, then the **newest update**, then ID. Before, pages with the same display order were ordered by ID.
- **A sort selector** sits right of the output-format filter: Display order, Newest update, Oldest update, ID, Title (URL parameter `sort=`). Title order uses Japanese collation (an empty title is ordered by its ID). `index` is always first. Pending pages come first only in Display order; in the other orders the list is purely in that order.
- Sorting happens before the page split. The chosen order is kept with filters, search and paging, and after opening and closing an editor.
- The selector's tooltip explains the Update date: it is set when the page is created, updated when it goes from not public to public, and not changed by later edits.

### Changes in 0.12.0

One arrangement only, on the way to a supported release.

- **Media is stored in D1 only.** Storing media in R2 and the migration from D1 to R2 were removed, so the site keeps working without a payment method registered with Cloudflare. Media may total 400 MB; near the limit a notice appears on the media screen and under Site → Storage usage (formerly "Media storage").
- **A site that keeps images in R2 cannot be updated to this version.** The update stops at the D1 change and no data is altered. Stay on 0.11.1.
- **History keeps the newest 10 entries per page** (as in the SQLite edition). Before, there was no limit and the screen listed the last 50. The update removes entries older than the tenth of each page; save a JSON backup first if you want to keep them.
- **Only the separated arrangement remains.** The management Worker returns the admin screen, MCP and previews whether or not a public Worker is set. The publication to a single Worker kept for development (`SITE_ENVIRONMENT=local`) and the old `npm run publish:static` command were removed. Without a public Worker, as before, a notice under the build button says where to set it and nothing is deployed.
- The only script sent to the public site is `ai-question.js`, which public pages load (admin scripts are not sent; this was already so in the separated arrangement).

### Changes in 0.12.1

Differences from the PHP editions and unused parts tidied up, on the way to a supported release.

- **Categories can be deleted** (the same "Delete" button as in PHP). In delete mode, the × or the category name deletes it; when pages use it, a confirmation shows how many. The PHP editions also delete on a click on the name.
- **The top page (index) ID can be changed** (as in PHP), so a new top page prepared under another ID can be swapped in. While no `index` page exists, the public site has no top page.
- **Stopping MCP and the last use** were added to Site → MCP API key, as in PHP. The `X-API-Key` header works too.
- **A device code appears right under the button** that issued it (in the SQLite edition too). "Devices and users" now has the SQLite edition's wording and structure.
- **CSV import** moved from the data migration screen to the site screen, where it is in PHP.
- **Design list**: AI instructions come first. "Create New" moved next to the heading, and a search field (ID and memo) sits at the right. The "Selected category" filter, which could not work, was removed (in all three editions).
- **WebP conversion** reports, as in PHP, which file the image became and how many image links were updated.
- The component ID hint no longer appears twice. The WordPress import description no longer says that published items become dynamic pages.
- **"Site URL" was removed from the site settings.** The Cloud edition did not use it; the public address comes from `PUBLIC_SITE_URL` (MCP `get_site_info` returns it too).
- The "Also restore users" label now says what happens: devices of users missing from the backup stop (not everyone is signed out).
- **Unused data was removed** (D1 change on update): the R2 column and tables, the password-era user columns (password, security question) and settings such as `site_url`. JSON backups made before 0.12.0 still restore (unneeded fields are skipped).

### Changes in 0.13.0

- **Media is kept only on the public site.** D1 keeps the information about each file. The 400 MB media total is gone (10 MB per file, 10,000 files). Uploads, resizing and WebP conversion show in the list once the file is confirmed on the public site. JS and CSS are published at once, like images.
- **Build the site before updating.** This update removes the image data kept in D1; update with every media file on the public site (built).
- **Exports and backups were reorganized.** Site: "Download data (JSON)" and "Download media". Data tool: "Export the public site", "Export the D1 database as SQL", "JSON backup and restore", "Restore D1 to a past time". Media and site exports read from the public site in the browser, so the 20 MB limit is gone. The server-built static HTML ZIP (with its file-structure choice) was removed.
- **Restoring a JSON backup** replaces the current site, images included; the 450 MB limit is gone. A damaged file stops without changes.
- **Recent operations** were added to the Site screen (the same items as PHP, up to 200).
- **WebP conversion asks for confirmation** (in all three editions).
- Every file on the public site allows cross-origin reads (`Access-Control-Allow-Origin: *`), so the admin screen's exports can read it; only published files are concerned.

### Changes in 0.13.1

- The "Media storage" line on the media screen and the media total under Site → Storage usage were removed (as in PHP), since the total size has no limit. A warning appears only when the file count passes 90% of the limit.
- The JS/CSS note in the upload options now reads "JS and CSS run on public pages. Upload only files you trust." (in all three editions).

### Changes in 0.13.2

- **The full backup is now one ZIP.** It replaces the JSON backup (which held the images as text inside one JSON file): the data and the image files go into one ZIP as they are, and restoring means choosing that one ZIP. JSON backups from 0.13.1 and earlier cannot be restored; after updating, save a new full backup.
- **Page history is optional.** It is left out unless you tick it.
- The data tool now lists: full backup, restore a backup file, export D1 as SQL, restore D1 to a past time, export the public site.
- Export and backup results appear in the toast at the bottom right.

### Changes in 0.14.0

- **The Data Migration & Import Tool now matches the PHP editions.** "Save" downloads the chosen contents (JSON and media / JSON only / Media only / Database). "Read" recognises what the chosen files hold and reads the JSON and media (ZIPs, WordPress XML, media files). When the same item exists, choose "Do not overwrite", "Overwrite items with the same ID" or "Replace everything". The saved ZIP has the same layout in all three editions.
- "Download data (JSON)", "Download media", "Full backup", "Restore a backup file", "Content package (ZIP) import" and "WordPress migration" are gathered into these two. A full backup ZIP saved with 0.13.2 can be read with "Read".
- Users are neither saved nor read (users and devices are managed under Devices and users).
- **Export the public site** has "Use relative paths" ("Convert to relative paths" from 0.15.1).
- Reading a file no longer reloads the screen.

### Changes in 0.14.1

- "Read" checks setting values as the settings screen does (such as the analytics ID and the number per page), and checks page history like pages.

### Changes in 0.14.2

- Media read by "Read" join the media list only once the public site carries them, as uploads do. If they cannot be sent to the public site, they are not read (read the same file again).

### Changes in 0.15.0

- **The Data Migration & Import Tool screen is gone; its contents are now under Site → Data management.** The top of the section shows the number of pages, components, users and media files, with the media total and the database size. Save, Read, Restore D1 to a past time and Export the public site work there as before (as in PHP 2.25.0).

### Changes in 0.15.1

- **Recent operations keeps only the latest 50** (200 before), the same number the screen shows. Updating removes the older records.
- **The site settings show "Site URL" read-only.** It is the address shown as the destination in the page list (`PUBLIC_SITE_URL`).
- Site → Storage usage was removed. The D1 database size is shown at the top of Data management, where the near-limit notice now appears too.
- "How to get a Cloudflare API token" now opens and closes like "Add a device".
- The site screen's helper texts were trimmed, and every section keeps the same gap between its heading and contents. Language, CSV import and site settings sit in one box each, like Data management (as in PHP 2.25.1).

### Changes in 0.15.2

- **Recent operations are kept in three groups, each holding its latest 50: important operations, page public-state changes, and failed sign-ins.** A run of failed sign-ins can no longer push out records such as MCP key issuance, device registration or restores. Updating removes the records older than the 51st in each group.

### Changes in 0.15.3

- **Recent operations has three tabs: Important, Site edits and Failed sign-ins.**

### Changes in 0.16.0

- **Every change to pages, components, media and site settings is recorded in “Site edits”, wherever it was made.** Rewriting only the content of a page that is already public is recorded too. The latest 500 site edits are kept (the same as PHP 2.26.0).

### Changes in 0.17.0

- **Added “Check for tampering” to the Site screen.** It compares the files of the public site and the stored data with the state on record and shows the result under the button. If what it finds is your own change, “This is my change (accept)” makes it the new basis. Program files are not applicable to the Cloud edition.
- **In the history, records whose person and IP range have not appeared before, or whose actor is empty, get a light background color.** Those of the last 30 days are also listed in the check result.
- **The history now uses almost no D1 rows read.** Each record used to scan the whole history table (about 600 rows) twice; it now has an index, and old records are removed once in 50 records. Saving a page reads a few rows instead of about 1,200. The numbers shown (50 important operations, 500 site edits, 50 failed sign-ins) do not change. Updating applies a D1 migration (0028).

### Changes in 0.18.0

- **The MCP API key is shown only once, when it is issued.** The server keeps only its fingerprint (SHA-256), the same as PHP 2.28.0. **Updating retires the existing key:** issue a new one once under Site → MCP API key and set it in your AI tool.

### Changes in 0.18.1

- In the tamper check, once you have confirmed the “Unusual operations” were yours, “This is my change (accept)” removes the color and the listing for the records up to then (the same as PHP 2.28.1).

### Changes in 0.19.0

- **MCP API keys can now be named, and you can issue as many as you need (up to 20; the same as PHP 2.29.0).** A separate key for each AI tool or machine shows in the history which key acted, and lets you revoke just the one that is a problem in the list. The list shows each key's name, issue date and last-use time.
- The tamper check's description is now the same as in the PHP editions. The “Cloudflare publication settings” and “MCP API key” sections are framed like the language section, and “Set up manual updates” is now “Set up updates connected to GitHub”.

### Changes in 0.19.1

- **The MCP API key section now sits under “Devices and users”, and an issued key appears in the field under the connection URL (the same order as PHP 2.29.1).** The tables of the history and of the MCP API keys use the same text size as the devices and users tables.
- **A key issued before this update (0.18.x) no longer works from 0.19.1.** After updating, issue a new key in “MCP API key” on the Site screen and change the setting of your AI tool.
- The “Update on GitHub” note is reworded and uses the same quiet gray as the version line. The outer frames around “Cloudflare publication settings” and the memo are transparent.
