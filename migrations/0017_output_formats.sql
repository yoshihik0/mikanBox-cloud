-- Output formats (mikanBox 2.17.0–2.18.1). A built page records the file it publishes
-- (/id.html, /id.md, /id.json, /api/id.json, ...); NULL means the HTML path. HTML + Markdown
-- pages also keep their Markdown version, published at /id.md.
ALTER TABLE static_pages ADD COLUMN path TEXT;
ALTER TABLE static_pages ADD COLUMN md TEXT;
ALTER TABLE static_pages ADD COLUMN md_hash TEXT;
-- The former "DB" status is the output format "mikanBox DB" of a public page.
UPDATE posts SET status='public_static',data=json_set(json_remove(data,'$.expand_tags'),'$.status','public_static','$.output_format','db') WHERE status='db';
