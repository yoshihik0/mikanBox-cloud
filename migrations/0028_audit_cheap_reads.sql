-- 0.17.0: the history costs far fewer D1 reads (Cloudflare Free allows 5,000,000 rows read per day).
-- Before, every record scanned the whole audit_events table twice: the trigger that keeps the newest
-- records counted every row of its group, and the "before" lookup of a changed item scanned the table
-- for the item's last record (about 1,200 rows read for one page save).
-- 1) The lookup uses an index on (target,id): a few rows.
CREATE INDEX IF NOT EXISTS audit_events_target ON audit_events(target,id);
-- 2) Old records are removed once in 50 records (the id is a multiple of 50), all three groups at once,
--    instead of on every record. The table may hold a few dozen more than the limits between two
--    removals; the site screen shows exactly the newest 50 / 500 / 50 of the groups.
DROP TRIGGER IF EXISTS audit_events_keep;
CREATE TRIGGER audit_events_keep AFTER INSERT ON audit_events WHEN NEW.id % 50 = 0 BEGIN
  DELETE FROM audit_events WHERE id IN (
    SELECT id FROM audit_events WHERE event<>'login_failed' AND event NOT IN ('page_status','page_created','page_updated','page_deleted','component_created','component_updated','component_deleted','media_uploaded','media_changed','media_deleted','settings_changed','data_imported')
    ORDER BY id DESC LIMIT -1 OFFSET 50);
  DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE event='login_failed' ORDER BY id DESC LIMIT -1 OFFSET 50);
  DELETE FROM audit_events WHERE id IN (
    SELECT id FROM audit_events WHERE event IN ('page_status','page_created','page_updated','page_deleted','component_created','component_updated','component_deleted','media_uploaded','media_changed','media_deleted','settings_changed','data_imported')
    ORDER BY id DESC LIMIT -1 OFFSET 500);
END;
