import type { Env, PageData } from './types';
import { isPublicStatus } from './storage';
export interface Revision { id: number; post_id: string; data: string; created_at: string; editor_id: string }
/** Entries kept per page. The trigger post_revisions_keep (migration 0020) removes older ones on every insert. */
export const REVISION_KEEP = 10;
export async function revisions(env: Env, id: string) {
  return (await env.DB.prepare('SELECT * FROM post_revisions WHERE post_id = ? ORDER BY id DESC LIMIT ?')
    .bind(id, REVISION_KEEP).all<Revision>()).results;
}
/** Keep the initial publication date even when a page is withdrawn. */
export function applyPageDates(data: PageData, previous: PageData | null): void {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const wasPublic = !!previous && (isPublicStatus(previous.status) || previous.status === 'db');
  data.updated_at ||= previous?.updated_at || now;
  const firstPublished = previous?.first_published_at || (wasPublic ? previous?.updated_at || now : '');
  if (firstPublished) data.first_published_at = firstPublished;
  else if (isPublicStatus(data.status)) data.first_published_at = data.updated_at = now;
}

export async function saveWithRevision(env: Env, id: string, oldId: string, data: PageData, editor: string, expected: string) {
  const current = oldId ? await env.DB.prepare('SELECT data FROM posts WHERE id = ?').bind(oldId).first<{data: string}>() : null;
  if (oldId && !current) throw new Error('Page no longer exists.');
  const previous: PageData | null = current ? JSON.parse(current.data) : null;
  if (previous && (previous.revision_tag || '') !== expected)
    throw new Error('他の更新があります。再読み込みしてください。 / Reload: this page has changed.');
  // The former "DB" status is stored as the output format "mikanBox DB" of a public page.
  if ((data.status as string) === 'db') { data.status = 'public_static'; data.output_format = 'db'; delete data.expand_tags; }
  if (['public', 'public_dynamic'].includes(data.status)) data.status = 'public_static';
  applyPageDates(data, previous);
  data.revision_tag = crypto.randomUUID();
  const args = [id, JSON.stringify(data), data.status, data.sort_order || 0, data.updated_at || ''];
  if (!current) {
    await env.DB.prepare('INSERT INTO posts (id,data,status,sort_order,updated_at) VALUES (?,?,?,?,?)').bind(...args).run();
    return;
  }
  const [_, updated] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO post_revisions (post_id,data,created_at,editor_id)
      SELECT ?, data, ?, ? FROM posts WHERE id = ? AND data = ?`)
      .bind(id, new Date().toISOString(), editor, oldId, current.data),
    env.DB.prepare('UPDATE posts SET id=?,data=?,status=?,sort_order=?,updated_at=? WHERE id=? AND data=?')
      .bind(...args, oldId, current.data),
    env.DB.prepare(`UPDATE post_revisions SET post_id = ? WHERE post_id = ?
      AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)` ).bind(id, oldId, id, args[1]),
    // Visual-editing history follows a renamed page.
    ...(id === oldId ? [] : [
      env.DB.prepare('UPDATE visual_history SET post_id = ? WHERE post_id = ? AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)').bind(id, oldId, id, args[1]),
      env.DB.prepare('UPDATE OR REPLACE visual_sessions SET post_id = ? WHERE post_id = ? AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)').bind(id, oldId, id, args[1])
    ])
  ]);
  if (!updated.meta.changes) throw new Error('Concurrent update detected.');
  // The change (and a change of the public state) is recorded by the database (migration 0027).
}
