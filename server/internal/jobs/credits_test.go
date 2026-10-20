package jobs

import (
	"bufio"
	"strings"
	"testing"
)

// frames builds keyframes every step seconds from a to b with the given blackness.
func frames(a, b, step float64, black int) []Frame {
	var out []Frame
	for t := a; t < b; t += step {
		out = append(out, Frame{T: t, Black: black})
	}
	return out
}

func join(fs ...[]Frame) []Frame {
	var out []Frame
	for _, f := range fs {
		out = append(out, f...)
	}
	return out
}

func TestDetectCredits(t *testing.T) {
	const d = 2700.0 // 45 minute episode
	cases := []struct {
		name       string
		in         []Frame
		start, end float64
	}{
		{"credits to the end", join(frames(2100, 2580, 4, 20), frames(2580, 2700, 4, 95)), 2580, d},
		{"no credits", frames(2100, 2700, 4, 30), 0, 0},
		{"short dark scene only", join(frames(2100, 2400, 4, 20), frames(2400, 2412, 4, 95), frames(2412, 2700, 4, 20)), 0, 0},
		{"post-credits scene", join(frames(2100, 2400, 4, 20), frames(2400, 2600, 4, 92), frames(2600, 2700, 4, 25)), 2400, 2596},
		{"logo cards inside credits", join(frames(2100, 2500, 4, 20), frames(2500, 2580, 4, 95), frames(2580, 2592, 4, 40), frames(2592, 2700, 4, 95)), 2500, d},
		{"mid-credits scene", join(frames(2100, 2300, 4, 20), frames(2300, 2400, 4, 95), frames(2400, 2520, 4, 20), frames(2520, 2690, 4, 95)), 2300, d},
		{"too early", join(frames(1000, 1300, 4, 20), frames(1300, 2700, 4, 95)), 0, 0},
	}
	for _, c := range cases {
		s, e := DetectCredits(c.in, d)
		if s != c.start || e != c.end {
			t.Errorf("%s: got %v–%v, want %v–%v", c.name, s, e, c.start, c.end)
		}
	}
}

func TestParseBlackframe(t *testing.T) {
	log := `[Parsed_blackframe_1 @ 0x55] frame:0 pblack:12 pts:0 t:0.000000 type:I last_keyframe:0
[Parsed_blackframe_1 @ 0x55] frame:1 pblack:97 pts:5005 t:5.005000 type:I last_keyframe:1
frame=    2 fps=0.0 q=-0.0 size=N/A time=00:00:05.00`
	got := parseBlackframe(bufio.NewScanner(strings.NewReader(log)), 100)
	if len(got) != 2 || got[1].Black != 97 || got[1].T != 105.005 {
		t.Fatalf("got %+v", got)
	}
}
