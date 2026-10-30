package stream

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gillgurjot/lumen/internal/store"
)

func TestSidecarCacheFollowsTheFile(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	srt := func(name, text string) string {
		p := filepath.Join(dir, name)
		os.WriteFile(p, []byte("1\n00:00:01,000 --> 00:00:02,000\n"+text+"\n"), 0o644)
		return p
	}
	a := srt("Movie.en.srt", "first file")
	s := NewSubtitles("ffmpeg", t.TempDir())
	m := &store.MediaFile{ID: 7, Mtime: 1, Sidecars: []store.Stream{{Index: 1000, Type: "subtitle", Codec: "srt", External: true, Path: a}}}
	read := func() string {
		t.Helper()
		p, err := s.VTT(context.Background(), m, 1000)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(p)
		return string(b)
	}
	if got := read(); !strings.Contains(got, "first file") {
		t.Fatalf("got %q", got)
	}
	// A new sidecar sorts first, so index 1000 is now a different file.
	b := srt("Movie.de.srt", "second file")
	m.Sidecars = []store.Stream{{Index: 1000, Type: "subtitle", Codec: "srt", External: true, Path: b}, {Index: 1001, Type: "subtitle", Codec: "srt", External: true, Path: a}}
	if got := read(); !strings.Contains(got, "second file") {
		t.Fatalf("index 1000 after adding a sidecar: got %q, want the new file", got)
	}
	// The same file replaced by a better download.
	time.Sleep(10 * time.Millisecond)
	srt("Movie.de.srt", "replaced file")
	if got := read(); !strings.Contains(got, "replaced file") {
		t.Fatalf("after replacing the sidecar: got %q", got)
	}
}
