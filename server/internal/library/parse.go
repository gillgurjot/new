// Package library scans media folders and keeps the catalog in sync.
package library

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var VideoExts = map[string]bool{
	".mkv": true, ".mp4": true, ".m4v": true, ".avi": true, ".mov": true, ".webm": true, ".ts": true,
	".m2ts": true, ".mts": true, ".wmv": true, ".flv": true, ".mpg": true, ".mpeg": true, ".ogv": true, ".3gp": true,
}

var SubtitleExts = map[string]bool{".srt": true, ".vtt": true, ".ass": true, ".ssa": true, ".sub": false}

// Folders that hold extras rather than main content.
var skipDirs = map[string]bool{
	"extras": true, "featurettes": true, "behind the scenes": true, "deleted scenes": true, "interviews": true,
	"scenes": true, "shorts": true, "trailers": true, "samples": true, "sample": true, "other": true, "@eadir": true,
	".actors": true, "$recycle.bin": true, "lost+found": true,
}

func SkipDir(name string) bool {
	n := strings.ToLower(name)
	return strings.HasPrefix(n, ".") || skipDirs[n]
}

func SkipFile(name string) bool {
	n := strings.ToLower(name)
	if strings.HasPrefix(n, ".") || strings.HasPrefix(n, "._") {
		return true
	}
	base := strings.TrimSuffix(n, filepath.Ext(n))
	return base == "sample" || strings.HasSuffix(base, "-sample") || strings.HasSuffix(base, ".sample") ||
		strings.HasSuffix(base, "-trailer") || strings.HasSuffix(base, "-featurette")
}

var (
	reYearParen = regexp.MustCompile(`^(.*?)[\s._]*[\(\[](\d{4})[\)\]]`)
	reYearBare  = regexp.MustCompile(`^(.*?)[\s._]+((?:19|20)\d{2})(?:[\s._\-]|$)`)
	reTMDB      = regexp.MustCompile(`(?i)[\[\{]tmdb(?:id)?[-=](\d+)[\]\}]`)
	reJunk      = regexp.MustCompile(`(?i)[\s._\-\[\(](2160p|1080p|720p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|web|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|10bit|hdr|hdr10|dv|atmos|ddp?5\.1|aac|dts|proper|repack|extended|unrated|imax)\b.*$`)
	reCleanSep  = regexp.MustCompile(`[._]+`)
	reSpaces    = regexp.MustCompile(`\s+`)

	reSxE      = regexp.MustCompile(`(?i)\bs(\d{1,3})[\s._-]*e(\d{1,4})(?:(?:[\s._-]*-?e|-)(\d{1,4}))?`)
	reNxN      = regexp.MustCompile(`(?i)\b(\d{1,2})x(\d{1,3})(?:-(\d{1,3}))?\b`)
	reEpOnly   = regexp.MustCompile(`(?i)(?:\bep?(?:isode)?[\s._-]*)(\d{1,4})\b`)
	reLeadNum  = regexp.MustCompile(`^(\d{1,3})(?:[\s._-]|$)`)
	reSeasonDir = regexp.MustCompile(`(?i)^(?:season|series|staffel|saison|temporada|s)[\s._-]*(\d{1,3})$`)
	reDailyDate = regexp.MustCompile(`\b((?:19|20)\d{2})[.\-_ ](\d{2})[.\-_ ](\d{2})\b`)
)

func cleanTitle(s string) string {
	s = reJunk.ReplaceAllString(s, "")
	s = reCleanSep.ReplaceAllString(s, " ")
	s = strings.Trim(s, " -[](){}")
	return reSpaces.ReplaceAllString(s, " ")
}

// ParseTitleYear extracts "Title" and year from a name like "Title (2020) [1080p]".
// It also returns a TMDB id when the name carries a "[tmdbid-123]" tag.
func ParseTitleYear(name string) (title string, year int, tmdb int) {
	if m := reTMDB.FindStringSubmatch(name); m != nil {
		tmdb, _ = strconv.Atoi(m[1])
		name = reTMDB.ReplaceAllString(name, "")
	}
	if m := reYearParen.FindStringSubmatch(name); m != nil && strings.TrimSpace(m[1]) != "" {
		year, _ = strconv.Atoi(m[2])
		return cleanTitle(m[1]), year, tmdb
	}
	if m := reYearBare.FindStringSubmatch(name); m != nil && strings.TrimSpace(m[1]) != "" {
		year, _ = strconv.Atoi(m[2])
		return cleanTitle(m[1]), year, tmdb
	}
	return cleanTitle(name), 0, tmdb
}

// MovieInfo derives movie title/year from its file path.
func MovieInfo(path string) (title string, year int, tmdb int) {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	title, year, tmdb = ParseTitleYear(base)
	dir := filepath.Base(filepath.Dir(path))
	dt, dy, dtm := ParseTitleYear(dir)
	if tmdb == 0 {
		tmdb = dtm
	}
	// Prefer folder when the file name is generic (e.g. "movie.mkv", "VTS_01_1") or lacks a year.
	generic := len(title) < 2 || strings.EqualFold(title, "movie") || strings.HasPrefix(strings.ToLower(title), "vts")
	if (generic || (year == 0 && dy != 0)) && dt != "" && !SkipDir(dir) {
		return dt, dy, tmdb
	}
	return title, year, tmdb
}

type EpisodeInfo struct {
	Season     int
	Episode    int
	EpisodeEnd int // 0 when single episode
	OK         bool
}

// SeasonFromDir parses "Season 2", "S02", "Specials" folder names.
func SeasonFromDir(name string) (int, bool) {
	n := strings.TrimSpace(name)
	if strings.EqualFold(n, "specials") || strings.EqualFold(n, "extras season") {
		return 0, true
	}
	if m := reSeasonDir.FindStringSubmatch(n); m != nil {
		v, _ := strconv.Atoi(m[1])
		return v, true
	}
	return 0, false
}

// ParseEpisode extracts season/episode numbers from a file name, using
// dirSeason (or -1 if unknown) when the name only carries an episode number.
func ParseEpisode(file string, dirSeason int) EpisodeInfo {
	base := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	if m := reSxE.FindStringSubmatch(base); m != nil {
		s, _ := strconv.Atoi(m[1])
		e, _ := strconv.Atoi(m[2])
		end, _ := strconv.Atoi(m[3])
		if end <= e {
			end = 0
		}
		return EpisodeInfo{s, e, end, true}
	}
	if m := reNxN.FindStringSubmatch(base); m != nil && !reDailyDate.MatchString(base) {
		s, _ := strconv.Atoi(m[1])
		e, _ := strconv.Atoi(m[2])
		end, _ := strconv.Atoi(m[3])
		if end <= e {
			end = 0
		}
		return EpisodeInfo{s, e, end, true}
	}
	season := dirSeason
	if season < 0 {
		season = 1
	}
	if m := reEpOnly.FindStringSubmatch(base); m != nil {
		e, _ := strconv.Atoi(m[1])
		return EpisodeInfo{season, e, 0, true}
	}
	if m := reLeadNum.FindStringSubmatch(base); m != nil {
		e, _ := strconv.Atoi(m[1])
		return EpisodeInfo{season, e, 0, true}
	}
	return EpisodeInfo{}
}

// EpisodeTitle tries to extract the episode title that follows the SxxEyy marker.
func EpisodeTitle(file string) string {
	base := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	loc := reSxE.FindStringIndex(base)
	if loc == nil {
		loc = reNxN.FindStringIndex(base)
	}
	if loc == nil {
		return ""
	}
	t := cleanTitle(base[loc[1]:])
	t = strings.Trim(t, " -")
	return t
}
