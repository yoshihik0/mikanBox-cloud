-- Recent operations: keep only the newest 50, the same number the site screen shows.
DROP TRIGGER IF EXISTS audit_events_keep;
DELETE FROM audit_events WHERE id <= (SELECT MAX(id) FROM audit_events) - 50;
CREATE TRIGGER audit_events_keep AFTER INSERT ON audit_events BEGIN
  DELETE FROM audit_events WHERE id <= NEW.id - 50;
END;
