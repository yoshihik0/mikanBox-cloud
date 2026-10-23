import type { Env, PageData } from './types';
export interface Revision { id: number; post_id: string; data: string; created_at: string; editor_id: string }
export async function revisions(env: Env, id: string) {
  return (await env.DB.prepare('SELECT * FROM post_revisions WHERE post_id = ? ORDER BY id DESC LIMIT 50')
    .bind(id).all<Revision>()).results;
}
export async function saveWithRevision(env: Env, id: string, oldId: string, data: PageData, editor: string, expected: string) {
  const current = oldId ? await env.DB.prepare('SELECT data FROM posts WHERE id = ?').bind(oldId).first<{data: string}>() : null;
  if (oldId && !current) throw new Error('Page no longer exists.');
  if (current && (JSON.parse(current.data).revision_tag || '') !== expected)
    throw new Error('他の更新があります。再読み込みしてください。 / Reload: this page has changed.');
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
      AND EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)` ).bind(id, oldId, id, args[1])
  ]);
  if (!updated.meta.changes) throw new Error('Concurrent update detected.');
}
