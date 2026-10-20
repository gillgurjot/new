package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/gillgurjot/lumen/internal/seerr"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/go-chi/chi/v5"
)

// Title is a movie or show as shown on the request pages.
type Title struct {
	MediaType string  `json:"mediaType"` // movie | tv
	TMDBID    int     `json:"tmdbId"`
	Title     string  `json:"title"`
	Year      int     `json:"year,omitempty"`
	Overview  string  `json:"overview,omitempty"`
	Poster    string  `json:"poster,omitempty"`   // TMDB path, served through /api/tmdb-image
	Backdrop  string  `json:"backdrop,omitempty"` // TMDB path
	Rating    float64 `json:"rating,omitempty"`
	// none | pending (waiting for approval) | processing (downloading) | partial | available
	Status string `json:"status"`
	ItemID int64  `json:"itemId,omitempty"` // the Lumen item when it's already in the library
}

type seasonInfo struct {
	SeasonNumber int    `json:"seasonNumber"`
	Name         string `json:"name"`
	EpisodeCount int    `json:"episodeCount"`
	Status       string `json:"status"`
}

func mediaStatus(mi *seerr.MediaInfo) string {
	if mi == nil {
		return "none"
	}
	switch mi.Status {
	case 2:
		return "pending"
	case 3:
		return "processing"
	case 4:
		return "partial"
	case 5:
		return "available"
	}
	return "none"
}

// titles converts Seerr results and marks what's already in Lumen.
func (s *Server) titles(u *store.User, res []seerr.Result) []Title {
	var movies, shows []int
	for _, r := range res {
		switch r.MediaType {
		case "movie":
			movies = append(movies, r.ID)
		case "tv":
			shows = append(shows, r.ID)
		}
	}
	inMovies, _ := s.St.ItemsByTMDB(u, "movie", movies)
	inShows, _ := s.St.ItemsByTMDB(u, "series", shows)
	out := []Title{}
	for _, r := range res {
		if r.MediaType != "movie" && r.MediaType != "tv" {
			continue // people
		}
		t := Title{MediaType: r.MediaType, TMDBID: r.ID, Title: r.DisplayTitle(), Year: r.Year(), Overview: r.Overview,
			Poster: r.PosterPath, Backdrop: r.BackdropPath, Rating: r.VoteAverage, Status: mediaStatus(r.MediaInfo)}
		if r.MediaType == "movie" {
			t.ItemID = inMovies[r.ID]
		} else {
			t.ItemID = inShows[r.ID]
		}
		if t.ItemID != 0 && t.Status != "partial" {
			t.Status = "available"
		}
		out = append(out, t)
	}
	return out
}

func (s *Server) seerrErr(w http.ResponseWriter, err error) {
	s.Log.Warn("seerr", "err", err)
	writeErr(w, seerr.StatusCode(err), err.Error())
}

func (s *Server) requestsConfig(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	writeJSON(w, 200, map[string]any{"enabled": s.Seerr.Enabled(), "canRequest": s.Seerr.Enabled() && u.CanRequest, "seerrUrl": s.Cfg.SeerrPublicURL})
}

func (s *Server) requireSeerr(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.Seerr.Enabled() {
			writeErr(w, 404, "requests aren't set up (SEERR_URL / SEERR_API_KEY)")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestsSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if query == "" {
		writeJSON(w, 200, map[string]any{"results": []Title{}, "page": 1, "totalPages": 0})
		return
	}
	p, err := s.Seerr.Search(r.Context(), query, page)
	if err != nil {
		s.seerrErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"results": s.titles(userFrom(r), p.Results), "page": p.Page, "totalPages": p.TotalPages})
}

func (s *Server) requestsDiscover(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	p, err := s.Seerr.Discover(r.Context(), chi.URLParam(r, "kind"), page)
	if err != nil {
		s.seerrErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"results": s.titles(userFrom(r), p.Results), "page": p.Page, "totalPages": p.TotalPages})
}

func (s *Server) requestsDetails(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	mt := chi.URLParam(r, "type")
	id, _ := strconv.Atoi(chi.URLParam(r, "tmdbID"))
	if (mt != "movie" && mt != "tv") || id <= 0 {
		writeErr(w, 400, "bad title")
		return
	}
	d, err := s.Seerr.Details(r.Context(), mt, id, true)
	if err != nil {
		s.seerrErr(w, err)
		return
	}
	t := s.titles(u, []seerr.Result{d.Result})[0]
	var genres []string
	for _, g := range d.Genres {
		genres = append(genres, g.Name)
	}
	out := map[string]any{"title": t, "genres": genres, "runtime": d.Runtime}
	if mt == "tv" {
		out["seasons"] = s.seasonStatus(u, d, t.ItemID)
	}
	writeJSON(w, 200, out)
}

// seasonStatus combines Seerr's per-season status, open requests and Lumen's own seasons.
func (s *Server) seasonStatus(u *store.User, d *seerr.Details, itemID int64) []seasonInfo {
	have := map[int]bool{}
	if itemID != 0 {
		if seasons, err := s.St.Children(u, itemID); err == nil {
			for _, se := range seasons {
				if se.SeasonNumber != nil && se.ChildCount > 0 {
					have[*se.SeasonNumber] = true
				}
			}
		}
	}
	status := map[int]string{}
	if mi := d.MediaInfo; mi != nil {
		for _, ss := range mi.Seasons {
			switch ss.Status {
			case 3:
				status[ss.SeasonNumber] = "processing"
			case 4:
				status[ss.SeasonNumber] = "partial"
			case 5:
				status[ss.SeasonNumber] = "available"
			}
		}
		for _, rq := range mi.Requests {
			if rq.Status != 1 && rq.Status != 2 {
				continue
			}
			for _, rs := range rq.Seasons {
				if status[rs.SeasonNumber] == "" {
					if rq.Status == 1 {
						status[rs.SeasonNumber] = "pending"
					} else {
						status[rs.SeasonNumber] = "processing"
					}
				}
			}
		}
	}
	out := []seasonInfo{}
	for _, se := range d.Seasons {
		if se.SeasonNumber == 0 {
			continue // specials can't be requested as a season
		}
		st := status[se.SeasonNumber]
		if have[se.SeasonNumber] && st != "partial" {
			st = "available"
		}
		if st == "" {
			st = "none"
		}
		out = append(out, seasonInfo{SeasonNumber: se.SeasonNumber, Name: se.Name, EpisodeCount: se.EpisodeCount, Status: st})
	}
	return out
}

func (s *Server) requestsCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if !u.CanRequest {
		writeErr(w, 403, "requests are turned off for your account")
		return
	}
	var b struct {
		MediaType string `json:"mediaType"`
		TMDBID    int    `json:"tmdbId"`
		Seasons   []int  `json:"seasons"` // tv only; empty = all
	}
	if err := decode(r, &b); err != nil || (b.MediaType != "movie" && b.MediaType != "tv") || b.TMDBID <= 0 {
		writeErr(w, 400, "bad request")
		return
	}
	asUser := s.Seerr.UserFor(r.Context(), u.Email)
	if err := s.Seerr.Request(r.Context(), asUser, b.MediaType, b.TMDBID, b.Seasons); err != nil {
		s.seerrErr(w, err)
		return
	}
	s.Log.Info("request sent to seerr", "user", u.Username, "type", b.MediaType, "tmdb", b.TMDBID, "seerrUser", asUser)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

type recentRequest struct {
	ID          int    `json:"id"`
	Status      string `json:"status"` // pending | approved | declined | failed | available
	CreatedAt   string `json:"createdAt"`
	RequestedBy string `json:"requestedBy"`
	Seasons     []int  `json:"seasons,omitempty"`
	Title       Title  `json:"title"`
}

func (s *Server) requestsRecent(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	reqs, err := s.Seerr.Recent(r.Context(), 30)
	if err != nil {
		s.seerrErr(w, err)
		return
	}
	// Titles aren't in the request list, so look them up (cached) in parallel.
	details := make([]*seerr.Details, len(reqs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for i, rq := range reqs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if d, err := s.Seerr.Details(r.Context(), rq.Media.MediaType, rq.Media.TMDBID, false); err == nil {
				details[i] = d
			}
		}()
	}
	wg.Wait()
	out := []recentRequest{}
	for i, rq := range reqs {
		d := details[i]
		if d == nil {
			continue
		}
		d.Result.MediaInfo = &seerr.MediaInfo{Status: rq.Media.Status}
		t := s.titles(u, []seerr.Result{d.Result})[0]
		st := map[int]string{1: "pending", 2: "approved", 3: "declined", 4: "failed", 5: "available"}[rq.Status]
		if t.Status == "available" {
			st = "available"
		}
		var seasons []int
		for _, se := range rq.Seasons {
			seasons = append(seasons, se.SeasonNumber)
		}
		sort.Ints(seasons)
		by := rq.RequestedBy.DisplayName
		if by == "" {
			by = rq.RequestedBy.Email
		}
		out = append(out, recentRequest{ID: rq.ID, Status: st, CreatedAt: rq.CreatedAt, RequestedBy: by, Seasons: seasons, Title: t})
	}
	writeJSON(w, 200, out)
}
