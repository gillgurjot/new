package api

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDownloadName(t *testing.T) {
	s, e := 1, 2
	if got := downloadName("Half Loop", "Severance", 0, &s, &e, ".mkv"); got != "Severance S01E02 - Half Loop.mkv" {
		t.Errorf("episode: %q", got)
	}
	if got := downloadName("Alien: Romulus", "", 2024, nil, nil, ".mp4"); got != "Alien- Romulus (2024).mp4" {
		t.Errorf("movie: %q", got)
	}
	long := downloadName(strings.Repeat("ਪੰਜਾਬੀ", 60), "", 0, nil, nil, ".mkv")
	if !utf8.ValidString(long) {
		t.Errorf("long non-Latin title cut mid-character: %q", long)
	}
}
