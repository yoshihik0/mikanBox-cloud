CREATE TABLE users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE post_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  editor_id TEXT NOT NULL
);
CREATE INDEX revisions_post ON post_revisions(post_id, id DESC);
CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE edit_locks (
  post_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
