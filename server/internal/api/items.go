package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gillgurjot/lumen/internal/store"
)

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, userFrom(r))
}

func (s *Server) updatePrefs(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AudioLang    string `json:"audioLang"`
		SubtitleLang string `json:"subtitleLang"`
		SubtitleMode string `json:"subtitleMode"`
	}
	if err := decode(r, &body); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	switch body.SubtitleMode {
	case "auto", "always", "off":
	default:
		body.SubtitleMode = "auto"
	}
	u := userFrom(r)
	if err := s.St.UpdateUserPrefs(u.ID, strings.ToLower(body.AudioLang), strings.ToLower(body.SubtitleLang), body.SubtitleMode); err != nil {
		s.notFoundOr500(w, err)
		return
	}
	u, _ = s.St.User(u.ID)
	writeJSON(w, 200, u)
}

func (s *Server) visibleLibraries(u *store.User) ([]*store.Library, error) {
	libs, err := s.St.Libraries()
	if err != nil {
		return nil, err
	}
	out := []*store.Library{}
	for _, l := range libs {
		if u.CanAccess(l.ID) {
			out = append(out, l)
		}
	}
	return out, nil
}

func (s *Server) libraries(w http.ResponseWriter, r *http.Request) {
	libs, err := s.visibleLibraries(userFrom(r))
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	// Paths are server internals; only admins need them.
	if !userFrom(r).IsAdmin {
		for _, l := range libs {
			l.Paths = nil
		}
	}
	writeJSON(w, 200, libs)
}

func (s *Server) libraryItems(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	id := idParam(r, "id")
	if !u.CanAccess(id) {
		writeErr(w, 404, "not found")
		return
	}
	q := r.URL.Query()
	f := store.ListFilter{LibraryID: id, Sort: q.Get("sort"), Desc: q.Get("order") == "desc", Genre: q.Get("genre"),
		Played: q.Get("played"), Favorite: q.Get("favorite") == "1", Letter: q.Get("letter")}
	f.Year, _ = strconv.Atoi(q.Get("year"))
	f.Offset, _ = strconv.Atoi(q.Get("offset"))
	f.Limit, _ = strconv.Atoi(q.Get("limit"))
	items, total, err := s.St.ListItems(u, f)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	for _, it := range items {
		it.People = nil // keep grid payloads small
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total})
}

func (s *Server) libraryGenres(w http.ResponseWriter, r *http.Request) {
	g, err := s.St.Genres(userFrom(r), idParam(r, "id"))
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, g)
}

func slim(items []*store.Item) []*store.Item {
	for _, it := range items {
		it.People = nil
	}
	return items
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	type row struct {
		Library *store.Library `json:"library"`
		Items   []*store.Item  `json:"items"`
	}
	cont, err := s.St.ContinueWatching(u, 20)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	next, _ := s.St.NextUp(u, 20)
	featured, _ := s.St.Featured(u, 6)
	libs, _ := s.visibleLibraries(u)
	latest := []row{}
	for _, l := range libs {
		items, _ := s.St.Latest(u, l.ID, 24)
		if len(items) > 0 {
			l.Paths = nil
			latest = append(latest, row{l, slim(items)})
		}
	}
	favs, _ := s.St.Favorites(u, 60)
	myList := []*store.Item{}
	for _, it := range favs {
		if (it.Type == "movie" || it.Type == "series") && len(myList) < 24 {
			myList = append(myList, it)
		}
	}
	writeJSON(w, 200, map[string]any{
		"continueWatching": slim(cont), "nextUp": slim(next), "featured": slim(featured), "latest": latest, "libraries": libs,
		"myList": slim(myList),
	})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 1 {
		writeJSON(w, 200, []any{})
		return
	}
	items, err := s.St.Search(userFrom(r), q, 40)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, slim(items))
}

func (s *Server) favorites(w http.ResponseWriter, r *http.Request) {
	items, err := s.St.Favorites(userFrom(r), 200)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, slim(items))
}

type itemDetail struct {
	*store.Item
	Media *store.MediaFile `json:"media,omitempty"`
}

func (s *Server) item(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	it, err := s.St.Item(idParam(r, "id"), u)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	d := itemDetail{Item: it}
	if it.Type == "movie" || it.Type == "episode" {
		if m, err := s.St.MediaFileForItem(it.ID); err == nil {
			d.Media = m
		}
	}
	writeJSON(w, 200, d)
}

func (s *Server) children(w http.ResponseWriter, r *http.Request) {
	items, err := s.St.Children(userFrom(r), idParam(r, "id"))
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, slim(items))
}

func (s *Server) episodes(w http.ResponseWriter, r *http.Request) {
	items, err := s.St.SeriesEpisodes(userFrom(r), idParam(r, "id"))
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, slim(items))
}

func (s *Server) nextEpisode(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	it, err := s.St.Item(idParam(r, "id"), u)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	next, err := s.St.NextEpisode(u, it)
	if err != nil {
		writeJSON(w, 200, nil)
		return
	}
	next.People = nil
	writeJSON(w, 200, next)
}

func (s *Server) setPlayed(played bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFrom(r)
		it, err := s.St.Item(idParam(r, "id"), u)
		if err != nil {
			s.notFoundOr500(w, err)
			return
		}
		if err := s.St.SetPlayed(u.ID, it.ID, played); err != nil {
			s.notFoundOr500(w, err)
			return
		}
		it, _ = s.St.Item(it.ID, u)
		s.Jobs.SyncJellyfin()
		writeJSON(w, 200, it.UserData)
	}
}

func (s *Server) setFavorite(fav bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFrom(r)
		it, err := s.St.Item(idParam(r, "id"), u)
		if err != nil {
			s.notFoundOr500(w, err)
			return
		}
		if err := s.St.SetFavorite(u.ID, it.ID, fav); err != nil {
			s.notFoundOr500(w, err)
			return
		}
		it, _ = s.St.Item(it.ID, u)
		s.Jobs.SyncJellyfin()
		writeJSON(w, 200, it.UserData)
	}
}
