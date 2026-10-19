CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  subject       TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  avatar        TEXT NOT NULL DEFAULT '',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  max_bitrate   INTEGER NOT NULL DEFAULT 0,          -- kbps, 0 = unlimited
  library_ids   TEXT,                                 -- JSON array, NULL = all libraries
  audio_lang    TEXT NOT NULL DEFAULT '',
  subtitle_lang TEXT NOT NULL DEFAULT '',
  subtitle_mode TEXT NOT NULL DEFAULT 'auto',         -- auto | always | off
  created_at    INTEGER NOT NULL,
  last_login    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  id_token    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE libraries (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('movies','tv')),
  paths      TEXT NOT NULL,                           -- JSON array
  created_at INTEGER NOT NULL,
  last_scan  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id              INTEGER PRIMARY KEY,
  library_id      INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('movie','series','season','episode')),
  parent_id       INTEGER REFERENCES items(id) ON DELETE CASCADE,
  series_id       INTEGER REFERENCES items(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  sort_title      TEXT NOT NULL,
  original_title  TEXT NOT NULL DEFAULT '',
  year            INTEGER NOT NULL DEFAULT 0,
  overview        TEXT NOT NULL DEFAULT '',
  tagline         TEXT NOT NULL DEFAULT '',
  genres          TEXT NOT NULL DEFAULT '[]',
  rating          REAL NOT NULL DEFAULT 0,
  content_rating  TEXT NOT NULL DEFAULT '',
  runtime         INTEGER NOT NULL DEFAULT 0,         -- minutes
  premiere_date   TEXT NOT NULL DEFAULT '',
  season_number   INTEGER,
  episode_number  INTEGER,
  episode_end     INTEGER,
  tmdb_id         INTEGER NOT NULL DEFAULT 0,
  imdb_id         TEXT NOT NULL DEFAULT '',
  poster          TEXT NOT NULL DEFAULT '',
  backdrop        TEXT NOT NULL DEFAULT '',
  logo            TEXT NOT NULL DEFAULT '',
  still           TEXT NOT NULL DEFAULT '',
  folder          TEXT NOT NULL DEFAULT '',           -- series/season/movie folder
  date_added      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  metadata_state  TEXT NOT NULL DEFAULT 'pending',    -- pending | ok | missing | locked
  people          TEXT NOT NULL DEFAULT '[]'          -- JSON [{name,character,profile}]
);
CREATE INDEX items_library_type ON items(library_id, type);
CREATE INDEX items_parent ON items(parent_id);
CREATE INDEX items_series ON items(series_id);
CREATE INDEX items_added ON items(date_added DESC);
CREATE UNIQUE INDEX items_folder_unique ON items(library_id, type, folder) WHERE type IN ('series','season') ;

CREATE TABLE media_files (
  id           INTEGER PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  path         TEXT NOT NULL UNIQUE,
  size         INTEGER NOT NULL,
  mtime        INTEGER NOT NULL,
  container    TEXT NOT NULL DEFAULT '',
  duration     REAL NOT NULL DEFAULT 0,               -- seconds
  bitrate      INTEGER NOT NULL DEFAULT 0,            -- bits per second
  width        INTEGER NOT NULL DEFAULT 0,
  height       INTEGER NOT NULL DEFAULT 0,
  video_codec  TEXT NOT NULL DEFAULT '',
  video_profile TEXT NOT NULL DEFAULT '',
  pix_fmt      TEXT NOT NULL DEFAULT '',
  hdr          TEXT NOT NULL DEFAULT '',              -- '', hdr10, hlg, dovi
  streams      TEXT NOT NULL DEFAULT '[]',            -- JSON audio/subtitle streams
  sidecars     TEXT NOT NULL DEFAULT '[]',            -- JSON external subtitles
  chapters     TEXT NOT NULL DEFAULT '[]',
  trickplay    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX media_files_item ON media_files(item_id);

CREATE TABLE user_data (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position    REAL NOT NULL DEFAULT 0,
  played      INTEGER NOT NULL DEFAULT 0,
  play_count  INTEGER NOT NULL DEFAULT 0,
  favorite    INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER NOT NULL DEFAULT 0,
  audio_index INTEGER,
  subtitle_index INTEGER,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX user_data_recent ON user_data(user_id, last_played DESC);

CREATE VIRTUAL TABLE items_fts USING fts5(title, original_title, people, tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
