package store

import (
	"database/sql"
	"errors"
)

// ---- intros ----

// SeasonNeedingIntro returns the episode files of a season that has files whose intro
// hasn't been looked for, in episode order.
func (s *Store) SeasonNeedingIntro() ([]*MediaFile, error) {
	var season int64
	err := s.DB.QueryRow(`SELECT i.parent_id FROM media_files m JOIN items i ON i.id=m.item_id
		WHERE m.intro_state=0 AND i.type='episode' AND i.parent_id IS NOT NULL AND m.duration > 300
		ORDER BY m.id DESC LIMIT 1`).Scan(&season)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(mediaCols+` WHERE item_id IN (SELECT id FROM items WHERE parent_id=? AND type='episode') AND duration > 300
		ORDER BY (SELECT episode_number FROM items WHERE id=item_id), id`, season)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*MediaFile
	for rows.Next() {
		m, err := scanMediaFile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// IntroState returns whether a file's intro has been looked for.
func (s *Store) IntroState(fileID int64) int {
	var st int
	_ = s.DB.QueryRow(`SELECT intro_state FROM media_files WHERE id=?`, fileID).Scan(&st)
	return st
}

// SetIntro stores the intro found from chapters or audio; state 1 = done, -1 = failed.
func (s *Store) SetIntro(fileID int64, start, end float64, state int) {
	_, _ = s.DB.Exec(`UPDATE media_files SET intro_start=?, intro_end=?, intro_state=? WHERE id=?`, start, end, state, fileID)
}

// Segments are intro, recap and credits times from another server (0, 0 = keep what we have).
type Segments struct {
	IntroStart, IntroEnd     float64
	RecapStart, RecapEnd     float64
	CreditsStart, CreditsEnd float64
}

// ApplySegments overwrites whatever Lumen found itself with the segments given.
func (s *Store) ApplySegments(fileID int64, g Segments) {
	if g.IntroEnd > g.IntroStart {
		_, _ = s.DB.Exec(`UPDATE media_files SET intro_start=?, intro_end=?, intro_state=1 WHERE id=?`, g.IntroStart, g.IntroEnd, fileID)
	}
	if g.RecapEnd > g.RecapStart {
		_, _ = s.DB.Exec(`UPDATE media_files SET recap_start=?, recap_end=? WHERE id=?`, g.RecapStart, g.RecapEnd, fileID)
	}
	if g.CreditsEnd > g.CreditsStart {
		_, _ = s.DB.Exec(`UPDATE media_files SET credits_start=?, credits_end=?, credits_state=1 WHERE id=?`, g.CreditsStart, g.CreditsEnd, fileID)
	}
}

// ---- Jellyfin ----

// FileRef is a movie or episode file, for matching against another server's paths.
type FileRef struct {
	FileID int64
	ItemID int64
	Path   string
}

func (s *Store) PlayableFiles() ([]FileRef, error) {
	rows, err := s.DB.Query(`SELECT m.id, m.item_id, m.path FROM media_files m JOIN items i ON i.id=m.item_id WHERE i.type IN ('movie','episode') ORDER BY m.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileRef
	for rows.Next() {
		var f FileRef
		if rows.Scan(&f.FileID, &f.ItemID, &f.Path) == nil {
			out = append(out, f)
		}
	}
	return out, rows.Err()
}

// LinkJellyfin records which Jellyfin item a Lumen item is. A changed id clears the
// segment check so the new item's segments are fetched.
func (s *Store) LinkJellyfin(itemID int64, jfID string) {
	_, _ = s.DB.Exec(`INSERT INTO jellyfin_items(item_id, jf_id) VALUES (?,?)
		ON CONFLICT(item_id) DO UPDATE SET jf_id=excluded.jf_id,
		  segments_checked=CASE WHEN jellyfin_items.jf_id=excluded.jf_id THEN jellyfin_items.segments_checked ELSE 0 END`, itemID, jfID)
}

// JellyfinLinkCount is how many Lumen items are matched to Jellyfin items.
func (s *Store) JellyfinLinkCount() int {
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM jellyfin_items`).Scan(&n)
	return n
}

type SegmentCheck struct {
	ItemID int64
	FileID int64
	JFID   string
}

// ItemsNeedingSegments lists linked items never checked, or checked before `before`
// without an intro (Intro Skipper may have analysed them since).
func (s *Store) ItemsNeedingSegments(before int64, limit int) ([]SegmentCheck, error) {
	rows, err := s.DB.Query(`SELECT j.item_id, m.id, j.jf_id FROM jellyfin_items j JOIN media_files m ON m.item_id=j.item_id
		WHERE j.segments_checked=0 OR (j.segments_checked < ? AND m.intro_end=0)
		ORDER BY j.segments_checked, j.item_id LIMIT ?`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SegmentCheck
	for rows.Next() {
		var c SegmentCheck
		if rows.Scan(&c.ItemID, &c.FileID, &c.JFID) == nil {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

func (s *Store) MarkSegmentsChecked(itemID int64) {
	_, _ = s.DB.Exec(`UPDATE jellyfin_items SET segments_checked=? WHERE item_id=?`, now(), itemID)
}

// UDRow is a user_data row as the sync sees it.
type UDRow struct {
	Position   float64
	Played     bool
	PlayCount  int
	Favorite   bool
	LastPlayed int64 // unix seconds
	UpdatedAt  int64 // unix ms
}

func (s *Store) UserDataRows(userID int64) (map[int64]UDRow, error) {
	rows, err := s.DB.Query(`SELECT item_id, position, played, play_count, favorite, last_played, updated_at FROM user_data WHERE user_id=?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]UDRow{}
	for rows.Next() {
		var id int64
		var r UDRow
		if rows.Scan(&id, &r.Position, &r.Played, &r.PlayCount, &r.Favorite, &r.LastPlayed, &r.UpdatedAt) == nil {
			out[id] = r
		}
	}
	return out, rows.Err()
}

// SyncRow is what the last Jellyfin sync of one item saw.
type SyncRow struct {
	SyncedAt int64 // unix ms
	JFState  string
}

func (s *Store) SyncRows(userID int64) (map[int64]SyncRow, error) {
	rows, err := s.DB.Query(`SELECT item_id, synced_at, jf_state FROM jellyfin_sync WHERE user_id=?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]SyncRow{}
	for rows.Next() {
		var id int64
		var r SyncRow
		if rows.Scan(&id, &r.SyncedAt, &r.JFState) == nil {
			out[id] = r
		}
	}
	return out, rows.Err()
}

// ApplySyncedUserData writes user data that came from Jellyfin. updated_at is set to
// `at` so the row doesn't look like a local change on the next sync.
func (s *Store) ApplySyncedUserData(userID, itemID int64, r UDRow, at int64) error {
	_, err := s.DB.Exec(`INSERT INTO user_data(user_id, item_id, position, played, play_count, favorite, last_played, updated_at)
		VALUES (?,?,?,?,?,?,?,?)
		ON CONFLICT(user_id, item_id) DO UPDATE SET position=excluded.position, played=excluded.played, play_count=excluded.play_count,
		  favorite=excluded.favorite, last_played=excluded.last_played, updated_at=excluded.updated_at`,
		userID, itemID, r.Position, r.Played, r.PlayCount, r.Favorite, r.LastPlayed, at)
	return err
}

func (s *Store) SetSynced(userID, itemID, at int64, jfState string) {
	_, _ = s.DB.Exec(`INSERT INTO jellyfin_sync(user_id, item_id, synced_at, jf_state) VALUES (?,?,?,?)
		ON CONFLICT(user_id, item_id) DO UPDATE SET synced_at=excluded.synced_at, jf_state=excluded.jf_state`, userID, itemID, at, jfState)
}

// ForgetJellyfin drops every item link and sync record, for when Lumen is pointed at a
// different Jellyfin server: the next sync then starts fresh like the first one did.
func (s *Store) ForgetJellyfin() error {
	_, err := s.DB.Exec(`DELETE FROM jellyfin_sync; DELETE FROM jellyfin_items;`)
	return err
}
