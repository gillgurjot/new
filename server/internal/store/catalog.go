package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// SortTitle lowercases and strips leading articles for ordering.
func SortTitle(t string) string {
	s := strings.ToLower(strings.TrimSpace(t))
	for _, a := range []string{"the ", "a ", "an "} {
		if strings.HasPrefix(s, a) && len(s) > len(a) {
			s = s[len(a):]
			break
		}
	}
	return s
}

type FileRecord struct {
	ID     int64
	ItemID int64
	Size   int64
	Mtime  int64
}

// FilesInLibrary maps path → record for change detection.
func (s *Store) FilesInLibrary(libraryID int64) (map[string]FileRecord, error) {
	rows, err := s.DB.Query(`SELECT m.id, m.item_id, m.path, m.size, m.mtime FROM media_files m JOIN items i ON i.id=m.item_id WHERE i.library_id=?`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]FileRecord{}
	for rows.Next() {
		var r FileRecord
		var p string
		if err := rows.Scan(&r.ID, &r.ItemID, &p, &r.Size, &r.Mtime); err != nil {
			return nil, err
		}
		out[p] = r
	}
	return out, rows.Err()
}

// NewItem is what the scanner knows about an item before metadata lookup.
type NewItem struct {
	LibraryID     int64
	Type          string
	ParentID      *int64
	SeriesID      *int64
	Title         string
	Year          int
	SeasonNumber  *int
	EpisodeNumber *int
	EpisodeEnd    *int
	Folder        string
	TMDBID        int
}

// EnsureContainer finds or creates a series/season item keyed by folder.
func (s *Store) EnsureContainer(n NewItem) (int64, bool, error) {
	var id int64
	err := s.DB.QueryRow(`SELECT id FROM items WHERE library_id=? AND type=? AND folder=?`, n.LibraryID, n.Type, n.Folder).Scan(&id)
	if err == nil {
		return id, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}
	id, err = s.insertItem(n)
	return id, true, err
}

func (s *Store) insertItem(n NewItem) (int64, error) {
	t := now()
	res, err := s.DB.Exec(`INSERT INTO items(library_id, type, parent_id, series_id, title, sort_title, year, season_number, episode_number, episode_end, folder, tmdb_id, date_added, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		n.LibraryID, n.Type, n.ParentID, n.SeriesID, n.Title, SortTitle(n.Title), n.Year, n.SeasonNumber, n.EpisodeNumber, n.EpisodeEnd, n.Folder, n.TMDBID, t, t)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	s.IndexItem(id)
	return id, nil
}

// AddFile creates a movie/episode item together with its media file.
func (s *Store) AddFile(n NewItem, m *MediaFile) (int64, error) {
	id, err := s.insertItem(n)
	if err != nil {
		return 0, err
	}
	m.ItemID = id
	return id, s.UpsertMediaFile(m)
}

func (s *Store) UpsertMediaFile(m *MediaFile) error {
	if m.Streams == nil {
		m.Streams = []Stream{}
	}
	if m.Sidecars == nil {
		m.Sidecars = []Stream{}
	}
	if m.Chapters == nil {
		m.Chapters = []Chapter{}
	}
	_, err := s.DB.Exec(`INSERT INTO media_files(item_id, path, size, mtime, container, duration, bitrate, width, height, video_codec, video_profile, pix_fmt, hdr, streams, sidecars, chapters)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, container=excluded.container, duration=excluded.duration,
		  bitrate=excluded.bitrate, width=excluded.width, height=excluded.height, video_codec=excluded.video_codec, video_profile=excluded.video_profile,
		  pix_fmt=excluded.pix_fmt, hdr=excluded.hdr, streams=excluded.streams, sidecars=excluded.sidecars, chapters=excluded.chapters, trickplay=0,
		  credits_state=CASE WHEN media_files.mtime=excluded.mtime AND media_files.size=excluded.size THEN media_files.credits_state ELSE 0 END,
		  intro_state=CASE WHEN media_files.mtime=excluded.mtime AND media_files.size=excluded.size THEN media_files.intro_state ELSE 0 END`,
		m.ItemID, m.Path, m.Size, m.Mtime, m.Container, m.Duration, m.Bitrate, m.Width, m.Height, m.VideoCodec, m.VideoProfile, m.PixFmt, m.HDR,
		encodeStreams(m.Streams), encodeStreams(m.Sidecars), mustJSON(m.Chapters))
	return err
}

func (s *Store) UpdateSidecars(fileID int64, sc []Stream) error {
	if sc == nil {
		sc = []Stream{}
	}
	_, err := s.DB.Exec(`UPDATE media_files SET sidecars=? WHERE id=?`, encodeStreams(sc), fileID)
	return err
}

// RemoveFile deletes a media file and its item, then prunes empty seasons/series.
func (s *Store) RemoveFile(r FileRecord) error {
	if _, err := s.DB.Exec(`DELETE FROM media_files WHERE id=?`, r.ID); err != nil {
		return err
	}
	var left int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM media_files WHERE item_id=?`, r.ItemID).Scan(&left)
	if left == 0 {
		_, _ = s.DB.Exec(`DELETE FROM items_fts WHERE rowid=?`, r.ItemID)
		if _, err := s.DB.Exec(`DELETE FROM items WHERE id=?`, r.ItemID); err != nil {
			return err
		}
	}
	return nil
}

// PruneEmpty removes seasons without episodes and series without seasons.
func (s *Store) PruneEmpty(libraryID int64) {
	for _, q := range []string{
		`DELETE FROM items WHERE library_id=? AND type='season' AND NOT EXISTS (SELECT 1 FROM items c WHERE c.parent_id=items.id)`,
		`DELETE FROM items WHERE library_id=? AND type='series' AND NOT EXISTS (SELECT 1 FROM items c WHERE c.parent_id=items.id)`,
	} {
		_, _ = s.DB.Exec(q, libraryID)
	}
	_, _ = s.DB.Exec(`DELETE FROM items_fts WHERE rowid NOT IN (SELECT id FROM items)`)
}

// IndexItem refreshes the search index row for an item.
func (s *Store) IndexItem(id int64) {
	var title, orig, people string
	if err := s.DB.QueryRow(`SELECT title, original_title, people FROM items WHERE id=?`, id).Scan(&title, &orig, &people); err != nil {
		return
	}
	var ps []Person
	_ = json.Unmarshal([]byte(people), &ps)
	var names []string
	for i, p := range ps {
		if i >= 15 {
			break
		}
		names = append(names, p.Name)
	}
	_, _ = s.DB.Exec(`DELETE FROM items_fts WHERE rowid=?`, id)
	_, _ = s.DB.Exec(`INSERT INTO items_fts(rowid, title, original_title, people) VALUES (?,?,?,?)`, id, title, orig, strings.Join(names, " "))
}

func (s *Store) MediaFile(id int64) (*MediaFile, error) {
	return scanMediaFile(s.DB.QueryRow(mediaCols+` WHERE id=?`, id))
}

func (s *Store) MediaFileForItem(itemID int64) (*MediaFile, error) {
	return scanMediaFile(s.DB.QueryRow(mediaCols+` WHERE item_id=? ORDER BY id LIMIT 1`, itemID))
}

const mediaCols = `SELECT id, item_id, path, size, mtime, container, duration, bitrate, width, height, video_codec, video_profile, pix_fmt, hdr, streams, sidecars, chapters, trickplay, credits_start, credits_end, intro_start, intro_end, recap_start, recap_end FROM media_files`

func scanMediaFile(r interface{ Scan(...any) error }) (*MediaFile, error) {
	var m MediaFile
	var streams, sidecars, chapters string
	var trick int
	err := r.Scan(&m.ID, &m.ItemID, &m.Path, &m.Size, &m.Mtime, &m.Container, &m.Duration, &m.Bitrate, &m.Width, &m.Height,
		&m.VideoCodec, &m.VideoProfile, &m.PixFmt, &m.HDR, &streams, &sidecars, &chapters, &trick, &m.CreditsStart, &m.CreditsEnd,
		&m.IntroStart, &m.IntroEnd, &m.RecapStart, &m.RecapEnd)
	m.Trickplay = trick == 1
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.Streams = decodeStreams(streams)
	m.Sidecars = decodeStreams(sidecars)
	_ = json.Unmarshal([]byte(chapters), &m.Chapters)
	if m.Streams == nil {
		m.Streams = []Stream{}
	}
	if m.Sidecars == nil {
		m.Sidecars = []Stream{}
	}
	if m.Chapters == nil {
		m.Chapters = []Chapter{}
	}
	return &m, nil
}

// FilesNeedingTrickplay lists media files without trickplay sprites.
func (s *Store) FilesNeedingTrickplay(limit int) ([]*MediaFile, error) {
	rows, err := s.DB.Query(mediaCols+` WHERE trickplay=0 AND duration > 60 ORDER BY id DESC LIMIT ?`, limit)
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

// FilesNeedingCredits lists media files whose end credits haven't been looked for yet.
func (s *Store) FilesNeedingCredits(limit int) ([]*MediaFile, error) {
	rows, err := s.DB.Query(mediaCols+` WHERE credits_state=0 AND duration > 600 ORDER BY id DESC LIMIT ?`, limit)
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

// SetCredits stores the analysis result; state 1 = done, -1 = failed.
func (s *Store) SetCredits(fileID int64, start, end float64, state int) {
	_, _ = s.DB.Exec(`UPDATE media_files SET credits_start=?, credits_end=?, credits_state=? WHERE id=?`, start, end, state, fileID)
}

// SetTrickplay records trickplay state: 1 = ready, -1 = failed.
func (s *Store) SetTrickplay(fileID int64, state int) {
	_, _ = s.DB.Exec(`UPDATE media_files SET trickplay=? WHERE id=?`, state, fileID)
}

// ItemsNeedingMetadata returns movies/series whose metadata hasn't been fetched.
func (s *Store) ItemsNeedingMetadata(libraryID int64) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE i.library_id=?2 AND i.type IN ('movie','series') AND i.metadata_state='pending' ORDER BY i.id`, 0, libraryID)
}

// EpisodesNeedingMetadata returns episodes of a series still pending metadata.
func (s *Store) PendingEpisodes(seriesID int64) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE i.series_id=?2 AND i.type IN ('season','episode') AND i.metadata_state='pending'`, 0, seriesID)
}

func (s *Store) SetMetadataState(id int64, state string) {
	_, _ = s.DB.Exec(`UPDATE items SET metadata_state=? WHERE id=?`, state, id)
}

// MarkSeriesPending resets a series and all its children to be refetched.
func (s *Store) MarkPending(id int64) {
	_, _ = s.DB.Exec(`UPDATE items SET metadata_state='pending' WHERE (id=? OR series_id=?) AND metadata_state != 'locked'`, id, id)
}

// Metadata is the set of fields filled from a metadata provider.
type Metadata struct {
	Title         string
	OriginalTitle string
	Year          int
	Overview      string
	Tagline       string
	Genres        []string
	Rating        float64
	ContentRating string
	Runtime       int
	PremiereDate  string
	TMDBID        int
	IMDBID        string
	People        []Person
	Poster        string
	Backdrop      string
	Logo          string
	Still         string
}

// ApplyMetadata writes provider metadata; empty image fields keep existing images.
func (s *Store) ApplyMetadata(id int64, m Metadata, state string) error {
	if m.Genres == nil {
		m.Genres = []string{}
	}
	if m.People == nil {
		m.People = []Person{}
	}
	_, err := s.DB.Exec(`UPDATE items SET
		title=CASE WHEN ?='' THEN title ELSE ? END, sort_title=CASE WHEN ?='' THEN sort_title ELSE ? END,
		original_title=?, year=CASE WHEN ?=0 THEN year ELSE ? END, overview=?, tagline=?, genres=?, rating=?, content_rating=?,
		runtime=?, premiere_date=?, tmdb_id=?, imdb_id=?, people=?,
		poster=CASE WHEN ?='' THEN poster ELSE ? END, backdrop=CASE WHEN ?='' THEN backdrop ELSE ? END,
		logo=CASE WHEN ?='' THEN logo ELSE ? END, still=CASE WHEN ?='' THEN still ELSE ? END,
		metadata_state=?, updated_at=? WHERE id=?`,
		m.Title, m.Title, m.Title, SortTitle(m.Title), m.OriginalTitle, m.Year, m.Year, m.Overview, m.Tagline, mustJSON(m.Genres), m.Rating, m.ContentRating,
		m.Runtime, m.PremiereDate, m.TMDBID, m.IMDBID, mustJSON(m.People),
		m.Poster, m.Poster, m.Backdrop, m.Backdrop, m.Logo, m.Logo, m.Still, m.Still, state, now(), id)
	if err == nil {
		s.IndexItem(id)
	}
	return err
}

// SetImage sets one local image path for an item.
func (s *Store) SetImage(id int64, kind, path string) error {
	switch kind {
	case "poster", "backdrop", "logo", "still":
	default:
		return errors.New("bad image kind")
	}
	_, err := s.DB.Exec(`UPDATE items SET `+kind+`=?, updated_at=? WHERE id=?`, path, now(), id)
	return err
}

// Stats returns counts for the admin dashboard.
func (s *Store) Stats() map[string]int {
	out := map[string]int{}
	rows, err := s.DB.Query(`SELECT type, COUNT(*) FROM items GROUP BY type`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var t string
		var n int
		if rows.Scan(&t, &n) == nil {
			out[t] = n
		}
	}
	var users int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	out["users"] = users
	return out
}

// SeriesWithPending returns series that have seasons/episodes awaiting metadata.
func (s *Store) SeriesWithPending(libraryID int64) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE i.library_id=?2 AND i.type='series' AND i.metadata_state != 'pending'
		AND EXISTS (SELECT 1 FROM items c WHERE c.series_id=i.id AND c.metadata_state='pending')`, 0, libraryID)
}
