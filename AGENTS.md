# Cloudflare edition development

Follow the workspace root AGENTS.md, including its single-owner, no-branch
workflow and prompt GitHub publication. Existing pending changes are project
work: review, preserve, and include related completed changes rather than
publishing a partial snapshot.

- Develop Cloud alongside both PHP editions. Keep shared UI, wording, and
  interactions aligned, and update all affected editions in the same task.
- Edit shared CSS, browser JavaScript, and translations in `../shared/`; use
  `../shared/sync.sh` to synchronize shared files and manuals across editions.
- Keep Cloud-only behavior and installation guidance in both Cloud manuals.
  Verify differences from the PHP editions rather than assuming full parity.
- Do not add a Cloud site connection to the workspace root `.mcp.json`, and do
  not copy credentials, runtime configuration, database files, or user data.
- Use local D1/R2 for development tests. Check account identity and configured
  resources before remote operations. Deployment follows the user's current
  request and must never be reported as complete if authentication fails.
- `npm run check:protected` is an optional development-environment audit that
  requires the local baseline and adjacent repositories; do not rewrite the
  baseline to conceal changes. Normal standalone checks use `npm run check` and
  `npm test`.
