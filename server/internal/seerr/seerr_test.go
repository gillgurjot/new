package seerr

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient(t *testing.T) {
	var lastBody map[string]any
	var lastUser, lastQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "k" {
			w.WriteHeader(401)
			return
		}
		lastUser = r.Header.Get("X-Api-User")
		switch r.URL.Path {
		case "/api/v1/search":
			lastQuery = r.URL.RawQuery
			_, _ = io.WriteString(w, `{"page":1,"totalPages":1,"results":[{"id":1,"mediaType":"movie","title":"Dune","releaseDate":"2021-09-15","mediaInfo":{"status":3}},{"id":2,"mediaType":"person","name":"X"}]}`)
		case "/api/v1/user":
			_, _ = io.WriteString(w, `{"results":[{"id":7,"email":"Gurjot@Example.com"}]}`)
		case "/api/v1/request":
			if r.Method == "POST" {
				lastBody = nil
				_ = json.NewDecoder(r.Body).Decode(&lastBody)
				if lastBody["mediaId"] == float64(99) {
					w.WriteHeader(409)
					_, _ = io.WriteString(w, `{"message":"Request already exists"}`)
					return
				}
				w.WriteHeader(201)
				_, _ = io.WriteString(w, `{}`)
			}
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	c := New(srv.URL, "k")

	p, err := c.Search(ctx, "dune part two", 1)
	if err != nil || len(p.Results) != 2 || p.Results[0].Year() != 2021 || p.Results[0].MediaInfo.Status != 3 {
		t.Fatalf("search: %v %+v", err, p)
	}
	if lastQuery != "page=1&query=dune%20part%20two" {
		t.Errorf("spaces must be %%20, got %s", lastQuery)
	}
	if id := c.UserFor(ctx, "gurjot@example.com"); id != 7 {
		t.Errorf("email match: got %d", id)
	}
	if id := c.UserFor(ctx, "nobody@example.com"); id != 0 {
		t.Errorf("unknown email: got %d", id)
	}
	if err := c.Request(ctx, 7, "tv", 5, nil); err != nil {
		t.Fatal(err)
	}
	if lastBody["seasons"] != "all" || lastUser != "7" || lastBody["mediaType"] != "tv" {
		t.Errorf("tv all seasons: %v user %s", lastBody, lastUser)
	}
	_ = c.Request(ctx, 0, "tv", 5, []int{2, 3})
	if s, _ := lastBody["seasons"].([]any); len(s) != 2 || lastUser != "" {
		t.Errorf("tv some seasons: %v user %q", lastBody, lastUser)
	}
	_ = c.Request(ctx, 0, "movie", 5, nil)
	if _, has := lastBody["seasons"]; has {
		t.Errorf("movie must not send seasons: %v", lastBody)
	}
	err = c.Request(ctx, 0, "movie", 99, nil)
	if err == nil || err.Error() != "Request already exists" || StatusCode(err) != 409 {
		t.Errorf("duplicate: %v", err)
	}
	if _, err := New(srv.URL, "wrong").Search(ctx, "x", 1); StatusCode(err) != 403 {
		t.Errorf("bad key should be 403, got %v", err)
	}
	if New("", "") != nil || (*Client)(nil).Enabled() {
		t.Error("unset config should disable")
	}
}
