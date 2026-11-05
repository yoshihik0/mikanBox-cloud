// Visual editing: reading and writing a page with its history.
//   undo / redo   the last UNDO_MAX states (table visual_history). Dropped when the editing session changes.
//   restore point ONE row in post_revisions per editing session: the state before the session's first save.
//                 A session is one opening of the screen (the browser's `sid`), so many small saves leave one point.
// Every write is one D1 batch that applies only while the page still holds the data it was read with,
// so a concurrent save from the admin screen or MCP is never overwritten.
import type { Env, PageData } from './types';

export const UNDO_MAX = 3;
export const POINTS_MAX = 10;

export class VisualError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface PageRow { raw: string; data: PageData; sid: string | null }
export interface Counts { undo: number; redo: number; points: number }

const SAME = 'EXISTS (SELECT 1 FROM posts WHERE id = ? AND data = ?)';
const validSid = (sid: string) => /^[A-Za-z0-9]{8,64}$/.test(sid);

/** An exact id (the renderer's `coffee` → `coffee/index` fallback would make saves go to a different row). */
export async function readPage(env: Env, id: string): Promise<PageRow | null> {
  const row = await env.DB.prepare('SELECT p.data AS data, s.sid AS sid FROM posts p LEFT JOIN visual_sessions s ON s.post_id = p.id WHERE p.id = ?')
    .bind(id).first<{ data: string; sid: string | null }>();
  if (!row) return null;
  try { return { raw: row.data, data: JSON.parse(row.data) as PageData, sid: row.sid }; } catch { return null; }
}

/** Cheap change detector for the screen's polling: no page body is read. */
export async function changeMark(env: Env, id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT json_extract(data, '$.revision_tag') AS tag, length(data) AS n, updated_at FROM posts WHERE id = ?")
    .bind(id).first<{ tag: string | null; n: number; updated_at: string }>();
  return row ? `${row.tag ?? ''}|${row.n}|${row.updated_at}` : '';
}

export async function counts(env: Env, id: string): Promise<Counts> {
  const row = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM visual_history WHERE post_id = ? AND kind = 'undo') AS undo,
    (SELECT COUNT(*) FROM visual_history WHERE post_id = ? AND kind = 'redo') AS redo,
    (SELECT COUNT(*) FROM (SELECT 1 FROM post_revisions WHERE post_id = ? LIMIT ${POINTS_MAX})) AS points`)
    .bind(id, id, id).first<Counts>();
  return { undo: row?.undo ?? 0, redo: row?.redo ?? 0, points: row?.points ?? 0 };
}

/** Newest first, like the admin screen's page history. */
export async function points(env: Env, id: string): Promise<Array<{ id: string; at: string }>> {
  const rows = await env.DB.prepare(`SELECT id, created_at FROM post_revisions WHERE post_id = ? ORDER BY id DESC LIMIT ${POINTS_MAX}`)
    .bind(id).all<{ id: number; created_at: string }>();
  return rows.results.map(r => ({ id: String(r.id), at: r.created_at.replace('T', ' ').replace(/\.\d+Z$|Z$/, '') }));   // "YYYY-MM-DD HH:MM:SS" (UTC), as the PHP editions show it
}

async function assertNotLocked(env: Env, id: string, editor: string) {
  const lock = await env.DB.prepare('SELECT owner FROM edit_locks WHERE post_id = ? AND expires_at > ?').bind(id, Date.now()).first<{ owner: string }>();
  if (lock && lock.owner !== editor) throw new VisualError(409, '他のユーザーが編集中です。 / Another user is editing this page.');
}

/**
 * Writes `next` over `cur`, keeping the state before it: an undo snapshot, and, when `sid` is a new
 * editing session, one restore point. `sid` is the browser's mark for this opening of the screen.
 */
export async function commit(env: Env, id: string, cur: PageRow, next: PageData, sid: string, editor: string): Promise<void> {
  await assertNotLocked(env, id, editor);
  if (!validSid(sid)) sid = 'none';
  const fresh = cur.sid !== sid;
  next.revision_tag = crypto.randomUUID();
  const guard = [id, cur.raw];
  const statements = [];
  if (fresh) {
    statements.push(
      env.DB.prepare(`INSERT INTO post_revisions (post_id, data, created_at, editor_id) SELECT ?, ?, ?, ? WHERE ${SAME}`)
        .bind(id, cur.raw, new Date().toISOString(), editor, ...guard),
      env.DB.prepare(`DELETE FROM visual_history WHERE post_id = ? AND kind = 'undo' AND ${SAME}`).bind(id, ...guard),
      env.DB.prepare(`INSERT OR REPLACE INTO visual_sessions (post_id, sid) SELECT ?, ? WHERE ${SAME}`).bind(id, sid, ...guard));
  }
  statements.push(
    env.DB.prepare(`INSERT INTO visual_history (post_id, kind, data) SELECT ?, 'undo', ? WHERE ${SAME}`).bind(id, cur.raw, ...guard),
    env.DB.prepare(`DELETE FROM visual_history WHERE post_id = ? AND kind = 'redo' AND ${SAME}`).bind(id, ...guard),
    env.DB.prepare(`DELETE FROM visual_history WHERE post_id = ? AND kind = 'undo' AND ${SAME}
      AND id NOT IN (SELECT id FROM visual_history WHERE post_id = ? AND kind = 'undo' ORDER BY id DESC LIMIT ${UNDO_MAX})`).bind(id, ...guard, id),
    updateStatement(env, id, cur.raw, next));
  const results = await env.DB.batch(statements);
  if (!results[results.length - 1].meta.changes) throw new VisualError(409, 'Concurrent update detected.');
}

function updateStatement(env: Env, id: string, oldRaw: string, next: PageData) {
  return env.DB.prepare('UPDATE posts SET data = ?, status = ?, sort_order = ?, updated_at = ? WHERE id = ? AND data = ?')
    .bind(JSON.stringify(next), next.status, next.sort_order || 0, next.updated_at || '', id, oldRaw);
}

/** 'undo' puts the current state on the redo stack and takes the newest undo snapshot, and the other way round for 'redo'. */
export async function move(env: Env, id: string, kind: 'undo' | 'redo', editor: string): Promise<boolean> {
  const cur = await readPage(env, id);
  const snap = await env.DB.prepare('SELECT id, data FROM visual_history WHERE post_id = ? AND kind = ? ORDER BY id DESC LIMIT 1')
    .bind(id, kind).first<{ id: number; data: string }>();
  if (!cur || !snap) return false;
  let data: PageData;
  try { data = JSON.parse(snap.data) as PageData; } catch { return false; }
  if (!data || typeof data !== 'object') return false;
  await assertNotLocked(env, id, editor);
  data.revision_tag = crypto.randomUUID();
  const guard = [id, cur.raw];
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO visual_history (post_id, kind, data) SELECT ?, ?, ? WHERE ${SAME}`).bind(id, kind === 'undo' ? 'redo' : 'undo', cur.raw, ...guard),
    env.DB.prepare(`DELETE FROM visual_history WHERE id = ? AND ${SAME}`).bind(snap.id, ...guard),
    updateStatement(env, id, cur.raw, data)]);
  if (!results[2].meta.changes) throw new VisualError(409, 'Concurrent update detected.');
  return true;
}

/** Back to a restore point. The status stays as it is now; the state before this can be brought back with undo. */
export async function restorePoint(env: Env, id: string, pointId: string, sid: string, editor: string): Promise<boolean> {
  if (!/^\d{1,15}$/.test(pointId)) return false;
  const cur = await readPage(env, id);
  const row = await env.DB.prepare('SELECT data FROM post_revisions WHERE id = ? AND post_id = ?').bind(Number(pointId), id).first<{ data: string }>();   // only this page's history
  if (!cur || !row) return false;
  let data: PageData;
  try { data = JSON.parse(row.data) as PageData; } catch { return false; }
  data.status = cur.data.status ?? data.status ?? 'draft';
  data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await commit(env, id, cur, data, sid, editor);
  return true;
}

/** A new page, always a draft. Fails (false) when the id is taken. */
export async function createPage(env: Env, id: string, data: PageData): Promise<boolean> {
  data.revision_tag = crypto.randomUUID();
  const r = await env.DB.prepare('INSERT INTO posts (id, data, status, sort_order, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(id, JSON.stringify(data), data.status, data.sort_order || 0, data.updated_at || '').run();
  return !!r.meta.changes;
}
