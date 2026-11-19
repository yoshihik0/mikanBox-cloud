-- Media files live only on the public site (0.13.0). D1 keeps what each file is:
-- its name, type, size, the asset hash Cloudflare knows it by, and its pixel size.
-- Update only after a build has published every media file (the release notes say so).
ALTER TABLE media ADD COLUMN hash TEXT NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN width INTEGER;
ALTER TABLE media ADD COLUMN height INTEGER;
-- Where the bytes are on the public site when that is not /media/<key> (a renamed file until the next build).
ALTER TABLE media ADD COLUMN source TEXT;
UPDATE media SET hash=substr(etag,1,32) WHERE etag IS NOT NULL;
DROP TABLE IF EXISTS media_chunks;
DROP TABLE IF EXISTS backup_chunks;
DROP INDEX IF EXISTS media_upload_id;
ALTER TABLE media DROP COLUMN upload_id;
ALTER TABLE media DROP COLUMN chunk_count;
ALTER TABLE media DROP COLUMN data;
