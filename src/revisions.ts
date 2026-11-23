import type { Env, PageData } from './types';
import { isPublicStatus } from './storage';
import { normalizeLegacyPage } from './output-formats';
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

export async function saveWithRevision(env: Env, id: string, oldId: string, data: PageData, editor: string, expected: string, overwrite?: string, keepBackup = false) {
  const current = oldId ? await env.DB.prepare('SELECT data FROM posts WHERE id = ?').bind(oldId).first<{data: string}>() : null;
  if (oldId && !current) throw new Error('Page no longer exists.');
  const previous: PageData | null = current ? JSON.parse(current.data) : null;
  if (previous && (previous.revision_tag || '') !== expected)
    throw new Error('他の更新があります。再読み込みしてください。 / Reload: this page has changed.');
  // The former "DB" status is stored as the output format "mikanBox DB" of a public page.
  if ((data.status as string) === 'db') { data.status = 'public_static'; data.output_format = 'db'; delete data.expand_tags; }
  if (['public', 'public_dynamic'].includes(data.status)) data.status = 'public_static';
  const target: PageData | null = overwrite === undefined ? null : JSON.parse(overwrite);
  applyPageDates(data, previous ?? target);
  data.revision_tag = crypto.randomUUID();
  const args = [id, JSON.stringify(data), data.status, data.sort_order || 0, data.updated_at || ''];
  if (target !== null) {
    const sourceMatches = oldId ? ' AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)' : '';
    const sourceArgs = current ? [oldId, current.data] : [];
    const targetArgs = [id, overwrite, ...sourceArgs];
    const saved = 'EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)';
    const savedArgs = [id, args[1]];
    const now = new Date().toISOString();
    const draft: PageData = {
      ...normalizeLegacyPage(target), status: 'draft', revision_tag: crypto.randomUUID(), preview_token: crypto.randomUUID(),
    };
    const backups = keepBackup ? [env.DB.prepare(`
      WITH RECURSIVE suffixes(n, suffix) AS (
        VALUES (1, '-bk')
        UNION ALL SELECT n + 1, '-bk-' || (n + 1) FROM suffixes WHERE n < 10000
      ), candidates AS (
        SELECT rtrim(substr(?, 1, 200 - length(suffix)), '/') || suffix AS id FROM suffixes
      )
      INSERT INTO posts (id,data,status,sort_order,updated_at)
      SELECT coalesce((
        SELECT candidate.id FROM candidates AS candidate
        WHERE NOT EXISTS (SELECT 1 FROM posts WHERE id IN (candidate.id, candidate.id || '/index'))
        LIMIT 1
      ), ?), ?, 'draft', ?, ?
      WHERE ${saved}
      RETURNING id
    `).bind(id, id, JSON.stringify(draft), draft.sort_order || 0, draft.updated_at || '', ...savedArgs)] : [];
    // A missing backup ID falls back to the occupied destination and rolls back the batch.
    const [, updated, backup] = await env.DB.batch<{id: string}>([
      env.DB.prepare(`INSERT INTO post_revisions (post_id,data,created_at,editor_id)
        SELECT id,data,?,? FROM posts WHERE id = ? AND data = ?${sourceMatches}`).bind(now, editor, ...targetArgs),
      env.DB.prepare(`UPDATE posts SET id=?,data=?,status=?,sort_order=?,updated_at=?
        WHERE id = ? AND data = ?${sourceMatches}`).bind(...args, ...targetArgs),
      ...backups,
      env.DB.prepare(`DELETE FROM visual_history WHERE post_id = ? AND ${saved}`).bind(id, ...savedArgs),
      env.DB.prepare(`DELETE FROM visual_sessions WHERE post_id = ? AND ${saved}`).bind(id, ...savedArgs),
      ...(current ? [
        env.DB.prepare(`UPDATE post_revisions SET post_id = ? WHERE post_id = ? AND ${saved}`).bind(id, oldId, ...savedArgs),
        env.DB.prepare(`INSERT INTO post_revisions (post_id,data,created_at,editor_id)
          SELECT ?,data,?,? FROM posts WHERE id = ? AND ${saved}`).bind(id, now, editor, oldId, ...savedArgs),
        env.DB.prepare(`UPDATE visual_history SET post_id = ? WHERE post_id = ? AND ${saved}`).bind(id, oldId, ...savedArgs),
        env.DB.prepare(`UPDATE visual_sessions SET post_id = ? WHERE post_id = ? AND ${saved}`).bind(id, oldId, ...savedArgs),
        env.DB.prepare(`DELETE FROM posts WHERE id = ? AND ${saved}`).bind(oldId, ...savedArgs)
      ] : [])
    ]);
    if (!updated.meta.changes) throw new Error('Concurrent update detected.');
    return keepBackup ? backup.results[0]?.id : undefined;
  }
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
