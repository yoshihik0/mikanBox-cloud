// ==========================================
// mikanBox Authentication (JWT + CSRF + Password)
// ==========================================
// PHP版のセッション認証をCloudflare Workers向けJWT認証に置き換え
// パスワードはPBKDF2-SHA256でハッシュ化（PHPのbcryptは使用不可）
// 既存の$2y$形式ハッシュは初回セットアップとして扱う

const SESSION_COOKIE = 'admin_session';
const TOKEN_EXPIRY = 24 * 60 * 60; // 24時間

interface JwtPayload {
  sub: string;
  version: number;
  exp: number;
  csrf: string;
}

// ---- JWT ----

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64url(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padding);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function createSessionToken(secret: string, username: string, version: number): Promise<{ token: string; csrf: string }> {
  const csrf = base64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload: JwtPayload = {
    sub: username,
    version,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY,
    csrf,
  };
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).buffer);
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)).buffer);
  const signing = `${header}.${payloadB64}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signing));
  return { token: `${signing}.${base64url(sig)}`, csrf };
}

export async function verifySessionToken(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [header, payload, sig] = parts;
    const key = await getKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      base64urlDecode(sig),
      new TextEncoder().encode(`${header}.${payload}`)
    );
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as JwtPayload;
    if (!Number.isFinite(data.exp) || data.exp <= Math.floor(Date.now() / 1000)
        || typeof data.sub !== 'string' || !data.sub || typeof data.csrf !== 'string'
        || !Number.isInteger(data.version)) return null;
    return data;
  } catch { return null; }
}

export function getSessionCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TOKEN_EXPIRY}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export async function getAdminSession(request: Request, secret: string): Promise<JwtPayload | null> {
  const token = getSessionCookie(request);
  if (!token) return null;
  return verifySessionToken(token, secret);
}

// ---- Password (PBKDF2-SHA256) ----
// 保存形式: $pbkdf2-sha256$100000$<salt_b64>$<hash_b64>
// PHP bcrypt ($2y$) は初回セットアップとして扱う

export function isBcryptHash(hash: string): boolean {
  return hash.startsWith('$2y$') || hash.startsWith('$2b$') || hash.startsWith('$2a$');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const saltB64 = base64url(salt.buffer);
  const hashB64 = base64url(derived);
  return `$pbkdf2-sha256$100000$${saltB64}$${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || isBcryptHash(stored)) return false;
  if (!stored.startsWith('$pbkdf2-sha256$')) return false;
  try {
    const parts = stored.split('$');
    // ['', 'pbkdf2-sha256', '100000', saltB64, hashB64]
    if (parts.length !== 5) return false;
    const iterations = parseInt(parts[2], 10);
    const salt = new Uint8Array(base64urlDecode(parts[3]));
    const expected = base64urlDecode(parts[4]);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      256
    );
    // 定数時間比較
    const a = new Uint8Array(derived);
    const b = new Uint8Array(expected);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}

// ---- CSRF ----

export function verifyCsrf(formToken: string, sessionCsrf: string): boolean {
  if (!formToken || !sessionCsrf) return false;
  // 定数時間比較
  if (formToken.length !== sessionCsrf.length) return false;
  let diff = 0;
  for (let i = 0; i < formToken.length; i++) {
    diff |= formToken.charCodeAt(i) ^ sessionCsrf.charCodeAt(i);
  }
  return diff === 0;
}
