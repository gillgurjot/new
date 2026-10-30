// Command lumen is a self-hosted media server.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gillgurjot/lumen/internal/api"
	"github.com/gillgurjot/lumen/internal/auth"
	"github.com/gillgurjot/lumen/internal/config"
	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/hwaccel"
	"github.com/gillgurjot/lumen/internal/images"
	"github.com/gillgurjot/lumen/internal/jobs"
	"github.com/gillgurjot/lumen/internal/library"
	"github.com/gillgurjot/lumen/internal/metadata"
	"github.com/gillgurjot/lumen/internal/party"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/gillgurjot/lumen/internal/stream"
	"github.com/gillgurjot/lumen/web"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	level := slog.LevelInfo
	if strings.EqualFold(os.Getenv("LUMEN_LOG_LEVEL"), "debug") {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(1)
	}
	if cfg.DevInsecureLogin {
		log.Warn("LUMEN_DEV_INSECURE_LOGIN is enabled: anyone can sign in. Never use this in production.")
	}
	for _, d := range []string{cfg.ConfigDir, cfg.TranscodeDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			log.Error("cannot create directory", "dir", d, "err", err)
			os.Exit(1)
		}
	}

	database, err := db.Open(filepath.Join(cfg.ConfigDir, "lumen.db"))
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer database.Close()
	st := store.New(database)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	caps := hwaccel.Detect(cfg.FFmpeg, cfg.HWAccel, cfg.VAAPIDevice, log)
	img := images.New(filepath.Join(cfg.ConfigDir, "images"), cfg.FFmpeg)
	tmdb := metadata.NewTMDB(cfg.TMDBAPIKey, cfg.TMDBLanguage)
	if !tmdb.Enabled() {
		log.Warn("TMDB_API_KEY not set: posters, descriptions and cast won't be fetched")
	}
	fetcher := metadata.NewFetcher(st, tmdb, img, cfg.TMDBLanguage, log)
	scanner := library.NewScanner(st, cfg.FFprobe, log)
	watcher := library.NewWatcher(st, scanner, log)
	streams := stream.NewManager(cfg.FFmpeg, cfg.TranscodeDir, caps, cfg.MaxTranscodes, log)
	runner := &jobs.Runner{St: st, Scanner: scanner, Fetcher: fetcher, Streams: streams, FFmpeg: cfg.FFmpeg,
		TrickplayDir: filepath.Join(cfg.ConfigDir, "trickplay"), Trickplay: os.Getenv("LUMEN_TRICKPLAY") != "false",
		Credits:      os.Getenv("LUMEN_CREDITS_DETECTION") != "false",
		Intro:        os.Getenv("LUMEN_INTRO_DETECTION") != "false",
		ScanInterval: cfg.ScanInterval, Log: log, JellyfinInterval: cfg.JellyfinSyncInterval}

	srv := &api.Server{Cfg: cfg, St: st, Auth: auth.New(cfg, st, log), Images: img, Scanner: scanner, Watcher: watcher,
		Fetcher: fetcher, TMDB: tmdb, Streams: streams, Subs: stream.NewSubtitles(cfg.FFmpeg, filepath.Join(cfg.ConfigDir, "cache")),
		Jobs: runner, Log: log, Web: web.FS(), Ctx: ctx, StartedAt: time.Now(), Party: party.NewHub()}
	srv.LoadIntegrations()
	if srv.Web == nil {
		log.Warn("web UI not embedded; build it with `npm run build` in web/")
	}

	go streams.Run(ctx)
	go srv.Party.Run(ctx)
	runner.Start(ctx)
	watcher.Start(ctx)

	httpSrv := &http.Server{Addr: cfg.Listen, Handler: srv.Router(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(sctx)
	}()
	log.Info("Lumen listening", "addr", cfg.Listen, "public_url", cfg.PublicURL, "transcoding", caps.Description)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("http server", "err", err)
		os.Exit(1)
	}
	// Give the stream manager a moment to stop ffmpeg processes.
	time.Sleep(300 * time.Millisecond)
}

// healthcheck is used by the container HEALTHCHECK (the image has no curl).
func healthcheck() int {
	addr := os.Getenv("LUMEN_LISTEN")
	if addr == "" {
		addr = ":8096"
	}
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + addr + "/api/health")
	if err != nil || resp.StatusCode != 200 {
		return 1
	}
	return 0
}
