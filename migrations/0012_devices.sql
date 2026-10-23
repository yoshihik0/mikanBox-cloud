-- Device authentication replaces passwords in the Cloud edition.
CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  seen_until INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE TABLE device_codes (
  code_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
