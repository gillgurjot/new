package library

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gillgurjot/lumen/internal/store"
)

type ffStream struct {
	Index         int               `json:"index"`
	CodecType     string            `json:"codec_type"`
	CodecName     string            `json:"codec_name"`
	Profile       string            `json:"profile"`
	PixFmt        string            `json:"pix_fmt"`
	Width         int               `json:"width"`
	Height        int               `json:"height"`
	Channels      int               `json:"channels"`
	ChannelLayout string            `json:"channel_layout"`
	BitRate       string            `json:"bit_rate"`
	ColorTransfer string            `json:"color_transfer"`
	ColorPrimaries string           `json:"color_primaries"`
	Tags          map[string]string `json:"tags"`
	Disposition   map[string]int    `json:"disposition"`
	SideData      []map[string]any  `json:"side_data_list"`
}

type ffProbe struct {
	Streams []ffStream `json:"streams"`
	Format  struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
		BitRate    string `json:"bit_rate"`
	} `json:"format"`
	Chapters []struct {
		StartTime string            `json:"start_time"`
		EndTime   string            `json:"end_time"`
		Tags      map[string]string `json:"tags"`
	} `json:"chapters"`
}

var imageSubCodecs = map[string]bool{"hdmv_pgs_subtitle": true, "dvd_subtitle": true, "dvb_subtitle": true, "xsub": true}

// Probe runs ffprobe on path and returns a MediaFile (without item id).
func Probe(ctx context.Context, ffprobe, path string) (*store.MediaFile, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", path).Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe %s: %w", filepath.Base(path), err)
	}
	var p ffProbe
	if err := json.Unmarshal(out, &p); err != nil {
		return nil, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	m := &store.MediaFile{Path: path, Size: st.Size(), Mtime: st.ModTime().Unix()}
	m.Container = normalizeContainer(p.Format.FormatName, path)
	m.Duration, _ = strconv.ParseFloat(p.Format.Duration, 64)
	m.Bitrate, _ = strconv.Atoi(p.Format.BitRate)
	if m.Bitrate == 0 && m.Duration > 0 {
		m.Bitrate = int(float64(m.Size*8) / m.Duration)
	}
	videoSeen := false
	for _, s := range p.Streams {
		switch s.CodecType {
		case "video":
			if videoSeen || s.Disposition["attached_pic"] == 1 {
				continue
			}
			videoSeen = true
			m.VideoCodec = s.CodecName
			m.VideoProfile = s.Profile
			m.PixFmt = s.PixFmt
			m.Width, m.Height = s.Width, s.Height
			m.HDR = detectHDR(s)
		case "audio":
			br, _ := strconv.Atoi(s.BitRate)
			m.Streams = append(m.Streams, store.Stream{
				Index: s.Index, Type: "audio", Codec: s.CodecName, Language: lang(s.Tags), Title: s.Tags["title"],
				Channels: s.Channels, Layout: s.ChannelLayout, Default: s.Disposition["default"] == 1, Bitrate: br,
			})
		case "subtitle":
			m.Streams = append(m.Streams, store.Stream{
				Index: s.Index, Type: "subtitle", Codec: s.CodecName, Language: lang(s.Tags), Title: s.Tags["title"],
				Default: s.Disposition["default"] == 1, Forced: s.Disposition["forced"] == 1, ImageBased: imageSubCodecs[s.CodecName],
			})
		}
	}
	for _, c := range p.Chapters {
		st, _ := strconv.ParseFloat(c.StartTime, 64)
		en, _ := strconv.ParseFloat(c.EndTime, 64)
		m.Chapters = append(m.Chapters, store.Chapter{Start: st, End: en, Title: c.Tags["title"]})
	}
	m.Sidecars = FindSidecars(path)
	if m.VideoCodec == "" {
		return nil, fmt.Errorf("%s: no video stream", filepath.Base(path))
	}
	return m, nil
}

func lang(tags map[string]string) string {
	l := strings.ToLower(tags["language"])
	if l == "und" {
		return ""
	}
	return l
}

func detectHDR(s ffStream) string {
	for _, sd := range s.SideData {
		if t, _ := sd["side_data_type"].(string); strings.Contains(strings.ToLower(t), "dovi") {
			return "dovi"
		}
	}
	switch s.ColorTransfer {
	case "smpte2084":
		return "hdr10"
	case "arib-std-b67":
		return "hlg"
	}
	return ""
}

func normalizeContainer(format, path string) string {
	f := strings.Split(format, ",")[0]
	switch {
	case strings.Contains(format, "matroska"):
		if strings.EqualFold(filepath.Ext(path), ".webm") {
			return "webm"
		}
		return "mkv"
	case strings.Contains(format, "mp4"), strings.Contains(format, "mov"):
		return "mp4"
	case f == "mpegts":
		return "ts"
	case f == "avi":
		return "avi"
	}
	return f
}

// FindSidecars lists external subtitle files next to a video:
// "Movie.srt", "Movie.en.srt", "Movie.en.forced.srt", "Movie.English.srt".
func FindSidecars(video string) []store.Stream {
	dir := filepath.Dir(video)
	base := strings.TrimSuffix(filepath.Base(video), filepath.Ext(video))
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []store.Stream
	for _, e := range entries {
		name := e.Name()
		ext := strings.ToLower(filepath.Ext(name))
		// "Movie.en.srt" belongs to "Movie.mkv"; "Movie 2.srt" doesn't.
		if e.IsDir() || !SubtitleExts[ext] || !strings.HasPrefix(name, base) || !strings.HasPrefix(name[len(base):], ".") {
			continue
		}
		rest := strings.Trim(strings.TrimSuffix(name[len(base):], filepath.Ext(name)), ".")
		s := store.Stream{Type: "subtitle", Codec: strings.TrimPrefix(ext, "."), External: true, Path: filepath.Join(dir, name)}
		for _, part := range strings.Split(strings.ToLower(rest), ".") {
			switch part {
			case "":
			case "forced":
				s.Forced = true
			case "default":
				s.Default = true
			case "sdh", "cc", "hi":
				s.Title = strings.TrimSpace(s.Title + " SDH")
			default:
				if s.Language == "" {
					s.Language = normalizeLang(part)
				}
			}
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	for i := range out {
		out[i].Index = 1000 + i // keep external indices separate from embedded stream indices
	}
	return out
}

var langNames = map[string]string{"english": "eng", "en": "eng", "spanish": "spa", "es": "spa", "french": "fre", "fr": "fre",
	"german": "ger", "de": "ger", "italian": "ita", "it": "ita", "japanese": "jpn", "ja": "jpn", "portuguese": "por", "pt": "por",
	"russian": "rus", "ru": "rus", "chinese": "chi", "zh": "chi", "korean": "kor", "ko": "kor", "hindi": "hin", "hi": "hin",
	"punjabi": "pan", "pa": "pan", "dutch": "dut", "nl": "dut", "arabic": "ara", "ar": "ara"}

func normalizeLang(s string) string {
	if v, ok := langNames[s]; ok {
		return v
	}
	return s
}
