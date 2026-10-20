// Package store holds the data models and all SQL queries.
package store

import (
	"database/sql"
	"encoding/json"
	"time"
)

type Store struct{ DB *sql.DB }

func New(db *sql.DB) *Store { return &Store{DB: db} }

func now() int64 { return time.Now().Unix() }

type User struct {
	ID           int64   `json:"id"`
	Subject      string  `json:"-"`
	Username     string  `json:"username"`
	DisplayName  string  `json:"displayName"`
	Email        string  `json:"email"`
	Avatar       string  `json:"avatar"`
	IsAdmin      bool    `json:"isAdmin"`
	Disabled     bool    `json:"disabled"`
	MaxBitrate   int     `json:"maxBitrate"`
	LibraryIDs   []int64 `json:"libraryIds"` // nil = all
	AudioLang    string  `json:"audioLang"`
	SubtitleLang string  `json:"subtitleLang"`
	SubtitleMode string  `json:"subtitleMode"`
	CreatedAt    int64   `json:"createdAt"`
	LastLogin    int64   `json:"lastLogin"`
	CanDownload  bool    `json:"canDownload"`
	CanRequest   bool    `json:"canRequest"`
}

// CanAccess reports whether the user may see the given library.
func (u *User) CanAccess(libraryID int64) bool {
	if u.LibraryIDs == nil {
		return true
	}
	for _, id := range u.LibraryIDs {
		if id == libraryID {
			return true
		}
	}
	return false
}

type Library struct {
	ID        int64    `json:"id"`
	Name      string   `json:"name"`
	Type      string   `json:"type"` // movies | tv
	Paths     []string `json:"paths"`
	CreatedAt int64    `json:"createdAt"`
	LastScan  int64    `json:"lastScan"`
	ItemCount int      `json:"itemCount"`
}

type Person struct {
	Name      string `json:"name"`
	Character string `json:"character,omitempty"`
	Profile   string `json:"profile,omitempty"` // remote URL, proxied via image cache
	Role      string `json:"role,omitempty"`    // actor | director | writer
}

type Item struct {
	ID             int64    `json:"id"`
	LibraryID      int64    `json:"libraryId"`
	Type           string   `json:"type"`
	ParentID       *int64   `json:"parentId,omitempty"`
	SeriesID       *int64   `json:"seriesId,omitempty"`
	Title          string   `json:"title"`
	SortTitle      string   `json:"-"`
	OriginalTitle  string   `json:"originalTitle,omitempty"`
	Year           int      `json:"year,omitempty"`
	Overview       string   `json:"overview,omitempty"`
	Tagline        string   `json:"tagline,omitempty"`
	Genres         []string `json:"genres"`
	Rating         float64  `json:"rating,omitempty"`
	ContentRating  string   `json:"contentRating,omitempty"`
	Runtime        int      `json:"runtime,omitempty"`
	PremiereDate   string   `json:"premiereDate,omitempty"`
	SeasonNumber   *int     `json:"seasonNumber,omitempty"`
	EpisodeNumber  *int     `json:"episodeNumber,omitempty"`
	EpisodeEnd     *int     `json:"episodeEnd,omitempty"`
	TMDBID         int      `json:"tmdbId,omitempty"`
	IMDBID         string   `json:"imdbId,omitempty"`
	Poster         string   `json:"-"`
	Backdrop       string   `json:"-"`
	Logo           string   `json:"-"`
	Still          string   `json:"-"`
	Folder         string   `json:"-"`
	DateAdded      int64    `json:"dateAdded"`
	UpdatedAt      int64    `json:"updatedAt"`
	MetadataState  string   `json:"metadataState"`
	People         []Person `json:"people,omitempty"`
	Images         Images   `json:"images"`

	// Joined / computed fields.
	UserData    *UserData `json:"userData,omitempty"`
	SeriesTitle string    `json:"seriesTitle,omitempty"`
	ChildCount  int       `json:"childCount,omitempty"`
	UnplayedCount int     `json:"unplayedCount,omitempty"`
	Duration    float64   `json:"duration,omitempty"` // seconds of primary media file
}

// Images holds cache-busting tags for the image endpoints; empty means absent.
type Images struct {
	Poster   string `json:"poster,omitempty"`
	Backdrop string `json:"backdrop,omitempty"`
	Logo     string `json:"logo,omitempty"`
	Still    string `json:"still,omitempty"`
}

type UserData struct {
	Position      float64 `json:"position"`
	Played        bool    `json:"played"`
	PlayCount     int     `json:"playCount"`
	Favorite      bool    `json:"favorite"`
	LastPlayed    int64   `json:"lastPlayed"`
	AudioIndex    *int    `json:"audioIndex,omitempty"`
	SubtitleIndex *int    `json:"subtitleIndex,omitempty"`
}

type Stream struct {
	Index     int    `json:"index"`
	Type      string `json:"type"` // audio | subtitle
	Codec     string `json:"codec"`
	Language  string `json:"language,omitempty"`
	Title     string `json:"title,omitempty"`
	Channels  int    `json:"channels,omitempty"`
	Layout    string `json:"layout,omitempty"`
	Default   bool   `json:"default,omitempty"`
	Forced    bool   `json:"forced,omitempty"`
	Bitrate   int    `json:"bitrate,omitempty"`
	External  bool   `json:"external,omitempty"`
	Path      string `json:"-"`
	ImageBased bool  `json:"imageBased,omitempty"`
}

type Chapter struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Title string  `json:"title"`
}

type MediaFile struct {
	ID           int64     `json:"id"`
	ItemID       int64     `json:"itemId"`
	Path         string    `json:"-"`
	Size         int64     `json:"size"`
	Mtime        int64     `json:"-"`
	Container    string    `json:"container"`
	Duration     float64   `json:"duration"`
	Bitrate      int       `json:"bitrate"`
	Width        int       `json:"width"`
	Height       int       `json:"height"`
	VideoCodec   string    `json:"videoCodec"`
	VideoProfile string    `json:"videoProfile"`
	PixFmt       string    `json:"pixFmt"`
	HDR          string    `json:"hdr,omitempty"`
	Streams      []Stream  `json:"streams"`   // audio + embedded subtitles
	Sidecars     []Stream  `json:"sidecars"`  // external subtitle files
	Chapters     []Chapter `json:"chapters"`
	Trickplay    bool      `json:"trickplay"`
	// End credits found by analysing the picture (0 = none found or not analysed yet).
	CreditsStart float64 `json:"creditsStart,omitempty"`
	CreditsEnd   float64 `json:"creditsEnd,omitempty"`
}

// AudioStreams returns only audio streams.
func (m *MediaFile) AudioStreams() []Stream {
	var out []Stream
	for _, s := range m.Streams {
		if s.Type == "audio" {
			out = append(out, s)
		}
	}
	return out
}

// Subtitles returns embedded then external subtitle streams.
func (m *MediaFile) Subtitles() []Stream {
	var out []Stream
	for _, s := range m.Streams {
		if s.Type == "subtitle" {
			out = append(out, s)
		}
	}
	return append(out, m.Sidecars...)
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// streamJSON persists Stream including Path, which the API never exposes.
type streamJSON struct {
	Stream
	P string `json:"path,omitempty"`
}

func encodeStreams(in []Stream) string {
	out := make([]streamJSON, len(in))
	for i, s := range in {
		out[i] = streamJSON{s, s.Path}
	}
	return mustJSON(out)
}

func decodeStreams(data string) []Stream {
	var raw []streamJSON
	_ = json.Unmarshal([]byte(data), &raw)
	out := make([]Stream, len(raw))
	for i, r := range raw {
		out[i] = r.Stream
		out[i].Path = r.P
	}
	return out
}
