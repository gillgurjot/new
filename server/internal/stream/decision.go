// Package stream decides how a file should reach a device and runs transcodes.
package stream

import (
	"fmt"
	"slices"
	"strings"

	"github.com/gillgurjot/lumen/internal/store"
)

// DeviceProfile describes what the playing device can decode. Clients build it
// from MediaSource/canPlayType checks, so it reflects the real device.
type DeviceProfile struct {
	Name             string   `json:"name"`
	VideoCodecs      []string `json:"videoCodecs"` // h264 hevc av1 vp9
	AudioCodecs      []string `json:"audioCodecs"` // aac mp3 opus flac ac3 eac3 vorbis
	Containers       []string `json:"containers"`  // mp4 webm mkv
	HLS              bool     `json:"hls"`         // MSE (hls.js) or native HLS available
	MaxWidth         int      `json:"maxWidth"`
	MaxHeight        int      `json:"maxHeight"`
	MaxBitrate       int      `json:"maxBitrate"` // kbps, 0 = unknown
	HDR              bool     `json:"hdr"`
	MaxAudioChannels int      `json:"maxAudioChannels"`
	// MultiAudio: the player can switch between a file's audio tracks itself (native apps).
	MultiAudio bool `json:"multiAudio"`
}

type Request struct {
	AudioIndex    *int    `json:"audioIndex"`
	SubtitleIndex *int    `json:"subtitleIndex"` // -1 / nil = none
	MaxHeight     int     `json:"maxHeight"`     // quality selector, 0 = auto
	MaxBitrate    int     `json:"maxBitrate"`    // kbps, 0 = auto
	StartTime     float64 `json:"startTime"`
	ForceTranscode bool   `json:"forceTranscode"`
}

type Method string

const (
	DirectPlay Method = "direct"
	Remux      Method = "remux"
	Transcode  Method = "transcode"
)

type Decision struct {
	Method       Method        `json:"method"`
	Reasons      []string      `json:"reasons"`
	VideoCopy    bool          `json:"videoCopy"`
	AudioCopy    bool          `json:"audioCopy"`
	Audio        *store.Stream `json:"audio,omitempty"`
	Burn         *store.Stream `json:"burn,omitempty"`
	Width        int           `json:"width"`
	Height       int           `json:"height"`
	VideoCodec   string        `json:"videoCodec,omitempty"` // output codec when transcoding
	AudioCodec   string        `json:"audioCodec,omitempty"` // output codec when converting audio
	VideoKbps    int           `json:"videoKbps"`
	AudioKbps    int           `json:"audioKbps"`
	AudioChannels int          `json:"audioChannels"`
	ToneMap      bool          `json:"toneMap"`
}

// fMP4 HLS can carry these without re-encoding.
var hlsVideoCopy = []string{"h264", "hevc", "av1"}
var hlsAudioCopy = []string{"aac", "mp3", "ac3", "eac3", "flac", "opus"}

// Bitrate ladder (kbps) by output height for H.264.
var ladder = []struct{ h, kbps int }{{2160, 24000}, {1440, 14000}, {1080, 8000}, {720, 4000}, {540, 2500}, {480, 1600}, {360, 900}}

func has(list []string, v string) bool { return slices.Contains(list, v) }

func minPos(vals ...int) int {
	m := 0
	for _, v := range vals {
		if v > 0 && (m == 0 || v < m) {
			m = v
		}
	}
	return m
}

// PickAudio selects the requested audio stream, else one in the preferred language, else default, else first.
func PickAudio(m *store.MediaFile, idx *int, prefLang string) *store.Stream {
	audio := m.AudioStreams()
	if len(audio) == 0 {
		return nil
	}
	if idx != nil {
		for i := range audio {
			if audio[i].Index == *idx {
				return &audio[i]
			}
		}
	}
	if prefLang != "" {
		for i := range audio {
			if audio[i].Language == prefLang {
				return &audio[i]
			}
		}
	}
	for i := range audio {
		if audio[i].Default {
			return &audio[i]
		}
	}
	return &audio[0]
}

func videoSupported(m *store.MediaFile, p DeviceProfile) (bool, string) {
	if !has(p.VideoCodecs, m.VideoCodec) {
		return false, fmt.Sprintf("video codec %s not supported by device", m.VideoCodec)
	}
	if m.VideoCodec == "h264" && strings.Contains(m.PixFmt, "10") {
		return false, "10-bit H.264 not supported by browsers"
	}
	if m.HDR != "" && !p.HDR {
		return false, "HDR source on SDR display (tone-mapping)"
	}
	if m.HDR == "dovi" && m.VideoCodec == "hevc" && strings.Contains(strings.ToLower(m.VideoProfile), "dolby") {
		return false, "Dolby Vision without HDR10 fallback"
	}
	return true, ""
}

func audioSupported(a *store.Stream, p DeviceProfile) bool {
	if a == nil {
		return true
	}
	if !has(p.AudioCodecs, a.Codec) {
		return false
	}
	return p.MaxAudioChannels == 0 || a.Channels <= p.MaxAudioChannels
}

// Decide chooses the cheapest method the device can play.
func Decide(m *store.MediaFile, p DeviceProfile, r Request, userMaxKbps int, prefLang string) Decision {
	d := Decision{Width: m.Width, Height: m.Height}
	d.Audio = PickAudio(m, r.AudioIndex, prefLang)

	if r.SubtitleIndex != nil && *r.SubtitleIndex >= 0 {
		for _, s := range m.Subtitles() {
			if s.Index == *r.SubtitleIndex && s.ImageBased && !s.External {
				s := s
				d.Burn = &s
			}
		}
	}
	capKbps := minPos(p.MaxBitrate, r.MaxBitrate, userMaxKbps)
	srcKbps := m.Bitrate / 1000
	bitrateOK := capKbps == 0 || srcKbps <= capKbps
	heightOK := r.MaxHeight == 0 || m.Height <= r.MaxHeight+r.MaxHeight/10
	vOK, vReason := videoSupported(m, p)
	aOK := audioSupported(d.Audio, p)
	firstAudio := true
	if aud := m.AudioStreams(); !p.MultiAudio && d.Audio != nil && len(aud) > 0 && aud[0].Index != d.Audio.Index {
		firstAudio = false // browsers can only play the first audio track of a file
	}
	containerOK := has(p.Containers, m.Container)

	var reasons []string
	add := func(ok bool, why string) {
		if !ok {
			reasons = append(reasons, why)
		}
	}
	add(containerOK, fmt.Sprintf("container %s not supported", m.Container))
	add(vOK, vReason)
	add(aOK, fmt.Sprintf("audio codec %s not supported", audioCodec(d.Audio)))
	add(bitrateOK, fmt.Sprintf("bitrate %d kbps over limit %d kbps", srcKbps, capKbps))
	add(heightOK, fmt.Sprintf("quality limited to %dp", r.MaxHeight))
	add(firstAudio, "selected audio track is not the first track")
	add(d.Burn == nil, "image subtitles must be burned in")
	add(!r.ForceTranscode, "transcode requested")
	if len(reasons) == 0 || !p.HLS {
		d.Method, d.VideoCopy, d.AudioCopy = DirectPlay, true, true
		if !p.HLS && len(reasons) > 0 {
			reasons = append(reasons, "device has no HLS support; trying direct play")
		}
		d.Reasons = reasons
		return d
	}
	d.Reasons = reasons

	d.AudioCopy = d.Audio != nil && aOK && has(hlsAudioCopy, d.Audio.Codec)
	if !d.AudioCopy && d.Audio != nil {
		d.AudioCodec = "aac"
		if !has(p.AudioCodecs, "aac") && has(p.AudioCodecs, "opus") {
			d.AudioCodec = "opus"
		}
		d.AudioChannels = 2
		if p.MaxAudioChannels >= 6 && d.Audio.Channels >= 6 && d.AudioCodec == "aac" {
			d.AudioChannels = 6
		}
		d.AudioKbps = 192
		if d.AudioChannels == 6 {
			d.AudioKbps = 384
		}
	}

	if vOK && bitrateOK && heightOK && d.Burn == nil && !r.ForceTranscode && has(hlsVideoCopy, m.VideoCodec) {
		d.Method, d.VideoCopy = Remux, true
		return d
	}

	// Full transcode, sized to the device and bandwidth.
	d.Method = Transcode
	d.VideoCodec = outputCodec(p)
	d.ToneMap = m.HDR != ""
	targetH := m.Height
	if mh := minPos(r.MaxHeight, p.MaxHeight); mh > 0 && mh < targetH {
		targetH = mh
	}
	kbps := ladderKbps(targetH) * efficiency(d.VideoCodec) / 100
	if capKbps > 0 {
		budget := capKbps - d.AudioKbps
		if budget < 300 {
			budget = 300
		}
		// Drop resolution until the ladder fits the budget so quality stays sensible.
		for _, l := range ladder {
			if l.h <= targetH && l.kbps <= budget*13/10 {
				targetH = l.h
				break
			}
			if l.h == 360 {
				targetH = 360
			}
		}
		kbps = min(ladderKbps(targetH)*efficiency(d.VideoCodec)/100, budget)
	}
	if srcKbps > 0 && kbps > srcKbps {
		kbps = max(srcKbps, 500)
	}
	d.VideoKbps = kbps
	d.Width, d.Height = fit(m.Width, m.Height, targetH, p.MaxWidth)
	return d
}

func audioCodec(a *store.Stream) string {
	if a == nil {
		return "none"
	}
	return a.Codec
}

func ladderKbps(h int) int {
	for _, l := range ladder {
		if h >= l.h-l.h/10 {
			return l.kbps
		}
	}
	return 700
}

// fit scales (w,h) to height th (never upscaling), limited by maxW, with even dimensions.
func fit(w, h, th, maxW int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, th
	}
	if th <= 0 || th > h {
		th = h
	}
	tw := w * th / h
	if maxW > 0 && tw > maxW && maxW < w {
		tw = maxW
		th = h * tw / w
	}
	return tw &^ 1, th &^ 1
}

// outputCodec picks the transcode target the device can decode, preferring H.264
// (fast hardware encode everywhere) and falling back for devices without it.
func outputCodec(p DeviceProfile) string {
	for _, c := range []string{"h264", "hevc", "vp9", "av1"} {
		if has(p.VideoCodecs, c) {
			return c
		}
	}
	return "h264"
}

// efficiency is the bitrate needed relative to H.264, in percent.
func efficiency(codec string) int {
	switch codec {
	case "hevc", "vp9":
		return 70
	case "av1":
		return 60
	}
	return 100
}
