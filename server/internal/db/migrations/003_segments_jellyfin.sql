-- Intro and recap found from chapters, the audio of other episodes, or Jellyfin's media segments (seconds; 0 = none).
-- intro_state: 0 = not analysed, 1 = done, -1 = failed.
ALTER TABLE media_files ADD COLUMN intro_start REAL NOT NULL DEFAULT 0;
ALTER TABLE media_files ADD COLUMN intro_end REAL NOT NULL DEFAULT 0;
ALTER TABLE media_files ADD COLUMN recap_start REAL NOT NULL DEFAULT 0;
ALTER TABLE media_files ADD COLUMN recap_end REAL NOT NULL DEFAULT 0;
ALTER TABLE media_files ADD COLUMN intro_state INTEGER NOT NULL DEFAULT 0;

-- When a row last changed (unix ms), so the Jellyfin sync can tell which side changed.
ALTER TABLE user_data ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER user_data_touch AFTER UPDATE ON user_data WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE user_data SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE user_id = NEW.user_id AND item_id = NEW.item_id;
END;

-- Lumen item ↔ Jellyfin item, matched by file path.
CREATE TABLE jellyfin_items (
  item_id          INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  jf_id            TEXT NOT NULL,
  segments_checked INTEGER NOT NULL DEFAULT 0   -- unix time media segments were last fetched
);

-- Per user and item: when it was last synced and what Jellyfin had then.
CREATE TABLE jellyfin_sync (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  synced_at INTEGER NOT NULL,                    -- unix ms
  jf_state  TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
