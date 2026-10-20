// Package auth implements OIDC login (PocketID), cookie sessions and media tokens.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gillgurjot/lumen/internal/config"
	"github.com/gillgurjot/lumen/internal/store"
	"golang.org/x/oauth2"
)

const (
	SessionCookie = "lumen_session"
	flowCookie    = "lumen_oidc"
)

type Auth struct {
	cfg    *config.Config
	st     *store.Store
	log    *slog.Logger
	secret []byte

	mu         sync.Mutex
	provider   *oidc.Provider
	verifier   *oidc.IDTokenVerifier
	oauth      *oauth2.Config
	endSession string
	HTTPClient *http.Client // optional, for tests

	codesMu  sync.Mutex
	appCodes map[string]appCode
}

// AppRedirect is where sign-ins started by the phone app return to.
const AppRedirect = "lumen://auth"

// appCode is a one-time code handed to the phone app after sign-in. The app trades it,
// with the verifier it generated, for a session token (the same idea as PKCE).
type appCode struct {
	token     string
	challenge string
	exp       time.Time
}

func New(cfg *config.Config, st *store.Store, log *slog.Logger) *Auth {
	secret := cfg.SecretKey
	if secret == "" {
		secret = st.Setting("secret_key")
		if secret == "" {
			secret = randString(32)
			_ = st.SetSetting("secret_key", secret)
		}
	}
	return &Auth{cfg: cfg, st: st, log: log, secret: []byte(secret)}
}

func randString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// discover lazily loads provider metadata so the server starts even if PocketID is briefly down.
func (a *Auth) discover(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.provider != nil {
		return nil
	}
	if a.HTTPClient != nil {
		ctx = oidc.ClientContext(ctx, a.HTTPClient)
	}
	p, err := oidc.NewProvider(ctx, a.cfg.OIDCIssuer)
	if err != nil {
		return fmt.Errorf("OIDC discovery for %s failed: %w", a.cfg.OIDCIssuer, err)
	}
	var extra struct {
		EndSession string `json:"end_session_endpoint"`
	}
	_ = p.Claims(&extra)
	a.provider = p
	a.endSession = extra.EndSession
	a.verifier = p.Verifier(&oidc.Config{ClientID: a.cfg.OIDCClientID})
	a.oauth = &oauth2.Config{
		ClientID:     a.cfg.OIDCClientID,
		ClientSecret: a.cfg.OIDCClientSecret,
		Endpoint:     p.Endpoint(),
		RedirectURL:  a.cfg.RedirectURL(),
		Scopes:       a.cfg.OIDCScopes,
	}
	return nil
}

type flowState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Redirect string `json:"r"`
	Exp      int64  `json:"e"`
	App      string `json:"a,omitempty"` // S256 challenge from the phone app
}

// appChallenge returns the app's PKCE-style challenge from ?app=, if it looks valid.
func appChallenge(r *http.Request) string {
	c := r.URL.Query().Get("app")
	if len(c) != 43 {
		return ""
	}
	if _, err := base64.RawURLEncoding.DecodeString(c); err != nil {
		return ""
	}
	return c
}

func (a *Auth) newAppCode(token, challenge string) string {
	a.codesMu.Lock()
	defer a.codesMu.Unlock()
	if a.appCodes == nil {
		a.appCodes = map[string]appCode{}
	}
	now := time.Now()
	for k, c := range a.appCodes {
		if c.exp.Before(now) {
			delete(a.appCodes, k)
		}
	}
	code := randString(24)
	a.appCodes[code] = appCode{token: token, challenge: challenge, exp: now.Add(2 * time.Minute)}
	return code
}

// AppToken trades a one-time code and its verifier for a session token.
func (a *Auth) AppToken(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Code     string `json:"code"`
		Verifier string `json:"verifier"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b); err != nil {
		http.Error(w, `{"error":"bad request"}`, 400)
		return
	}
	a.codesMu.Lock()
	c, ok := a.appCodes[b.Code]
	delete(a.appCodes, b.Code) // single use, even on a wrong verifier
	a.codesMu.Unlock()
	sum := sha256.Sum256([]byte(b.Verifier))
	if !ok || c.exp.Before(time.Now()) || !hmac.Equal([]byte(base64.RawURLEncoding.EncodeToString(sum[:])), []byte(c.challenge)) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":"Sign-in code expired, please try again"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"token": c.token})
}

// appFail sends a failed app sign-in back to the app with a message.
func appFail(w http.ResponseWriter, r *http.Request, msg string) {
	http.Redirect(w, r, AppRedirect+"?error="+url.QueryEscape(msg), http.StatusFound)
}

func (a *Auth) sign(data []byte) string {
	m := hmac.New(sha256.New, a.secret)
	m.Write(data)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (a *Auth) sealCookie(v any) string {
	b, _ := json.Marshal(v)
	p := base64.RawURLEncoding.EncodeToString(b)
	return p + "." + a.sign([]byte(p))
}

func (a *Auth) openCookie(s string, v any) error {
	p, sig, ok := strings.Cut(s, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(a.sign([]byte(p)))) {
		return errors.New("bad signature")
	}
	b, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// safeRedirect only allows same-site relative paths.
func safeRedirect(r string) string {
	if r == "" || !strings.HasPrefix(r, "/") || strings.HasPrefix(r, "//") || strings.HasPrefix(r, "/\\") {
		return "/"
	}
	return r
}

// Login starts the authorization code flow with PKCE.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	if err := a.discover(r.Context()); err != nil {
		a.log.Error("oidc", "err", err)
		if appChallenge(r) != "" {
			appFail(w, r, "Sign-in provider unreachable")
			return
		}
		http.Redirect(w, r, "/login?error="+url.QueryEscape("Sign-in provider unreachable"), http.StatusFound)
		return
	}
	fs := flowState{State: randString(16), Nonce: randString(16), Verifier: oauth2.GenerateVerifier(),
		Redirect: safeRedirect(r.URL.Query().Get("redirect")), Exp: time.Now().Add(10 * time.Minute).Unix(), App: appChallenge(r)}
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Value: a.sealCookie(fs), Path: "/api/auth", HttpOnly: true,
		Secure: a.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: 600})
	u := a.oauth.AuthCodeURL(fs.State, oidc.Nonce(fs.Nonce), oauth2.S256ChallengeOption(fs.Verifier))
	http.Redirect(w, r, u, http.StatusFound)
}

type claims struct {
	Subject  string `json:"sub"`
	Username string `json:"preferred_username"`
	Name     string `json:"name"`
	Given    string `json:"given_name"`
	Email    string `json:"email"`
	Picture  string `json:"picture"`
	Nonce    string `json:"nonce"`
}

func groupsFrom(raw map[string]any, claim string) []string {
	var out []string
	switch v := raw[claim].(type) {
	case []any:
		for _, g := range v {
			if s, ok := g.(string); ok {
				out = append(out, s)
			}
		}
	case string:
		out = strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' })
	}
	return out
}

// Callback completes the flow, upserts the user and sets the session cookie.
func (a *Auth) Callback(w http.ResponseWriter, r *http.Request) {
	var fs flowState
	c, cerr := r.Cookie(flowCookie)
	if cerr == nil && a.openCookie(c.Value, &fs) != nil {
		fs = flowState{}
	}
	fail := func(msg string, err error) {
		a.log.Warn("login failed", "reason", msg, "err", err)
		if fs.App != "" {
			appFail(w, r, msg)
			return
		}
		http.Redirect(w, r, "/login?error="+url.QueryEscape(msg), http.StatusFound)
	}
	if e := r.URL.Query().Get("error"); e != "" {
		fail("Sign-in was cancelled or denied", errors.New(e+": "+r.URL.Query().Get("error_description")))
		return
	}
	if err := a.discover(r.Context()); err != nil {
		fail("Sign-in provider unreachable", err)
		return
	}
	if cerr != nil || fs.State == "" || fs.Exp < time.Now().Unix() {
		fail("Sign-in session expired, please try again", cerr)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Value: "", Path: "/api/auth", MaxAge: -1})
	if r.URL.Query().Get("state") != fs.State {
		fail("Invalid sign-in state", nil)
		return
	}
	ctx := r.Context()
	if a.HTTPClient != nil {
		ctx = oidc.ClientContext(ctx, a.HTTPClient)
	}
	tok, err := a.oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(fs.Verifier))
	if err != nil {
		fail("Could not complete sign-in", err)
		return
	}
	rawID, _ := tok.Extra("id_token").(string)
	idt, err := a.verifier.Verify(ctx, rawID)
	if err != nil {
		fail("Invalid identity token", err)
		return
	}
	var cl claims
	raw := map[string]any{}
	_ = idt.Claims(&cl)
	_ = idt.Claims(&raw)
	if cl.Nonce != fs.Nonce {
		fail("Invalid sign-in nonce", nil)
		return
	}
	groups := groupsFrom(raw, a.cfg.OIDCGroupsClaim)
	if _, ok := raw[a.cfg.OIDCGroupsClaim]; !ok || cl.Email == "" || cl.Username == "" {
		// Some providers only put profile and groups in userinfo.
		if ui, err := a.provider.UserInfo(ctx, oauth2.StaticTokenSource(tok)); err == nil {
			uraw := map[string]any{}
			_ = ui.Claims(&uraw)
			var ucl claims
			_ = ui.Claims(&ucl)
			if len(groups) == 0 {
				groups = groupsFrom(uraw, a.cfg.OIDCGroupsClaim)
			}
			if cl.Email == "" {
				cl.Email = ucl.Email
			}
			if cl.Username == "" {
				cl.Username = ucl.Username
			}
			if cl.Name == "" {
				cl.Name = ucl.Name
			}
			if cl.Picture == "" {
				cl.Picture = ucl.Picture
			}
		}
	}
	if a.cfg.OIDCUserGroup != "" && !slices.Contains(groups, a.cfg.OIDCUserGroup) && !slices.Contains(groups, a.cfg.OIDCAdminGroup) {
		fail("Your account is not allowed to use this server", fmt.Errorf("user %s not in group %s", cl.Subject, a.cfg.OIDCUserGroup))
		return
	}
	u, token, err := a.completeLogin(w, r, cl, slices.Contains(groups, a.cfg.OIDCAdminGroup), rawID, fs.App != "")
	if err != nil {
		fail(err.Error(), err)
		return
	}
	a.log.Info("user signed in", "user", u.Username, "admin", u.IsAdmin, "app", fs.App != "")
	if fs.App != "" {
		http.Redirect(w, r, AppRedirect+"?code="+a.newAppCode(token, fs.App), http.StatusFound)
		return
	}
	http.Redirect(w, r, fs.Redirect, http.StatusFound)
}

// completeLogin saves the user and creates a session. Browser sign-ins get a cookie;
// app sign-ins (app=true) get the token back instead.
func (a *Auth) completeLogin(w http.ResponseWriter, r *http.Request, cl claims, admin bool, idToken string, app bool) (*store.User, string, error) {
	username := cl.Username
	if username == "" {
		username, _, _ = strings.Cut(cl.Email, "@")
	}
	if username == "" {
		username = cl.Subject
	}
	display := cl.Name
	if display == "" {
		display = cl.Given
	}
	if display == "" {
		display = username
	}
	u, err := a.st.UpsertOIDCUser(cl.Subject, username, display, cl.Email, cl.Picture, admin)
	if err != nil {
		return nil, "", errors.New("Could not save account")
	}
	if u.Disabled {
		return nil, "", errors.New("Your account is disabled")
	}
	token := randString(32)
	if err := a.st.CreateSession(token, u.ID, a.cfg.SessionTTL, r.UserAgent(), idToken); err != nil {
		return nil, "", errors.New("Could not create session")
	}
	if !app {
		http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: a.cfg.SecureCookies,
			SameSite: http.SameSiteLaxMode, MaxAge: int(a.cfg.SessionTTL.Seconds())})
	}
	return u, token, nil
}

// DevLogin signs in without an identity provider. Only enabled by LUMEN_DEV_INSECURE_LOGIN for testing.
func (a *Auth) DevLogin(w http.ResponseWriter, r *http.Request) {
	if !a.cfg.DevInsecureLogin {
		http.NotFound(w, r)
		return
	}
	name := r.URL.Query().Get("user")
	if name == "" {
		name = "dev"
	}
	app := appChallenge(r)
	_, token, err := a.completeLogin(w, r, claims{Subject: "dev:" + name, Username: name, Name: name}, r.URL.Query().Get("admin") == "1", "", app != "")
	if err != nil {
		http.Error(w, err.Error(), 403)
		return
	}
	if app != "" {
		http.Redirect(w, r, AppRedirect+"?code="+a.newAppCode(token, app), http.StatusFound)
		return
	}
	http.Redirect(w, r, safeRedirect(r.URL.Query().Get("redirect")), http.StatusFound)
}

// Logout ends the session and returns the provider logout URL, if any.
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) string {
	idt := ""
	if t := sessionToken(r); t != "" {
		idt = a.st.DeleteSession(t)
	}
	http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: a.cfg.SecureCookies})
	_ = a.discover(r.Context())
	a.mu.Lock()
	end := a.endSession
	a.mu.Unlock()
	if end == "" {
		return ""
	}
	q := url.Values{"post_logout_redirect_uri": {a.cfg.PublicURL + "/login"}, "client_id": {a.cfg.OIDCClientID}}
	if idt != "" {
		q.Set("id_token_hint", idt)
	}
	return end + "?" + q.Encode()
}

// sessionToken reads the session from the app's bearer header or the browser cookie.
func sessionToken(r *http.Request) string {
	if t, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok && t != "" {
		return t
	}
	if c, err := r.Cookie(SessionCookie); err == nil {
		return c.Value
	}
	return ""
}

// FromApp reports whether a request authenticates with the app's bearer token.
func FromApp(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ")
}

// SessionUser returns the signed-in user for a request (cookie or bearer token).
func (a *Auth) SessionUser(r *http.Request) *store.User {
	t := sessionToken(r)
	if t == "" {
		return nil
	}
	u, err := a.st.SessionUser(t)
	if err != nil || u.Disabled {
		return nil
	}
	return u
}

// MediaToken grants read access to media endpoints for cookie-less clients (Chromecast).
func (a *Auth) MediaToken(userID int64, ttl time.Duration) string {
	p := strconv.FormatInt(userID, 36) + "." + strconv.FormatInt(time.Now().Add(ttl).Unix(), 36)
	return p + "." + a.sign([]byte("media:"+p))
}

func (a *Auth) VerifyMediaToken(t string) (int64, bool) {
	parts := strings.Split(t, ".")
	if len(parts) != 3 {
		return 0, false
	}
	p := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(a.sign([]byte("media:"+p)))) {
		return 0, false
	}
	exp, err := strconv.ParseInt(parts[1], 36, 64)
	if err != nil || exp < time.Now().Unix() {
		return 0, false
	}
	uid, err := strconv.ParseInt(parts[0], 36, 64)
	return uid, err == nil
}
