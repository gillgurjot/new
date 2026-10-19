package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

var ErrNotFound = errors.New("not found")

const userCols = `id, subject, username, display_name, email, avatar, is_admin, disabled, max_bitrate, library_ids, audio_lang, subtitle_lang, subtitle_mode, created_at, last_login`

func scanUser(r interface{ Scan(...any) error }) (*User, error) {
	var u User
	var libs sql.NullString
	err := r.Scan(&u.ID, &u.Subject, &u.Username, &u.DisplayName, &u.Email, &u.Avatar, &u.IsAdmin, &u.Disabled, &u.MaxBitrate, &libs, &u.AudioLang, &u.SubtitleLang, &u.SubtitleMode, &u.CreatedAt, &u.LastLogin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if libs.Valid {
		u.LibraryIDs = []int64{}
		_ = json.Unmarshal([]byte(libs.String), &u.LibraryIDs)
	}
	return &u, nil
}

// UpsertOIDCUser creates or updates a user from identity-provider claims.
// The admin flag always follows the provider's groups.
func (s *Store) UpsertOIDCUser(subject, username, display, email, avatar string, admin bool) (*User, error) {
	t := now()
	_, err := s.DB.Exec(`INSERT INTO users(subject, username, display_name, email, avatar, is_admin, created_at, last_login)
		VALUES (?,?,?,?,?,?,?,?)
		ON CONFLICT(subject) DO UPDATE SET username=excluded.username, display_name=excluded.display_name,
		  email=excluded.email, avatar=excluded.avatar, is_admin=excluded.is_admin, last_login=excluded.last_login`,
		subject, username, display, email, avatar, admin, t, t)
	if err != nil {
		return nil, err
	}
	return scanUser(s.DB.QueryRow(`SELECT `+userCols+` FROM users WHERE subject=?`, subject))
}

func (s *Store) User(id int64) (*User, error) {
	return scanUser(s.DB.QueryRow(`SELECT `+userCols+` FROM users WHERE id=?`, id))
}

func (s *Store) Users() ([]*User, error) {
	rows, err := s.DB.Query(`SELECT ` + userCols + ` FROM users ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// UpdateUserAdmin sets the admin-managed fields.
func (s *Store) UpdateUserAdmin(id int64, disabled bool, maxBitrate int, libraryIDs []int64) error {
	var libs any
	if libraryIDs != nil {
		libs = mustJSON(libraryIDs)
	}
	_, err := s.DB.Exec(`UPDATE users SET disabled=?, max_bitrate=?, library_ids=? WHERE id=?`, disabled, maxBitrate, libs, id)
	if err == nil && disabled {
		_, err = s.DB.Exec(`DELETE FROM sessions WHERE user_id=?`, id)
	}
	return err
}

func (s *Store) UpdateUserPrefs(id int64, audioLang, subLang, subMode string) error {
	_, err := s.DB.Exec(`UPDATE users SET audio_lang=?, subtitle_lang=?, subtitle_mode=? WHERE id=?`, audioLang, subLang, subMode, id)
	return err
}

func hashToken(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

func (s *Store) CreateSession(token string, userID int64, ttl time.Duration, ua, idToken string) error {
	t := now()
	_, err := s.DB.Exec(`INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen, user_agent, id_token) VALUES (?,?,?,?,?,?,?)`,
		hashToken(token), userID, t, t+int64(ttl.Seconds()), t, ua, idToken)
	return err
}

// SessionUser resolves a session token to its user, sliding last_seen.
func (s *Store) SessionUser(token string) (*User, error) {
	h := hashToken(token)
	u, err := scanUser(s.DB.QueryRow(`SELECT u.id, u.subject, u.username, u.display_name, u.email, u.avatar, u.is_admin, u.disabled, u.max_bitrate, u.library_ids, u.audio_lang, u.subtitle_lang, u.subtitle_mode, u.created_at, u.last_login
		FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?`, h, now()))
	if err != nil {
		return nil, err
	}
	_, _ = s.DB.Exec(`UPDATE sessions SET last_seen=? WHERE token_hash=? AND last_seen < ?`, now(), h, now()-300)
	return u, nil
}

// DeleteSession removes a session and returns its stored id_token (for RP logout).
func (s *Store) DeleteSession(token string) string {
	var idt string
	h := hashToken(token)
	_ = s.DB.QueryRow(`SELECT id_token FROM sessions WHERE token_hash=?`, h).Scan(&idt)
	_, _ = s.DB.Exec(`DELETE FROM sessions WHERE token_hash=?`, h)
	return idt
}

func (s *Store) PurgeExpiredSessions() {
	_, _ = s.DB.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now())
}

func (s *Store) Setting(key string) string {
	var v string
	_ = s.DB.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	return v
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.DB.Exec(`INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
