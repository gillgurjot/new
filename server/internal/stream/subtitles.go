package stream

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gillgurjot/lumen/internal/store"
)

type Subtitles struct {
	ffmpeg string
	dir    string
	mu     sync.Mutex
	locks  map[string]*sync.Mutex
}

func NewSubtitles(ffmpeg, cacheDir string) *Subtitles {
	d := filepath.Join(cacheDir, "subtitles")
	_ = os.MkdirAll(d, 0o755)
	return &Subtitles{ffmpeg: ffmpeg, dir: d, locks: map[string]*sync.Mutex{}}
}

func (s *Subtitles) lock(key string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks[key] == nil {
		s.locks[key] = &sync.Mutex{}
	}
	return s.locks[key]
}

// VTT returns a path to a WebVTT version of the given subtitle stream.
func (s *Subtitles) VTT(ctx context.Context, m *store.MediaFile, index int) (string, error) {
	var sub *store.Stream
	for _, st := range m.Subtitles() {
		if st.Index == index {
			st := st
			sub = &st
		}
	}
	if sub == nil {
		return "", os.ErrNotExist
	}
	if sub.ImageBased {
		return "", fmt.Errorf("image-based subtitles can't be converted to text")
	}
	out := filepath.Join(s.dir, fmt.Sprintf("%d_%d_%d.vtt", m.ID, index, m.Mtime))
	if _, err := os.Stat(out); err == nil {
		return out, nil
	}
	l := s.lock(out)
	l.Lock()
	defer l.Unlock()
	if _, err := os.Stat(out); err == nil {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var args []string
	if sub.External {
		args = []string{"-hide_banner", "-v", "error", "-nostdin", "-y"}
		if raw, err := os.ReadFile(sub.Path); err == nil && !utf8.Valid(raw) {
			args = append(args, "-sub_charenc", "CP1252")
		}
		args = append(args, "-i", sub.Path, "-f", "webvtt", out+".tmp")
	} else {
		args = []string{"-hide_banner", "-v", "error", "-nostdin", "-y", "-i", m.Path, "-map", "0:" + strconv.Itoa(index), "-c:s", "webvtt", "-f", "webvtt", out + ".tmp"}
	}
	if b, err := exec.CommandContext(ctx, s.ffmpeg, args...).CombinedOutput(); err != nil {
		os.Remove(out + ".tmp")
		return "", fmt.Errorf("subtitle conversion: %v: %s", err, b)
	}
	return out, os.Rename(out+".tmp", out)
}
