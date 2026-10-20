package jobs

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gillgurjot/lumen/internal/store"
	"github.com/gillgurjot/lumen/internal/stream"
)

// Credits detection looks at the end of each file for a long stretch of mostly-black
// frames, which is what scrolling or card credits look like. Only keyframes are decoded,
// so a whole library is analysed cheaply in the background.

var creditsChapter = regexp.MustCompile(`(?i)credits|ending|^ed$|outro`)

func (r *Runner) creditsLoop(ctx context.Context) {
	for {
		busy := false
		for _, s := range r.Streams.List() {
			if s.Method == stream.Transcode {
				busy = true
			}
		}
		var files []*store.MediaFile
		if !busy {
			files, _ = r.St.FilesNeedingCredits(1)
		}
		if len(files) == 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Minute):
			}
			continue
		}
		f := files[0]
		start, end, err := r.findCredits(ctx, f)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			r.Log.Warn("credits detection failed", "file", filepath.Base(f.Path), "err", err)
			r.St.SetCredits(f.ID, 0, 0, -1)
			continue
		}
		if start > 0 {
			r.Log.Debug("credits found", "file", filepath.Base(f.Path), "start", int(start), "end", int(end))
		}
		r.St.SetCredits(f.ID, start, end, 1)
	}
}

// Frame is one decoded keyframe: its time and how much of it is black (0–100).
type Frame struct {
	T     float64
	Black int
}

func (r *Runner) findCredits(ctx context.Context, f *store.MediaFile) (float64, float64, error) {
	// A credits chapter from the file itself is better than any guess.
	for _, c := range f.Chapters {
		if creditsChapter.MatchString(c.Title) && c.Start > f.Duration*0.5 {
			return c.Start, c.End, nil
		}
	}
	window := creditsWindow(f.Duration)
	from := f.Duration - window
	cctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, r.FFmpeg, "-hide_banner", "-nostdin", "-threads", "2", "-skip_frame", "nokey",
		"-ss", strconv.FormatFloat(from, 'f', 1, 64), "-i", f.Path,
		"-an", "-sn", "-dn", "-vf", "scale=160:-2,blackframe=amount=0:threshold=32", "-f", "null", "-")
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return 0, 0, err
	}
	if err := cmd.Start(); err != nil {
		return 0, 0, err
	}
	frames := parseBlackframe(bufio.NewScanner(stderr), from)
	if err := cmd.Wait(); err != nil && len(frames) == 0 {
		return 0, 0, fmt.Errorf("ffmpeg: %w", err)
	}
	s, e := DetectCredits(frames, f.Duration)
	return s, e, nil
}

// creditsWindow is how much of the end of a file to analyse.
func creditsWindow(d float64) float64 {
	w := 600.0 // episodes: last 10 minutes
	if d > 75*60 {
		w = 1200 // movies: last 20 minutes
	}
	return min(w, d*0.35)
}

var blackLine = regexp.MustCompile(`pblack:(\d+).*?\bt:([0-9.]+)`)

func parseBlackframe(sc *bufio.Scanner, offset float64) []Frame {
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	var out []Frame
	for sc.Scan() {
		line := sc.Text()
		if !strings.Contains(line, "blackframe") {
			continue
		}
		m := blackLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		b, _ := strconv.Atoi(m[1])
		t, _ := strconv.ParseFloat(m[2], 64)
		out = append(out, Frame{T: offset + t, Black: b})
	}
	return out
}

const (
	darkPct    = 85   // a frame counts as "credits-like" when this much of it is black
	maxGap     = 30.0 // seconds between dark keyframes inside credits (static credits get sparse keyframes; logos, cards)
	mergeGap   = 240.0
	minCredits = 25.0 // shortest stretch we call credits
)

// DetectCredits returns the start and end of the end credits, or 0, 0 if none were found.
// It finds runs of dark keyframes, takes the last long run near the end of the file, and
// joins earlier runs separated by a short scene (mid-credits scenes).
func DetectCredits(frames []Frame, duration float64) (float64, float64) {
	if len(frames) < 4 || duration <= 0 {
		return 0, 0
	}
	// ffmpeg reports frames in decode order; put them in time order.
	frames = append([]Frame(nil), frames...)
	sort.Slice(frames, func(i, j int) bool { return frames[i].T < frames[j].T })
	type run struct{ start, end float64 }
	var runs []run
	var cur *run
	for _, f := range frames {
		if f.Black >= darkPct {
			if cur != nil && f.T-cur.end <= maxGap {
				cur.end = f.T
			} else {
				runs = append(runs, run{f.T, f.T})
				cur = &runs[len(runs)-1]
			}
		}
	}
	// Last long run that reaches close to the end (post-credits scenes are allowed after it).
	idx := -1
	for i := len(runs) - 1; i >= 0; i-- {
		if runs[i].end-runs[i].start >= minCredits {
			idx = i
			break
		}
	}
	if idx < 0 || duration-runs[idx].end > 300 {
		return 0, 0
	}
	start, end := runs[idx].start, runs[idx].end
	for i := idx - 1; i >= 0; i-- {
		if start-runs[i].end > mergeGap || runs[i].end-runs[i].start < minCredits {
			break
		}
		start = runs[i].start
	}
	if start < duration*0.5 || end-start > duration*0.4 {
		return 0, 0
	}
	// Keyframes are sparse; the credits end where the last dark keyframe's GOP ends.
	if duration-end < 15 {
		end = duration
	}
	return start, end
}
