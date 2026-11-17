-- Media is kept in D1 only. The optional R2 storage and its migration are no longer used (0.12.0).
-- A site that still keeps media in R2 must not be updated: stop here, before the new code is deployed.
CREATE TABLE r2_removal_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO r2_removal_guard(ok)
 SELECT 0 WHERE EXISTS(SELECT 1 FROM media WHERE object_key IS NOT NULL)
  OR EXISTS(SELECT 1 FROM settings WHERE key='media_storage' AND value='r2');
DROP TABLE r2_removal_guard;

-- An unfinished migration to R2 is cancelled; D1 still holds every original.
DELETE FROM media_migrations;
DELETE FROM settings WHERE key IN ('media_storage','media_storage_lock');

-- The R2 column and tables (media.object_key, r2_objects, backup_parts, backup_images,
-- media_migration*, backup_sessions.target_store) stay for now. The update applies this file
-- before it deploys the new code, and the previous version still reads them; a later release
-- drops them, once no installed version does.
