-- Hash of the built HTML, computed at build time so publication can skip
-- re-reading unchanged pages. NULL means unknown and is hashed by the browser.
ALTER TABLE static_pages ADD COLUMN hash TEXT;
