package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// itemSelect selects item columns plus per-user data for user ?1.
const itemSelect = `SELECT i.id, i.library_id, i.type, i.parent_id, i.series_id, i.title, i.sort_title, i.original_title, i.year,
  i.overview, i.tagline, i.genres, i.rating, i.content_rating, i.runtime, i.premiere_date, i.season_number, i.episode_number,
  i.episode_end, i.tmdb_id, i.imdb_id, i.poster, i.backdrop, i.logo, i.still, i.folder, i.date_added, i.updated_at,
  i.metadata_state, i.people,
  ud.position, ud.played, ud.play_count, ud.favorite, ud.last_played, ud.audio_index, ud.subtitle_index,
  COALESCE((SELECT s.title FROM items s WHERE s.id = i.series_id), ''),
  CASE WHEN i.type IN ('series','season') THEN (SELECT COUNT(*) FROM items c WHERE c.parent_id = i.id) ELSE 0 END,
  CASE WHEN i.type = 'series' THEN (SELECT COUNT(*) FROM items e LEFT JOIN user_data eu ON eu.item_id=e.id AND eu.user_id=?1
        WHERE e.series_id=i.id AND e.type='episode' AND COALESCE(eu.played,0)=0)
       WHEN i.type = 'season' THEN (SELECT COUNT(*) FROM items e LEFT JOIN user_data eu ON eu.item_id=e.id AND eu.user_id=?1
        WHERE e.parent_id=i.id AND COALESCE(eu.played,0)=0)
       ELSE 0 END,
  COALESCE((SELECT m.duration FROM media_files m WHERE m.item_id=i.id ORDER BY m.id LIMIT 1), 0)
FROM items i LEFT JOIN user_data ud ON ud.item_id = i.id AND ud.user_id = ?1 `

func scanItem(r interface{ Scan(...any) error }) (*Item, error) {
	var it Item
	var genres, people string
	var pos sql.NullFloat64
	var played, favorite sql.NullBool
	var playCount sql.NullInt64
	var lastPlayed sql.NullInt64
	var aIdx, sIdx sql.NullInt64
	var parent, series sql.NullInt64
	var season, ep, epEnd sql.NullInt64
	err := r.Scan(&it.ID, &it.LibraryID, &it.Type, &parent, &series, &it.Title, &it.SortTitle, &it.OriginalTitle, &it.Year,
		&it.Overview, &it.Tagline, &genres, &it.Rating, &it.ContentRating, &it.Runtime, &it.PremiereDate, &season, &ep,
		&epEnd, &it.TMDBID, &it.IMDBID, &it.Poster, &it.Backdrop, &it.Logo, &it.Still, &it.Folder, &it.DateAdded, &it.UpdatedAt,
		&it.MetadataState, &people,
		&pos, &played, &playCount, &favorite, &lastPlayed, &aIdx, &sIdx,
		&it.SeriesTitle, &it.ChildCount, &it.UnplayedCount, &it.Duration)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(genres), &it.Genres)
	if it.Genres == nil {
		it.Genres = []string{}
	}
	_ = json.Unmarshal([]byte(people), &it.People)
	if parent.Valid {
		it.ParentID = &parent.Int64
	}
	if series.Valid {
		it.SeriesID = &series.Int64
	}
	it.SeasonNumber = nullInt(season)
	it.EpisodeNumber = nullInt(ep)
	it.EpisodeEnd = nullInt(epEnd)
	ud := &UserData{Position: pos.Float64, Played: played.Bool, PlayCount: int(playCount.Int64), Favorite: favorite.Bool, LastPlayed: lastPlayed.Int64}
	ud.AudioIndex = nullInt(aIdx)
	ud.SubtitleIndex = nullInt(sIdx)
	if it.Type == "series" || it.Type == "season" {
		ud.Played = it.ChildCount > 0 && it.UnplayedCount == 0
	}
	it.UserData = ud
	tag := strconv.FormatInt(it.UpdatedAt, 36)
	if it.Poster != "" {
		it.Images.Poster = tag
	}
	if it.Backdrop != "" {
		it.Images.Backdrop = tag
	}
	if it.Logo != "" {
		it.Images.Logo = tag
	}
	if it.Still != "" {
		it.Images.Still = tag
	}
	return &it, nil
}

func nullInt(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func (s *Store) queryItems(q string, args ...any) ([]*Item, error) {
	rows, err := s.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// libFilter returns an SQL condition limiting items to libraries the user may see.
func libFilter(u *User) string {
	if u == nil || u.LibraryIDs == nil {
		return "1=1"
	}
	if len(u.LibraryIDs) == 0 {
		return "0=1"
	}
	ids := make([]string, len(u.LibraryIDs))
	for i, id := range u.LibraryIDs {
		ids[i] = strconv.FormatInt(id, 10)
	}
	return "i.library_id IN (" + strings.Join(ids, ",") + ")"
}

func (s *Store) Item(id int64, u *User) (*Item, error) {
	it, err := scanItem(s.DB.QueryRow(itemSelect+`WHERE i.id=?2 AND `+libFilter(u), u.ID, id))
	return it, err
}

// ItemRaw loads an item without user access checks (internal use).
func (s *Store) ItemRaw(id int64) (*Item, error) {
	return scanItem(s.DB.QueryRow(itemSelect+`WHERE i.id=?2`, 0, id))
}

type ListFilter struct {
	LibraryID int64
	Sort      string // title | added | year | rating | runtime | random | played
	Desc      bool
	Genre     string
	Year      int
	Played    string // "", "played", "unplayed"
	Favorite  bool
	Letter    string // "#" or A-Z
	Offset    int
	Limit     int
}

func (s *Store) ListItems(u *User, f ListFilter) ([]*Item, int, error) {
	where := []string{libFilter(u), "i.library_id=?2", "i.type IN ('movie','series')"}
	args := []any{u.ID, f.LibraryID}
	if f.Genre != "" {
		where = append(where, "EXISTS (SELECT 1 FROM json_each(i.genres) g WHERE g.value = ?)")
		args = append(args, f.Genre)
	}
	if f.Year > 0 {
		where = append(where, "i.year = ?")
		args = append(args, f.Year)
	}
	if f.Favorite {
		where = append(where, "COALESCE(ud.favorite,0)=1")
	}
	switch f.Letter {
	case "":
	case "#":
		where = append(where, "substr(i.sort_title,1,1) NOT BETWEEN 'a' AND 'z'")
	default:
		where = append(where, "substr(i.sort_title,1,1) = ?")
		args = append(args, strings.ToLower(f.Letter[:1]))
	}
	playedExpr := `(CASE WHEN i.type='series' THEN NOT EXISTS (SELECT 1 FROM items e LEFT JOIN user_data eu ON eu.item_id=e.id AND eu.user_id=?1 WHERE e.series_id=i.id AND e.type='episode' AND COALESCE(eu.played,0)=0) ELSE COALESCE(ud.played,0)=1 END)`
	switch f.Played {
	case "played":
		where = append(where, playedExpr)
	case "unplayed":
		where = append(where, "NOT "+playedExpr)
	}
	cond := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM items i LEFT JOIN user_data ud ON ud.item_id=i.id AND ud.user_id=?1`+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	dir := "ASC"
	if f.Desc {
		dir = "DESC"
	}
	var order string
	switch f.Sort {
	case "added":
		order = "i.date_added " + dir + ", i.sort_title"
	case "year":
		order = "i.year " + dir + ", i.sort_title"
	case "rating":
		order = "i.rating " + dir + ", i.sort_title"
	case "runtime":
		order = "i.runtime " + dir + ", i.sort_title"
	case "random":
		order = "random()"
	case "played":
		order = "COALESCE(ud.last_played,0) " + dir + ", i.sort_title"
	default:
		order = "i.sort_title " + dir
	}
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	q := itemSelect + cond + " ORDER BY " + order + fmt.Sprintf(" LIMIT %d OFFSET %d", f.Limit, f.Offset)
	items, err := s.queryItems(q, args...)
	return items, total, err
}

func (s *Store) Genres(u *User, libraryID int64) ([]string, error) {
	rows, err := s.DB.Query(`SELECT DISTINCT g.value FROM items i, json_each(i.genres) g WHERE `+libFilter(u)+` AND i.library_id=? AND i.type IN ('movie','series') ORDER BY g.value`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var g string
		if rows.Scan(&g) == nil {
			out = append(out, g)
		}
	}
	return out, rows.Err()
}

// Children returns seasons of a series or episodes of a season.
func (s *Store) Children(u *User, parentID int64) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE i.parent_id=?2 AND `+libFilter(u)+` ORDER BY COALESCE(i.season_number, 9999), COALESCE(i.episode_number, 9999), i.sort_title`, u.ID, parentID)
}

func (s *Store) SeriesEpisodes(u *User, seriesID int64) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE i.series_id=?2 AND i.type='episode' AND `+libFilter(u)+
		` ORDER BY CASE WHEN i.season_number=0 THEN 9999 ELSE i.season_number END, i.episode_number`, u.ID, seriesID)
}

// ContinueWatching returns partially watched movies/episodes.
func (s *Store) ContinueWatching(u *User, limit int) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE `+libFilter(u)+` AND i.type IN ('movie','episode') AND ud.position > 30 AND COALESCE(ud.played,0)=0
		ORDER BY ud.last_played DESC LIMIT ?2`, u.ID, limit)
}

// NextUp returns, for each recently watched series, the first unplayed episode after the last played one.
func (s *Store) NextUp(u *User, limit int) ([]*Item, error) {
	rows, err := s.DB.Query(`SELECT e.series_id, MAX(ud.last_played) lp FROM user_data ud JOIN items e ON e.id = ud.item_id
		WHERE ud.user_id=? AND e.type='episode' AND ud.played=1 GROUP BY e.series_id ORDER BY lp DESC LIMIT ?`, u.ID, limit*2)
	if err != nil {
		return nil, err
	}
	var series []int64
	for rows.Next() {
		var id, lp int64
		if rows.Scan(&id, &lp) == nil {
			series = append(series, id)
		}
	}
	rows.Close()
	out := []*Item{}
	for _, sid := range series {
		if len(out) >= limit {
			break
		}
		// Last played episode in airing order, then next unplayed after it.
		it, err := scanItem(s.DB.QueryRow(itemSelect+`WHERE i.series_id=?2 AND i.type='episode' AND `+libFilter(u)+` AND COALESCE(ud.played,0)=0
			AND (i.season_number*10000 + i.episode_number) > (
			  SELECT MAX(e.season_number*10000 + e.episode_number) FROM items e JOIN user_data x ON x.item_id=e.id AND x.user_id=?1
			  WHERE e.series_id=?2 AND x.played=1 AND e.season_number > 0)
			AND i.season_number > 0
			ORDER BY i.season_number, i.episode_number LIMIT 1`, u.ID, sid))
		if err == nil && (it.UserData == nil || it.UserData.Position <= 30) {
			out = append(out, it)
		}
	}
	return out, nil
}

// Latest returns recently added movies or series (series ordered by newest episode).
func (s *Store) Latest(u *User, libraryID int64, limit int) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE i.library_id=?2 AND `+libFilter(u)+` AND i.type IN ('movie','series')
		ORDER BY CASE WHEN i.type='series' THEN COALESCE((SELECT MAX(e.date_added) FROM items e WHERE e.series_id=i.id), i.date_added) ELSE i.date_added END DESC
		LIMIT ?3`, u.ID, libraryID, limit)
}

// Featured returns items with backdrops for the home hero carousel.
func (s *Store) Featured(u *User, limit int) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE `+libFilter(u)+` AND i.type IN ('movie','series') AND i.backdrop != ''
		AND i.date_added > (SELECT COALESCE(MAX(date_added),0) - 86400*120 FROM items)
		ORDER BY (i.overview != '') DESC, random() LIMIT ?2`, u.ID, limit)
}

func (s *Store) Favorites(u *User, limit int) ([]*Item, error) {
	return s.queryItems(itemSelect+`WHERE `+libFilter(u)+` AND ud.favorite=1 ORDER BY i.sort_title LIMIT ?2`, u.ID, limit)
}

// NextEpisode returns the episode following ep in airing order.
func (s *Store) NextEpisode(u *User, ep *Item) (*Item, error) {
	if ep.SeriesID == nil || ep.SeasonNumber == nil || ep.EpisodeNumber == nil {
		return nil, ErrNotFound
	}
	key := *ep.SeasonNumber*10000 + *ep.EpisodeNumber
	return scanItem(s.DB.QueryRow(itemSelect+`WHERE i.series_id=?2 AND i.type='episode' AND `+libFilter(u)+`
		AND (i.season_number*10000 + i.episode_number) > ?3 AND (i.season_number > 0 OR ?3 < 10000)
		ORDER BY i.season_number, i.episode_number LIMIT 1`, u.ID, *ep.SeriesID, key))
}

// ftsQuery turns user input into a safe FTS5 prefix query.
func ftsQuery(q string) string {
	var terms []string
	for _, f := range strings.FieldsFunc(q, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }) {
		terms = append(terms, `"`+f+`"*`)
	}
	return strings.Join(terms, " ")
}

func (s *Store) Search(u *User, q string, limit int) ([]*Item, error) {
	fq := ftsQuery(q)
	if fq == "" {
		return []*Item{}, nil
	}
	return s.queryItems(itemSelect+`JOIN items_fts f ON f.rowid = i.id WHERE items_fts MATCH ?2 AND `+libFilter(u)+`
		AND i.type IN ('movie','series','episode')
		ORDER BY CASE i.type WHEN 'episode' THEN 1 ELSE 0 END, bm25(items_fts, 10.0, 5.0, 1.0) LIMIT ?3`, u.ID, fq, limit)
}

// ---- user data ----

func (s *Store) ensureUD(userID, itemID int64) {
	_, _ = s.DB.Exec(`INSERT OR IGNORE INTO user_data(user_id, item_id) VALUES (?,?)`, userID, itemID)
}

// SaveProgress records the playback position; marks played past 90%.
func (s *Store) SaveProgress(userID, itemID int64, pos, duration float64, audio, sub *int) (bool, error) {
	s.ensureUD(userID, itemID)
	played := duration > 0 && pos/duration >= 0.9
	if played {
		_, err := s.DB.Exec(`UPDATE user_data SET position=0, played=1, play_count=play_count+CASE WHEN played=1 THEN 0 ELSE 1 END, last_played=?, audio_index=?, subtitle_index=? WHERE user_id=? AND item_id=?`,
			now(), audio, sub, userID, itemID)
		return true, err
	}
	_, err := s.DB.Exec(`UPDATE user_data SET position=?, last_played=?, audio_index=?, subtitle_index=? WHERE user_id=? AND item_id=?`,
		pos, now(), audio, sub, userID, itemID)
	return false, err
}

// SetPlayed marks an item (and for series/seasons, all its episodes) as played or unplayed.
func (s *Store) SetPlayed(userID, itemID int64, played bool) error {
	ids := []int64{itemID}
	rows, err := s.DB.Query(`SELECT id FROM items WHERE type='episode' AND (series_id=? OR parent_id=?)`, itemID, itemID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	t := now()
	for _, id := range ids {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO user_data(user_id, item_id) VALUES (?,?)`, userID, id); err != nil {
			return err
		}
		if played {
			_, err = tx.Exec(`UPDATE user_data SET played=1, position=0, play_count=MAX(play_count,1), last_played=? WHERE user_id=? AND item_id=?`, t, userID, id)
		} else {
			_, err = tx.Exec(`UPDATE user_data SET played=0, position=0 WHERE user_id=? AND item_id=?`, userID, id)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) SetFavorite(userID, itemID int64, fav bool) error {
	s.ensureUD(userID, itemID)
	_, err := s.DB.Exec(`UPDATE user_data SET favorite=? WHERE user_id=? AND item_id=?`, fav, userID, itemID)
	return err
}

// ItemsByTMDB maps TMDB ids to library item ids the user can see. kind is "movie" or "series".
func (s *Store) ItemsByTMDB(u *User, kind string, ids []int) (map[int]int64, error) {
	out := map[int]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	ph := make([]string, len(ids))
	args := []any{kind}
	for i, id := range ids {
		ph[i] = "?"
		args = append(args, id)
	}
	rows, err := s.DB.Query(`SELECT i.tmdb_id, i.id FROM items i WHERE i.type=? AND i.tmdb_id IN (`+strings.Join(ph, ",")+`) AND `+libFilter(u), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t int
		var id int64
		if rows.Scan(&t, &id) == nil {
			out[t] = id
		}
	}
	return out, rows.Err()
}
