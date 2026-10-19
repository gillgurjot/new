package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gillgurjot/lumen/internal/metadata"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/go-chi/chi/v5"
)

func (s *Server) adminSystem(w http.ResponseWriter, r *http.Request) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	writeJSON(w, 200, map[string]any{
		"version":       Version,
		"uptime":        int(time.Since(s.StartedAt).Seconds()),
		"hwaccel":       s.Streams.Caps(),
		"stats":         s.St.Stats(),
		"scans":         s.Scanner.Statuses(),
		"tmdb":          s.TMDB.Enabled(),
		"maxTranscodes": s.Cfg.MaxTranscodes,
		"memoryMB":      ms.Alloc / 1024 / 1024,
		"goroutines":    runtime.NumGoroutine(),
		"publicUrl":     s.Cfg.PublicURL,
		"adminGroup":    s.Cfg.OIDCAdminGroup,
	})
}

func (s *Server) adminLibraries(w http.ResponseWriter, r *http.Request) {
	libs, err := s.St.Libraries()
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	if libs == nil {
		libs = []*store.Library{}
	}
	writeJSON(w, 200, map[string]any{"libraries": libs, "scans": s.Scanner.Statuses()})
}

type libReq struct {
	Name  string   `json:"name"`
	Type  string   `json:"type"`
	Paths []string `json:"paths"`
}

func cleanPaths(in []string) ([]string, string) {
	var out []string
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !filepath.IsAbs(p) {
			return nil, "paths must be absolute: " + p
		}
		st, err := os.Stat(p)
		if err != nil || !st.IsDir() {
			return nil, "folder not found on server: " + p
		}
		out = append(out, filepath.Clean(p))
	}
	if len(out) == 0 {
		return nil, "add at least one folder"
	}
	return out, ""
}

func (s *Server) adminCreateLibrary(w http.ResponseWriter, r *http.Request) {
	var b libReq
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if b.Type != "movies" && b.Type != "tv" {
		writeErr(w, 400, "type must be movies or tv")
		return
	}
	if strings.TrimSpace(b.Name) == "" {
		writeErr(w, 400, "name is required")
		return
	}
	paths, msg := cleanPaths(b.Paths)
	if msg != "" {
		writeErr(w, 400, msg)
		return
	}
	l, err := s.St.CreateLibrary(strings.TrimSpace(b.Name), b.Type, paths)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	s.Watcher.Reload()
	s.Jobs.ScanLibrary(s.Ctx, l.ID)
	writeJSON(w, 201, l)
}

func (s *Server) adminUpdateLibrary(w http.ResponseWriter, r *http.Request) {
	var b libReq
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	paths, msg := cleanPaths(b.Paths)
	if msg != "" {
		writeErr(w, 400, msg)
		return
	}
	id := idParam(r, "id")
	if err := s.St.UpdateLibrary(id, strings.TrimSpace(b.Name), paths); err != nil {
		s.notFoundOr500(w, err)
		return
	}
	s.Watcher.Reload()
	s.Jobs.ScanLibrary(s.Ctx, id)
	l, _ := s.St.Library(id)
	writeJSON(w, 200, l)
}

func (s *Server) adminDeleteLibrary(w http.ResponseWriter, r *http.Request) {
	if err := s.St.DeleteLibrary(idParam(r, "id")); err != nil {
		s.notFoundOr500(w, err)
		return
	}
	s.Watcher.Reload()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminScan(w http.ResponseWriter, r *http.Request) {
	s.Jobs.ScanLibrary(s.Ctx, idParam(r, "id"))
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) adminRefreshLibrary(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	_, err := s.St.DB.Exec(`UPDATE items SET metadata_state='pending' WHERE library_id=? AND metadata_state != 'locked'`, id)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	s.Jobs.RefreshMetadata(id)
	writeJSON(w, 202, map[string]bool{"ok": true})
}

// adminBrowse lists sub-folders so admins can pick library paths in the UI.
func (s *Server) adminBrowse(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		p = "/"
	}
	p = filepath.Clean(p)
	entries, err := os.ReadDir(p)
	if err != nil {
		writeErr(w, 400, "can't read folder")
		return
	}
	dirs := []string{}
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, e.Name())
		} else if e.Type()&os.ModeSymlink != 0 {
			if st, err := os.Stat(filepath.Join(p, e.Name())); err == nil && st.IsDir() {
				dirs = append(dirs, e.Name())
			}
		}
	}
	sort.Strings(dirs)
	parent := filepath.Dir(p)
	writeJSON(w, 200, map[string]any{"path": p, "parent": parent, "dirs": dirs})
}

func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request) {
	us, err := s.St.Users()
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	if us == nil {
		us = []*store.User{}
	}
	writeJSON(w, 200, us)
}

func (s *Server) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Disabled   bool    `json:"disabled"`
		MaxBitrate int     `json:"maxBitrate"`
		LibraryIDs []int64 `json:"libraryIds"`
	}
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	id := idParam(r, "id")
	if id == userFrom(r).ID && b.Disabled {
		writeErr(w, 400, "you can't disable yourself")
		return
	}
	if err := s.St.UpdateUserAdmin(id, b.Disabled, max(b.MaxBitrate, 0), b.LibraryIDs); err != nil {
		s.notFoundOr500(w, err)
		return
	}
	u, err := s.St.User(id)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, u)
}

func (s *Server) adminSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.Streams.List())
}

func (s *Server) adminStopSession(w http.ResponseWriter, r *http.Request) {
	s.Streams.Stop(chi.URLParam(r, "id"))
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) adminIdentifySearch(w http.ResponseWriter, r *http.Request) {
	if !s.TMDB.Enabled() {
		writeErr(w, 400, "set TMDB_API_KEY to search for metadata")
		return
	}
	it, err := s.St.ItemRaw(mustInt(r.URL.Query().Get("itemId")))
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	kind := "movie"
	if it.Type == "series" {
		kind = "tv"
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		q = it.Title
	}
	year, _ := strconv.Atoi(r.URL.Query().Get("year"))
	res, err := s.TMDB.Search(r.Context(), kind, q, year)
	if err != nil {
		writeErr(w, 502, "TMDB search failed")
		return
	}
	type out struct {
		ID       int    `json:"id"`
		Title    string `json:"title"`
		Year     int    `json:"year"`
		Overview string `json:"overview"`
		Poster   string `json:"poster,omitempty"`
	}
	list := []out{}
	for _, x := range res {
		o := out{ID: x.ID, Title: x.DisplayTitle(), Year: x.Year(), Overview: x.Overview}
		if x.PosterPath != "" {
			o.Poster = metadata.ImageBase + "w185" + x.PosterPath
		}
		list = append(list, o)
	}
	writeJSON(w, 200, list)
}

func mustInt(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

func (s *Server) adminIdentify(w http.ResponseWriter, r *http.Request) {
	var b struct {
		TMDBID int `json:"tmdbId"`
	}
	if err := decode(r, &b); err != nil || b.TMDBID <= 0 {
		writeErr(w, 400, "tmdbId required")
		return
	}
	id := idParam(r, "id")
	go func() {
		ctx, cancel := context.WithTimeout(s.Ctx, 10*time.Minute)
		defer cancel()
		if err := s.Fetcher.Identify(ctx, id, b.TMDBID); err != nil {
			s.Log.Error("identify", "err", err)
		}
	}()
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) adminRefreshItem(w http.ResponseWriter, r *http.Request) {
	id := idParam(r, "id")
	go func() {
		ctx, cancel := context.WithTimeout(s.Ctx, 10*time.Minute)
		defer cancel()
		s.Fetcher.RefreshItem(ctx, id)
	}()
	writeJSON(w, 202, map[string]bool{"ok": true})
}
