package jobs

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/jellyfin"
	"github.com/gillgurjot/lumen/internal/store"
)

func TestPathMatcher(t *testing.T) {
	m := newPathMatcher([]store.FileRef{
		{FileID: 1, Path: "/media/tv/Show A/Season 01/01.mkv"},
		{FileID: 2, Path: "/media/tv/Show B/Season 01/01.mkv"},
		{FileID: 3, Path: "/media/movies/Film (2010)/Film.2010.mkv"},
	})
	for p, want := range map[string]int64{
		"/data/media/tv/Show B/Season 01/01.mkv":       2,
		"/data/media/movies/Film (2010)/Film.2010.mkv": 3,
		`D:\media\movies\film (2010)\FILM.2010.mkv`:    3,
		"/data/media/tv/Show C/Season 01/01.mkv":       0,
	} {
		f, ok := m.find(p)
		if (want == 0) == ok || f.FileID != want {
			t.Errorf("%s: got %d %v, want %d", p, f.FileID, ok, want)
		}
	}
}

// fakeJellyfin serves one user and a few items, and records user data updates.
type fakeJellyfin struct {
	mu    sync.Mutex
	items map[string]*jellyfin.Item
}

func (f *fakeJellyfin) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.URL.Path == "/Users":
		json.NewEncoder(w).Encode([]jellyfin.User{{ID: "u1", Name: "Gill"}})
	case r.URL.Path == "/Items":
		var list []jellyfin.Item
		for _, id := range []string{"m1", "e1", "e2"} {
			list = append(list, *f.items[id])
		}
		json.NewEncoder(w).Encode(map[string]any{"Items": list})
	case strings.HasPrefix(r.URL.Path, "/UserItems/"):
		id := strings.Split(r.URL.Path, "/")[2]
		var d jellyfin.UserData
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &d)
		f.items[id].UserData = &d
	case strings.HasPrefix(r.URL.Path, "/MediaSegments/e1"):
		json.NewEncoder(w).Encode(map[string]any{"Items": []jellyfin.Segment{{Type: "Intro", StartTicks: 50e7, EndTicks: 100e7}}})
	case strings.HasPrefix(r.URL.Path, "/MediaSegments/"):
		json.NewEncoder(w).Encode(map[string]any{"Items": []jellyfin.Segment{}})
	default:
		http.NotFound(w, r)
	}
}

func TestJellyfinSync(t *testing.T) {
	d, err := db.Open(filepath.Join(t.TempDir(), "lumen.db"))
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	exec := func(q string, args ...any) {
		if _, err := d.Exec(q, args...); err != nil {
			t.Fatal(q, err)
		}
	}
	now := time.Now().Unix()
	exec(`INSERT INTO users(id, subject, username, created_at) VALUES (1, 's', 'gill', ?)`, now)
	exec(`INSERT INTO libraries(id, name, type, paths, created_at) VALUES (1, 'L', 'movies', '[]', ?)`, now)
	for i, p := range []string{"/media/movies/M/m.mkv", "/media/tv/S/Season 01/e1.mkv", "/media/tv/S/Season 01/e2.mkv"} {
		id := i + 1
		exec(`INSERT INTO items(id, library_id, type, title, sort_title, date_added, updated_at) VALUES (?, 1, 'movie', 't', 't', ?, ?)`, id, now, now)
		exec(`INSERT INTO media_files(id, item_id, path, size, mtime, duration) VALUES (?, ?, ?, 1, 1, 1800)`, id, id, p)
	}
	// Lumen: the movie is half watched (played yesterday). Jellyfin: e1 was finished
	// last week, the movie was started a month ago.
	exec(`INSERT INTO user_data(user_id, item_id, position, last_played) VALUES (1, 1, 600, ?)`, now-86400)
	month := time.Now().Add(-30 * 24 * time.Hour)
	week := time.Now().Add(-7 * 24 * time.Hour)
	fake := &fakeJellyfin{items: map[string]*jellyfin.Item{
		"m1": {ID: "m1", Path: "/data/media/movies/M/m.mkv", UserData: &jellyfin.UserData{PlaybackPositionTicks: 120e7, LastPlayedDate: &month}},
		"e1": {ID: "e1", Path: "/data/media/tv/S/Season 01/e1.mkv", UserData: &jellyfin.UserData{Played: true, PlayCount: 1, LastPlayedDate: &week}},
		"e2": {ID: "e2", Path: "/data/media/tv/S/Season 01/e2.mkv", UserData: &jellyfin.UserData{}},
	}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	r := &Runner{St: st, Jellyfin: jellyfin.New(srv.URL, "k"), Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	ctx := context.Background()

	res, err := r.syncJellyfin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.pulled != 1 || res.pushed != 1 || res.segments != 1 || len(res.users) != 1 {
		t.Fatalf("first sync: %+v", res)
	}
	rows, _ := st.UserDataRows(1)
	if !rows[2].Played || rows[2].LastPlayed != week.Unix() {
		t.Fatalf("e1 not pulled: %+v", rows[2])
	}
	if got := fake.items["m1"].UserData.PlaybackPositionTicks; got != 600e7 {
		t.Fatalf("movie position not pushed: %d", got)
	}
	m, _ := st.MediaFile(2)
	if m.IntroStart != 50 || m.IntroEnd != 100 {
		t.Fatalf("intro not copied: %+v", m)
	}

	// Nothing changed: nothing to do.
	if res, _ = r.syncJellyfin(ctx); res.pulled+res.pushed != 0 {
		t.Fatalf("idle sync did work: %+v", res)
	}

	// Watched part of e2 in Jellyfin and marked the movie
	// played in Lumen.
	fake.mu.Lock()
	fake.items["e2"].UserData = &jellyfin.UserData{PlaybackPositionTicks: 300e7, LastPlayedDate: &week}
	fake.mu.Unlock()
	time.Sleep(5 * time.Millisecond)
	if err := st.SetPlayed(1, 1, true); err != nil {
		t.Fatal(err)
	}
	if res, _ = r.syncJellyfin(ctx); res.pulled != 1 || res.pushed != 1 {
		t.Fatalf("second sync: %+v", res)
	}
	rows, _ = st.UserDataRows(1)
	if rows[3].Position != 300 || rows[3].Played {
		t.Fatalf("e2 progress not pulled: %+v", rows[3])
	}
	if !fake.items["m1"].UserData.Played {
		t.Fatal("movie played not pushed")
	}
	if res, _ = r.syncJellyfin(ctx); res.pulled+res.pushed != 0 {
		t.Fatalf("sync after changes not idle: %+v", res)
	}
}
