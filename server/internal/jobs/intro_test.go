package jobs

import (
	"math/rand"
	"testing"
)

func randomPoints(r *rand.Rand, n int) []uint32 {
	out := make([]uint32, n)
	for i := range out {
		out[i] = r.Uint32()
	}
	return out
}

func secs(s float64) int { return int(s / fpStep) }

func TestCompareFingerprints(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	intro := randomPoints(r, secs(40)) // a 40 s theme
	// Episode A: 30 s cold open, then the theme. Episode B: 75 s cold open, then the theme
	// with a few bits flipped, as a different encode would have.
	a := append(append(randomPoints(r, secs(30)), intro...), randomPoints(r, 2000)...)
	noisy := make([]uint32, len(intro))
	for i, p := range intro {
		noisy[i] = p ^ (1 << uint(r.Intn(32))) ^ (1 << uint(r.Intn(32)))
	}
	b := append(append(randomPoints(r, secs(75)), noisy...), randomPoints(r, 2000)...)
	as, ae, bs, be, ok := CompareFingerprints(a, b)
	if !ok {
		t.Fatal("intro not found")
	}
	near := func(got, want float64) bool { return got > want-1.5 && got < want+1.5 }
	if !near(as, 30) || !near(ae, 70) || !near(bs, 75) || !near(be, 115) {
		t.Fatalf("got a %.1f–%.1f b %.1f–%.1f", as, ae, bs, be)
	}
	if _, _, _, _, ok := CompareFingerprints(randomPoints(r, 3000), randomPoints(r, 3000)); ok {
		t.Fatal("found an intro in unrelated audio")
	}
	silence := make([]uint32, 3000)
	if _, _, _, _, ok := CompareFingerprints(silence, silence); ok {
		t.Fatal("silence counted as an intro")
	}
}
