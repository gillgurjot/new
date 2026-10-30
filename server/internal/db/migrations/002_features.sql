-- Per-user permissions for downloading original files and requesting titles through Seerr.
ALTER TABLE users ADD COLUMN can_download INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN can_request INTEGER NOT NULL DEFAULT 1;

-- End credits found by analysing the file (seconds; 0 = none). state: 0 = not analysed, 1 = done, -1 = failed.
ALTER TABLE media_files ADD COLUMN credits_start REAL NOT NULL DEFAULT 0;
ALTER TABLE media_files ADD COLUMN credits_end REAL NOT NULL DEFAULT 0;
ALTER TABLE media_files ADD COLUMN credits_state INTEGER NOT NULL DEFAULT 0;
