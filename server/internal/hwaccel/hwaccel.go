// Package hwaccel detects which ffmpeg hardware encoders actually work on this host.
package hwaccel

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"time"
)

type Caps struct {
	Mode        string `json:"mode"`   // vaapi | qsv | none
	Device      string `json:"device"` // render node
	H264        bool   `json:"h264"`
	HEVC        bool   `json:"hevc"`
	HWTonemap   bool   `json:"hwTonemap"` // tonemap_vaapi
	SWTonemap   bool   `json:"swTonemap"` // zscale + tonemap
	FFmpeg      string `json:"ffmpegVersion"`
	Description string `json:"description"`
}

func run(ffmpeg string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, ffmpeg, args...).Run()
}

func testEncode(ffmpeg string, pre []string, filter, encoder string) bool {
	args := append([]string{"-hide_banner", "-v", "error", "-nostdin"}, pre...)
	args = append(args, "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=0.4", "-vf", filter, "-c:v", encoder, "-frames:v", "8", "-f", "null", "-")
	return run(ffmpeg, args...) == nil
}

// Detect probes the configured mode ("auto" tries VAAPI then QSV).
func Detect(ffmpeg, mode, device string, log *slog.Logger) Caps {
	c := Caps{Mode: "none", Device: device}
	if out, err := exec.Command(ffmpeg, "-hide_banner", "-version").Output(); err == nil {
		c.FFmpeg = strings.TrimPrefix(strings.SplitN(string(out), "\n", 2)[0], "ffmpeg version ")
	}
	if out, err := exec.Command(ffmpeg, "-hide_banner", "-filters").Output(); err == nil {
		f := string(out)
		c.SWTonemap = strings.Contains(f, " zscale ") && strings.Contains(f, " tonemap ")
		c.HWTonemap = strings.Contains(f, " tonemap_vaapi ")
	}
	hwTonemap := c.HWTonemap
	c.HWTonemap = false // only true once a VAAPI device is confirmed
	if mode == "none" {
		c.Description = "Software (libx264)"
		return c
	}
	if _, err := os.Stat(device); err != nil {
		log.Info("no GPU render node; using software transcoding", "device", device)
		c.Description = "Software (libx264) — " + device + " not found"
		return c
	}
	vaapi := []string{"-init_hw_device", "vaapi=va:" + device, "-filter_hw_device", "va"}
	qsv := []string{"-init_hw_device", "vaapi=va:" + device, "-init_hw_device", "qsv=qs@va", "-filter_hw_device", "qs"}
	if mode == "auto" || mode == "vaapi" {
		if testEncode(ffmpeg, vaapi, "format=nv12,hwupload", "h264_vaapi") {
			c.Mode, c.H264 = "vaapi", true
			c.HEVC = testEncode(ffmpeg, vaapi, "format=nv12,hwupload", "hevc_vaapi")
		}
	}
	if c.Mode == "none" && (mode == "auto" || mode == "qsv") {
		if testEncode(ffmpeg, qsv, "format=nv12,hwupload=extra_hw_frames=16", "h264_qsv") {
			c.Mode, c.H264 = "qsv", true
			c.HEVC = testEncode(ffmpeg, qsv, "format=nv12,hwupload=extra_hw_frames=16", "hevc_qsv")
		}
	}
	if c.Mode == "none" {
		c.Description = "Software (libx264) — GPU encode test failed"
		log.Warn("hardware encoding unavailable; falling back to software", "device", device)
		return c
	}
	c.HWTonemap = hwTonemap && c.Mode == "vaapi"
	c.Description = strings.ToUpper(c.Mode) + " on " + device
	log.Info("hardware transcoding enabled", "mode", c.Mode, "hevc", c.HEVC, "hwTonemap", c.HWTonemap)
	return c
}
