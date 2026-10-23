import type { Env } from './types';
import { deviceSession } from './devices';

export interface User {
  username: string;
  display_name: string;
  password_hash: string;
  auth_version: number;
}
export async function getUser(env: Env, username: string): Promise<User | null> {
  return env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
}
export async function listUsers(env: Env): Promise<User[]> {
  return (await env.DB.prepare('SELECT * FROM users ORDER BY username').all<User>()).results;
}
// Sessions belong to devices (see devices.ts). A deleted user's devices stop working
// because the session lookup joins users.
export async function authenticatedUser(request: Request, env: Env) {
  const session = await deviceSession(request, env);
  if (!session) return null;
  const user = await getUser(env, session.device.username);
  return user ? { user, session: { csrf: session.csrf }, device: session.device } : null;
}
export function validateUser(username: string, displayName: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(username) || !displayName.trim() || displayName.length > 120)
    throw new Error('ユーザー名・表示名を確認してください。 / Check username and display name.');
}
/** The first user only. Later users join through invite codes. */
export async function addInitialUser(env: Env, username: string, displayName: string) {
  validateUser(username, displayName);
  const result = await env.DB.prepare("INSERT INTO users (username, display_name, password_hash, auth_version) SELECT ?, ?, '', 1 WHERE NOT EXISTS (SELECT 1 FROM users)")
    .bind(username, displayName.trim()).run();
  if (!result.meta.changes) throw new Error('初期設定済みです。 / Setup is already complete.');
}
export async function rateLimit(env: Env, key: string, failed = false) {
  const now = Math.floor(Date.now() / 1000);
  if (failed) {
    await env.DB.prepare(`INSERT INTO login_attempts (id, failures, locked_until) VALUES (?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET failures = CASE WHEN locked_until <= ? THEN 1 ELSE failures + 1 END,
      locked_until = ?`).bind(key, now + 900, now, now + 900).run();
  }
  const row = await env.DB.prepare('SELECT failures, locked_until FROM login_attempts WHERE id = ?')
    .bind(key).first<{ failures: number; locked_until: number }>();
  return !!row && row.failures >= 5 && row.locked_until > now;
}
