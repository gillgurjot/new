// Package jellyfin talks to a Jellyfin server with an admin API key, so Lumen can keep
// watch history, resume points and favourites in step with it and reuse the intro and
// credits segments its Intro Skipper plugin found.
package jellyfin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	base string
	key  string
	http *http.Client
}

func New(baseURL, apiKey string) *Client {
	if baseURL == "" || apiKey == "" {
		return nil
	}
	return &Client{base: strings.TrimRight(baseURL, "/"), key: apiKey, http: &http.Client{Timeout: 60 * time.Second}}
}

func (c *Client) Enabled() bool { return c != nil }

func (c *Client) do(ctx context.Context, method, path string, q url.Values, body, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", `MediaBrowser Client="Lumen", Device="Lumen", DeviceId="lumen-sync", Version="1", Token="`+c.key+`"`)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		return fmt.Errorf("jellyfin %s %s: %s %s", method, path, resp.Status, strings.TrimSpace(string(msg)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type User struct {
	ID   string `json:"Id"`
	Name string `json:"Name"`
}

func (c *Client) Users(ctx context.Context) ([]User, error) {
	var out []User
	return out, c.do(ctx, "GET", "/Users", nil, nil, &out)
}

type UserData struct {
	PlaybackPositionTicks int64      `json:"PlaybackPositionTicks"`
	PlayCount             int        `json:"PlayCount"`
	IsFavorite            bool       `json:"IsFavorite"`
	Played                bool       `json:"Played"`
	LastPlayedDate        *time.Time `json:"LastPlayedDate,omitempty"`
}

type Item struct {
	ID       string    `json:"Id"`
	Type     string    `json:"Type"`
	Path     string    `json:"Path"`
	UserData *UserData `json:"UserData"`
}

// Items returns every movie and episode the user can see, with their user data.
func (c *Client) Items(ctx context.Context, userID string) ([]Item, error) {
	q := url.Values{}
	q.Set("userId", userID)
	q.Set("recursive", "true")
	q.Set("includeItemTypes", "Movie,Episode")
	q.Set("fields", "Path")
	q.Set("enableUserData", "true")
	q.Set("enableImages", "false")
	q.Set("enableTotalRecordCount", "false")
	var out struct {
		Items []Item `json:"Items"`
	}
	return out.Items, c.do(ctx, "GET", "/Items", q, nil, &out)
}

// UpdateUserData sets played, position and favourite for one item.
func (c *Client) UpdateUserData(ctx context.Context, userID, itemID string, d UserData) error {
	q := url.Values{}
	q.Set("userId", userID)
	return c.do(ctx, "POST", "/UserItems/"+url.PathEscape(itemID)+"/UserData", q, d, nil)
}

type Segment struct {
	Type       string `json:"Type"` // Intro | Outro | Recap | Preview | Commercial
	StartTicks int64  `json:"StartTicks"`
	EndTicks   int64  `json:"EndTicks"`
}

func (s Segment) Start() float64 { return float64(s.StartTicks) / 1e7 }
func (s Segment) End() float64   { return float64(s.EndTicks) / 1e7 }

func (c *Client) Segments(ctx context.Context, itemID string) ([]Segment, error) {
	var out struct {
		Items []Segment `json:"Items"`
	}
	return out.Items, c.do(ctx, "GET", "/MediaSegments/"+url.PathEscape(itemID), nil, nil, &out)
}
