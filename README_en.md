# 🍊mikanBox Cloudflare Edition

[日本語 README →](README.md)

**AI-era, parts-assembly, ultra-lightweight CMS**

🍊mikanBox is an ultra-lightweight CMS with an easy-to-use UI, Markdown-based content management, and a flexible component-based design — all of which can be freely controlled by AI.

This repository is the **Cloudflare edition** (🍊mikanBox Cloud), which runs on Cloudflare Workers and D1. The admin site and the public site run as separate Workers, and the public site is delivered as static files only.

> [!NOTE]
> The Cloudflare edition is under development. See the [Cloud manual](docs/cloud_en.md) for current features and support status.

---

## Three Editions and Which to Choose

🍊mikanBox comes in three editions that differ in where they run and how they store data.

| | 📂 flat | 🗄️ SQLite | ☁️ Cloudflare (this repository) |
| :--- | :--- | :--- | :--- |
| Best for | Sites with few pages (up to about 100) | Sites that keep growing in page count | Sites you want to manage and publish on Cloudflare |
| Runs on | A PHP-enabled server, or your own computer | A PHP-enabled server, or your own computer | Cloudflare Workers |
| Storage | JSON files | SQLite (single DB file) | D1 (images can move to R2 as needed) |
| Requirements | PHP 8.0+ | PHP 8.0+ with the SQLite3 extension | A Cloudflare account and Node.js |
| Public site delivery | Dynamic, static, or mixed | Dynamic, static, or mixed | Static files only (no Worker or D1 runs when someone views a page) |
| Login | Password | Registered devices (no password) | Registered devices (no password) |

> [!TIP]
> **If you run it on your own computer and just upload a static site, flat (or the SQLite edition) is enough.** Manage the site locally, then place the exported HTML on a rental server, Cloudflare, or anywhere else — the public side needs neither PHP nor an admin screen.
> **Use the Cloudflare edition when you want to manage the site itself on Cloudflare.** You can reach the admin screen from anywhere and run both management and publishing without preparing a server. With D1, you can start within the free tier without registering a payment method (conditions and limits apply).

- [🍊mikanBox flat →](https://github.com/yoshihik0/mikanBox-flat/)
- [🍊mikanBox (SQLite edition) →](https://github.com/yoshihik0/mikanBox)

---

## Features

- **Everything on Cloudflare** — Run the admin screen, MCP, data (D1), and public site together on Cloudflare
- **Admin and public separated** — The public side is static files only, with no program or data, so viewing a page uses none of your Worker or D1 quota
- **Modeless UI** — No page transitions; nearly all work completed on a single screen for a snappy experience (developed to match the PHP editions)
- **Markdown Support** — Easy to edit content, and also well-suited as a content archive
- **Filter by Category** — Narrow down pages and images by category; use categories as workspaces
- **Images Shown by Filename Alone** — Place images without thinking about file paths
- **Component structure and scoped CSS** — Combinable page templates and parts, with CSS that doesn't interfere across components
- **Drop in AI-generated code as is** — Works without any manual design effort
- **AI Agent Integration (MCP)** — AI understands your site structure and design direction, and reads and writes files directly
- **DESIGN.md Management** — Manage your instructions to AI on the site and pass them along
- **DB Less DB** — Embed data in pages and serve it through an API; works as a headless CMS
- **Start images on D1, move to R2 later** — Begin with D1 alone, and move to R2 when you need more capacity
- **Backup and export** — JSON backup and restore, and static HTML ZIP export

---

## Requirements

- A Cloudflare account
- A GitHub account
- Node.js, npm, and a terminal

Cloudflare's screens, pricing, and free tiers may change. Using R2 requires registering a payment method with Cloudflare.

---

## Installation

You can ask an AI to install it, or run the commands yourself.

**Asking an AI**

Use an AI that can fetch files and run commands. Open a new conversation in a working folder and ask:

```
Please install https://github.com/yoshihik0/mikanBox-cloud on Cloudflare
```

The AI fetches the files, configures, and deploys. You authorize Cloudflare, choose the addresses, and register the first device in your usual browser.

**Doing it yourself**

1. Download **Source code (zip)** from the [releases](https://github.com/yoshihik0/mikanBox-cloud/releases) and extract it
2. In the extracted folder, run `npm ci` and `npx wrangler login`, and confirm the Cloudflare account you are installing to
3. Create the D1 database, prepare the configuration files, and deploy
4. Open the public site's address and register the first device

For the detailed commands and settings from step 2 onward, see [New installation and publication](docs/cloud_en.md#new-installation-and-publication). Never publish configuration files or secrets to GitHub.

There are no passwords. Only registered devices (browsers) can enter the admin screen. For adding devices and recovering after losing every device, see the [manual](docs/cloud_en.md#device-authentication).

---

## Updating

When updating an existing site, do not create a new D1 database or Worker. You can update by downloading, or by running GitHub Actions manually.

- [Update procedure](docs/cloud_en.md#manual-updates-v066-and-later)

---

## Basic Usage

### Page Publication Status

| Status | Behavior |
| :------- | :------- |
| Draft | Private (only signed-in editors can preview) |
| Pending | Private (only signed-in editors can preview) |
| Published | Static HTML is generated by the build and delivered as static files |
| DB | The page itself is private; its data is published as an API (`/api/pageID`) |

There is no per-page choice between static and dynamic. Pages you stop publishing are withdrawn from delivery at build time.

(Previews are generated dynamically, so building dynamic sites would be possible. For security and to keep the free tier easy to use, dynamic publishing is not offered at this stage.)

### Static Site Generation (Build)

The build button below the page list generates the published pages as static HTML and delivers them to the public side. Only changed files are sent.

### Images (D1 and R2)

You can start without R2, storing images in D1 (up to 400 MB in total and 10 MB per image). When you need more capacity, switch to R2 with "Migrate from D1 to R2" in the admin screen. In either case, the public URL is `/media/filename`.

Migrating to R2 requires registering a payment method with Cloudflare. The free tier is generous, but usage beyond it is billed, so please be careful.

---

## AI Integration

As in the PHP editions, you can paste AI-generated HTML pages as they are and publish them, and manage instructions to AI (such as DESIGN.md) as components.

- The admin MCP is at `/mcp` (requires a Cloud-specific API key). It reads and writes pages, components, and images.
- The public help MCP is at `/public-mcp` (no key needed, read-only).
- Human-readable Cloud help is at `/public-help.html?language=en`.

---

## Differences from the PHP Editions

The Cloudflare edition is developed to match the PHP editions' UI and operations, but some differences come from the runtime environment.

- Because no program runs on the public side, use Google site search if you need on-site search.
- Published pages are built static files only (there is no "Published (dynamic)").
- The external-fetch `EXT_MD` tag and video/audio uploads on D1 are not supported.
- SQLite files themselves cannot be imported or exported. Use the ZIP, WordPress XML, and CSV import tools to bring data in, and the Cloud-specific JSON for backup and restore (ZIP/XML imports do not bring in images, accounts, or site settings).

See the [Cloud manual](docs/cloud_en.md) for details.

---

## Documentation

- [Cloud manual (English)](docs/cloud_en.md)
- [Cloud マニュアル（日本語）](docs/cloud_ja.md)
- [Operation manual (shared)](https://yoshihiko.com/mikanbox/help_en.html)
