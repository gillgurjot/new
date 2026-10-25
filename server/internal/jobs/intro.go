package jobs

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"math/bits"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/gillgurjot/lumen/internal/store"
	"github.com/gillgurjot/lumen/internal/stream"
)

// Intro detection works like Jellyfin's Intro Skipper: episodes of a season share the
// same opening music, so the start of each episode's audio is fingerprinted (chromaprint,
// through ffmpeg) and compared with its neighbours. The longest stretch of matching
// audio is the intro. A chapter called "Intro"/"Opening" wins over any guess.

var introChapter = regexp.MustCompile(`(?i)^(intro|opening|op|title sequence|main titles?)$|\bintro\b|\bopening\b`)

const (
	fpStep     = 0.1238 // seconds per chromaprint point (11025 Hz, 4096-sample frames, 2/3 overlap)
	maxBitDiff = 6      // points this close count as the same sound
	maxGapSec  = 3.5    // short quiet or changed bits inside an intro
	minIntro   = 15.0
	maxIntro   = 120.0
	maxShifts  = 24 // candidate alignments tried per pair
)

func (r *Runner) introLoop(ctx context.Context) {
	for {
		busy := false
		for _, s := range r.Streams.List() {
			if s.Method == stream.Transcode {
				busy = true
			}
		}
		var files []*store.MediaFile
		if !busy {
			files, _ = r.St.SeasonNeedingIntro()
		}
		if len(files) == 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Minute):
			}
			continue
		}
		r.analyseSeason(ctx, files)
		if ctx.Err() != nil {
			return
		}
	}
}

func (r *Runner) analyseSeason(ctx context.Context, files []*store.MediaFile) {
	fps := map[int64][]uint32{}
	failed := map[int64]bool{}
	fp := func(f *store.MediaFile) []uint32 {
		if v, ok := fps[f.ID]; ok || failed[f.ID] {
			return v
		}
		v, err := r.fingerprint(ctx, f)
		if err != nil {
			if ctx.Err() == nil {
				r.Log.Warn("intro fingerprint failed", "file", filepath.Base(f.Path), "err", err)
			}
			failed[f.ID] = true
			return nil
		}
		fps[f.ID] = v
		return v
	}
	for i, f := range files {
		if ctx.Err() != nil {
			return
		}
		if r.St.IntroState(f.ID) != 0 {
			continue
		}
		if s, e, ok := chapterIntro(f); ok {
			r.St.SetIntro(f.ID, s, e, 1)
			continue
		}
		a := fp(f)
		if a == nil {
			if ctx.Err() == nil {
				r.St.SetIntro(f.ID, 0, 0, -1)
			}
			continue
		}
		found := false
		for _, j := range []int{i + 1, i - 1, i + 2, i - 2} {
			if j < 0 || j >= len(files) {
				continue
			}
			b := fp(files[j])
			if b == nil {
				continue
			}
			as, ae, bs, be, ok := CompareFingerprints(a, b)
			if !ok {
				continue
			}
			r.St.SetIntro(f.ID, as, ae, 1)
			if r.St.IntroState(files[j].ID) == 0 {
				r.St.SetIntro(files[j].ID, bs, be, 1)
			}
			r.Log.Debug("intro found", "file", filepath.Base(f.Path), "start", int(as), "end", int(ae))
			found = true
			break
		}
		if !found && ctx.Err() == nil {
			r.St.SetIntro(f.ID, 0, 0, 1)
		}
	}
}

func chapterIntro(f *store.MediaFile) (float64, float64, bool) {
	for _, c := range f.Chapters {
		if introChapter.MatchString(c.Title) && c.End > c.Start && c.Start < f.Duration*0.4 && c.End-c.Start <= 300 {
			return c.Start, c.End, true
		}
	}
	return 0, 0, false
}

// fingerprint returns chromaprint points for the first quarter of the file (10 min max).
func (r *Runner) fingerprint(ctx context.Context, f *store.MediaFile) ([]uint32, error) {
	length := min(f.Duration*0.25, 600)
	cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, r.FFmpeg, "-hide_banner", "-nostdin", "-v", "error", "-threads", "2",
		"-t", strconv.FormatFloat(length, 'f', 1, 64), "-i", f.Path,
		"-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "2", "-f", "chromaprint", "-fp_format", "raw", "-")
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%v: %s", err, bytes.TrimSpace(errb.Bytes()))
	}
	raw := out.Bytes()
	if float64(len(raw)/4)*fpStep < minIntro {
		return nil, fmt.Errorf("fingerprint too short")
	}
	pts := make([]uint32, len(raw)/4)
	for i := range pts {
		pts[i] = binary.LittleEndian.Uint32(raw[i*4:])
	}
	return pts, nil
}

// CompareFingerprints finds the longest stretch of shared audio in two fingerprints and
// returns where it is in each (seconds), or ok=false when there isn't an intro-sized one.
func CompareFingerprints(a, b []uint32) (aStart, aEnd, bStart, bEnd float64, ok bool) {
	// Exact point matches suggest how far b is shifted against a.
	where := make(map[uint32][]int32, len(b))
	for j, p := range b {
		if l := where[p]; len(l) < 8 {
			where[p] = append(l, int32(j))
		}
	}
	votes := map[int]int{}
	for i, p := range a {
		for _, j := range where[p] {
			votes[int(j)-i]++
		}
	}
	type cand struct{ shift, n int }
	var cands []cand
	for s, n := range votes {
		if n >= 2 {
			cands = append(cands, cand{s, n})
		}
	}
	sort.Slice(cands, func(i, j int) bool {
		return cands[i].n > cands[j].n || cands[i].n == cands[j].n && cands[i].shift < cands[j].shift
	})
	if len(cands) > maxShifts {
		cands = cands[:maxShifts]
	}
	tried := map[int]bool{}
	best := 0.0
	step, gapSec := fpStep, maxGapSec
	maxGap := int(gapSec / step)
	for _, c := range cands {
		// Two encodes of the same music can be a point or two apart.
		for _, shift := range []int{c.shift, c.shift - 1, c.shift + 1} {
			if tried[shift] {
				continue
			}
			tried[shift] = true
			s, e, found := longestRun(a, b, shift, maxGap)
			if !found || !varied(a[s:e+1]) {
				continue
			}
			d := float64(e-s) * fpStep
			if d > best {
				best = d
				aStart, aEnd = float64(s)*fpStep, float64(e+1)*fpStep
				bStart, bEnd = float64(s+shift)*fpStep, float64(e+1+shift)*fpStep
			}
		}
	}
	if best < minIntro || best > maxIntro {
		return 0, 0, 0, 0, false
	}
	return aStart, aEnd, bStart, bEnd, true
}

// varied is false for silence and hum, whose points barely change and would otherwise
// match between any two episodes.
func varied(pts []uint32) bool {
	seen := map[uint32]bool{}
	for _, p := range pts {
		seen[p] = true
	}
	return len(seen)*4 >= len(pts)
}

// longestRun walks a against b offset by shift and returns the longest run (indexes in
// a) of similar points, allowing gaps of up to maxGap points.
func longestRun(a, b []uint32, shift, maxGap int) (int, int, bool) {
	from := max(0, -shift)
	to := min(len(a), len(b)-shift)
	bestS, bestE, found := 0, 0, false
	runS, last := -1, -1
	for i := from; i < to; i++ {
		if bits.OnesCount32(a[i]^b[i+shift]) > maxBitDiff {
			continue
		}
		if runS < 0 || i-last > maxGap {
			runS = i
		}
		last = i
		if !found || last-runS > bestE-bestS {
			bestS, bestE, found = runS, last, true
		}
	}
	return bestS, bestE, found
}
