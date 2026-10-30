package stream

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gillgurjot/lumen/internal/hwaccel"
	"github.com/gillgurjot/lumen/internal/store"
)

const SegmentSeconds = 4

// Pipeline is one way of producing the stream; sessions fall back down the list on failure.
type Pipeline string

const (
	PipeCopy       Pipeline = "copy"
	PipeVAAPIFull  Pipeline = "vaapi"      // hw decode + hw filters + hw encode
	PipeVAAPIUp    Pipeline = "vaapi-sw"   // sw decode, upload, hw encode
	PipeQSVUp      Pipeline = "qsv-sw"
	PipeSoftware   Pipeline = "software"
)

// Pipelines returns the pipelines to try, best first.
func Pipelines(d Decision, caps hwaccel.Caps) []Pipeline {
	if d.VideoCopy {
		return []Pipeline{PipeCopy}
	}
	hwCodec := d.VideoCodec == "" || d.VideoCodec == "h264" || (d.VideoCodec == "hevc" && caps.HEVC)
	if !hwCodec {
		return []Pipeline{PipeSoftware}
	}
	var out []Pipeline
	switch caps.Mode {
	case "vaapi":
		if d.Burn == nil && (!d.ToneMap || caps.HWTonemap) {
			out = append(out, PipeVAAPIFull)
		}
		out = append(out, PipeVAAPIUp)
	case "qsv":
		out = append(out, PipeQSVUp)
	}
	return append(out, PipeSoftware)
}

func swToneMap(caps hwaccel.Caps) string {
	if !caps.SWTonemap {
		return ""
	}
	return "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,"
}

// BuildArgs returns ffmpeg arguments writing an fMP4 HLS event playlist into dir.
func BuildArgs(m *store.MediaFile, d Decision, pipe Pipeline, caps hwaccel.Caps, start float64, dir string) []string {
	a := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y"}
	switch pipe {
	case PipeVAAPIFull:
		a = append(a, "-hwaccel", "vaapi", "-hwaccel_device", caps.Device, "-hwaccel_output_format", "vaapi")
	case PipeVAAPIUp:
		a = append(a, "-init_hw_device", "vaapi=va:"+caps.Device, "-filter_hw_device", "va")
	case PipeQSVUp:
		a = append(a, "-init_hw_device", "vaapi=va:"+caps.Device, "-init_hw_device", "qsv=qs@va", "-filter_hw_device", "qs")
	}
	if pipe != PipeCopy {
		a = append(a, "-noautorotate")
	}
	if start > 0 {
		a = append(a, "-ss", strconv.FormatFloat(start, 'f', 3, 64))
	}
	a = append(a, "-fflags", "+genpts", "-i", m.Path)

	// Video
	vmap := "0:V:0" // capital V skips attached cover art
	if pipe == PipeCopy {
		a = append(a, "-map", vmap, "-c:v", "copy")
		if m.VideoCodec == "hevc" {
			// Some WEB-DLs keep VPS/SPS/PPS in-band only (near-empty hvcC). Tagging those hvc1 as-is
			// gives unplayable segments; going through Annex B lets the muxer rebuild a full hvcC.
			a = append(a, "-bsf:v", "hevc_mp4toannexb", "-tag:v", "hvc1")
		}
	} else {
		filter := videoFilter(d, pipe, caps)
		if d.Burn != nil {
			fc := fmt.Sprintf("[0:V:0][0:%d]overlay=eof_action=pass:repeatlast=0[sub];[sub]%s[vout]", d.Burn.Index, filter)
			a = append(a, "-filter_complex", fc, "-map", "[vout]")
		} else {
			a = append(a, "-map", vmap, "-vf", filter)
		}
		kb := strconv.Itoa(d.VideoKbps) + "k"
		maxr := strconv.Itoa(d.VideoKbps*3/2) + "k"
		buf := strconv.Itoa(d.VideoKbps*2) + "k"
		hevc := d.VideoCodec == "hevc"
		switch {
		case pipe == PipeVAAPIFull || pipe == PipeVAAPIUp:
			enc := "h264_vaapi"
			prof := "high"
			if hevc {
				enc, prof = "hevc_vaapi", "main"
			}
			a = append(a, "-c:v", enc, "-rc_mode", "VBR", "-b:v", kb, "-maxrate", maxr, "-bufsize", buf, "-profile:v", prof)
		case pipe == PipeQSVUp:
			enc := "h264_qsv"
			if hevc {
				enc = "hevc_qsv"
			}
			a = append(a, "-c:v", enc, "-preset", "veryfast", "-b:v", kb, "-maxrate", maxr, "-bufsize", buf, "-look_ahead", "0")
		case hevc:
			a = append(a, "-c:v", "libx265", "-preset", "superfast", "-crf", "24", "-maxrate", kb, "-bufsize", buf, "-pix_fmt", "yuv420p",
				"-x265-params", "log-level=error")
		case d.VideoCodec == "vp9":
			a = append(a, "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-b:v", kb, "-maxrate", maxr,
				"-bufsize", buf, "-pix_fmt", "yuv420p")
		case d.VideoCodec == "av1":
			a = append(a, "-c:v", "libsvtav1", "-preset", "10", "-crf", "34", "-pix_fmt", "yuv420p")
		default:
			a = append(a, "-c:v", "libx264", "-preset", "veryfast", "-tune", "film", "-crf", "21", "-maxrate", kb, "-bufsize", buf,
				"-profile:v", "high", "-pix_fmt", "yuv420p")
		}
		if hevc {
			a = append(a, "-tag:v", "hvc1")
		}
		a = append(a, "-g", strconv.Itoa(SegmentSeconds*24))
		// Fixed keyframe interval so every segment starts on a keyframe.
		a = append(a, "-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%d)", SegmentSeconds), "-sc_threshold", "0")
	}

	// Audio
	if d.Audio != nil {
		a = append(a, "-map", "0:"+strconv.Itoa(d.Audio.Index))
		if d.AudioCopy {
			a = append(a, "-c:a", "copy")
		} else {
			enc := "aac"
			if d.AudioCodec == "opus" {
				enc = "libopus"
			}
			a = append(a, "-c:a", enc, "-ac", strconv.Itoa(d.AudioChannels), "-b:a", strconv.Itoa(d.AudioKbps)+"k", "-ar", "48000")
		}
	}

	a = append(a, "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-max_muxing_queue_size", "2048",
		"-f", "hls", "-hls_time", strconv.Itoa(SegmentSeconds), "-hls_list_size", "0", "-hls_playlist_type", "event",
		"-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
		"-hls_segment_filename", filepath.Join(dir, "seg%05d.m4s"),
		"-hls_flags", "temp_file+independent_segments", "-start_number", "0",
		filepath.Join(dir, "index.m3u8"))
	return a
}

func videoFilter(d Decision, pipe Pipeline, caps hwaccel.Caps) string {
	w, h := strconv.Itoa(d.Width), strconv.Itoa(d.Height)
	switch pipe {
	case PipeVAAPIFull:
		f := ""
		if d.ToneMap {
			f = "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,"
		}
		return f + "scale_vaapi=w=" + w + ":h=" + h + ":format=nv12"
	case PipeVAAPIUp:
		f := ""
		if d.ToneMap {
			f = swToneMap(caps)
		}
		return f + "scale=" + w + ":" + h + ":flags=bicubic,format=nv12,hwupload"
	case PipeQSVUp:
		f := ""
		if d.ToneMap {
			f = swToneMap(caps)
		}
		return f + "scale=" + w + ":" + h + ":flags=bicubic,format=nv12,hwupload=extra_hw_frames=64"
	default:
		f := ""
		if d.ToneMap {
			f = swToneMap(caps)
		}
		return strings.TrimSuffix(f+"scale="+w+":"+h+":flags=bicubic,format=yuv420p", ",")
	}
}
