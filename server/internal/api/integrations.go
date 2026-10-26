package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gillgurjot/lumen/internal/jellyfin"
	"github.com/gillgurjot/lumen/internal/seerr"
	"github.com/go-chi/chi/v5"
)

// Jellyfin and Seerr can be connected from the admin page. What's saved there is kept in
// the settings table and wins over JELLYFIN_* / SEERR_* in the environment, field by field.
// API keys are never sent back to the browser.

const (
	setJellyfinURL = "jellyfin_url"
	setJellyfinKey = "jellyfin_api_key"
	setJellyfinOff = "jellyfin_off"
	setSeerrURL    = "seerr_url"
	setSeerrKey    = "seerr_api_key"
	setSeerrPublic = "seerr_public_url"
	setSeerrOff    = "seerr_off"
)

type seerrConn struct {
	client    *seerr.Client
	publicURL string
}

func (s *Server) setting(key, env string) string {
	if v := s.St.Setting(key); v != "" {
		return v
	}
	return env
}

// LoadIntegrations connects Jellyfin and Seerr from the saved settings or the environment.
func (s *Server) LoadIntegrations() {
	jf := s.jellyfinFromSettings()
	s.Jobs.SetJellyfin(jf)
	if jf != nil {
		s.Log.Info("syncing watch history with Jellyfin", "url", s.setting(setJellyfinURL, s.Cfg.JellyfinURL), "every", s.Jobs.JellyfinInterval)
	}
	s.loadSeerr()
	if c := s.seerr(); c != nil {
		s.Log.Info("requests enabled through Seerr", "url", s.setting(setSeerrURL, s.Cfg.SeerrURL))
	}
}

func (s *Server) jellyfinFromSettings() *jellyfin.Client {
	if s.St.Setting(setJellyfinOff) != "" {
		return nil
	}
	return jellyfin.New(s.setting(setJellyfinURL, s.Cfg.JellyfinURL), s.setting(setJellyfinKey, s.Cfg.JellyfinAPIKey))
}

func (s *Server) loadSeerr() {
	c := &seerrConn{publicURL: s.setting(setSeerrPublic, s.Cfg.SeerrPublicURL)}
	if s.St.Setting(setSeerrOff) == "" {
		c.client = seerr.New(s.setting(setSeerrURL, s.Cfg.SeerrURL), s.setting(setSeerrKey, s.Cfg.SeerrAPIKey))
	}
	s.seerrConn.Store(c)
}

// seerr is the Seerr client in use, or nil when requests aren't set up.
func (s *Server) seerr() *seerr.Client {
	if c := s.seerrConn.Load(); c != nil {
		return c.client
	}
	return nil
}

func (s *Server) seerrPublicURL() string {
	if c := s.seerrConn.Load(); c != nil {
		return c.publicURL
	}
	return ""
}

type integrationInfo struct {
	URL       string `json:"url"`
	PublicURL string `json:"publicUrl,omitempty"`
	HasKey    bool   `json:"hasKey"`
	Enabled   bool   `json:"enabled"`
	// saved = set on the admin page, env = from the server's environment, "" = not set up.
	Source string `json:"source"`
}

func (s *Server) integrationInfo(urlKey, keyKey, offKey, envURL, envKey string, extra ...string) integrationInfo {
	info := integrationInfo{URL: s.setting(urlKey, envURL), HasKey: s.setting(keyKey, envKey) != ""}
	switch {
	case s.St.Setting(offKey) != "":
		info.Source = "off"
	case s.St.Setting(urlKey) != "" || s.St.Setting(keyKey) != "" || (len(extra) > 0 && s.St.Setting(extra[0]) != ""):
		info.Source = "saved"
	case envURL != "" || envKey != "":
		info.Source = "env"
	}
	return info
}

func (s *Server) adminIntegrations(w http.ResponseWriter, r *http.Request) {
	jf := s.integrationInfo(setJellyfinURL, setJellyfinKey, setJellyfinOff, s.Cfg.JellyfinURL, s.Cfg.JellyfinAPIKey)
	jf.Enabled = s.Jobs.Jellyfin().Enabled()
	se := s.integrationInfo(setSeerrURL, setSeerrKey, setSeerrOff, s.Cfg.SeerrURL, s.Cfg.SeerrAPIKey, setSeerrPublic)
	se.PublicURL = s.seerrPublicURL()
	se.Enabled = s.seerr().Enabled()
	writeJSON(w, 200, map[string]any{"jellyfin": jf, "seerr": se})
}

func cleanURL(raw string) (string, bool) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", false
	}
	return raw, true
}

// adminSaveIntegration checks the server answers with the given URL and key before
// saving them. An empty apiKey keeps the key already in use.
func (s *Server) adminSaveIntegration(w http.ResponseWriter, r *http.Request) {
	var b struct {
		URL       string `json:"url"`
		APIKey    string `json:"apiKey"`
		PublicURL string `json:"publicUrl"`
	}
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	u, ok := cleanURL(b.URL)
	if !ok {
		writeErr(w, 400, "Enter the server's address, starting with http:// or https://")
		return
	}
	key := strings.TrimSpace(b.APIKey)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	switch chi.URLParam(r, "name") {
	case "jellyfin":
		if key == "" {
			key = s.setting(setJellyfinKey, s.Cfg.JellyfinAPIKey)
		}
		if key == "" {
			writeErr(w, 400, "Enter an API key (Jellyfin dashboard → API Keys)")
			return
		}
		c := jellyfin.New(u, key)
		if err := c.Check(ctx); err != nil {
			s.Log.Warn("jellyfin check", "err", err)
			writeErr(w, 400, "Couldn't connect to Jellyfin: "+friendly(err))
			return
		}
		if s.setting(setJellyfinURL, s.Cfg.JellyfinURL) != u {
			if err := s.St.ForgetJellyfin(); err != nil {
				s.notFoundOr500(w, err)
				return
			}
		}
		if !s.saveSettings(w, map[string]string{setJellyfinURL: u, setJellyfinKey: key, setJellyfinOff: ""}) {
			return
		}
		s.Jobs.SetJellyfin(c)
		s.Log.Info("jellyfin connected from the admin page", "url", u)
	case "seerr":
		if key == "" {
			key = s.setting(setSeerrKey, s.Cfg.SeerrAPIKey)
		}
		if key == "" {
			writeErr(w, 400, "Enter an API key (Seerr → Settings → General)")
			return
		}
		pub := ""
		if strings.TrimSpace(b.PublicURL) != "" {
			if pub, ok = cleanURL(b.PublicURL); !ok {
				writeErr(w, 400, "The public link must start with http:// or https://")
				return
			}
		}
		if err := seerr.New(u, key).Check(ctx); err != nil {
			s.Log.Warn("seerr check", "err", err)
			writeErr(w, 400, "Couldn't connect to Seerr: "+friendly(err))
			return
		}
		if !s.saveSettings(w, map[string]string{setSeerrURL: u, setSeerrKey: key, setSeerrPublic: pub, setSeerrOff: ""}) {
			return
		}
		s.loadSeerr()
		s.Log.Info("seerr connected from the admin page", "url", u)
	default:
		writeErr(w, 404, "not found")
		return
	}
	s.adminIntegrations(w, r)
}

// adminRemoveIntegration disconnects a server, even one set in the environment.
func (s *Server) adminRemoveIntegration(w http.ResponseWriter, r *http.Request) {
	switch chi.URLParam(r, "name") {
	case "jellyfin":
		if !s.saveSettings(w, map[string]string{setJellyfinURL: "", setJellyfinKey: "", setJellyfinOff: "1"}) {
			return
		}
		s.Jobs.SetJellyfin(nil)
	case "seerr":
		if !s.saveSettings(w, map[string]string{setSeerrURL: "", setSeerrKey: "", setSeerrPublic: "", setSeerrOff: "1"}) {
			return
		}
		s.loadSeerr()
	default:
		writeErr(w, 404, "not found")
		return
	}
	s.adminIntegrations(w, r)
}

func (s *Server) saveSettings(w http.ResponseWriter, kv map[string]string) bool {
	for k, v := range kv {
		if err := s.St.SetSetting(k, v); err != nil {
			s.notFoundOr500(w, err)
			return false
		}
	}
	return true
}

// friendly turns a connection error into something short enough for a form.
func friendly(err error) string {
	msg := err.Error()
	var se *seerr.Error
	if errors.As(err, &se) && (se.Status == 401 || se.Status == 403) {
		return "the API key was refused"
	}
	switch {
	case strings.Contains(msg, "401"), strings.Contains(msg, "403"):
		return "the API key was refused"
	case strings.Contains(msg, "no such host"):
		return "that address can't be found"
	case strings.Contains(msg, "connection refused"):
		return "nothing is listening at that address"
	case strings.Contains(msg, "deadline exceeded"), strings.Contains(msg, "Timeout"):
		return "it didn't answer in time"
	case strings.Contains(msg, "404"):
		return "that address doesn't look like the right server"
	}
	if len(msg) > 160 {
		msg = msg[:160] + "…"
	}
	return msg
}
