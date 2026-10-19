package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spa serves the embedded web app, falling back to index.html for client routes.
func (s *Server) spa(compress func(http.Handler) http.Handler) http.HandlerFunc {
	if s.Web == nil {
		return func(w http.ResponseWriter, r *http.Request) { http.Error(w, "web UI not built", 404) }
	}
	fileServer := http.FileServer(http.FS(s.Web))
	h := compress(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeErr(w, 404, "not found")
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if st, err := fs.Stat(s.Web, p); err != nil || st.IsDir() {
			// Client-side route: serve the app shell.
			w.Header().Set("Cache-Control", "no-cache")
			b, err := fs.ReadFile(s.Web, "index.html")
			if err != nil {
				http.Error(w, "web UI not built", 404)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(b)
			return
		}
		switch {
		case strings.HasPrefix(p, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable") // hashed filenames
		case p == "sw.js" || p == "index.html" || strings.HasSuffix(p, ".webmanifest"):
			w.Header().Set("Cache-Control", "no-cache")
		default:
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}
		fileServer.ServeHTTP(w, r)
	}))
	return h.ServeHTTP
}
