CREATE TABLE backup_sessions (
 id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 owner TEXT NOT NULL DEFAULT '',
 restore_users INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE backup_records (
 session_id TEXT NOT NULL REFERENCES backup_sessions(id) ON DELETE CASCADE,
 phase TEXT NOT NULL,
 kind TEXT NOT NULL,
 record_id TEXT NOT NULL,
 value TEXT NOT NULL,
 PRIMARY KEY(session_id,phase,kind,record_id)
);
CREATE TABLE backup_chunks (
 session_id TEXT NOT NULL REFERENCES backup_sessions(id) ON DELETE CASCADE,
 media_key TEXT NOT NULL,
 chunk_index INTEGER NOT NULL,
 data BLOB NOT NULL,
 PRIMARY KEY(session_id,media_key,chunk_index)
);
CREATE TABLE backup_commit_guard (
 session_id TEXT PRIMARY KEY,
 valid INTEGER NOT NULL CHECK(valid=1)
);
