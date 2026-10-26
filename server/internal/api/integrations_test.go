package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gillgurjot/lumen/internal/config"
	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/jobs"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/go-chi/chi/v5"
)

func TestIntegrations(t *testing.T) {
	d, err := db.Open(filepath.Join(t.TempDir(), "lumen.db"))
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := &Server{Cfg: &config.Config{SeerrURL: "http://env-seerr", SeerrAPIKey: "envkey"}, St: st, Log: log, Jobs: &jobs.Runner{St: st, Log: log}}
	s.LoadIntegrations()

	// A fake Jellyfin and Seerr that only accept "good".
	jf := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Authorization"), `Token="good"`) {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte(`[{"Id":"u1","Name":"gill"}]`))
	}))
	defer jf.Close()
	se := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "good" {
			w.WriteHeader(403)
			return
		}
		w.Write([]byte(`{"id":1}`))
	}))
	defer se.Close()

	r := chi.NewRouter()
	r.Get("/i", s.adminIntegrations)
	r.Put("/i/{name}", s.adminSaveIntegration)
	r.Delete("/i/{name}", s.adminRemoveIntegration)
	call := func(method, path string, body any) (int, map[string]integrationInfo) {
		b, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewReader(b)))
		var out map[string]integrationInfo
		json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}

	_, out := call("GET", "/i", nil)
	if out["jellyfin"].Enabled || out["jellyfin"].Source != "" || !out["seerr"].Enabled || out["seerr"].Source != "env" {
		t.Fatalf("start: %+v", out)
	}
	if code, _ := call("PUT", "/i/jellyfin", map[string]string{"url": jf.URL, "apiKey": "bad"}); code != 400 {
		t.Fatalf("bad key saved: %d", code)
	}
	if s.Jobs.Jellyfin() != nil || st.Setting(setJellyfinKey) != "" {
		t.Fatal("bad key was kept")
	}
	if code, out := call("PUT", "/i/jellyfin", map[string]string{"url": jf.URL + "/", "apiKey": "good"}); code != 200 || !out["jellyfin"].Enabled || out["jellyfin"].Source != "saved" || out["jellyfin"].URL != jf.URL {
		t.Fatalf("save: %d %+v", code, out)
	}
	// Changing only the URL keeps the saved key.
	if code, _ := call("PUT", "/i/jellyfin", map[string]string{"url": jf.URL}); code != 200 || st.Setting(setJellyfinKey) != "good" {
		t.Fatalf("keep key: %d", code)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/i", nil))
	if strings.Contains(w.Body.String(), "good") {
		t.Fatal("API key sent to the browser")
	}

	// Seerr from the environment is replaced by the saved one, and can be turned off.
	if code, out := call("PUT", "/i/seerr", map[string]string{"url": se.URL, "apiKey": "good", "publicUrl": "https://request.example.com"}); code != 200 || out["seerr"].PublicURL != "https://request.example.com" {
		t.Fatalf("seerr save: %d %+v", code, out)
	}
	if code, out := call("DELETE", "/i/seerr", nil); code != 200 || out["seerr"].Enabled || out["seerr"].Source != "off" || s.seerr() != nil {
		t.Fatalf("seerr off: %d %+v", code, out)
	}
	if code, out := call("DELETE", "/i/jellyfin", nil); code != 200 || out["jellyfin"].Enabled || s.Jobs.Jellyfin() != nil {
		t.Fatalf("jellyfin off: %d %+v", code, out)
	}
	// Still off after a restart.
	s.LoadIntegrations()
	if s.seerr() != nil || s.Jobs.Jellyfin() != nil {
		t.Fatal("came back on after a restart")
	}
}
