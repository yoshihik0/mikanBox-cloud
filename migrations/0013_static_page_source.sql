-- Hash of the page source (posts.data) the HTML was built from. The admin page
-- list compares it with the current source to show pages changed since the build.
ALTER TABLE static_pages ADD COLUMN source_hash TEXT;
