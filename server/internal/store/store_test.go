package store_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/store"
)

func open(t *testing.T) *store.Store {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return store.New(d)
}

func TestSessionsSlide(t *testing.T) {
	st := open(t)
	u, err := st.UpsertOIDCUser("sub", "gill", "Gill", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSession("tok", u.ID, time.Hour, "", ""); err != nil {
		t.Fatal(err)
	}
	expiry := func() (exp, seen int64) {
		st.DB.QueryRow(`SELECT expires_at, last_seen FROM sessions`).Scan(&exp, &seen)
		return
	}
	// Fresh session: nothing to slide yet.
	if _, slid, err := st.SessionUser("tok", 24*time.Hour); err != nil || slid {
		t.Fatalf("fresh session: slid=%v err=%v", slid, err)
	}
	// Last used ten minutes ago: the expiry moves to ttl from now.
	st.DB.Exec(`UPDATE sessions SET last_seen = last_seen - 600`)
	got, slid, err := st.SessionUser("tok", 24*time.Hour)
	if err != nil || !slid || got.ID != u.ID {
		t.Fatalf("used session: slid=%v err=%v", slid, err)
	}
	exp, seen := expiry()
	if want := time.Now().Add(24 * time.Hour).Unix(); exp < want-5 || exp > want+5 {
		t.Fatalf("expiry %d, want about %d", exp, want)
	}
	if time.Now().Unix()-seen > 5 {
		t.Fatal("last_seen not updated")
	}
	// Expired sessions don't come back to life.
	st.DB.Exec(`UPDATE sessions SET expires_at = 1, last_seen = 1`)
	if _, _, err := st.SessionUser("tok", 24*time.Hour); err != store.ErrNotFound {
		t.Fatalf("expired session: err=%v, want not found", err)
	}
	if exp, _ := expiry(); exp != 1 {
		t.Fatal("an expired session was extended")
	}
}

func TestFeaturedIsStable(t *testing.T) {
	st := open(t)
	u, _ := st.UpsertOIDCUser("sub", "gill", "Gill", "", "", false)
	lib, _ := st.CreateLibrary("Movies", "movies", []string{"/m"})
	for i := 0; i < 30; i++ {
		id, err := st.AddFile(store.NewItem{LibraryID: lib.ID, Type: "movie", Title: "M", Folder: "/m"}, &store.MediaFile{Path: filepath.Join("/m", string(rune('a'+i))+".mkv")})
		if err != nil {
			t.Fatal(err)
		}
		st.SetImage(id, "backdrop", "/m/b.jpg")
	}
	ids := func() []int64 {
		items, err := st.Featured(u, 6)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]int64, len(items))
		for i, it := range items {
			out[i] = it.ID
		}
		return out
	}
	first := ids()
	if len(first) != 6 {
		t.Fatalf("got %d featured, want 6", len(first))
	}
	for i := 0; i < 5; i++ {
		if again := ids(); !equal(first, again) {
			t.Fatalf("featured changed between loads: %v then %v", first, again)
		}
	}
}

func equal(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
