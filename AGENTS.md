The user explicitly authorized optional D1-to-R2 image migration and usage displays
on 2026-10-08. This task may edit Cloud storage/runtime/admin/tests/configuration
and both canonical root manuals; run shared/sync.sh for manual copies only.
No remote R2 subscription, resource creation or migration is authorized here.
Keep the original baseline and record reviewed manual hashes separately in
`.baseline/authorized-r2-storage.json`.

# Cloudflare edition development

The user explicitly authorized media operation/UI parity and existing-image
WebP conversion with reference updates, SQLite-shaped Cloud data import/export,
and shared settings/category layout corrections on 2026-10-07. This task may
edit shared/PHP/Cloud media handlers, shared CSS/translations/templates, Cloud
import and settings UI/modules, tests and bilingual manuals; run shared/sync.sh.
Record reviewed changes in `.baseline/authorized-media-interface.json`.

The user explicitly authorized common tracking settings, page exclusions, a
None wrapper, missing head metadata completion and PHP/Cloud page editor layout
parity on 2026-10-07. This task may edit shared/PHP/Cloud renderers, editor and
settings templates, edition save handlers, MCP schemas, tests, shared CSS and
translations, initial content and bilingual manuals; run shared/sync.sh and
Cloud default-content synchronization. Record reviewed changes in
`.baseline/authorized-common-head.json` without replacing earlier baselines.

The user explicitly authorized JavaScript editor help text and example ordering
parity across all editions on 2026-10-07. This task may edit shared translations,
PHP/Cloud editor templates, bilingual manuals and run `../shared/sync.sh`.
Record reviewed shared changes in `.baseline/authorized-js-editor-help.json`.

The user explicitly authorized CSS insertion parity across all editions on
2026-10-07. This task may edit shared/PHP/Cloud renderers, regression tests,
canonical and copied manuals, and the planned PHP patch version, and run
`../shared/sync.sh`. Preserve the original protected baseline and record these
reviewed changes in `.baseline/authorized-css-placement.json`.

The user explicitly authorized a common settings UI correction on 2026-10-04
across shared, flat, SQLite and Cloud. That task may edit the common settings and
SSG templates, their CSS/translations, site identity URL fallback, corresponding
manuals and patch version. Preserve the original protected baseline and record
the reviewed changes in a separate authorization ledger. Other PHP/shared work
remains outside the Cloud-only task scope described below.

- For this task, write only inside this directory. Treat both PHP editions,
  `../shared/`, the root manuals, and root configuration as read-only.
- Do not run `../shared/sync.sh`: it overwrites files in both PHP repositories.
- Shared browser assets and translations are read-only source inputs. Use
  `npm run sync:assets` to copy them INTO this edition only.
- Do not add a Cloud site connection to the workspace `.mcp.json`.
- Do not copy old credentials, runtime configuration, database files, or user data.
- Target the SQLite edition's UI and features. Track remaining differences in
  `docs/cloud_ja.md` and `docs/cloud_en.md`; do not claim full parity before verified.
- Record the untouched PHP/shared baseline locally and run
  `node scripts/verify-protected.mjs` after changes. Never update the baseline to
  hide an unintended change.
- Use local D1/R2 during development. Remote resource creation and deployment are
  separate operations and require the user's request.
