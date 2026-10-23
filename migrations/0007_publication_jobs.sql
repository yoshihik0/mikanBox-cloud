CREATE TABLE publication_jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL);
CREATE TABLE publication_entries(job_id TEXT NOT NULL,path TEXT NOT NULL,hash TEXT,size INTEGER,content_type TEXT,PRIMARY KEY(job_id,path),FOREIGN KEY(job_id) REFERENCES publication_jobs(id) ON DELETE CASCADE);
ALTER TABLE publication_entries ADD COLUMN source_version TEXT;
