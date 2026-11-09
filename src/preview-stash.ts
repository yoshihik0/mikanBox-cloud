import type { Env } from './types';

// The page editor's Preview shows the content being edited, saved or not (PHP 2.19.0). The editor
// sends its form fields here (POST preview_stash); the preview tab then opens a plain GET address
// with the returned token. Nothing is saved to the page. A stash lives 30 minutes, belongs to the
// user who made it, and each user keeps at most four.
const LIFETIME_MS = 30 * 60 * 1000;
const PER_USER = 4;
const MAX_BYTES = 1_500_000;

/** Keep the submitted fields as text pairs (files and the like are not part of a preview). */
export async function stashPreview(env: Env, username: string, form: FormData): Promise<string> {
  const fields: Array<[string, string]> = [];
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string' || ['csrf_token', 'save_action', 'ajax_request'].includes(key)) continue;
    fields.push([key, value]);
  }
  const data = JSON.stringify(fields);
  if (new TextEncoder().encode(data).byteLength > MAX_BYTES) throw new Error('The content is too large to preview.');
  const token = crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM preview_stash WHERE created_at<?').bind(now - LIFETIME_MS),
    env.DB.prepare('INSERT INTO preview_stash(token,username,data,created_at) VALUES(?,?,?,?)').bind(token, username, data, now),
    env.DB.prepare('DELETE FROM preview_stash WHERE username=? AND token NOT IN (SELECT token FROM preview_stash WHERE username=? ORDER BY created_at DESC LIMIT ?)').bind(username, username, PER_USER),
  ]);
  return token;
}

/** The stashed fields as a form, or null when the token is unknown, expired or someone else's. */
export async function loadStashedForm(env: Env, username: string, token: string): Promise<FormData | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const row = await env.DB.prepare('SELECT data FROM preview_stash WHERE token=? AND username=? AND created_at>=?').bind(token, username, Date.now() - LIFETIME_MS).first<{ data: string }>();
  if (!row) return null;
  const form = new FormData();
  for (const [key, value] of JSON.parse(row.data) as Array<[string, string]>) form.append(key, value);
  return form;
}
