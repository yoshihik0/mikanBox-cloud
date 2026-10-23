CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS components (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  is_wrapper INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
  key          TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL DEFAULT 0,
  uploaded     TEXT NOT NULL,
  data         TEXT NOT NULL
);
