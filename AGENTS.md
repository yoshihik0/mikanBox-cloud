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

- Guide the user through URL choices in short, plain language, one step at a
  time. Do not demand full URLs, Worker names, account subdomain, and migration
  details all at once. First ask whether to use a temporary `workers.dev` address
  or a custom domain. Briefly explain a custom domain needs Cloudflare setup and
  a temporary address can be changed later; give migration details only when
  relevant or requested. Discover the account's existing `workers.dev`
  subdomain and resources through available read-only tools instead of asking
  the user for information the AI can find. If a subdomain must be registered,
  ask the user to choose one and explain it must be available and is shared by
  the account's Workers. Explain that the subdomain is public and should not
  contain an email address, email username, login ID, or other private personal
  information. Never derive or suggest names from account or login details.
  Never change an existing subdomain without consent.
- Explain `workers.dev` URLs with a concrete example: for account subdomain B,
  management name A and public name C, management is
  `https://A.B.workers.dev/admin` and public is `https://C.B.workers.dev/`.
  A and C are separate Worker names; the account-wide B is shared. A custom
  domain can instead be connected to the public Worker. Ask the user to choose
  the names and derive both full URLs yourself. Illustrate the format with
  neutral examples, but do not recommend or proactively suggest names. Offer
  candidates only if the user asks, using no email usernames, login IDs,
  account names, or private personal details. Never treat an example as a choice.
- Before creating resources or deploying, show the two derived addresses and
  get the user's agreement unless they have already explicitly selected them.
  If they are undecided, wait for their choice; use any prior choices without
  re-asking. After deployment verify both addresses match. Do not suggest
  rerunning the public placeholder deployment on an existing site.
- Check the intended Cloudflare account and whether the selected names already
  exist; do not overwrite existing resources. Follow the installation guide in
  `docs/cloud_ja.md` or `docs/cloud_en.md`.
- Generate a unique cryptographically random `JWT_SECRET` and `SETUP_TOKEN`
  locally for each installation. Save them privately in the ignored
  `.env.production.secrets`; never print, commit, or share their values. Tell
  the user where to find the setup token for their first device registration.
  The setup token is separate from the Cloudflare API token used for publication.
