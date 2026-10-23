-- D1 starter storage remains available; optional R2 uses immutable object pointers.
ALTER TABLE media ADD COLUMN object_key TEXT;
CREATE UNIQUE INDEX media_object_key ON media(object_key);
CREATE TABLE r2_objects (
 object_key TEXT PRIMARY KEY,
 size INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE backup_parts (
 session_id TEXT NOT NULL REFERENCES backup_sessions(id) ON DELETE CASCADE,
 media_key TEXT NOT NULL,
 chunk_index INTEGER NOT NULL,
 object_key TEXT NOT NULL,
 size INTEGER NOT NULL,
 sha256 TEXT NOT NULL,
 PRIMARY KEY(session_id,media_key,chunk_index)
);
CREATE TABLE backup_images (
 session_id TEXT NOT NULL REFERENCES backup_sessions(id) ON DELETE CASCADE,
 media_key TEXT NOT NULL,
 object_key TEXT NOT NULL,
 size INTEGER NOT NULL,
 etag TEXT NOT NULL,
 PRIMARY KEY(session_id,media_key)
);

ALTER TABLE backup_sessions ADD COLUMN target_store TEXT NOT NULL DEFAULT 'd1';
CREATE TABLE media_migrations(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
CREATE TABLE media_migration_items(
 job_id TEXT NOT NULL REFERENCES media_migrations(id) ON DELETE CASCADE,
 media_key TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 object_key TEXT,etag TEXT,
 PRIMARY KEY(job_id,media_key)
);
CREATE TABLE media_migration_guard(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));

-- Start the retention period when a live pointer is removed, not at upload time.
CREATE TRIGGER retain_replaced_r2_image BEFORE UPDATE OF object_key ON media
WHEN OLD.object_key IS NOT NULL AND OLD.object_key IS NOT NEW.object_key
BEGIN UPDATE r2_objects SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE object_key=OLD.object_key; END;
CREATE TRIGGER retain_deleted_r2_image BEFORE DELETE ON media
WHEN OLD.object_key IS NOT NULL
BEGIN UPDATE r2_objects SET created_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE object_key=OLD.object_key; END;
