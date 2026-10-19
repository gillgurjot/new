// Package images downloads, stores and serves resized artwork.
package images

import (
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

type Cache struct {
	Dir    string // originals: Dir/items/<id>/<kind>.<ext>; resized: Dir/resized/
	ffmpeg string
	client *http.Client
	mu     sync.Mutex
	inflight map[string]*sync.WaitGroup
}

func New(dir, ffmpeg string) *Cache {
	_ = os.MkdirAll(filepath.Join(dir, "items"), 0o755)
	_ = os.MkdirAll(filepath.Join(dir, "resized"), 0o755)
	_ = os.MkdirAll(filepath.Join(dir, "remote"), 0o755)
	return &Cache{Dir: dir, ffmpeg: ffmpeg, client: &http.Client{Timeout: 30 * time.Second}, inflight: map[string]*sync.WaitGroup{}}
}

// Resolve turns a stored image reference into an absolute file path.
func (c *Cache) Resolve(ref string) string {
	if ref == "" || filepath.IsAbs(ref) {
		return ref
	}
	return filepath.Join(c.Dir, "items", ref)
}

// Download fetches url into the item's folder and returns the stored reference.
func (c *Cache) Download(ctx context.Context, itemID int64, kind, url string) (string, error) {
	ext := strings.ToLower(filepath.Ext(url))
	if ext != ".png" && ext != ".webp" {
		ext = ".jpg"
	}
	rel := filepath.Join(strconv.FormatInt(itemID, 10), kind+ext)
	if err := c.fetch(ctx, url, filepath.Join(c.Dir, "items", rel)); err != nil {
		return "", err
	}
	c.purgeResized(itemID, kind)
	return rel, nil
}

func (c *Cache) fetch(ctx context.Context, url, dst string) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download %s: %s", url, resp.Status)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, io.LimitReader(resp.Body, 30<<20)); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	f.Close()
	return os.Rename(tmp, dst)
}

// FrameGrab extracts a frame from a video at time t as an item image.
func (c *Cache) FrameGrab(ctx context.Context, itemID int64, kind, video string, t float64) (string, error) {
	rel := filepath.Join(strconv.FormatInt(itemID, 10), kind+".jpg")
	dst := filepath.Join(c.Dir, "items", rel)
	_ = os.MkdirAll(filepath.Dir(dst), 0o755)
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.ffmpeg, "-v", "error", "-y", "-ss", strconv.FormatFloat(t, 'f', 1, 64), "-i", video,
		"-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", dst)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("frame grab: %v: %s", err, out)
	}
	c.purgeResized(itemID, kind)
	return rel, nil
}

func (c *Cache) purgeResized(itemID int64, kind string) {
	matches, _ := filepath.Glob(filepath.Join(c.Dir, "resized", fmt.Sprintf("%d_%s_*", itemID, kind)))
	for _, m := range matches {
		os.Remove(m)
	}
}

var widths = []int{160, 240, 320, 480, 640, 960, 1280, 1920}

// SnapWidth rounds a requested width up to a fixed set to keep the cache small.
func SnapWidth(w int) int {
	if w <= 0 {
		return 0
	}
	for _, s := range widths {
		if w <= s {
			return s
		}
	}
	return 0 // original
}

// Resized returns a path to the image scaled to width w (0 = original).
func (c *Cache) Resized(itemID int64, kind, src string, w int) (string, error) {
	w = SnapWidth(w)
	if w == 0 {
		return src, nil
	}
	ext := ".jpg"
	if strings.EqualFold(filepath.Ext(src), ".png") {
		ext = ".png" // logos keep transparency
	}
	dst := filepath.Join(c.Dir, "resized", fmt.Sprintf("%d_%s_%d%s", itemID, kind, w, ext))
	return dst, c.resizeOnce(src, dst, w)
}

// RemoteFile caches a remote image (e.g. a cast photo) under a hashed name.
func (c *Cache) RemoteFile(ctx context.Context, key, url string) (string, error) {
	dst := filepath.Join(c.Dir, "remote", key)
	if _, err := os.Stat(dst); err == nil {
		return dst, nil
	}
	return dst, c.fetch(ctx, url, dst)
}

func (c *Cache) resizeOnce(src, dst string, w int) error {
	if st, err := os.Stat(dst); err == nil {
		if sst, err := os.Stat(src); err == nil && !sst.ModTime().After(st.ModTime()) {
			return nil
		}
	}
	c.mu.Lock()
	if wg, ok := c.inflight[dst]; ok {
		c.mu.Unlock()
		wg.Wait()
		return nil
	}
	wg := &sync.WaitGroup{}
	wg.Add(1)
	c.inflight[dst] = wg
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.inflight, dst)
		c.mu.Unlock()
		wg.Done()
	}()
	return resize(src, dst, w)
}

func resize(src, dst string, w int) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return err
	}
	b := img.Bounds()
	if b.Dx() <= w {
		// Never upscale; just reference a copy.
		return copyFile(src, dst)
	}
	h := b.Dy() * w / b.Dx()
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(out, out.Bounds(), img, b, draw.Src, nil)
	tmp := dst + ".tmp"
	of, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if strings.HasSuffix(dst, ".png") {
		err = encodePNG(of, out)
	} else {
		err = jpeg.Encode(of, out, &jpeg.Options{Quality: 82})
	}
	of.Close()
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst + ".tmp")
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	out.Close()
	return os.Rename(dst+".tmp", dst)
}

var ErrNoImage = errors.New("no image")
