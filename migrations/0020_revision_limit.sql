-- Page history keeps the newest 10 entries of each page (REVISION_KEEP in src/revisions.ts, as in the SQLite edition).
DELETE FROM post_revisions WHERE id NOT IN (
 SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY id DESC) AS position FROM post_revisions) WHERE position<=10
);
CREATE TRIGGER post_revisions_keep AFTER INSERT ON post_revisions BEGIN
 DELETE FROM post_revisions WHERE post_id=NEW.post_id
  AND id NOT IN (SELECT id FROM post_revisions WHERE post_id=NEW.post_id ORDER BY id DESC LIMIT 10);
END;
