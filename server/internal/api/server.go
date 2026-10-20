// Package api exposes the REST and streaming HTTP endpoints.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gillgurjot/lumen/internal/auth"
	"github.com/gillgurjot/lumen/internal/config"
	"github.com/gillgurjot/lumen/internal/images"
	"github.com/gillgurjot/lumen/internal/jobs"
	"github.com/gillgurjot/lumen/internal/library"
	"github.com/gillgurjot/lumen/internal/metadata"
	"github.com/gillgurjot/lumen/internal/party"
	"github.com/gillgurjot/lumen/internal/seerr"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/gillgurjot/lumen/internal/stream"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

const Version = "1.0.0"

type Server struct {
	Cfg       *config.Config
	St        *store.Store
	Auth      *auth.Auth
	Images    *images.Cache
	Scanner   *library.Scanner
	Watcher   *library.Watcher
	Fetcher   *metadata.Fetcher
	TMDB      *metadata.TMDB
	Streams   *stream.Manager
	Subs      *stream.Subtitles
	Jobs      *jobs.Runner
	Party     *party.Hub
	Seerr     *seerr.Client // nil when not configured
	Log       *slog.Logger
	Web       fs.FS // built SPA
	Ctx       context.Context
	StartedAt time.Time
}

type ctxKey int

const userKey ctxKey = 1

func userFrom(r *http.Request) *store.User {
	u, _ := r.Context().Value(userKey).(*store.User)
	return u
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	return json.NewDecoder(r.Body).Decode(v)
}

func idParam(r *http.Request, name string) int64 {
	n, _ := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	return n
}

func (s *Server) notFoundOr500(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "not found")
		return
	}
	s.Log.Error("request failed", "err", err)
	writeErr(w, 500, "internal error")
}

// requireUser authenticates API calls with the session cookie.
func (s *Server) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := s.Auth.SessionUser(r)
		if u == nil {
			writeErr(w, 401, "not signed in")
			return
		}
		// Basic CSRF defence on top of SameSite=Lax: mutating calls must come from our JS.
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Lumen-Request") != "1" {
			writeErr(w, 403, "missing request header")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

// requireMedia accepts the session cookie or a signed media token (?t=) for cast devices.
func (s *Server) requireMedia(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
		u := s.Auth.SessionUser(r)
		if u == nil {
			if t := r.URL.Query().Get("t"); t != "" {
				if uid, ok := s.Auth.VerifyMediaToken(t); ok {
					if usr, err := s.St.User(uid); err == nil && !usr.Disabled {
						u = usr
					}
				}
			}
		}
		if u == nil {
			http.Error(w, "unauthorized", 401)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u := userFrom(r); u == nil || !u.IsAdmin {
			writeErr(w, 403, "admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.Recoverer)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "same-origin")
			next.ServeHTTP(w, r)
		})
	})
	compress := middleware.Compress(5, "application/json", "text/html", "text/css", "application/javascript", "text/javascript", "image/svg+xml", "application/manifest+json", "text/vtt")

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok", "version": Version}) })

	r.Route("/api/auth", func(r chi.Router) {
		r.Get("/config", s.authConfig)
		r.Get("/login", s.Auth.Login)
		r.Get("/callback", s.Auth.Callback)
		r.Get("/dev-login", s.Auth.DevLogin)
		r.Post("/app-token", s.Auth.AppToken)
		r.Post("/logout", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, 200, map[string]string{"redirect": s.Auth.Logout(w, r)})
		})
	})

	// Media endpoints: cookie or token, CORS enabled for Chromecast.
	r.Group(func(r chi.Router) {
		r.Use(s.requireMedia)
		r.Get("/api/stream/{fileID}/file", s.directStream)
		r.Head("/api/stream/{fileID}/file", s.directStream)
		r.Options("/api/stream/{fileID}/file", func(http.ResponseWriter, *http.Request) {})
		r.Get("/api/hls/{sessionID}/index.m3u8", s.hlsPlaylist)
		r.Get("/api/hls/{sessionID}/{name}", s.hlsSegment)
		r.Options("/api/hls/{sessionID}/{name}", func(http.ResponseWriter, *http.Request) {})
		r.With(compress).Get("/api/subtitles/{fileID}/{index}.vtt", s.subtitle)
		r.Get("/api/images/{itemID}/{kind}", s.image)
		r.Get("/api/person-image", s.personImage)
		r.Get("/api/tmdb-image", s.tmdbImage)
		r.Get("/api/trickplay/{fileID}/index.json", s.trickplayIndex)
		r.Get("/api/trickplay/{fileID}/{sheet}.jpg", s.trickplaySheet)
	})

	r.Group(func(r chi.Router) {
		r.Use(s.requireUser, compress)
		r.Get("/api/me", s.me)
		r.Put("/api/me/preferences", s.updatePrefs)
		r.Get("/api/libraries", s.libraries)
		r.Get("/api/libraries/{id}/items", s.libraryItems)
		r.Get("/api/libraries/{id}/genres", s.libraryGenres)
		r.Get("/api/home", s.home)
		r.Get("/api/search", s.search)
		r.Get("/api/favorites", s.favorites)
		r.Get("/api/items/{id}", s.item)
		r.Get("/api/items/{id}/children", s.children)
		r.Get("/api/items/{id}/episodes", s.episodes)
		r.Get("/api/items/{id}/next", s.nextEpisode)
		r.Post("/api/items/{id}/played", s.setPlayed(true))
		r.Delete("/api/items/{id}/played", s.setPlayed(false))
		r.Post("/api/items/{id}/favorite", s.setFavorite(true))
		r.Delete("/api/items/{id}/favorite", s.setFavorite(false))
		r.Post("/api/playback/start", s.playbackStart)
		r.Post("/api/playback/progress", s.playbackProgress)
		r.Post("/api/playback/stop", s.playbackStop)
		r.Get("/api/items/{id}/download", s.download)

		r.Post("/api/party", s.partyCreate)
		r.Get("/api/party/{id}", s.partyGet)
		r.Post("/api/party/{id}/state", s.partyState)
		r.Post("/api/party/{id}/chat", s.partyChat)

		r.Get("/api/requests/config", s.requestsConfig)
		r.Group(func(r chi.Router) {
			r.Use(s.requireSeerr)
			r.Get("/api/requests/search", s.requestsSearch)
			r.Get("/api/requests/discover/{kind}", s.requestsDiscover)
			r.Get("/api/requests/title/{type}/{tmdbID}", s.requestsDetails)
			r.Get("/api/requests/recent", s.requestsRecent)
			r.Post("/api/requests", s.requestsCreate)
		})

		r.Route("/api/admin", func(r chi.Router) {
			r.Use(requireAdmin)
			r.Get("/system", s.adminSystem)
			r.Get("/libraries", s.adminLibraries)
			r.Post("/libraries", s.adminCreateLibrary)
			r.Put("/libraries/{id}", s.adminUpdateLibrary)
			r.Delete("/libraries/{id}", s.adminDeleteLibrary)
			r.Post("/libraries/{id}/scan", s.adminScan)
			r.Post("/libraries/{id}/refresh", s.adminRefreshLibrary)
			r.Get("/browse", s.adminBrowse)
			r.Get("/users", s.adminUsers)
			r.Put("/users/{id}", s.adminUpdateUser)
			r.Get("/sessions", s.adminSessions)
			r.Delete("/sessions/{id}", s.adminStopSession)
			r.Get("/identify", s.adminIdentifySearch)
			r.Post("/items/{id}/identify", s.adminIdentify)
			r.Post("/items/{id}/refresh", s.adminRefreshItem)
		})
	})

	// Long-lived event stream: no compression, which would buffer it.
	r.With(s.requireUser).Get("/api/party/{id}/events", s.partyEvents)

	r.NotFound(s.spa(compress))
	return r
}

func (s *Server) authConfig(w http.ResponseWriter, r *http.Request) {
	provider := ""
	if s.Cfg.OIDCIssuer != "" {
		provider = strings.TrimPrefix(strings.TrimPrefix(s.Cfg.OIDCIssuer, "https://"), "http://")
	}
	writeJSON(w, 200, map[string]any{"devLogin": s.Cfg.DevInsecureLogin, "provider": provider, "oidc": s.Cfg.OIDCIssuer != ""})
}
