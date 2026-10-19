package stream

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gillgurjot/lumen/internal/hwaccel"
	"github.com/gillgurjot/lumen/internal/store"
)

var (
	ErrNoSession = errors.New("playback session not found")
	ErrBusy      = errors.New("too many active transcodes; try again shortly or pick original quality")
	segRe        = regexp.MustCompile(`^seg(\d{5})\.m4s$`)
)

const (
	idleTimeout  = 90 * time.Second
	aheadPause   = 60 // segments (~4 min) ahead of the player before pausing ffmpeg
	aheadResume  = 30
	keepBehind   = 150 // segments kept behind the player (~10 min)
)

// Session is one active playback, whatever the method.
type Session struct {
	ID          string    `json:"id"`
	UserID      int64     `json:"userId"`
	Username    string    `json:"username"`
	ItemID      int64     `json:"itemId"`
	FileID      int64     `json:"fileId"`
	Title       string    `json:"title"`
	Device      string    `json:"device"`
	Client      string    `json:"client"`
	Method      Method    `json:"method"`
	Decision    Decision  `json:"decision"`
	Pipeline    Pipeline  `json:"pipeline,omitempty"`
	StartOffset float64   `json:"startOffset"`
	Position    float64   `json:"position"`
	Duration    float64   `json:"duration"`
	Paused      bool      `json:"paused"`
	Throttled   bool      `json:"throttled"`
	Created     time.Time `json:"created"`
	LastSeen    time.Time `json:"lastSeen"`

	tc *transcoder
}

type transcoder struct {
	dir     string
	cmd     *exec.Cmd
	cancel  context.CancelFunc
	done    chan struct{}
	stderr  *tailBuffer
	mu      sync.Mutex
	lastSeg int
	stopped bool
}

type Manager struct {
	ffmpeg        string
	baseDir       string
	caps          hwaccel.Caps
	maxTranscodes int
	log           *slog.Logger

	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager(ffmpeg, baseDir string, caps hwaccel.Caps, maxTranscodes int, log *slog.Logger) *Manager {
	_ = os.RemoveAll(filepath.Join(baseDir, "sessions"))
	_ = os.MkdirAll(filepath.Join(baseDir, "sessions"), 0o755)
	return &Manager{ffmpeg: ffmpeg, baseDir: baseDir, caps: caps, maxTranscodes: maxTranscodes, log: log, sessions: map[string]*Session{}}
}

func (m *Manager) Caps() hwaccel.Caps { return m.caps }

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Run reaps idle sessions and throttles encoders until ctx ends.
func (m *Manager) Run(ctx context.Context) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			m.mu.Lock()
			for id := range m.sessions {
				m.stopLocked(id)
			}
			m.mu.Unlock()
			return
		case <-t.C:
			m.tick()
		}
	}
}

func (m *Manager) tick() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, s := range m.sessions {
		if time.Since(s.LastSeen) > idleTimeout {
			m.log.Info("ending idle playback session", "session", id, "user", s.Username)
			m.stopLocked(id)
			continue
		}
		if s.tc != nil {
			s.Throttled = s.tc.throttle()
		}
	}
}

// Start registers a session and, for remux/transcode, launches ffmpeg.
// replaceID (optional) ends an earlier session of the same viewer, e.g. on seek.
func (m *Manager) Start(ctx context.Context, s *Session, file *store.MediaFile, replaceID string) error {
	s.ID = newID()
	s.Created, s.LastSeen = time.Now(), time.Now()
	s.Method = s.Decision.Method
	if replaceID != "" {
		m.mu.Lock()
		if old, ok := m.sessions[replaceID]; ok && old.UserID == s.UserID {
			m.stopLocked(replaceID)
		}
		m.mu.Unlock()
	}
	if s.Method == DirectPlay {
		m.mu.Lock()
		m.sessions[s.ID] = s
		m.mu.Unlock()
		return nil
	}
	if s.Method == Transcode {
		m.mu.Lock()
		n := 0
		for _, o := range m.sessions {
			if o.Method == Transcode {
				n++
			}
		}
		m.mu.Unlock()
		if m.maxTranscodes > 0 && n >= m.maxTranscodes {
			return ErrBusy
		}
	}
	var lastErr error
	for _, p := range Pipelines(s.Decision, m.caps) {
		tc, err := m.launch(ctx, s, file, p)
		if err == nil {
			s.tc, s.Pipeline = tc, p
			m.mu.Lock()
			m.sessions[s.ID] = s
			m.mu.Unlock()
			m.log.Info("playback started", "user", s.Username, "title", s.Title, "method", s.Method, "pipeline", p, "reasons", strings.Join(s.Decision.Reasons, "; "))
			return nil
		}
		lastErr = err
		m.log.Warn("pipeline failed, trying next", "pipeline", p, "err", err)
	}
	return fmt.Errorf("could not start stream: %w", lastErr)
}

func (m *Manager) launch(ctx context.Context, s *Session, file *store.MediaFile, p Pipeline) (*transcoder, error) {
	dir := filepath.Join(m.baseDir, "sessions", s.ID+"-"+string(p))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	args := BuildArgs(file, s.Decision, p, m.caps, s.StartOffset, dir)
	cctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(cctx, m.ffmpeg, args...)
	tb := &tailBuffer{max: 4096}
	cmd.Stderr = tb
	m.log.Debug("ffmpeg", "args", strings.Join(args, " "))
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, err
	}
	tc := &transcoder{dir: dir, cmd: cmd, cancel: cancel, done: make(chan struct{}), stderr: tb}
	go func() {
		_ = cmd.Wait()
		close(tc.done)
	}()
	// Wait for the first segment, or for ffmpeg to fail.
	deadline := time.After(45 * time.Second)
	for {
		select {
		case <-tc.done:
			if ready(dir) {
				return tc, nil // very short file finished already
			}
			cancel()
			os.RemoveAll(dir)
			return nil, fmt.Errorf("ffmpeg exited: %s", strings.TrimSpace(tb.String()))
		case <-deadline:
			tc.kill()
			return nil, errors.New("timed out waiting for first segment")
		case <-ctx.Done():
			tc.kill()
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
			if ready(dir) {
				return tc, nil
			}
		}
	}
}

func ready(dir string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "index.m3u8"))
	return err == nil && bytes.Contains(b, []byte("#EXTINF"))
}

func (tc *transcoder) kill() {
	tc.mu.Lock()
	if tc.stopped && tc.cmd.Process != nil {
		_ = tc.cmd.Process.Signal(syscall.SIGCONT)
	}
	tc.mu.Unlock()
	tc.cancel()
	select {
	case <-tc.done:
	case <-time.After(5 * time.Second):
	}
	_ = os.RemoveAll(tc.dir)
}

func (tc *transcoder) highestSegment() int {
	entries, err := os.ReadDir(tc.dir)
	if err != nil {
		return -1
	}
	hi := -1
	for _, e := range entries {
		if mm := segRe.FindStringSubmatch(e.Name()); mm != nil {
			if n, _ := strconv.Atoi(mm[1]); n > hi {
				hi = n
			}
		}
	}
	return hi
}

// throttle pauses ffmpeg when it is far ahead of the player and deletes old segments.
func (tc *transcoder) throttle() bool {
	select {
	case <-tc.done:
		return false
	default:
	}
	hi := tc.highestSegment()
	tc.mu.Lock()
	defer tc.mu.Unlock()
	ahead := hi - tc.lastSeg
	if tc.cmd.Process != nil {
		if !tc.stopped && ahead > aheadPause {
			if tc.cmd.Process.Signal(syscall.SIGSTOP) == nil {
				tc.stopped = true
			}
		} else if tc.stopped && ahead < aheadResume {
			if tc.cmd.Process.Signal(syscall.SIGCONT) == nil {
				tc.stopped = false
			}
		}
	}
	if cut := tc.lastSeg - keepBehind; cut > 0 {
		entries, _ := os.ReadDir(tc.dir)
		for _, e := range entries {
			if mm := segRe.FindStringSubmatch(e.Name()); mm != nil {
				if n, _ := strconv.Atoi(mm[1]); n < cut {
					os.Remove(filepath.Join(tc.dir, e.Name()))
				}
			}
		}
	}
	return tc.stopped
}

func (m *Manager) stopLocked(id string) {
	s, ok := m.sessions[id]
	if !ok {
		return
	}
	delete(m.sessions, id)
	if s.tc != nil {
		go s.tc.kill()
	}
}

func (m *Manager) Stop(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked(id)
}

// Get returns a session and marks it as seen.
func (m *Manager) Get(id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNoSession
	}
	s.LastSeen = time.Now()
	return s, nil
}

// Report updates position/pause state from a player heartbeat.
func (m *Manager) Report(id string, userID int64, pos float64, paused bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[id]; ok && s.UserID == userID {
		s.Position, s.Paused, s.LastSeen = pos, paused, time.Now()
	}
}

// List returns a snapshot of active sessions, newest first.
func (m *Manager) List() []Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out
}

// Playlist returns the HLS playlist with query appended to every URI (auth for cookie-less clients).
func (m *Manager) Playlist(id, query string) ([]byte, error) {
	s, err := m.Get(id)
	if err != nil || s.tc == nil {
		return nil, ErrNoSession
	}
	b, err := os.ReadFile(filepath.Join(s.tc.dir, "index.m3u8"))
	if err != nil {
		return nil, err
	}
	if query == "" {
		return b, nil
	}
	var out bytes.Buffer
	for _, line := range strings.Split(string(b), "\n") {
		switch {
		case strings.HasPrefix(line, "#EXT-X-MAP:URI=\""):
			line = strings.Replace(line, "init.mp4\"", "init.mp4?"+query+"\"", 1)
		case line != "" && !strings.HasPrefix(line, "#"):
			line += "?" + query
		}
		out.WriteString(line)
		out.WriteByte('\n')
	}
	return bytes.TrimSuffix(out.Bytes(), []byte("\n")), nil
}

// SegmentPath waits (briefly) for a segment to be written and returns its path.
func (m *Manager) SegmentPath(ctx context.Context, id, name string) (string, error) {
	s, err := m.Get(id)
	if err != nil || s.tc == nil {
		return "", ErrNoSession
	}
	tc := s.tc
	if name != "init.mp4" {
		mm := segRe.FindStringSubmatch(name)
		if mm == nil {
			return "", os.ErrNotExist
		}
		n, _ := strconv.Atoi(mm[1])
		tc.mu.Lock()
		tc.lastSeg = n
		tc.mu.Unlock()
		tc.throttle() // resume promptly if the player caught up
	}
	p := filepath.Join(tc.dir, name)
	deadline := time.Now().Add(30 * time.Second)
	for {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		select {
		case <-tc.done:
			if _, err := os.Stat(p); err == nil {
				return p, nil
			}
			return "", os.ErrNotExist
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			return "", os.ErrNotExist
		}
	}
}

// tailBuffer keeps the last max bytes written (for ffmpeg error messages).
type tailBuffer struct {
	mu  sync.Mutex
	max int
	b   []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.b = append(t.b, p...)
	if len(t.b) > t.max {
		t.b = t.b[len(t.b)-t.max:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.b)
}
