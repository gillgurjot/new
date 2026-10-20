// Package jobs runs background work: scheduled scans, metadata, trickplay.
package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gillgurjot/lumen/internal/library"
	"github.com/gillgurjot/lumen/internal/metadata"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/gillgurjot/lumen/internal/stream"
)

type Runner struct {
	St           *store.Store
	Scanner      *library.Scanner
	Fetcher      *metadata.Fetcher
	Streams      *stream.Manager
	FFmpeg       string
	TrickplayDir string
	Trickplay    bool
	Credits      bool // look for end credits in the background
	ScanInterval time.Duration
	Log          *slog.Logger

	metaQueue chan int64
	trickWake chan struct{}
}

func (r *Runner) Start(ctx context.Context) {
	r.metaQueue = make(chan int64, 64)
	r.trickWake = make(chan struct{}, 1)
	r.Scanner.OnScanned = func(id int64) {
		select {
		case r.metaQueue <- id:
		default:
		}
	}
	go r.metadataLoop(ctx)
	go r.scanLoop(ctx)
	if r.Trickplay {
		go r.trickplayLoop(ctx)
	}
	if r.Credits {
		go r.creditsLoop(ctx)
	}
}

// ScanAll scans every library in turn.
func (r *Runner) ScanAll(ctx context.Context) {
	libs, err := r.St.Libraries()
	if err != nil {
		return
	}
	for _, l := range libs {
		if ctx.Err() != nil {
			return
		}
		if err := r.Scanner.Scan(ctx, l); err != nil {
			r.Log.Error("scan failed", "library", l.Name, "err", err)
		}
	}
}

// ScanLibrary scans one library in the background.
func (r *Runner) ScanLibrary(ctx context.Context, id int64) {
	go func() {
		if l, err := r.St.Library(id); err == nil {
			_ = r.Scanner.Scan(ctx, l)
		}
	}()
}

// RefreshMetadata queues a metadata pass for a library.
func (r *Runner) RefreshMetadata(id int64) {
	select {
	case r.metaQueue <- id:
	default:
	}
}

func (r *Runner) scanLoop(ctx context.Context) {
	r.ScanAll(ctx)
	t := time.NewTicker(r.ScanInterval)
	purge := time.NewTicker(time.Hour)
	defer t.Stop()
	defer purge.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.ScanAll(ctx)
		case <-purge.C:
			r.St.PurgeExpiredSessions()
		}
	}
}

func (r *Runner) metadataLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-r.metaQueue:
			r.Fetcher.RefreshLibrary(ctx, id)
			select {
			case r.trickWake <- struct{}{}:
			default:
			}
		}
	}
}

func (r *Runner) trickplayLoop(ctx context.Context) {
	for {
		busy := false
		for _, s := range r.Streams.List() {
			if s.Method == stream.Transcode {
				busy = true // leave the CPU/GPU to viewers
			}
		}
		var files []*store.MediaFile
		if !busy {
			files, _ = r.St.FilesNeedingTrickplay(1)
		}
		if len(files) == 0 {
			select {
			case <-ctx.Done():
				return
			case <-r.trickWake:
			case <-time.After(2 * time.Minute):
			}
			continue
		}
		f := files[0]
		if err := r.generateTrickplay(ctx, f); err != nil {
			if ctx.Err() != nil {
				return
			}
			r.Log.Warn("trickplay failed", "file", filepath.Base(f.Path), "err", err)
			r.St.SetTrickplay(f.ID, -1)
		} else {
			r.St.SetTrickplay(f.ID, 1)
		}
	}
}

// Trickplay sprite layout.
const (
	TrickInterval = 10
	TrickWidth    = 320
	TrickCols     = 10
	TrickRows     = 10
)

type TrickplayIndex struct {
	Interval int `json:"interval"`
	Width    int `json:"width"`
	Height   int `json:"height"`
	Cols     int `json:"cols"`
	Rows     int `json:"rows"`
	Count    int `json:"count"`
	Sheets   int `json:"sheets"`
}

func (r *Runner) generateTrickplay(ctx context.Context, f *store.MediaFile) error {
	if f.Width == 0 || f.Height == 0 {
		return fmt.Errorf("unknown dimensions")
	}
	dir := filepath.Join(r.TrickplayDir, strconv.FormatInt(f.ID, 10))
	_ = os.RemoveAll(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	h := (TrickWidth*f.Height/f.Width + 1) &^ 1
	cctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	vf := fmt.Sprintf("fps=1/%d,scale=%d:%d,tile=%dx%d", TrickInterval, TrickWidth, h, TrickCols, TrickRows)
	cmd := exec.CommandContext(cctx, r.FFmpeg, "-hide_banner", "-v", "error", "-nostdin", "-threads", "2", "-skip_frame", "nokey",
		"-i", f.Path, "-an", "-sn", "-dn", "-vf", vf, "-fps_mode", "vfr", "-q:v", "5", filepath.Join(dir, "%03d.jpg"))
	if out, err := cmd.CombinedOutput(); err != nil {
		os.RemoveAll(dir)
		return fmt.Errorf("%v: %s", err, out)
	}
	sheets, _ := filepath.Glob(filepath.Join(dir, "*.jpg"))
	if len(sheets) == 0 {
		return fmt.Errorf("no sprites produced")
	}
	idx := TrickplayIndex{Interval: TrickInterval, Width: TrickWidth, Height: h, Cols: TrickCols, Rows: TrickRows,
		Count: int(f.Duration) / TrickInterval, Sheets: len(sheets)}
	b, _ := json.Marshal(idx)
	return os.WriteFile(filepath.Join(dir, "index.json"), b, 0o644)
}
