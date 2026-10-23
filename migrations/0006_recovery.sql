ALTER TABLE users ADD COLUMN security_question TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN security_answer_hash TEXT NOT NULL DEFAULT '';
