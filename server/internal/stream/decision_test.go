package stream

import (
	"testing"

	"github.com/gillgurjot/lumen/internal/store"
)

var chrome = DeviceProfile{VideoCodecs: []string{"h264", "vp9", "av1", "hevc"}, AudioCodecs: []string{"aac", "mp3", "opus", "flac"},
	Containers: []string{"mp4", "webm"}, HLS: true, MaxWidth: 2560, MaxHeight: 1440}
var oldPhone = DeviceProfile{VideoCodecs: []string{"h264"}, AudioCodecs: []string{"aac", "mp3"}, Containers: []string{"mp4"},
	HLS: true, MaxWidth: 1280, MaxHeight: 720, MaxBitrate: 3000}

func file(container, vcodec, acodec string, h, kbps int) *store.MediaFile {
	return &store.MediaFile{Container: container, VideoCodec: vcodec, Width: h * 16 / 9, Height: h, PixFmt: "yuv420p", Bitrate: kbps * 1000,
		Streams: []store.Stream{{Index: 1, Type: "audio", Codec: acodec, Channels: 2}, {Index: 2, Type: "audio", Codec: "aac", Channels: 2, Language: "jpn"}}}
}

func TestDecide(t *testing.T) {
	cases := []struct {
		name string
		f    *store.MediaFile
		p    DeviceProfile
		r    Request
		want Method
	}{
		{"mp4 h264 aac direct", file("mp4", "h264", "aac", 1080, 6000), chrome, Request{}, DirectPlay},
		{"mkv h264 aac remux", file("mkv", "h264", "aac", 1080, 6000), chrome, Request{}, Remux},
		{"mkv hevc ac3 on chrome remux w/ audio transcode", file("mkv", "hevc", "ac3", 2160, 20000), chrome, Request{}, Remux},
		{"hevc on h264-only phone transcodes", file("mkv", "hevc", "aac", 2160, 20000), oldPhone, Request{}, Transcode},
		{"bitrate cap forces transcode", file("mp4", "h264", "aac", 1080, 9000), oldPhone, Request{}, Transcode},
		{"quality selector forces transcode", file("mp4", "h264", "aac", 1080, 6000), chrome, Request{MaxHeight: 480}, Transcode},
		{"second audio track remux", file("mp4", "h264", "aac", 1080, 6000), chrome, Request{AudioIndex: ptr(2)}, Remux},
		{"mpeg2 transcodes", file("ts", "mpeg2video", "mp2", 576, 5000), chrome, Request{}, Transcode},
	}
	for _, c := range cases {
		d := Decide(c.f, c.p, c.r, 0, "")
		if d.Method != c.want {
			t.Errorf("%s: got %s (%v)", c.name, d.Method, d.Reasons)
		}
	}
}

func TestTranscodeSizing(t *testing.T) {
	d := Decide(file("mkv", "hevc", "aac", 2160, 20000), oldPhone, Request{}, 0, "")
	if d.Height > 720 || d.VideoKbps > 3000 {
		t.Errorf("phone transcode too big: %dx%d @ %d", d.Width, d.Height, d.VideoKbps)
	}
	if d.Width%2 != 0 || d.Height%2 != 0 {
		t.Errorf("odd dims %dx%d", d.Width, d.Height)
	}
	d = Decide(file("mkv", "hevc", "ac3", 1080, 10000), oldPhone, Request{}, 1500, "")
	if d.VideoKbps > 1500 || d.Height > 540 {
		t.Errorf("user cap ignored: %dp @ %d", d.Height, d.VideoKbps)
	}
}

func TestHDRToneMap(t *testing.T) {
	f := file("mkv", "hevc", "aac", 2160, 20000)
	f.HDR = "hdr10"
	f.PixFmt = "yuv420p10le"
	d := Decide(f, chrome, Request{}, 0, "")
	if d.Method != Transcode || !d.ToneMap {
		t.Errorf("SDR display should tone-map: %+v", d)
	}
	hdr := chrome
	hdr.HDR = true
	if d := Decide(f, hdr, Request{}, 0, ""); d.Method != Remux {
		t.Errorf("HDR display should remux, got %s %v", d.Method, d.Reasons)
	}
}

func TestPreferredLanguage(t *testing.T) {
	a := PickAudio(file("mp4", "h264", "aac", 1080, 1), nil, "jpn")
	if a == nil || a.Index != 2 {
		t.Errorf("got %+v", a)
	}
}

func ptr(i int) *int { return &i }

func TestNoH264Device(t *testing.T) {
	open := DeviceProfile{VideoCodecs: []string{"vp9", "av1"}, AudioCodecs: []string{"opus", "flac"}, Containers: []string{"mp4", "webm"}, HLS: true}
	d := Decide(file("mp4", "h264", "aac", 720, 3000), open, Request{}, 0, "")
	if d.Method != Transcode || d.VideoCodec != "vp9" || d.AudioCodec != "opus" {
		t.Errorf("got %s %s %s", d.Method, d.VideoCodec, d.AudioCodec)
	}
}
