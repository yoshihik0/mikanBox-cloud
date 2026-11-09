-- The page editor's Preview shows what is being edited, saved or not (PHP 2.19.0): the form's
-- fields are held here for a short time and rendered by GET /admin?page_preview=ID&stash=TOKEN.
-- Nothing is saved to the page. Rows expire after 30 minutes; each user keeps at most four.
CREATE TABLE preview_stash (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX preview_stash_user ON preview_stash(username, created_at);
