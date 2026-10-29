CREATE TABLE IF NOT EXISTS backup_restore_results (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
