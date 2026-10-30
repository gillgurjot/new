package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gillgurjot/lumen/internal/config"
	"github.com/gillgurjot/lumen/internal/db"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/oauth2-proxy/mockoidc"
)

func setup(t *testing.T, userGroup string) (*mockoidc.MockOIDC, *httptest.Server, *store.Store) {
	t.Helper()
	m, err := mockoidc.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Shutdown() })
	d, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(d)
	var a *Auth
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) { a.Login(w, r) })
	mux.HandleFunc("/api/auth/callback", func(w http.ResponseWriter, r *http.Request) { a.Callback(w, r) })
	mux.HandleFunc("/api/auth/app-token", func(w http.ResponseWriter, r *http.Request) { a.AppToken(w, r) })
	mux.HandleFunc("/api/me", func(w http.ResponseWriter, r *http.Request) {
		if u := a.SessionUser(r); u != nil {
			io.WriteString(w, u.Username)
			if u.IsAdmin {
				io.WriteString(w, " admin")
			}
			return
		}
		w.WriteHeader(401)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "app:"+r.URL.Path) })
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	cfg := m.Config()
	a = New(&config.Config{
		PublicURL: srv.URL, OIDCIssuer: cfg.Issuer, OIDCClientID: cfg.ClientID, OIDCClientSecret: cfg.ClientSecret,
		OIDCScopes: []string{"openid", "profile", "email", "groups"}, OIDCAdminGroup: "lumen-admins", OIDCUserGroup: userGroup,
		OIDCGroupsClaim: "groups", SessionTTL: time.Hour,
	}, st, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return m, srv, st
}

func login(t *testing.T, srv *httptest.Server) (*http.Client, string) {
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	resp, err := c.Get(srv.URL + "/api/auth/login?redirect=/library/1")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return c, resp.Request.URL.Path + "|" + resp.Request.URL.RawQuery + "|" + string(body)
}

func TestOIDCLoginAdmin(t *testing.T) {
	m, srv, _ := setup(t, "")
	m.QueueUser(&mockoidc.MockUser{Subject: "u-1", Email: "gurjot@example.com", PreferredUsername: "gurjot", Groups: []string{"lumen-admins"}})
	c, landed := login(t, srv)
	if !strings.HasPrefix(landed, "/library/1|") {
		t.Fatalf("expected redirect back to app, got %s", landed)
	}
	resp, _ := c.Get(srv.URL + "/api/me")
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(b) != "gurjot admin" {
		t.Fatalf("me: %d %q", resp.StatusCode, b)
	}
}

func TestOIDCNonAdminAndGroupGate(t *testing.T) {
	m, srv, _ := setup(t, "lumen-users")
	m.QueueUser(&mockoidc.MockUser{Subject: "u-2", Email: "friend@example.com", PreferredUsername: "friend", Groups: []string{"lumen-users"}})
	c, _ := login(t, srv)
	resp, _ := c.Get(srv.URL + "/api/me")
	b, _ := io.ReadAll(resp.Body)
	if string(b) != "friend" {
		t.Fatalf("expected plain user, got %q", b)
	}
	m.QueueUser(&mockoidc.MockUser{Subject: "u-3", Email: "stranger@example.com", PreferredUsername: "stranger", Groups: []string{"other"}})
	c2, landed := login(t, srv)
	if !strings.Contains(landed, "/login|error=") {
		t.Fatalf("stranger should be rejected, landed %s", landed)
	}
	resp, _ = c2.Get(srv.URL + "/api/me")
	if resp.StatusCode != 401 {
		t.Fatalf("stranger got a session")
	}
}

func TestMediaToken(t *testing.T) {
	_, _, st := setup(t, "")
	a := New(&config.Config{}, st, slog.Default())
	tok := a.MediaToken(42, time.Minute)
	if id, ok := a.VerifyMediaToken(tok); !ok || id != 42 {
		t.Fatal("valid token rejected")
	}
	if _, ok := a.VerifyMediaToken(tok + "x"); ok {
		t.Fatal("tampered token accepted")
	}
	if _, ok := a.VerifyMediaToken(a.MediaToken(42, -time.Minute)); ok {
		t.Fatal("expired token accepted")
	}
}

func TestSafeRedirect(t *testing.T) {
	for in, want := range map[string]string{"/x": "/x", "//evil.com": "/", "https://evil.com": "/", "": "/", "/\\evil": "/"} {
		if got := safeRedirect(in); got != want {
			t.Errorf("%q → %q", in, got)
		}
	}
}

func TestAppLogin(t *testing.T) {
	m, srv, _ := setup(t, "")
	m.QueueUser(&mockoidc.MockUser{Subject: "u-9", Email: "phone@example.com", PreferredUsername: "phone"})
	verifier := "a-long-random-verifier-string-made-by-the-app-123456"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	jar, _ := cookiejar.New(nil)
	var landed *url.URL
	c := &http.Client{Jar: jar, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme == "lumen" {
			landed = req.URL
			return http.ErrUseLastResponse
		}
		return nil
	}}
	resp, err := c.Get(srv.URL + "/api/auth/login?app=" + challenge)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if landed == nil || landed.Query().Get("code") == "" {
		t.Fatalf("expected a lumen://auth?code= redirect, got %v", landed)
	}
	u, _ := url.Parse(srv.URL)
	for _, ck := range jar.Cookies(u) {
		if ck.Name == SessionCookie {
			t.Fatal("app sign-in should not set a browser session cookie")
		}
	}
	code := landed.Query().Get("code")

	exchange := func(code, verifier string) (int, string) {
		resp, err := http.Post(srv.URL+"/api/auth/app-token", "application/json", strings.NewReader(`{"code":"`+code+`","verifier":"`+verifier+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out struct{ Token string }
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out.Token
	}
	if st, _ := exchange(code, "wrong"); st != 400 {
		t.Fatalf("wrong verifier accepted: %d", st)
	}
	if st, _ := exchange(code, verifier); st != 400 {
		t.Fatal("code should be single use, even after a failed try")
	}

	// Fresh sign-in, correct verifier this time.
	m.QueueUser(&mockoidc.MockUser{Subject: "u-9", Email: "phone@example.com", PreferredUsername: "phone"})
	landed = nil
	resp, _ = c.Get(srv.URL + "/api/auth/login?app=" + challenge)
	resp.Body.Close()
	st, token := exchange(landed.Query().Get("code"), verifier)
	if st != 200 || token == "" {
		t.Fatalf("exchange failed: %d", st)
	}
	req, _ := http.NewRequest("GET", srv.URL+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, _ = http.DefaultClient.Do(req)
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(b) != "phone" {
		t.Fatalf("bearer token: %d %q", resp.StatusCode, b)
	}
}
