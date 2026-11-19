-- 0.14.0: the data tool reads files in parts (src/data-transfer.ts); the staging tables of the
-- former JSON backup restore are no longer used.
DROP TABLE IF EXISTS backup_commit_guard;
DROP TABLE IF EXISTS backup_records;
DROP TABLE IF EXISTS backup_restore_results;
DROP TABLE IF EXISTS backup_sessions;
