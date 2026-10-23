import type { Env } from './types';
import { getAdminSession, hashPassword } from './auth';

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
export async function authenticatedUser(request: Request, env: Env) {
  const session = await getAdminSession(request, env.JWT_SECRET);
  if (!session) return null;
  const user = await getUser(env, session.sub);
  return user && user.auth_version === session.version ? { user, session } : null;
}
export function validateUser(username: string, displayName: string, password: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(username) || !displayName.trim() || displayName.length > 120)
    throw new Error('ユーザー名・表示名を確認してください。 / Check username and display name.');
  if (password.length < 8 || password.length > 256)
    throw new Error('パスワードは8〜256文字にしてください。 / Use 8–256 characters for the password.');
}
export async function addUser(env: Env, username: string, displayName: string, password: string, initial = false) {
  validateUser(username, displayName, password);
  const hash = await hashPassword(password);
  // A new generation prevents sessions from a deleted account being reused.
  const random = crypto.getRandomValues(new Uint32Array(2));
  const generation = 2 + random[0] * 1048576 + (random[1] & 1048575);
  const statement = initial
    ? env.DB.prepare('INSERT INTO users (username, display_name, password_hash, auth_version) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)')
    : env.DB.prepare('INSERT INTO users (username, display_name, password_hash, auth_version) VALUES (?, ?, ?, ?)');
  const result = await statement.bind(username, displayName.trim(), hash, generation).run();
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
