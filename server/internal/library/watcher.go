package library

import (
	"context"
	"io/fs"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/gillgurjot/lumen/internal/store"
)

// Watcher triggers library scans when files change on disk.
// Network mounts often don't emit events, so periodic scans still run.
type Watcher struct {
	st      *store.Store
	scanner *Scanner
	log     *slog.Logger

	mu     sync.Mutex
	w      *fsnotify.Watcher
	roots  map[string]int64
	timers map[int64]*time.Timer
	ctx    context.Context
}

func NewWatcher(st *store.Store, sc *Scanner, log *slog.Logger) *Watcher {
	return &Watcher{st: st, scanner: sc, log: log, roots: map[string]int64{}, timers: map[int64]*time.Timer{}}
}

func (w *Watcher) Start(ctx context.Context) {
	w.ctx = ctx
	w.Reload()
	go func() {
		<-ctx.Done()
		w.mu.Lock()
		if w.w != nil {
			w.w.Close()
		}
		w.mu.Unlock()
	}()
}

// Reload re-registers watches for the current set of libraries.
func (w *Watcher) Reload() {
	w.mu.Lock()
	if w.w != nil {
		w.w.Close()
	}
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		w.mu.Unlock()
		w.log.Warn("file watching unavailable", "err", err)
		return
	}
	w.w = fw
	w.roots = map[string]int64{}
	w.mu.Unlock()

	libs, _ := w.st.Libraries()
	for _, l := range libs {
		for _, p := range l.Paths {
			w.mu.Lock()
			w.roots[filepath.Clean(p)] = l.ID
			w.mu.Unlock()
			w.addTree(fw, p)
		}
	}
	go w.loop(fw)
}

func (w *Watcher) addTree(fw *fsnotify.Watcher, root string) {
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if p != root && SkipDir(d.Name()) {
			return filepath.SkipDir
		}
		if err := fw.Add(p); err != nil {
			return filepath.SkipDir
		}
		return nil
	})
}

func (w *Watcher) libraryFor(p string) (int64, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	best, id := "", int64(0)
	for r, lid := range w.roots {
		if (p == r || strings.HasPrefix(p, r+string(filepath.Separator))) && len(r) > len(best) {
			best, id = r, lid
		}
	}
	return id, best != ""
}

func (w *Watcher) loop(fw *fsnotify.Watcher) {
	for {
		select {
		case ev, ok := <-fw.Events:
			if !ok {
				return
			}
			if ev.Has(fsnotify.Create) {
				if fi, err := statDir(ev.Name); err == nil && fi {
					w.addTree(fw, ev.Name)
				}
			}
			ext := strings.ToLower(filepath.Ext(ev.Name))
			if ext != "" && !VideoExts[ext] && !SubtitleExts[ext] {
				continue
			}
			if id, ok := w.libraryFor(ev.Name); ok {
				w.schedule(id)
			}
		case _, ok := <-fw.Errors:
			if !ok {
				return
			}
		}
	}
}

// schedule debounces scans so a large copy only triggers one scan.
func (w *Watcher) schedule(id int64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if t := w.timers[id]; t != nil {
		t.Reset(20 * time.Second)
		return
	}
	w.timers[id] = time.AfterFunc(20*time.Second, func() {
		w.mu.Lock()
		delete(w.timers, id)
		w.mu.Unlock()
		if lib, err := w.st.Library(id); err == nil {
			_ = w.scanner.Scan(w.ctx, lib)
		}
	})
}
