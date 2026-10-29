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

- Guide installation in short steps, using ordinary language and line breaks.
  First ask whether the public site will use a custom domain. Briefly explain
  that using one now requires Cloudflare domain setup and that it can be added
  later. Offer "Use a custom domain" and "Do not use one (or set it up later)".
  Do not ask again if the
  user has already chosen. If using a custom domain, guide them through using
  an existing domain or obtaining one and connecting it to Cloudflare; do not
  imply that all existing domains must be purchased or transferred. Ask for
  the intended public domain and check the zone and connection.
- Then explain the management and public addresses on separate lines. If the
  public site uses `workers.dev`, use this form:

  Management: `https://[management name].[subdomain].workers.dev/admin`

  Public: `https://[public name].[subdomain].workers.dev/`

  Ask for the subdomain if one must be newly registered, the management name,
  and the public name. The two site names must differ. When a custom public
  domain is selected, show that domain as the public address instead and do
  not ask the user for a public `workers.dev` address or public site name.
  Determine any internal public Worker name yourself, check it does not collide
  with an existing resource, and do not expose private personal information.
- Discover an existing `workers.dev` account subdomain and resources through
  available read-only tools and show what was found instead of asking for it
  again. A newly registered subdomain must be available and is shared by the
  account's Workers. Explain that it appears publicly; do not use an email
  username, login ID, account name, or other private personal information.
  Never infer or suggest names from login or account details, and never change
  an existing subdomain without consent. Explain the user may choose the names
  without proactively recommending names; provide examples only to explain the
  format, or candidates if specifically asked. Never adopt examples silently.
- When the client supports an input form, request all names needed for this
  step together in one form: management name and, only for a `workers.dev`
  public site, public name; include the account subdomain only if it is not
  registered. Show a known subdomain as context, not an input to change it.
  Use separate labeled short-text fields, one per value, without multiple
  sequential screens where the client supports grouping. Show the two address
  formats in readable text before the form. For a custom domain, request only
  relevant values and do not ask for a public `workers.dev` name. If the client
  cannot provide such fields, use a short, clearly formatted text request.
- Do not ask the user to choose "Worker names" or use technical jargon unless
  asked. Preserve line breaks in the user-facing message; do not put the entire
  explanation into a single question field. Handle configuration details yourself.
- Before creating resources or deploying, show the two derived addresses and
  get the user's agreement unless they have already explicitly selected them.
  If they are undecided, wait for their choice; use any prior choices without
  re-asking. After deployment verify both addresses match. Do not suggest
  rerunning the public placeholder deployment on an existing site.
- Check the intended Cloudflare account and whether the selected names already
  exist; do not overwrite existing resources. Follow the installation guide in
  `docs/cloud_ja.md` or `docs/cloud_en.md`; the detailed commands and
  configuration steps are in `docs/install-reference_ja.md` (the English manual
  still carries them inline).
- Generate a unique cryptographically random `JWT_SECRET` and `SETUP_TOKEN`
  locally for each installation. Save them privately in the ignored
  `.env.production.secrets`; never print, commit, or share their values. Tell
  the user where to find the setup token for their first device registration.
  The setup token is separate from the Cloudflare API token used for publication.

- Initial setup registers the browser that submits the one-use setup token as
  the first management device. Do not consume that token or complete initial
  registration in the AI's embedded, temporary, automation, or other browser
  unless the user explicitly wants that browser registered. Direct them to open
  the management URL in their usual browser and enter the setup token themselves. Explain where the local secret file is without showing
  or requesting the token. Viewing the setup page without submitting is fine.
  If another browser was already registered, guide the user to add their normal
  browser using a device-add code from Site → Devices and users; recovery is
  reserved for losing all registered devices and revokes other devices and keys.

- After deploying and checking the management setup page, give a concise handoff:
  link to the local `.env.production.secrets` file so the user can copy the
  setup token, and provide the management URL with instructions to open it in
  their own usual browser and enter the token. Do not ask them to paste the
  token into chat. Do not open or register an embedded browser by default.
  Avoid repeating the public API token and build instructions in this initial
  handoff; the management screen guides the user through them. If the user
  asks, or if an actual failure prevents setup, explain the current public
  deployment separately and distinguish configured URL from published content.
