package metadata

import (
	"context"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/gillgurjot/lumen/internal/images"
	"github.com/gillgurjot/lumen/internal/store"
)

type Fetcher struct {
	st   *store.Store
	tmdb *TMDB
	img  *images.Cache
	log  *slog.Logger
	lang string
	mu   sync.Mutex // one refresh at a time keeps API usage polite
}

func NewFetcher(st *store.Store, tmdb *TMDB, img *images.Cache, lang string, log *slog.Logger) *Fetcher {
	return &Fetcher{st: st, tmdb: tmdb, img: img, lang: lang, log: log}
}

// RefreshLibrary fetches metadata for all pending items in a library.
func (f *Fetcher) RefreshLibrary(ctx context.Context, libraryID int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	items, err := f.st.ItemsNeedingMetadata(libraryID)
	if err != nil {
		f.log.Error("metadata list", "err", err)
		return
	}
	for _, it := range items {
		if ctx.Err() != nil {
			return
		}
		f.refreshItem(ctx, it)
	}
	// Series whose new episodes were added later still have pending children.
	series, _ := f.st.SeriesWithPending(libraryID)
	for _, s := range series {
		if pend, _ := f.st.PendingEpisodes(s.ID); len(pend) > 0 {
			f.refreshSeasons(ctx, s, pend)
		}
	}
}

// RefreshItem forces a metadata refresh of a movie or series (and its episodes).
func (f *Fetcher) RefreshItem(ctx context.Context, id int64) {
	f.st.MarkPending(id)
	it, err := f.st.ItemRaw(id)
	if err != nil {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refreshItem(ctx, it)
}

// Identify binds an item to a specific TMDB id and refreshes it.
func (f *Fetcher) Identify(ctx context.Context, id int64, tmdbID int) error {
	if _, err := f.st.DB.Exec(`UPDATE items SET tmdb_id=? WHERE id=?`, tmdbID, id); err != nil {
		return err
	}
	f.RefreshItem(ctx, id)
	return nil
}

func (f *Fetcher) refreshItem(ctx context.Context, it *store.Item) {
	switch it.Type {
	case "movie":
		f.movie(ctx, it)
	case "series":
		f.series(ctx, it)
	}
}

func (f *Fetcher) people(cast, crew []credit, createdBy []credit) []store.Person {
	var out []store.Person
	for _, c := range createdBy {
		out = append(out, store.Person{Name: c.Name, Role: "creator", Profile: c.ProfilePath})
	}
	for _, c := range crew {
		if c.Job == "Director" {
			out = append(out, store.Person{Name: c.Name, Role: "director", Profile: c.ProfilePath})
		}
	}
	sort.SliceStable(cast, func(i, j int) bool { return cast[i].Order < cast[j].Order })
	for i, c := range cast {
		if i >= 30 {
			break
		}
		out = append(out, store.Person{Name: c.Name, Character: c.Character, Role: "actor", Profile: c.ProfilePath})
	}
	return out
}

func genres(gs []genre) []string {
	out := make([]string, 0, len(gs))
	for _, g := range gs {
		out = append(out, g.Name)
	}
	return out
}

func year(date string) int {
	if len(date) >= 4 {
		y, _ := strconv.Atoi(date[:4])
		return y
	}
	return 0
}

func (f *Fetcher) download(ctx context.Context, id int64, kind, size, path string) string {
	if path == "" {
		return ""
	}
	ref, err := f.img.Download(ctx, id, kind, ImageBase+size+path)
	if err != nil {
		f.log.Warn("image download failed", "item", id, "kind", kind, "err", err)
		return ""
	}
	return ref
}

// backdrop picks a text-free TMDB backdrop when there is one (even over local fanart,
// which often has the title on it), else keeps local art, else TMDB's default.
func (f *Fetcher) backdrop(ctx context.Context, it *store.Item, il imageList, def string) string {
	if p := textlessBackdrop(il); p != "" {
		if ref := f.download(ctx, it.ID, "backdrop", "w1280", p); ref != "" {
			return ref
		}
	}
	if strings.HasPrefix(it.Backdrop, "/") {
		return "" // keep the local file
	}
	return f.download(ctx, it.ID, "backdrop", "w1280", def)
}

// pickMatch prefers an exact title + year match, then year, then the first result.
func pickMatch(res []SearchResult, title string, yr int) *SearchResult {
	if len(res) == 0 {
		return nil
	}
	norm := func(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }
	for i, r := range res {
		if norm(r.DisplayTitle()) == norm(title) && (yr == 0 || r.Year() == yr) {
			return &res[i]
		}
	}
	if yr > 0 {
		for i, r := range res {
			if r.Year() == yr || r.Year() == yr-1 || r.Year() == yr+1 {
				return &res[i]
			}
		}
	}
	return &res[0]
}

func (f *Fetcher) findID(ctx context.Context, kind string, it *store.Item) int {
	if it.TMDBID > 0 {
		return it.TMDBID
	}
	res, err := f.tmdb.Search(ctx, kind, it.Title, it.Year)
	if err == nil && len(res) == 0 && it.Year > 0 {
		res, err = f.tmdb.Search(ctx, kind, it.Title, 0)
	}
	if err != nil {
		f.log.Warn("tmdb search failed", "title", it.Title, "err", err)
		return -1
	}
	if m := pickMatch(res, it.Title, it.Year); m != nil {
		return m.ID
	}
	return 0
}

func (f *Fetcher) movie(ctx context.Context, it *store.Item) {
	if !f.tmdb.Enabled() {
		f.localFallback(ctx, it)
		return
	}
	id := f.findID(ctx, "movie", it)
	if id < 0 {
		return // transient error; stay pending
	}
	if id == 0 {
		f.localFallback(ctx, it)
		return
	}
	d, err := f.tmdb.Movie(ctx, id)
	if err != nil {
		f.log.Warn("tmdb movie failed", "id", id, "err", err)
		return
	}
	cert := ""
	for _, r := range d.ReleaseDates.Results {
		if r.Country == country(f.lang) {
			for _, x := range r.Dates {
				if x.Cert != "" {
					cert = x.Cert
					break
				}
			}
		}
	}
	m := store.Metadata{
		Title: d.Title, OriginalTitle: d.OriginalTitle, Year: year(d.ReleaseDate), Overview: d.Overview, Tagline: d.Tagline,
		Genres: genres(d.Genres), Rating: d.VoteAverage, ContentRating: cert, Runtime: d.Runtime, PremiereDate: d.ReleaseDate,
		TMDBID: d.ID, IMDBID: d.IMDBID, People: f.people(d.Credits.Cast, d.Credits.Crew, nil),
	}
	if !strings.HasPrefix(it.Poster, "/") { // keep local artwork
		m.Poster = f.download(ctx, it.ID, "poster", "w780", d.PosterPath)
	}
	m.Backdrop = f.backdrop(ctx, it, d.Images, d.BackdropPath)
	if !strings.HasPrefix(it.Logo, "/") {
		m.Logo = f.download(ctx, it.ID, "logo", "w500", bestLogo(d.Images, f.lang))
	}
	if err := f.st.ApplyMetadata(it.ID, m, "ok"); err != nil {
		f.log.Error("apply metadata", "err", err)
	}
}

func (f *Fetcher) series(ctx context.Context, it *store.Item) {
	children, _ := f.st.PendingEpisodes(it.ID)
	if !f.tmdb.Enabled() {
		f.st.SetMetadataState(it.ID, "missing")
		f.refreshSeasons(ctx, it, children)
		return
	}
	id := f.findID(ctx, "tv", it)
	if id < 0 {
		return
	}
	if id == 0 {
		f.st.SetMetadataState(it.ID, "missing")
		f.refreshSeasons(ctx, it, children)
		return
	}
	d, err := f.tmdb.TV(ctx, id)
	if err != nil {
		f.log.Warn("tmdb tv failed", "id", id, "err", err)
		return
	}
	cert := ""
	for _, r := range d.ContentRatings.Results {
		if r.Country == country(f.lang) {
			cert = r.Rating
		}
	}
	rt := 0
	if len(d.EpisodeRunTime) > 0 {
		rt = d.EpisodeRunTime[0]
	}
	m := store.Metadata{
		Title: d.Name, OriginalTitle: d.OriginalName, Year: year(d.FirstAirDate), Overview: d.Overview, Tagline: d.Tagline,
		Genres: genres(d.Genres), Rating: d.VoteAverage, ContentRating: cert, Runtime: rt, PremiereDate: d.FirstAirDate,
		TMDBID: d.ID, IMDBID: d.ExternalIDs.IMDBID, People: f.people(d.Credits.Cast, d.Credits.Crew, d.CreatedBy),
	}
	if !strings.HasPrefix(it.Poster, "/") {
		m.Poster = f.download(ctx, it.ID, "poster", "w780", d.PosterPath)
	}
	m.Backdrop = f.backdrop(ctx, it, d.Images, d.BackdropPath)
	if !strings.HasPrefix(it.Logo, "/") {
		m.Logo = f.download(ctx, it.ID, "logo", "w500", bestLogo(d.Images, f.lang))
	}
	if err := f.st.ApplyMetadata(it.ID, m, "ok"); err != nil {
		f.log.Error("apply metadata", "err", err)
		return
	}
	it.TMDBID = d.ID
	f.refreshSeasons(ctx, it, children)
}

// refreshSeasons fills season and episode metadata, falling back to frame grabs.
func (f *Fetcher) refreshSeasons(ctx context.Context, series *store.Item, pending []*store.Item) {
	bySeason := map[int][]*store.Item{}
	for _, c := range pending {
		if c.SeasonNumber != nil {
			bySeason[*c.SeasonNumber] = append(bySeason[*c.SeasonNumber], c)
		}
	}
	tmdbID := series.TMDBID
	if tmdbID == 0 {
		if s, err := f.st.ItemRaw(series.ID); err == nil {
			tmdbID = s.TMDBID
		}
	}
	for sn, items := range bySeason {
		if ctx.Err() != nil {
			return
		}
		var sd *SeasonDetails
		if f.tmdb.Enabled() && tmdbID > 0 {
			var err error
			sd, err = f.tmdb.Season(ctx, tmdbID, sn)
			if err != nil {
				f.log.Debug("tmdb season", "series", series.Title, "season", sn, "err", err)
				sd = nil
			}
		}
		for _, c := range items {
			if c.Type == "season" {
				m := store.Metadata{}
				if sd != nil {
					m.Overview = sd.Overview
					m.PremiereDate = sd.AirDate
					m.Year = year(sd.AirDate)
					if sd.Name != "" {
						m.Title = sd.Name
					}
					if !strings.HasPrefix(c.Poster, "/") {
						m.Poster = f.download(ctx, c.ID, "poster", "w500", sd.PosterPath)
					}
				}
				_ = f.st.ApplyMetadata(c.ID, m, "ok")
				continue
			}
			m := store.Metadata{}
			matched := false
			if sd != nil && c.EpisodeNumber != nil {
				for _, e := range sd.Episodes {
					if e.EpisodeNumber == *c.EpisodeNumber {
						matched = true
						m.Title, m.Overview, m.PremiereDate, m.Runtime, m.Rating = e.Name, e.Overview, e.AirDate, e.Runtime, e.VoteAverage
						m.Year = year(e.AirDate)
						var guests []store.Person
						for _, g := range e.GuestStars {
							guests = append(guests, store.Person{Name: g.Name, Character: g.Character, Role: "guest", Profile: g.ProfilePath})
						}
						m.People = guests
						if !strings.HasPrefix(c.Still, "/") {
							m.Still = f.download(ctx, c.ID, "still", "w780", e.StillPath)
						}
						break
					}
				}
			}
			if m.Still == "" && c.Still == "" {
				m.Still = f.grab(ctx, c, "still")
			}
			if !matched {
				m.Title = c.Title
			}
			_ = f.st.ApplyMetadata(c.ID, m, "ok")
		}
	}
}

func (f *Fetcher) grab(ctx context.Context, it *store.Item, kind string) string {
	mf, err := f.st.MediaFileForItem(it.ID)
	if err != nil || mf.Duration <= 0 {
		return ""
	}
	ref, err := f.img.FrameGrab(ctx, it.ID, kind, mf.Path, mf.Duration*0.15)
	if err != nil {
		f.log.Debug("frame grab failed", "item", it.ID, "err", err)
		return ""
	}
	return ref
}

func (f *Fetcher) localFallback(ctx context.Context, it *store.Item) {
	m := store.Metadata{Title: it.Title}
	if it.Backdrop == "" {
		m.Backdrop = f.grab(ctx, it, "backdrop")
	}
	_ = f.st.ApplyMetadata(it.ID, m, "missing")
}
