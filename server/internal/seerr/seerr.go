// Package seerr talks to a Seerr (Overseerr/Jellyseerr) server so people can request
// movies and shows from inside Lumen. Seerr then sends them to Radarr/Sonarr.
package seerr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Client struct {
	base string
	key  string
	http *http.Client

	mu      sync.Mutex
	users   map[string]int // lower-case email → Seerr user id
	usersAt time.Time
	cache   map[string]cached
}

type cached struct {
	at   time.Time
	data []byte
}

func New(baseURL, apiKey string) *Client {
	if baseURL == "" || apiKey == "" {
		return nil
	}
	return &Client{base: strings.TrimRight(baseURL, "/") + "/api/v1", key: apiKey, http: &http.Client{Timeout: 15 * time.Second},
		cache: map[string]cached{}}
}

func (c *Client) Enabled() bool { return c != nil }

// Error carries Seerr's own message (e.g. "This title is already requested").
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

func (c *Client) do(ctx context.Context, method, path string, asUser int, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("X-Api-Key", c.key)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if asUser > 0 {
		req.Header.Set("X-Api-User", strconv.Itoa(asUser))
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return &Error{Status: 502, Message: "Seerr isn't responding"}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Message == "" {
			e.Message = fmt.Sprintf("Seerr returned %d", resp.StatusCode)
		}
		return &Error{Status: resp.StatusCode, Message: e.Message}
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// cachedGet caches read-only lookups that are shared by everyone (title details).
func (c *Client) cachedGet(ctx context.Context, path string, ttl time.Duration, out any) error {
	c.mu.Lock()
	e, ok := c.cache[path]
	c.mu.Unlock()
	if ok && time.Since(e.at) < ttl {
		return json.Unmarshal(e.data, out)
	}
	var raw json.RawMessage
	if err := c.do(ctx, "GET", path, 0, nil, &raw); err != nil {
		return err
	}
	c.mu.Lock()
	if len(c.cache) > 2000 {
		c.cache = map[string]cached{}
	}
	c.cache[path] = cached{time.Now(), raw}
	c.mu.Unlock()
	return json.Unmarshal(raw, out)
}

func (c *Client) forget(path string) {
	c.mu.Lock()
	delete(c.cache, path)
	c.mu.Unlock()
}

// ---- Seerr payloads (only the fields Lumen uses) ----

type MediaInfo struct {
	Status  int `json:"status"` // 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available
	Seasons []struct {
		SeasonNumber int `json:"seasonNumber"`
		Status       int `json:"status"`
	} `json:"seasons"`
	Requests []Request `json:"requests"`
}

type Result struct {
	ID           int        `json:"id"`
	MediaType    string     `json:"mediaType"`
	Title        string     `json:"title"`
	Name         string     `json:"name"`
	ReleaseDate  string     `json:"releaseDate"`
	FirstAirDate string     `json:"firstAirDate"`
	Overview     string     `json:"overview"`
	PosterPath   string     `json:"posterPath"`
	BackdropPath string     `json:"backdropPath"`
	VoteAverage  float64    `json:"voteAverage"`
	MediaInfo    *MediaInfo `json:"mediaInfo"`
}

func (r Result) DisplayTitle() string {
	if r.Title != "" {
		return r.Title
	}
	return r.Name
}

func (r Result) Year() int {
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

type Page struct {
	Page       int      `json:"page"`
	TotalPages int      `json:"totalPages"`
	Results    []Result `json:"results"`
}

type Details struct {
	Result
	Runtime int `json:"runtime"`
	Genres  []struct {
		Name string `json:"name"`
	} `json:"genres"`
	Seasons []struct {
		SeasonNumber int    `json:"seasonNumber"`
		Name         string `json:"name"`
		EpisodeCount int    `json:"episodeCount"`
		AirDate      string `json:"airDate"`
	} `json:"seasons"`
	NumberOfSeasons int `json:"numberOfSeasons"`
}

type Request struct {
	ID        int    `json:"id"`
	Status    int    `json:"status"` // 1 pending approval, 2 approved, 3 declined, 4 failed, 5 completed
	CreatedAt string `json:"createdAt"`
	Media     struct {
		TMDBID    int    `json:"tmdbId"`
		MediaType string `json:"mediaType"`
		Status    int    `json:"status"`
	} `json:"media"`
	RequestedBy struct {
		ID          int    `json:"id"`
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
	} `json:"requestedBy"`
	Seasons []struct {
		SeasonNumber int `json:"seasonNumber"`
	} `json:"seasons"`
}

// ---- API ----

func q(v url.Values) string {
	// Seerr rejects '+' for spaces in queries.
	return strings.ReplaceAll(v.Encode(), "+", "%20")
}

func (c *Client) Search(ctx context.Context, query string, page int) (*Page, error) {
	var p Page
	err := c.do(ctx, "GET", "/search?"+q(url.Values{"query": {query}, "page": {strconv.Itoa(max(page, 1))}}), 0, nil, &p)
	return &p, err
}

// Discover lists trending titles or popular movies / shows.
func (c *Client) Discover(ctx context.Context, kind string, page int) (*Page, error) {
	path := map[string]string{"trending": "/discover/trending", "movies": "/discover/movies", "tv": "/discover/tv", "upcoming": "/discover/movies/upcoming"}[kind]
	if path == "" {
		return nil, &Error{Status: 400, Message: "unknown list"}
	}
	var p Page
	err := c.cachedGet(ctx, path+"?"+q(url.Values{"page": {strconv.Itoa(max(page, 1))}}), 10*time.Minute, &p)
	return &p, err
}

func detailsPath(mediaType string, id int) string {
	if mediaType == "tv" {
		return "/tv/" + strconv.Itoa(id)
	}
	return "/movie/" + strconv.Itoa(id)
}

// Details loads a movie or show. fresh skips the cache (for request status).
func (c *Client) Details(ctx context.Context, mediaType string, id int, fresh bool) (*Details, error) {
	var d Details
	p := detailsPath(mediaType, id)
	if fresh {
		c.forget(p)
	}
	err := c.cachedGet(ctx, p, 30*time.Minute, &d)
	d.MediaType = mediaType
	return &d, err
}

// Request asks Seerr for a title. seasons is nil for movies, empty for "all seasons".
func (c *Client) Request(ctx context.Context, asUser int, mediaType string, id int, seasons []int) error {
	body := map[string]any{"mediaType": mediaType, "mediaId": id, "is4k": false}
	if mediaType == "tv" {
		if len(seasons) == 0 {
			body["seasons"] = "all"
		} else {
			body["seasons"] = seasons
		}
	}
	err := c.do(ctx, "POST", "/request", asUser, body, nil)
	c.forget(detailsPath(mediaType, id))
	return err
}

func (c *Client) Recent(ctx context.Context, take int) ([]Request, error) {
	var out struct {
		Results []Request `json:"results"`
	}
	err := c.do(ctx, "GET", "/request?"+q(url.Values{"take": {strconv.Itoa(take)}, "skip": {"0"}, "filter": {"all"}, "sort": {"added"}}), 0, nil, &out)
	return out.Results, err
}

// UserFor finds the Seerr account with the same email, so requests count against
// that person's quota and permissions. 0 means "use the API key's own account".
func (c *Client) UserFor(ctx context.Context, email string) int {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return 0
	}
	c.mu.Lock()
	fresh := c.users != nil && time.Since(c.usersAt) < 10*time.Minute
	id := c.users[email]
	c.mu.Unlock()
	if fresh {
		return id
	}
	var out struct {
		Results []struct {
			ID    int    `json:"id"`
			Email string `json:"email"`
		} `json:"results"`
	}
	m := map[string]int{}
	if err := c.do(ctx, "GET", "/user?take=1000", 0, nil, &out); err == nil {
		for _, u := range out.Results {
			m[strings.ToLower(u.Email)] = u.ID
		}
	}
	c.mu.Lock()
	c.users, c.usersAt = m, time.Now()
	c.mu.Unlock()
	return m[email]
}

// StatusCode maps an error to an HTTP status for Lumen's API.
func StatusCode(err error) int {
	var e *Error
	if errors.As(err, &e) {
		switch {
		case e.Status == 401 || e.Status == 403:
			return 403
		case e.Status == 409:
			return 409
		case e.Status >= 500:
			return 502
		}
		return 400
	}
	return 502
}
