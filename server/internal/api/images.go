package api

import (
	"crypto/sha1"
	"encoding/hex"
	"net/http"
	"regexp"
	"strconv"

	"github.com/gillgurjot/lumen/internal/metadata"
	"github.com/go-chi/chi/v5"
)

func (s *Server) image(w http.ResponseWriter, r *http.Request) {
	it, err := s.St.Item(idParam(r, "itemID"), userFrom(r))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	kind := chi.URLParam(r, "kind")
	var ref string
	switch kind {
	case "poster":
		ref = it.Poster
	case "backdrop":
		ref = it.Backdrop
	case "logo":
		ref = it.Logo
	case "still":
		ref = it.Still
	}
	if ref == "" {
		http.NotFound(w, r)
		return
	}
	src := s.Images.Resolve(ref)
	wd, _ := strconv.Atoi(r.URL.Query().Get("w"))
	p, err := s.Images.Resized(it.ID, kind, src, wd)
	if err != nil {
		s.Log.Debug("resize failed", "err", err)
		p = src
	}
	if r.URL.Query().Get("tag") != "" {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "private, max-age=3600")
	}
	http.ServeFile(w, r, p)
}

var tmdbPath = regexp.MustCompile(`^/[A-Za-z0-9_-]+\.(jpg|png)$`)

var tmdbSizes = map[string]bool{"w185": true, "w342": true, "w500": true, "w780": true, "w1280": true}

// tmdbImage proxies and caches TMDB posters/backdrops for titles that aren't in the library yet.
func (s *Server) tmdbImage(w http.ResponseWriter, r *http.Request) {
	p, size := r.URL.Query().Get("p"), r.URL.Query().Get("s")
	if !tmdbPath.MatchString(p) {
		http.NotFound(w, r)
		return
	}
	if !tmdbSizes[size] {
		size = "w342"
	}
	h := sha1.Sum([]byte(size + p))
	file, err := s.Images.RemoteFile(r.Context(), "t_"+hex.EncodeToString(h[:8])+".jpg", metadata.ImageBase+size+p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=2592000, immutable")
	http.ServeFile(w, r, file)
}

// personImage proxies and caches TMDB cast photos so clients never call TMDB directly.
func (s *Server) personImage(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("p")
	if !tmdbPath.MatchString(p) {
		http.NotFound(w, r)
		return
	}
	h := sha1.Sum([]byte(p))
	file, err := s.Images.RemoteFile(r.Context(), "p_"+hex.EncodeToString(h[:8])+".jpg", metadata.ImageBase+"w185"+p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=2592000, immutable")
	http.ServeFile(w, r, file)
}
