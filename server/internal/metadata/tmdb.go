// Package metadata fetches titles, artwork and cast from TMDB.
package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const tmdbAPI = "https://api.themoviedb.org/3"
const ImageBase = "https://image.tmdb.org/t/p/"

type TMDB struct {
	key    string
	lang   string
	client *http.Client
	mu     sync.Mutex
	last   time.Time
	base   string
}

func NewTMDB(key, lang string) *TMDB {
	return &TMDB{key: key, lang: lang, client: &http.Client{Timeout: 20 * time.Second}, base: tmdbAPI}
}

func (t *TMDB) Enabled() bool { return t != nil && t.key != "" }

func (t *TMDB) get(ctx context.Context, path string, q url.Values, out any) error {
	// Gentle client-side rate limit (TMDB allows ~50 req/s).
	t.mu.Lock()
	if wait := 30*time.Millisecond - time.Since(t.last); wait > 0 {
		time.Sleep(wait)
	}
	t.last = time.Now()
	t.mu.Unlock()

	if q == nil {
		q = url.Values{}
	}
	q.Set("language", t.lang)
	req, err := http.NewRequestWithContext(ctx, "GET", t.base+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	if strings.Count(t.key, ".") == 2 { // v4 read access token (JWT)
		req.Header.Set("Authorization", "Bearer "+t.key)
	} else {
		q.Set("api_key", t.key)
		req.URL.RawQuery = q.Encode()
	}
	req.Header.Set("Accept", "application/json")
	for attempt := 0; ; attempt++ {
		resp, err := t.client.Do(req)
		if err != nil {
			return err
		}
		if resp.StatusCode == 429 && attempt < 3 {
			resp.Body.Close()
			ra, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			time.Sleep(time.Duration(max(ra, 1)) * time.Second)
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return fmt.Errorf("tmdb %s: %s", path, resp.Status)
		}
		return json.NewDecoder(resp.Body).Decode(out)
	}
}

type SearchResult struct {
	ID           int     `json:"id"`
	Title        string  `json:"title"`
	Name         string  `json:"name"`
	ReleaseDate  string  `json:"release_date"`
	FirstAirDate string  `json:"first_air_date"`
	Overview     string  `json:"overview"`
	PosterPath   string  `json:"poster_path"`
	Popularity   float64 `json:"popularity"`
}

func (r SearchResult) DisplayTitle() string {
	if r.Title != "" {
		return r.Title
	}
	return r.Name
}

func (r SearchResult) Year() int {
	d := r.ReleaseDate
	if d == "" {
		d = r.FirstAirDate
	}
	if len(d) >= 4 {
		y, _ := strconv.Atoi(d[:4])
		return y
	}
	return 0
}

// Search queries movies ("movie") or shows ("tv").
func (t *TMDB) Search(ctx context.Context, kind, query string, year int) ([]SearchResult, error) {
	q := url.Values{"query": {query}, "include_adult": {"false"}}
	if year > 0 {
		if kind == "movie" {
			q.Set("year", strconv.Itoa(year))
		} else {
			q.Set("first_air_date_year", strconv.Itoa(year))
		}
	}
	var res struct {
		Results []SearchResult `json:"results"`
	}
	if err := t.get(ctx, "/search/"+kind, q, &res); err != nil {
		return nil, err
	}
	return res.Results, nil
}

type credit struct {
	Name        string `json:"name"`
	Character   string `json:"character"`
	Job         string `json:"job"`
	ProfilePath string `json:"profile_path"`
	Order       int    `json:"order"`
}

type tmdbImage struct {
	FilePath string  `json:"file_path"`
	Lang     string  `json:"iso_639_1"`
	Vote     float64 `json:"vote_average"`
	Votes    int     `json:"vote_count"`
	Width    int     `json:"width"`
}

type imageList struct {
	Logos     []tmdbImage `json:"logos"`
	Backdrops []tmdbImage `json:"backdrops"`
}

type genre struct {
	Name string `json:"name"`
}

type MovieDetails struct {
	ID            int     `json:"id"`
	Title         string  `json:"title"`
	OriginalTitle string  `json:"original_title"`
	Overview      string  `json:"overview"`
	Tagline       string  `json:"tagline"`
	ReleaseDate   string  `json:"release_date"`
	Runtime       int     `json:"runtime"`
	VoteAverage   float64 `json:"vote_average"`
	IMDBID        string  `json:"imdb_id"`
	PosterPath    string  `json:"poster_path"`
	BackdropPath  string  `json:"backdrop_path"`
	Genres        []genre `json:"genres"`
	Credits       struct {
		Cast []credit `json:"cast"`
		Crew []credit `json:"crew"`
	} `json:"credits"`
	Images       imageList `json:"images"`
	ReleaseDates struct {
		Results []struct {
			Country string `json:"iso_3166_1"`
			Dates   []struct {
				Cert string `json:"certification"`
			} `json:"release_dates"`
		} `json:"results"`
	} `json:"release_dates"`
}

func (t *TMDB) Movie(ctx context.Context, id int) (*MovieDetails, error) {
	var m MovieDetails
	err := t.get(ctx, "/movie/"+strconv.Itoa(id), url.Values{
		"append_to_response":     {"credits,images,release_dates"},
		"include_image_language": {langPrefix(t.lang) + ",en,null"},
	}, &m)
	return &m, err
}

type TVDetails struct {
	ID               int     `json:"id"`
	Name             string  `json:"name"`
	OriginalName     string  `json:"original_name"`
	Overview         string  `json:"overview"`
	Tagline          string  `json:"tagline"`
	FirstAirDate     string  `json:"first_air_date"`
	EpisodeRunTime   []int   `json:"episode_run_time"`
	VoteAverage      float64 `json:"vote_average"`
	PosterPath       string  `json:"poster_path"`
	BackdropPath     string  `json:"backdrop_path"`
	Genres           []genre `json:"genres"`
	Credits          struct {
		Cast []credit `json:"cast"`
		Crew []credit `json:"crew"`
	} `json:"credits"`
	CreatedBy []credit  `json:"created_by"`
	Images    imageList `json:"images"`
	ContentRatings struct {
		Results []struct {
			Country string `json:"iso_3166_1"`
			Rating  string `json:"rating"`
		} `json:"results"`
	} `json:"content_ratings"`
	ExternalIDs struct {
		IMDBID string `json:"imdb_id"`
	} `json:"external_ids"`
}

func (t *TMDB) TV(ctx context.Context, id int) (*TVDetails, error) {
	var m TVDetails
	err := t.get(ctx, "/tv/"+strconv.Itoa(id), url.Values{
		"append_to_response":     {"credits,images,content_ratings,external_ids"},
		"include_image_language": {langPrefix(t.lang) + ",en,null"},
	}, &m)
	return &m, err
}

type SeasonDetails struct {
	Name       string `json:"name"`
	Overview   string `json:"overview"`
	AirDate    string `json:"air_date"`
	PosterPath string `json:"poster_path"`
	Episodes   []struct {
		EpisodeNumber int     `json:"episode_number"`
		Name          string  `json:"name"`
		Overview      string  `json:"overview"`
		AirDate       string  `json:"air_date"`
		Runtime       int     `json:"runtime"`
		StillPath     string  `json:"still_path"`
		VoteAverage   float64 `json:"vote_average"`
		GuestStars    []credit `json:"guest_stars"`
	} `json:"episodes"`
}

func (t *TMDB) Season(ctx context.Context, tvID, season int) (*SeasonDetails, error) {
	var s SeasonDetails
	err := t.get(ctx, fmt.Sprintf("/tv/%d/season/%d", tvID, season), nil, &s)
	return &s, err
}

func langPrefix(l string) string {
	if i := strings.IndexByte(l, '-'); i > 0 {
		return l[:i]
	}
	return l
}

func country(l string) string {
	if i := strings.IndexByte(l, '-'); i > 0 {
		return l[i+1:]
	}
	return "US"
}

// bestBackdrop prefers a backdrop without text (no language), since the UI shows the
// title logo on top of it; falls back to TMDB's default choice.
func bestBackdrop(il imageList, fallback string) string {
	best, bestScore := "", -1.0
	for _, b := range il.Backdrops {
		if b.Lang != "" || b.Width < 1280 {
			continue
		}
		score := b.Vote + float64(min(b.Votes, 10))*0.1
		if score > bestScore {
			best, bestScore = b.FilePath, score
		}
	}
	if best == "" {
		return fallback
	}
	return best
}

// bestLogo picks the highest-voted logo in the preferred language, then English.
func bestLogo(il imageList, lang string) string {
	best, bestScore := "", -1.0
	for _, l := range il.Logos {
		score := l.Vote
		switch l.Lang {
		case langPrefix(lang):
			score += 20
		case "en":
			score += 10
		}
		if !strings.HasSuffix(l.FilePath, ".svg") && score > bestScore {
			best, bestScore = l.FilePath, score
		}
	}
	return best
}
