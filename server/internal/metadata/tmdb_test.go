package metadata

import "testing"

func TestTextlessBackdrop(t *testing.T) {
	il := imageList{Backdrops: []tmdbImage{
		{FilePath: "/titled.jpg", Lang: "en", Vote: 9, Width: 3840},
		{FilePath: "/small.jpg", Lang: "", Vote: 9, Width: 780},
		{FilePath: "/clean-low.jpg", Lang: "", Vote: 5, Votes: 2, Width: 1920},
		{FilePath: "/clean.jpg", Lang: "", Vote: 5.5, Votes: 8, Width: 1920},
	}}
	if got := textlessBackdrop(il); got != "/clean.jpg" {
		t.Fatalf("got %q", got)
	}
	if got := textlessBackdrop(imageList{Backdrops: []tmdbImage{{FilePath: "/t.jpg", Lang: "hi", Width: 1920}}}); got != "" {
		t.Fatalf("only titled art should give none, got %q", got)
	}
}
