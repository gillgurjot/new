package api

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gillgurjot/lumen/internal/auth"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/gillgurjot/lumen/internal/stream"
	"github.com/go-chi/chi/v5"
)

type startReq struct {
	ItemID         int64                `json:"itemId"`
	Profile        stream.DeviceProfile `json:"profile"`
	AudioIndex     *int                 `json:"audioIndex"`
	SubtitleIndex  *int                 `json:"subtitleIndex"` // nil = auto, -1 = off
	MaxHeight      int                  `json:"maxHeight"`
	MaxBitrate     int                  `json:"maxBitrate"`
	StartTime      *float64             `json:"startTime"` // nil = resume
	ReplaceSession string               `json:"replaceSession"`
	ForceTranscode bool                 `json:"forceTranscode"`
	Device         string               `json:"device"`
}

type subtitleTrack struct {
	Index    int    `json:"index"`
	Label    string `json:"label"`
	Language string `json:"language"`
	Codec    string `json:"codec"`
	Forced   bool   `json:"forced"`
	Default  bool   `json:"default"`
	External bool   `json:"external"`
	URL      string `json:"url,omitempty"` // WebVTT; empty for image subs (burned in when selected)
}

type audioTrack struct {
	Index    int    `json:"index"`
	Label    string `json:"label"`
	Language string `json:"language"`
	Codec    string `json:"codec"`
	Channels int    `json:"channels"`
}

type startResp struct {
	SessionID     string           `json:"sessionId"`
	Method        stream.Method    `json:"method"`
	URL           string           `json:"url"`
	MimeType      string           `json:"mimeType"`
	StartOffset   float64          `json:"startOffset"`
	StartTime     float64          `json:"startTime"`
	Duration      float64          `json:"duration"`
	Decision      stream.Decision  `json:"decision"`
	Token         string           `json:"token"`
	AudioTracks   []audioTrack     `json:"audioTracks"`
	AudioIndex    *int             `json:"audioIndex"`
	Subtitles     []subtitleTrack  `json:"subtitles"`
	SubtitleIndex int              `json:"subtitleIndex"`
	Trickplay     string           `json:"trickplay,omitempty"`
	Chapters      []store.Chapter  `json:"chapters"`
	Item          *store.Item      `json:"item"`
	Media         *store.MediaFile `json:"media"`
}

var langLabels = map[string]string{"eng": "English", "spa": "Spanish", "fre": "French", "fra": "French", "ger": "German", "deu": "German",
	"ita": "Italian", "jpn": "Japanese", "por": "Portuguese", "rus": "Russian", "chi": "Chinese", "zho": "Chinese", "kor": "Korean",
	"hin": "Hindi", "pan": "Punjabi", "dut": "Dutch", "nld": "Dutch", "ara": "Arabic", "swe": "Swedish", "nor": "Norwegian",
	"dan": "Danish", "fin": "Finnish", "pol": "Polish", "tur": "Turkish", "heb": "Hebrew", "tha": "Thai", "vie": "Vietnamese",
	"ind": "Indonesian", "ukr": "Ukrainian", "ces": "Czech", "cze": "Czech", "hun": "Hungarian", "gre": "Greek", "ell": "Greek",
	"tam": "Tamil", "tel": "Telugu", "urd": "Urdu", "ben": "Bengali"}

func langLabel(code string) string {
	if l, ok := langLabels[code]; ok {
		return l
	}
	if code == "" {
		return "Unknown"
	}
	return strings.ToUpper(code)
}

func channelLabel(n int) string {
	switch n {
	case 1:
		return "Mono"
	case 2:
		return "Stereo"
	case 6:
		return "5.1"
	case 8:
		return "7.1"
	}
	return strconv.Itoa(n) + "ch"
}

// pickSubtitle applies the user's subtitle preference when the client asks for "auto".
func pickSubtitle(m *store.MediaFile, u *store.User, audio *store.Stream) int {
	subs := m.Subtitles()
	if u.SubtitleMode == "off" || len(subs) == 0 {
		return -1
	}
	want := u.SubtitleLang
	if want == "" {
		want = u.AudioLang
	}
	audioLang := ""
	if audio != nil {
		audioLang = audio.Language
	}
	textFirst := func(match func(store.Stream) bool) int {
		best := -1
		for _, s := range subs {
			if match(s) {
				if !s.ImageBased {
					return s.Index
				}
				if best < 0 {
					best = s.Index
				}
			}
		}
		return best
	}
	// Forced subtitles in the audio language (foreign-dialogue parts) always show.
	if i := textFirst(func(s store.Stream) bool { return s.Forced && (s.Language == audioLang || s.Language == "") }); i >= 0 {
		return i
	}
	if u.SubtitleMode == "always" || (want != "" && audioLang != "" && audioLang != want) {
		if i := textFirst(func(s store.Stream) bool { return !s.Forced && (want == "" || s.Language == want) }); i >= 0 {
			return i
		}
	}
	return -1
}

func (s *Server) playbackStart(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var req startReq
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	it, err := s.St.Item(req.ItemID, u)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	m, err := s.St.MediaFileForItem(it.ID)
	if err != nil {
		writeErr(w, 404, "no playable file for this item")
		return
	}
	if _, err := os.Stat(m.Path); err != nil {
		writeErr(w, 410, "media file is unavailable (is the drive mounted?)")
		return
	}
	// Remembered per-item track choices, then user preferences.
	if req.AudioIndex == nil && it.UserData != nil {
		req.AudioIndex = it.UserData.AudioIndex
	}
	audio := stream.PickAudio(m, req.AudioIndex, u.AudioLang)
	subIdx := -1
	switch {
	case req.SubtitleIndex != nil:
		subIdx = *req.SubtitleIndex
	case it.UserData != nil && it.UserData.SubtitleIndex != nil:
		subIdx = *it.UserData.SubtitleIndex
	default:
		subIdx = pickSubtitle(m, u, audio)
	}
	start := 0.0
	if req.StartTime != nil {
		start = *req.StartTime
	} else if it.UserData != nil && it.UserData.Position > 0 {
		start = it.UserData.Position
	}
	if start < 0 || (m.Duration > 0 && start > m.Duration-5) {
		start = 0
	}
	var aIdx *int
	if audio != nil {
		aIdx = &audio.Index
	}
	sreq := stream.Request{AudioIndex: aIdx, SubtitleIndex: &subIdx, MaxHeight: req.MaxHeight, MaxBitrate: req.MaxBitrate, StartTime: start, ForceTranscode: req.ForceTranscode}
	d := stream.Decide(m, req.Profile, sreq, u.MaxBitrate, u.AudioLang)

	title := it.Title
	if it.SeriesTitle != "" {
		title = it.SeriesTitle + " — " + it.Title
	}
	dev := req.Device
	if dev == "" {
		dev = req.Profile.Name
	}
	sess := &stream.Session{UserID: u.ID, Username: u.Username, ItemID: it.ID, FileID: m.ID, Title: title, Device: dev,
		Client: r.UserAgent(), Decision: d, Duration: m.Duration, Position: start}
	if d.Method != stream.DirectPlay {
		sess.StartOffset = start
	}
	if err := s.Streams.Start(r.Context(), sess, m, req.ReplaceSession); err != nil {
		if errors.Is(err, stream.ErrBusy) {
			writeErr(w, 503, err.Error())
			return
		}
		s.Log.Error("playback start failed", "item", it.ID, "err", err)
		writeErr(w, 500, "Couldn't start playback. Check the server log for the ffmpeg error.")
		return
	}
	token := s.Auth.MediaToken(u.ID, 12*time.Hour)
	tq := "t=" + url.QueryEscape(token)
	resp := startResp{SessionID: sess.ID, Method: d.Method, StartOffset: sess.StartOffset, StartTime: start, Duration: m.Duration,
		Decision: d, Token: token, AudioIndex: aIdx, SubtitleIndex: subIdx, Chapters: m.Chapters, Item: it, Media: m}
	if d.Method == stream.DirectPlay {
		resp.URL = fmt.Sprintf("/api/stream/%d/file?%s", m.ID, tq)
		resp.MimeType = mimeFor(m.Container)
	} else {
		resp.URL = fmt.Sprintf("/api/hls/%s/index.m3u8?%s", sess.ID, tq)
		resp.MimeType = "application/x-mpegURL"
	}
	for _, a := range m.AudioStreams() {
		label := langLabel(a.Language) + " · " + strings.ToUpper(a.Codec) + " " + channelLabel(a.Channels)
		if a.Title != "" {
			label = a.Title + " (" + label + ")"
		}
		resp.AudioTracks = append(resp.AudioTracks, audioTrack{Index: a.Index, Label: label, Language: a.Language, Codec: a.Codec, Channels: a.Channels})
	}
	for _, sub := range m.Subtitles() {
		label := langLabel(sub.Language)
		if sub.Title != "" && !strings.EqualFold(sub.Title, label) {
			label += " · " + sub.Title
		}
		if sub.Forced {
			label += " (Forced)"
		}
		if sub.External {
			label += " · External"
		}
		t := subtitleTrack{Index: sub.Index, Label: label, Language: sub.Language, Codec: sub.Codec, Forced: sub.Forced, Default: sub.Default, External: sub.External}
		if !sub.ImageBased {
			t.URL = fmt.Sprintf("/api/subtitles/%d/%d.vtt?%s", m.ID, sub.Index, tq)
		}
		resp.Subtitles = append(resp.Subtitles, t)
	}
	if m.Trickplay {
		resp.Trickplay = fmt.Sprintf("/api/trickplay/%d/index.json", m.ID)
	}
	writeJSON(w, 200, resp)
}

func mimeFor(container string) string {
	switch container {
	case "mp4":
		return "video/mp4"
	case "webm":
		return "video/webm"
	case "mkv":
		return "video/x-matroska"
	case "ts":
		return "video/mp2t"
	}
	return "application/octet-stream"
}

type progressReq struct {
	SessionID     string  `json:"sessionId"`
	ItemID        int64   `json:"itemId"`
	Position      float64 `json:"position"`
	Paused        bool    `json:"paused"`
	AudioIndex    *int    `json:"audioIndex"`
	SubtitleIndex *int    `json:"subtitleIndex"`
}

func (s *Server) playbackProgress(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var p progressReq
	if err := decode(r, &p); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	it, err := s.St.Item(p.ItemID, u)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	s.Streams.Report(p.SessionID, u.ID, p.Position, p.Paused)
	alive := true
	if _, err := s.Streams.Get(p.SessionID); err != nil {
		alive = false
	}
	played, err := s.St.SaveProgress(u.ID, it.ID, p.Position, it.Duration, p.AudioIndex, p.SubtitleIndex)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"played": played, "sessionAlive": alive})
}

func (s *Server) playbackStop(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var p progressReq
	if err := decode(r, &p); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if sess, err := s.Streams.Get(p.SessionID); err == nil && sess.UserID == u.ID {
		s.Streams.Stop(p.SessionID)
	}
	if p.ItemID > 0 {
		if it, err := s.St.Item(p.ItemID, u); err == nil && p.Position > 0 {
			_, _ = s.St.SaveProgress(u.ID, it.ID, p.Position, it.Duration, p.AudioIndex, p.SubtitleIndex)
		}
	}
	s.Jobs.SyncJellyfin()
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// mediaFileFor loads a file and checks the user may access its library.
func (s *Server) mediaFileFor(r *http.Request) (*store.MediaFile, error) {
	m, err := s.St.MediaFile(idParam(r, "fileID"))
	if err != nil {
		return nil, err
	}
	if _, err := s.St.Item(m.ItemID, userFrom(r)); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Server) directStream(w http.ResponseWriter, r *http.Request) {
	m, err := s.mediaFileFor(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(m.Path)
	if err != nil {
		http.Error(w, "file unavailable", 410)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, "file unavailable", 410)
		return
	}
	w.Header().Set("Content-Type", mimeFor(m.Container))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (s *Server) hlsPlaylist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "sessionID")
	sess, err := s.Streams.Get(id)
	if err != nil || sess.UserID != userFrom(r).ID {
		http.Error(w, "session ended", 404)
		return
	}
	q := ""
	if t := r.URL.Query().Get("t"); t != "" {
		q = "t=" + url.QueryEscape(t)
	}
	b, err := s.Streams.Playlist(id, q)
	if err != nil {
		http.Error(w, "playlist not ready", 404)
		return
	}
	if auth.FromApp(r) {
		// The playlist grows while ffmpeg works (an EVENT playlist). Native players treat that
		// like live TV and jump to the newest segment; this tag makes them start at the top.
		b = bytes.Replace(b, []byte("#EXTM3U\n"), []byte("#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n"), 1)
	}
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(b)
}

func (s *Server) hlsSegment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "sessionID")
	sess, err := s.Streams.Get(id)
	if err != nil || sess.UserID != userFrom(r).ID {
		http.Error(w, "session ended", 404)
		return
	}
	p, err := s.Streams.SegmentPath(r.Context(), id, chi.URLParam(r, "name"))
	if err != nil {
		http.Error(w, "segment unavailable", 404)
		return
	}
	if strings.HasSuffix(p, ".mp4") {
		w.Header().Set("Content-Type", "video/mp4")
	} else {
		w.Header().Set("Content-Type", "video/iso.segment")
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, p)
}

func (s *Server) subtitle(w http.ResponseWriter, r *http.Request) {
	m, err := s.mediaFileFor(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	idx, _ := strconv.Atoi(chi.URLParam(r, "index"))
	p, err := s.Subs.VTT(r.Context(), m, idx)
	if err != nil {
		s.Log.Warn("subtitle", "err", err)
		http.Error(w, "subtitle unavailable", 404)
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, p)
}

func (s *Server) trickplayDir(r *http.Request) (string, bool) {
	m, err := s.mediaFileFor(r)
	if err != nil || !m.Trickplay {
		return "", false
	}
	return filepath.Join(s.Jobs.TrickplayDir, strconv.FormatInt(m.ID, 10)), true
}

func (s *Server) trickplayIndex(w http.ResponseWriter, r *http.Request) {
	dir, ok := s.trickplayDir(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, filepath.Join(dir, "index.json"))
}

func (s *Server) trickplaySheet(w http.ResponseWriter, r *http.Request) {
	dir, ok := s.trickplayDir(r)
	n, err := strconv.Atoi(chi.URLParam(r, "sheet"))
	if !ok || err != nil || n < 1 || n > 9999 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=604800")
	http.ServeFile(w, r, filepath.Join(dir, fmt.Sprintf("%03d.jpg", n)))
}
