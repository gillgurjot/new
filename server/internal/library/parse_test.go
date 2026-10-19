package library

import "testing"

func TestMovieInfo(t *testing.T) {
	cases := []struct {
		path, title string
		year        int
	}{
		{"/m/Inception (2010)/Inception (2010).mkv", "Inception", 2010},
		{"/m/The.Matrix.1999.1080p.BluRay.x264.mkv", "The Matrix", 1999},
		{"/m/Blade Runner 2049 (2017)/movie.mkv", "Blade Runner 2049", 2017},
		{"/m/Arrival (2016) [tmdbid-329865]/Arrival.mkv", "Arrival", 2016},
		{"/m/Some Film/Some Film.mp4", "Some Film", 0},
		{"/m/2001 A Space Odyssey (1968)/2001 A Space Odyssey (1968).mkv", "2001 A Space Odyssey", 1968},
	}
	for _, c := range cases {
		title, year, _ := MovieInfo(c.path)
		if title != c.title || year != c.year {
			t.Errorf("%s: got %q %d, want %q %d", c.path, title, year, c.title, c.year)
		}
	}
	if _, _, id := MovieInfo("/m/Arrival (2016) [tmdbid-329865]/Arrival.mkv"); id != 329865 {
		t.Errorf("tmdb id: got %d", id)
	}
}

func TestParseEpisode(t *testing.T) {
	cases := []struct {
		file          string
		dirSeason     int
		s, e, end     int
		ok            bool
	}{
		{"Show S01E02.mkv", -1, 1, 2, 0, true},
		{"show.s02e10.720p.mkv", -1, 2, 10, 0, true},
		{"Show - S03E01-E02 - Title.mkv", -1, 3, 1, 2, true},
		{"Show S03E01E02.mkv", -1, 3, 1, 2, true},
		{"Show 4x05.mkv", -1, 4, 5, 0, true},
		{"Episode 7.mkv", 2, 2, 7, 0, true},
		{"03 - Pilot.mkv", 1, 1, 3, 0, true},
		{"E12.mkv", 0, 0, 12, 0, true},
		{"random.mkv", 1, 0, 0, 0, false},
	}
	for _, c := range cases {
		got := ParseEpisode(c.file, c.dirSeason)
		if got.OK != c.ok || got.Season != c.s || got.Episode != c.e || got.EpisodeEnd != c.end {
			t.Errorf("%s: got %+v", c.file, got)
		}
	}
}

func TestSeasonFromDir(t *testing.T) {
	for in, want := range map[string]int{"Season 1": 1, "Season 02": 2, "S03": 3, "Specials": 0, "season.10": 10} {
		got, ok := SeasonFromDir(in)
		if !ok || got != want {
			t.Errorf("%s: got %d %v", in, got, ok)
		}
	}
	if _, ok := SeasonFromDir("Extras Stuff"); ok {
		t.Error("unexpected season")
	}
}

func TestEpisodeTitle(t *testing.T) {
	if got := EpisodeTitle("Show - S01E02 - The Return.mkv"); got != "The Return" {
		t.Errorf("got %q", got)
	}
}
