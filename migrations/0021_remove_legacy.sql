-- Leftovers that no installed version reads any more (0.12.0 and later).
-- R2 media storage (removed in 0.12.0).
DROP TRIGGER IF EXISTS retain_replaced_r2_image;
DROP TRIGGER IF EXISTS retain_deleted_r2_image;
DROP INDEX IF EXISTS media_object_key;
ALTER TABLE media DROP COLUMN object_key;
DROP TABLE IF EXISTS backup_parts;
DROP TABLE IF EXISTS backup_images;
DROP TABLE IF EXISTS media_migration_guard;
DROP TABLE IF EXISTS media_migration_items;
DROP TABLE IF EXISTS media_migrations;
DROP TABLE IF EXISTS r2_objects;
ALTER TABLE backup_sessions DROP COLUMN target_store;
-- Passwords and recovery questions (devices replaced them in 0.6).
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users DROP COLUMN security_question;
ALTER TABLE users DROP COLUMN security_answer_hash;
-- Settings the Cloud edition no longer has: the site URL comes from PUBLIC_SITE_URL.
UPDATE settings SET value=json_remove(value,'$.password_hash','$.site_url','$.ssg_root_url','$.ssg_mode','$.ssg_output_dir') WHERE key='settings';
