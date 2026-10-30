package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gillgurjot/lumen/internal/auth"
	"github.com/gillgurjot/lumen/internal/config"
	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/jobs"
	"github.com/gillgurjot/lumen/internal/party"
	"github.com/gillgurjot/lumen/internal/store"
)

type testEnv struct {
	s     *Server
	h     http.Handler
	admin string // session tokens
	kid   string
	libA  int64
	itemB int64
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	st := store.New(d)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{PublicURL: "http://lumen.test", SessionTTL: 24 * time.Hour, DevInsecureLogin: true}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	s := &Server{Cfg: cfg, St: st, Auth: auth.New(cfg, st, log), Log: log, Jobs: &jobs.Runner{St: st, Log: log}, Party: party.NewHub(), Ctx: ctx}
	e := &testEnv{s: s, h: s.Router(), admin: "admin-token", kid: "kid-token"}

	admin, _ := st.UpsertOIDCUser("a", "admin", "Admin", "", "", true)
	kid, _ := st.UpsertOIDCUser("k", "kid", "Kid", "", "", false)
	st.CreateSession(e.admin, admin.ID, cfg.SessionTTL, "", "")
	st.CreateSession(e.kid, kid.ID, cfg.SessionTTL, "", "")
	a, _ := st.CreateLibrary("Kids", "movies", []string{t.TempDir()})
	b, _ := st.CreateLibrary("Grown-ups", "movies", []string{t.TempDir()})
	e.libA = a.ID
	st.UpdateUserAdmin(kid.ID, store.UserAdminFields{LibraryIDs: []int64{a.ID}, CanDownload: true, CanRequest: true})
	e.itemB, _ = st.AddFile(store.NewItem{LibraryID: b.ID, Type: "movie", Title: "Grown-up film", Folder: "/b"}, &store.MediaFile{Path: "/b/film.mkv"})
	return e
}

func (e *testEnv) do(t *testing.T, ctx context.Context, method, path, token string, cookie bool, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	r.Header.Set("X-Lumen-Request", "1")
	if cookie {
		r.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
	} else {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, r)
	return w
}

func TestPartyEventsCheckAccess(t *testing.T) {
	e := newEnv(t)
	id := e.s.Party.Create(1, e.itemB, 0)
	if w := e.do(t, context.Background(), "GET", "/api/party/"+id+"/events", e.kid, false, ""); w.Code != 403 {
		t.Fatalf("restricted user joined a party for a title they can't see: %d", w.Code)
	}
	if w := e.do(t, context.Background(), "GET", "/api/party/nope/events", e.kid, false, ""); w.Code != 404 {
		t.Fatalf("unknown party: %d", w.Code)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	w := e.do(t, ctx, "GET", "/api/party/"+id+"/events", e.admin, false, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"snapshot"`) {
		t.Fatalf("admin: %d %q", w.Code, w.Body.String())
	}
}

func TestCookieRenewedAsSessionSlides(t *testing.T) {
	e := newEnv(t)
	e.s.St.DB.Exec(`UPDATE sessions SET last_seen = last_seen - 3600`)
	w := e.do(t, context.Background(), "GET", "/api/me", e.admin, true, "")
	if w.Code != 200 {
		t.Fatalf("me: %d", w.Code)
	}
	c := w.Result().Cookies()
	if len(c) != 1 || c[0].Name != auth.SessionCookie || c[0].Value != e.admin || c[0].MaxAge != int((24*time.Hour).Seconds()) {
		t.Fatalf("cookie not renewed: %+v", c)
	}
	// Right after, nothing to renew.
	if w := e.do(t, context.Background(), "GET", "/api/me", e.admin, true, ""); len(w.Result().Cookies()) != 0 {
		t.Fatal("cookie renewed on every request")
	}
	// The app's bearer sessions slide too, but never get a cookie.
	e.s.St.DB.Exec(`UPDATE sessions SET last_seen = last_seen - 3600`)
	if w := e.do(t, context.Background(), "GET", "/api/me", e.kid, false, ""); w.Code != 200 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("bearer: %d %v", w.Code, w.Result().Cookies())
	}
}

func TestUpdateLibraryValidates(t *testing.T) {
	e := newEnv(t)
	dir := t.TempDir()
	if w := e.do(t, context.Background(), "PUT", "/api/admin/libraries/999", e.admin, false, `{"name":"X","paths":["`+dir+`"]}`); w.Code != 404 {
		t.Fatalf("missing library: %d %s", w.Code, w.Body)
	}
	if w := e.do(t, context.Background(), "PUT", "/api/admin/libraries/1", e.admin, false, `{"name":"  ","paths":["`+dir+`"]}`); w.Code != 400 {
		t.Fatalf("blank name: %d %s", w.Code, w.Body)
	}
	if w := e.do(t, context.Background(), "PUT", "/api/admin/libraries/1", e.kid, false, `{"name":"X","paths":["`+dir+`"]}`); w.Code != 403 {
		t.Fatalf("non-admin: %d", w.Code)
	}
}
