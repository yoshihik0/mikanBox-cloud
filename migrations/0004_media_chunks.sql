ALTER TABLE media ADD COLUMN upload_id TEXT;
ALTER TABLE media ADD COLUMN etag TEXT;
ALTER TABLE media ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX media_upload_id ON media(upload_id);
CREATE TABLE media_chunks (
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(upload_id,chunk_index),
  FOREIGN KEY(upload_id) REFERENCES media(upload_id) ON DELETE CASCADE
);
CREATE TABLE media_usage (
  id INTEGER PRIMARY KEY CHECK(id=1),
  bytes INTEGER NOT NULL DEFAULT 0,
  files INTEGER NOT NULL DEFAULT 0
);
INSERT INTO media_usage(id,bytes,files) SELECT 1,COALESCE(SUM(size),0),COUNT(*) FROM media;
CREATE TRIGGER media_usage_add AFTER INSERT ON media BEGIN
  UPDATE media_usage SET bytes=bytes+NEW.size,files=files+1 WHERE id=1;
END;
CREATE TRIGGER media_usage_remove AFTER DELETE ON media BEGIN
  UPDATE media_usage SET bytes=bytes-OLD.size,files=files-1 WHERE id=1;
END;
CREATE TRIGGER media_usage_resize AFTER UPDATE OF size ON media BEGIN
  UPDATE media_usage SET bytes=bytes+NEW.size-OLD.size WHERE id=1;
END;
