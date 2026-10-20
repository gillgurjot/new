package api

import (
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// download sends the original media file as an attachment, untouched, so it can be
// kept on the device and played offline. Range requests let browsers resume.
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if !u.CanDownload {
		writeErr(w, 403, "downloads are turned off for your account")
		return
	}
	it, err := s.St.Item(idParam(r, "id"), u)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	if it.Type != "movie" && it.Type != "episode" {
		writeErr(w, 400, "only movies and episodes can be downloaded")
		return
	}
	m, err := s.St.MediaFileForItem(it.ID)
	if err != nil {
		writeErr(w, 404, "no file for this item")
		return
	}
	f, err := os.Open(m.Path)
	if err != nil {
		writeErr(w, 410, "media file is unavailable (is the drive mounted?)")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeErr(w, 410, "media file is unavailable")
		return
	}
	name := downloadName(it.Title, it.SeriesTitle, it.Year, it.SeasonNumber, it.EpisodeNumber, filepath.Ext(m.Path))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Cache-Control", "private, no-transform")
	s.Log.Info("download", "user", u.Username, "item", it.ID, "file", filepath.Base(m.Path))
	http.ServeContent(w, r, "", st.ModTime(), f)
}

// downloadName builds a tidy file name like "Severance S01E02 - Half Loop.mkv".
func downloadName(title, series string, year int, season, episode *int, ext string) string {
	var n string
	switch {
	case series != "" && season != nil && episode != nil:
		n = fmt.Sprintf("%s S%02dE%02d - %s", series, *season, *episode, title)
	case year > 0:
		n = fmt.Sprintf("%s (%d)", title, year)
	default:
		n = title
	}
	n = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 32 {
			return '-'
		}
		return r
	}, n)
	if len(n) > 180 {
		n = n[:180]
	}
	return strings.TrimSpace(n) + ext
}
