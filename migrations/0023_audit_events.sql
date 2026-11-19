-- Recent operations (as in PHP's "Recent operations"): the newest 200 are kept, 50 are shown.
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  from_value TEXT NOT NULL DEFAULT '',
  to_value TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER audit_events_keep AFTER INSERT ON audit_events BEGIN
  DELETE FROM audit_events WHERE id <= NEW.id - 200;
END;
