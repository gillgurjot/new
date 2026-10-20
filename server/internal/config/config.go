// Package config loads Lumen's settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	PublicURL    string
	Listen       string
	ConfigDir    string
	TranscodeDir string
	FFmpeg       string
	FFprobe      string

	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	OIDCScopes       []string
	OIDCAdminGroup   string
	OIDCUserGroup    string
	OIDCGroupsClaim  string

	TMDBAPIKey   string
	TMDBLanguage string

	// Optional Seerr (Overseerr/Jellyseerr) server for requesting new titles.
	SeerrURL       string
	SeerrAPIKey    string
	SeerrPublicURL string // link shown to people, e.g. https://request.example.com

	HWAccel       string // auto | vaapi | qsv | none
	VAAPIDevice   string
	MaxTranscodes int
	ScanInterval  time.Duration
	SessionTTL    time.Duration

	SecretKey        string
	SecureCookies    bool
	DevInsecureLogin bool
}

// RedirectURL is the OIDC callback registered with the provider.
func (c *Config) RedirectURL() string { return c.PublicURL + "/api/auth/callback" }

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// Load reads the environment and validates it.
func Load() (*Config, error) {
	c := &Config{
		PublicURL:        strings.TrimRight(env("PUBLIC_URL", "http://localhost:8096"), "/"),
		Listen:           env("LUMEN_LISTEN", ":8096"),
		ConfigDir:        env("LUMEN_CONFIG_DIR", "/config"),
		TranscodeDir:     env("LUMEN_TRANSCODE_DIR", "/transcode"),
		FFmpeg:           env("LUMEN_FFMPEG", "ffmpeg"),
		FFprobe:          env("LUMEN_FFPROBE", "ffprobe"),
		OIDCIssuer:       strings.TrimRight(env("OIDC_ISSUER", ""), "/"),
		OIDCClientID:     env("OIDC_CLIENT_ID", ""),
		OIDCClientSecret: env("OIDC_CLIENT_SECRET", ""),
		OIDCScopes:       strings.Fields(env("OIDC_SCOPES", "openid profile email groups")),
		OIDCAdminGroup:   env("OIDC_ADMIN_GROUP", "lumen-admins"),
		OIDCUserGroup:    env("OIDC_USER_GROUP", ""),
		OIDCGroupsClaim:  env("OIDC_GROUPS_CLAIM", "groups"),
		TMDBAPIKey:       env("TMDB_API_KEY", ""),
		TMDBLanguage:     env("TMDB_LANGUAGE", "en-US"),
		SeerrURL:         strings.TrimRight(env("SEERR_URL", ""), "/"),
		SeerrAPIKey:      env("SEERR_API_KEY", ""),
		SeerrPublicURL:   strings.TrimRight(env("SEERR_PUBLIC_URL", ""), "/"),
		HWAccel:          strings.ToLower(env("LUMEN_HWACCEL", "auto")),
		VAAPIDevice:      env("LUMEN_VAAPI_DEVICE", "/dev/dri/renderD128"),
		SecretKey:        env("LUMEN_SECRET_KEY", ""),
	}
	var errs []error
	var err error
	if c.DevInsecureLogin, err = strconv.ParseBool(env("LUMEN_DEV_INSECURE_LOGIN", "false")); err != nil {
		errs = append(errs, fmt.Errorf("LUMEN_DEV_INSECURE_LOGIN: %w", err))
	}
	if c.MaxTranscodes, err = strconv.Atoi(env("LUMEN_MAX_TRANSCODES", "4")); err != nil || c.MaxTranscodes < 0 {
		errs = append(errs, errors.New("LUMEN_MAX_TRANSCODES must be a number >= 0"))
	}
	if c.ScanInterval, err = time.ParseDuration(env("LUMEN_SCAN_INTERVAL", "6h")); err != nil || c.ScanInterval < time.Minute {
		errs = append(errs, errors.New("LUMEN_SCAN_INTERVAL must be a duration of at least 1m, e.g. 6h"))
	}
	if c.SessionTTL, err = time.ParseDuration(env("LUMEN_SESSION_TTL", "720h")); err != nil || c.SessionTTL < time.Minute {
		errs = append(errs, errors.New("LUMEN_SESSION_TTL must be a duration of at least 1m, e.g. 720h"))
	}
	switch c.HWAccel {
	case "auto", "vaapi", "qsv", "none":
	default:
		errs = append(errs, fmt.Errorf("LUMEN_HWACCEL must be auto, vaapi, qsv or none (got %q)", c.HWAccel))
	}
	u, err := url.Parse(c.PublicURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		errs = append(errs, fmt.Errorf("PUBLIC_URL must be an absolute http(s) URL (got %q)", c.PublicURL))
	} else {
		c.SecureCookies = u.Scheme == "https"
	}
	if !c.DevInsecureLogin {
		if c.OIDCIssuer == "" || c.OIDCClientID == "" || c.OIDCClientSecret == "" {
			errs = append(errs, errors.New("OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required"))
		}
	}
	if len(c.OIDCScopes) == 0 {
		c.OIDCScopes = []string{"openid"}
	}
	return c, errors.Join(errs...)
}
