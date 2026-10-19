package library

import (
	"context"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gillgurjot/lumen/internal/store"
)

type Status struct {
	LibraryID int64     `json:"libraryId"`
	Running   bool      `json:"running"`
	Phase     string    `json:"phase"`
	Total     int       `json:"total"`
	Done      int       `json:"done"`
	Added     int       `json:"added"`
	Removed   int       `json:"removed"`
	Errors    int       `json:"errors"`
	Started   time.Time `json:"started"`
	Finished  time.Time `json:"finished"`
}

type Scanner struct {
	st        *store.Store
	ffprobe   string
	log       *slog.Logger
	OnScanned func(libraryID int64)

	mu     sync.Mutex
	locks  map[int64]*sync.Mutex
	status map[int64]*Status
}

func NewScanner(st *store.Store, ffprobe string, log *slog.Logger) *Scanner {
	return &Scanner{st: st, ffprobe: ffprobe, log: log, locks: map[int64]*sync.Mutex{}, status: map[int64]*Status{}}
}

func (s *Scanner) lock(id int64) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks[id] == nil {
		s.locks[id] = &sync.Mutex{}
	}
	return s.locks[id]
}

func (s *Scanner) setStatus(id int64, f func(*Status)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status[id] == nil {
		s.status[id] = &Status{LibraryID: id}
	}
	f(s.status[id])
}

// Statuses returns a snapshot of all scan statuses.
func (s *Scanner) Statuses() []Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Status, 0, len(s.status))
	for _, st := range s.status {
		out = append(out, *st)
	}
	return out
}

func (s *Scanner) Running(id int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status[id] != nil && s.status[id].Running
}

type found struct {
	path  string
	size  int64
	mtime int64
}

// Scan synchronizes one library with disk. Concurrent scans of the same library are serialized.
func (s *Scanner) Scan(ctx context.Context, lib *store.Library) error {
	l := s.lock(lib.ID)
	if !l.TryLock() {
		return nil // already scanning
	}
	defer l.Unlock()
	start := time.Now()
	s.setStatus(lib.ID, func(st *Status) { *st = Status{LibraryID: lib.ID, Running: true, Phase: "walking", Started: start} })
	defer s.setStatus(lib.ID, func(st *Status) { st.Running = false; st.Phase = "done"; st.Finished = time.Now() })

	existing, err := s.st.FilesInLibrary(lib.ID)
	if err != nil {
		return err
	}
	var files []found
	rootsOK := false
	for _, root := range lib.Paths {
		if _, err := os.Stat(root); err != nil {
			s.log.Warn("library path unavailable", "path", root, "err", err)
			continue
		}
		rootsOK = true
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if d.IsDir() {
				if p != root && SkipDir(d.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			if !VideoExts[strings.ToLower(filepath.Ext(p))] || SkipFile(d.Name()) {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			files = append(files, found{p, info.Size(), info.ModTime().Unix()})
			return nil
		})
	}
	if !rootsOK {
		// Never wipe a library because its mount is offline.
		s.log.Warn("no library paths reachable; skipping scan", "library", lib.Name)
		return nil
	}

	seen := map[string]bool{}
	var todo []found
	for _, f := range files {
		seen[f.path] = true
		if r, ok := existing[f.path]; ok && r.Size == f.size && r.Mtime == f.mtime {
			continue
		}
		todo = append(todo, f)
	}
	s.setStatus(lib.ID, func(st *Status) { st.Phase = "probing"; st.Total = len(todo) })

	// Probe in parallel, insert serially (keeps container creation race-free).
	type result struct {
		f found
		m *store.MediaFile
	}
	jobs := make(chan found)
	results := make(chan result)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range jobs {
				m, err := Probe(ctx, s.ffprobe, f.path)
				if err != nil {
					s.log.Warn("probe failed", "err", err)
				}
				results <- result{f, m}
			}
		}()
	}
	go func() {
		for _, f := range todo {
			if ctx.Err() != nil {
				break
			}
			jobs <- f
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()
	for r := range results {
		s.setStatus(lib.ID, func(st *Status) { st.Done++ })
		if r.m == nil {
			s.setStatus(lib.ID, func(st *Status) { st.Errors++ })
			continue
		}
		if old, ok := existing[r.f.path]; ok {
			r.m.ItemID = old.ItemID
			if err := s.st.UpsertMediaFile(r.m); err != nil {
				s.log.Error("update file", "err", err)
			}
			continue
		}
		var err error
		if lib.Type == "movies" {
			err = s.addMovie(lib, r.m)
		} else {
			err = s.addEpisode(lib, r.m)
		}
		if err != nil {
			s.log.Error("add file", "path", r.f.path, "err", err)
			s.setStatus(lib.ID, func(st *Status) { st.Errors++ })
		} else {
			s.setStatus(lib.ID, func(st *Status) { st.Added++ })
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// Removals and sidecar refresh for unchanged files.
	s.setStatus(lib.ID, func(st *Status) { st.Phase = "cleanup" })
	for p, r := range existing {
		if !seen[p] {
			if err := s.st.RemoveFile(r); err == nil {
				s.setStatus(lib.ID, func(st *Status) { st.Removed++ })
			}
			continue
		}
		if mf, err := s.st.MediaFile(r.ID); err == nil {
			sc := FindSidecars(p)
			if !sameSidecars(sc, mf.Sidecars) {
				_ = s.st.UpdateSidecars(r.ID, sc)
			}
		}
	}
	s.st.PruneEmpty(lib.ID)
	s.st.TouchLibraryScan(lib.ID)
	s.log.Info("scan complete", "library", lib.Name, "files", len(files), "probed", len(todo), "took", time.Since(start).Round(time.Millisecond))
	if s.OnScanned != nil {
		s.OnScanned(lib.ID)
	}
	return nil
}

func sameSidecars(a, b []store.Stream) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Path != b[i].Path || a[i].Language != b[i].Language || a[i].Forced != b[i].Forced || a[i].Index != b[i].Index {
			return false
		}
	}
	return true
}

func (s *Scanner) addMovie(lib *store.Library, m *store.MediaFile) error {
	title, year, tmdb := MovieInfo(m.Path)
	id, err := s.st.AddFile(store.NewItem{LibraryID: lib.ID, Type: "movie", Title: title, Year: year, Folder: filepath.Dir(m.Path), TMDBID: tmdb}, m)
	if err != nil {
		return err
	}
	dir := filepath.Dir(m.Path)
	base := strings.TrimSuffix(m.Path, filepath.Ext(m.Path))
	s.localArt(id, "poster", base+"-poster", filepath.Join(dir, "poster"), filepath.Join(dir, "folder"), filepath.Join(dir, "cover"))
	s.localArt(id, "backdrop", base+"-fanart", filepath.Join(dir, "fanart"), filepath.Join(dir, "backdrop"))
	s.localArt(id, "logo", filepath.Join(dir, "logo"), filepath.Join(dir, "clearlogo"))
	return nil
}

// libraryRoot returns the library path that contains p.
func libraryRoot(lib *store.Library, p string) string {
	best := ""
	for _, r := range lib.Paths {
		r = filepath.Clean(r)
		if strings.HasPrefix(p, r+string(filepath.Separator)) && len(r) > len(best) {
			best = r
		}
	}
	return best
}

func (s *Scanner) addEpisode(lib *store.Library, m *store.MediaFile) error {
	root := libraryRoot(lib, m.Path)
	rel, _ := filepath.Rel(root, m.Path)
	parts := strings.Split(rel, string(filepath.Separator))

	var seriesDir, seriesName string
	if len(parts) >= 2 {
		seriesDir = filepath.Join(root, parts[0])
		seriesName = parts[0]
	} else {
		// Loose file in library root: use the text before SxxEyy as the series name.
		base := strings.TrimSuffix(parts[0], filepath.Ext(parts[0]))
		if loc := reSxE.FindStringIndex(base); loc != nil {
			seriesName = base[:loc[0]]
		} else {
			seriesName = base
		}
		seriesName = cleanTitle(seriesName)
		seriesDir = filepath.Join(root, seriesName)
	}
	sTitle, sYear, sTMDB := ParseTitleYear(seriesName)

	dirSeason := -1
	if len(parts) >= 3 {
		if n, ok := SeasonFromDir(parts[len(parts)-2]); ok {
			dirSeason = n
		}
	}
	ep := ParseEpisode(m.Path, dirSeason)
	if !ep.OK {
		ep = EpisodeInfo{Season: max(dirSeason, 1), Episode: 0, OK: true}
	}
	if dirSeason >= 0 && ep.Season != dirSeason && dirSeason != 0 {
		// Folder wins over a filename that disagrees (common with absolute numbering).
		ep.Season = dirSeason
	}

	seriesID, created, err := s.st.EnsureContainer(store.NewItem{LibraryID: lib.ID, Type: "series", Title: sTitle, Year: sYear, Folder: seriesDir, TMDBID: sTMDB})
	if err != nil {
		return err
	}
	if created {
		s.localArt(seriesID, "poster", filepath.Join(seriesDir, "poster"), filepath.Join(seriesDir, "folder"))
		s.localArt(seriesID, "backdrop", filepath.Join(seriesDir, "fanart"), filepath.Join(seriesDir, "backdrop"))
		s.localArt(seriesID, "logo", filepath.Join(seriesDir, "logo"), filepath.Join(seriesDir, "clearlogo"))
	}
	seasonTitle := "Season " + strconv.Itoa(ep.Season)
	if ep.Season == 0 {
		seasonTitle = "Specials"
	}
	sn := ep.Season
	seasonID, created, err := s.st.EnsureContainer(store.NewItem{LibraryID: lib.ID, Type: "season", ParentID: &seriesID, SeriesID: &seriesID,
		Title: seasonTitle, SeasonNumber: &sn, Folder: seriesDir + "#S" + strconv.Itoa(ep.Season)})
	if err != nil {
		return err
	}
	if created {
		sd := filepath.Join(seriesDir, parts[max(0, len(parts)-2)])
		s.localArt(seasonID, "poster", filepath.Join(seriesDir, "season"+pad2(ep.Season)+"-poster"), filepath.Join(sd, "poster"), filepath.Join(sd, "folder"))
	}
	title := EpisodeTitle(m.Path)
	if title == "" {
		title = "Episode " + strconv.Itoa(ep.Episode)
	}
	en := ep.Episode
	var end *int
	if ep.EpisodeEnd > 0 {
		e := ep.EpisodeEnd
		end = &e
	}
	id, err := s.st.AddFile(store.NewItem{LibraryID: lib.ID, Type: "episode", ParentID: &seasonID, SeriesID: &seriesID, Title: title,
		SeasonNumber: &sn, EpisodeNumber: &en, EpisodeEnd: end, Folder: filepath.Dir(m.Path)}, m)
	if err != nil {
		return err
	}
	base := strings.TrimSuffix(m.Path, filepath.Ext(m.Path))
	s.localArt(id, "still", base+"-thumb", base)
	return nil
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// localArt uses the first existing image among candidate base paths.
func (s *Scanner) localArt(id int64, kind string, bases ...string) {
	for _, b := range bases {
		for _, ext := range []string{".jpg", ".jpeg", ".png", ".webp"} {
			if st, err := os.Stat(b + ext); err == nil && !st.IsDir() {
				_ = s.st.SetImage(id, kind, b+ext)
				return
			}
		}
	}
}
