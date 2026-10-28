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

## Installing for a user

- Before creating or deploying either Worker, ask the user which management URL
  (including `/admin`) and public site URL they want. If they have already chosen
  both, use those choices; otherwise wait for their answer. Never silently adopt
  names or URLs from the examples, repository name, or account defaults.
- Explain that a `workers.dev` URL combines the Worker name with the account's
  shared `workers.dev` subdomain. Ask whether to use that subdomain or a custom
  domain, and confirm any new or changed account subdomain before registering it.
  Changing it affects other Workers. Show both full intended URLs and the two
  distinct Worker names and confirm them before resource creation or deployment,
  unless the user has already explicitly chosen them. Verify the resulting URLs
  match the choices after deployment.
- Check the intended Cloudflare account and whether the selected names already
  exist; do not overwrite existing resources. Follow the installation guide in
  `docs/cloud_ja.md` or `docs/cloud_en.md`.
- Generate a unique cryptographically random `JWT_SECRET` and `SETUP_TOKEN`
  locally for each installation. Save them privately in the ignored
  `.env.production.secrets`; never print, commit, or share their values. Tell
  the user where to find the setup token for their first device registration.
  The setup token is separate from the Cloudflare API token used for publication.
