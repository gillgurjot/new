package library

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/store"
)

// makeVideo writes a one-second test clip, the smallest thing ffprobe calls a video.
func makeVideo(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x36:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path).CombinedOutput()
	if err != nil {
		t.Fatalf("ffmpeg: %v: %s", err, out)
	}
}

func newTestScanner(t *testing.T) (*Scanner, *store.Store) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not installed")
	}
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	st := store.New(d)
	return NewScanner(st, "ffprobe", slog.New(slog.NewTextHandler(io.Discard, nil))), st
}

func movieCount(t *testing.T, st *store.Store, lib int64) int {
	t.Helper()
	var n int
	if err := st.DB.QueryRow(`SELECT COUNT(*) FROM items WHERE library_id=? AND type='movie'`, lib).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestScanKeepsFilesItCantSee(t *testing.T) {
	sc, st := newTestScanner(t)
	base := t.TempDir()
	a, b := filepath.Join(base, "a"), filepath.Join(base, "b")
	makeVideo(t, filepath.Join(a, "Alpha (2001)", "Alpha (2001).mp4"))
	makeVideo(t, filepath.Join(a, "Locked (2003)", "Locked (2003).mp4"))
	makeVideo(t, filepath.Join(b, "Beta (2002)", "Beta (2002).mp4"))
	lib, err := st.CreateLibrary("Movies", "movies", []string{a, b})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	scan := func() {
		t.Helper()
		l, _ := st.Library(lib.ID)
		if err := sc.Scan(ctx, l); err != nil {
			t.Fatal(err)
		}
	}
	scan()
	if n := movieCount(t, st, lib.ID); n != 3 {
		t.Fatalf("first scan: %d movies, want 3", n)
	}
	// Watch history must survive whatever happens to the drive below.
	alpha, _ := st.DB.Exec(`INSERT INTO users(subject, username, created_at) VALUES ('s','u',0)`)
	uid, _ := alpha.LastInsertId()
	var betaID int64
	st.DB.QueryRow(`SELECT id FROM items WHERE title='Beta'`).Scan(&betaID)
	st.SetFavorite(uid, betaID, true)

	// One of two folders offline (unmounted NAS share): its movies stay.
	if err := os.Rename(b, b+".off"); err != nil {
		t.Fatal(err)
	}
	scan()
	if n := movieCount(t, st, lib.ID); n != 3 {
		t.Fatalf("offline folder: %d movies, want 3", n)
	}
	// The mount point is back but empty (drive not mounted): still kept.
	os.Mkdir(b, 0o755)
	scan()
	if n := movieCount(t, st, lib.ID); n != 3 {
		t.Fatalf("empty mount point: %d movies, want 3", n)
	}
	var fav bool
	st.DB.QueryRow(`SELECT favorite FROM user_data WHERE user_id=? AND item_id=?`, uid, betaID).Scan(&fav)
	if !fav {
		t.Fatal("favourite on the offline movie was lost")
	}
	os.Remove(b)
	os.Rename(b+".off", b)

	// A folder that can't be read (permissions, disk error): its movie stays.
	if os.Geteuid() != 0 {
		locked := filepath.Join(a, "Locked (2003)")
		os.Chmod(locked, 0)
		scan()
		os.Chmod(locked, 0o755)
		if n := movieCount(t, st, lib.ID); n != 3 {
			t.Fatalf("unreadable folder: %d movies, want 3", n)
		}
	}

	// A file that's really gone is removed.
	os.RemoveAll(filepath.Join(a, "Alpha (2001)"))
	scan()
	if n := movieCount(t, st, lib.ID); n != 2 {
		t.Fatalf("after deleting a movie: %d movies, want 2", n)
	}
	// Every folder unreachable: nothing is touched.
	os.Rename(a, a+".off")
	os.Rename(b, b+".off")
	scan()
	if n := movieCount(t, st, lib.ID); n != 2 {
		t.Fatalf("all folders offline: %d movies, want 2", n)
	}
}

func TestScanRunsAgainWhenAskedMidScan(t *testing.T) {
	sc, st := newTestScanner(t)
	root := t.TempDir()
	makeVideo(t, filepath.Join(root, "One (2001)", "One (2001).mp4"))
	lib, _ := st.CreateLibrary("Movies", "movies", []string{root})
	runs := 0
	sc.OnScanned = func(id int64) {
		runs++
		if runs == 1 {
			// A file lands while the first scan is finishing; the watcher asks for a scan.
			makeVideo(t, filepath.Join(root, "Two (2002)", "Two (2002).mp4"))
			if err := sc.Scan(context.Background(), lib); err != nil {
				t.Error(err)
			}
		}
	}
	if err := sc.Scan(context.Background(), lib); err != nil {
		t.Fatal(err)
	}
	if runs != 2 {
		t.Fatalf("scans run: %d, want 2", runs)
	}
	if n := movieCount(t, st, lib.ID); n != 2 {
		t.Fatalf("%d movies, want 2 (the one added mid-scan was missed)", n)
	}
}

func TestFindSidecars(t *testing.T) {
	dir := t.TempDir()
	video := filepath.Join(dir, "Movie (2020).mkv")
	for _, n := range []string{"Movie (2020).mkv", "Movie (2020).srt", "Movie (2020).en.forced.srt", "Movie (2020).English.sdh.srt",
		"Movie (2020) 2.srt", "Movie (2020)-trailer.srt", "Movie (2020).nfo"} {
		os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644)
	}
	got := FindSidecars(video)
	if len(got) != 3 {
		var names []string
		for _, s := range got {
			names = append(names, filepath.Base(s.Path))
		}
		t.Fatalf("sidecars %v, want the 3 that belong to the movie", names)
	}
	byName := map[string]store.Stream{}
	for _, s := range got {
		byName[filepath.Base(s.Path)] = s
	}
	if s := byName["Movie (2020).en.forced.srt"]; s.Language != "eng" || !s.Forced {
		t.Errorf("forced English sidecar parsed as %+v", s)
	}
	if s := byName["Movie (2020).English.sdh.srt"]; s.Language != "eng" || s.Title != "SDH" {
		t.Errorf("SDH sidecar parsed as %+v", s)
	}
}
