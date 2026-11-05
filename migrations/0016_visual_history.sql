-- Visual editing: undo/redo snapshots (a few per page) and the editing session each page was last saved in.
-- Restore points use post_revisions: one row per editing session, not one per save.
CREATE TABLE IF NOT EXISTS visual_history (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('undo', 'redo')),
  data    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visual_history_post ON visual_history(post_id, kind, id);
CREATE TABLE IF NOT EXISTS visual_sessions (
  post_id TEXT PRIMARY KEY,
  sid     TEXT NOT NULL
);
