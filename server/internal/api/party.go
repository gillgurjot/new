package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gillgurjot/lumen/internal/party"
	"github.com/gillgurjot/lumen/internal/store"
	"github.com/go-chi/chi/v5"
)

// Reactions people can send during a watch party.
var reactions = map[string]bool{"😂": true, "😮": true, "😍": true, "😢": true, "🔥": true, "👏": true, "😱": true, "👍": true}

func member(u *store.User) party.Member {
	name := u.DisplayName
	if name == "" {
		name = u.Username
	}
	return party.Member{UserID: u.ID, Name: name, Avatar: u.Avatar}
}

func (s *Server) partyErr(w http.ResponseWriter, err error) {
	if errors.Is(err, party.ErrNotFound) {
		writeErr(w, 404, "This watch party has ended.")
		return
	}
	if errors.Is(err, party.ErrNotMember) {
		writeErr(w, 403, "Join the watch party first.")
		return
	}
	writeErr(w, 400, err.Error())
}

func (s *Server) partyCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var b struct {
		ItemID   int64   `json:"itemId"`
		Position float64 `json:"position"`
	}
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	it, err := s.St.Item(b.ItemID, u)
	if err != nil {
		s.notFoundOr500(w, err)
		return
	}
	if it.Type != "movie" && it.Type != "episode" {
		writeErr(w, 400, "pick a movie or an episode")
		return
	}
	id := s.Party.Create(u.ID, it.ID, max(b.Position, 0))
	snap, _ := s.Party.Snapshot(id)
	writeJSON(w, 200, snap)
}

// partyGet returns the room, after checking the viewer can watch what's playing.
func (s *Server) partyGet(w http.ResponseWriter, r *http.Request) {
	snap, err := s.Party.Snapshot(chi.URLParam(r, "id"))
	if err != nil {
		s.partyErr(w, err)
		return
	}
	if _, err := s.St.Item(snap.State.ItemID, userFrom(r)); err != nil {
		writeErr(w, 403, "You don't have access to what this party is watching.")
		return
	}
	writeJSON(w, 200, map[string]any{"party": snap, "now": time.Now().UnixMilli()})
}

// partyEvents streams room events with Server-Sent Events.
func (s *Server) partyEvents(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	fl, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, "streaming unsupported")
		return
	}
	ch, leave, err := s.Party.Join(chi.URLParam(r, "id"), member(u))
	if err != nil {
		s.partyErr(w, err)
		return
	}
	defer leave()
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(200)
	fl.Flush()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.Ctx.Done():
			return
		case ev := <-ch:
			b, _ := json.Marshal(ev)
			if _, err := w.Write([]byte("data: " + string(b) + "\n\n")); err != nil {
				return
			}
			fl.Flush()
		case <-ping.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func (s *Server) partyState(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var b struct {
		Action   string  `json:"action"`
		Position float64 `json:"position"`
		ItemID   int64   `json:"itemId"`
	}
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	if b.Action == "item" {
		if _, err := s.St.Item(b.ItemID, u); err != nil {
			s.notFoundOr500(w, err)
			return
		}
	}
	st, err := s.Party.Update(chi.URLParam(r, "id"), member(u), b.Action, b.Position, b.ItemID)
	if err != nil {
		s.partyErr(w, err)
		return
	}
	writeJSON(w, 200, st)
}

func (s *Server) partyChat(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var b struct {
		Text  string `json:"text"`
		Emoji string `json:"emoji"`
	}
	if err := decode(r, &b); err != nil {
		writeErr(w, 400, "bad request")
		return
	}
	b.Text = strings.TrimSpace(b.Text)
	if utf8.RuneCountInString(b.Text) > 500 {
		writeErr(w, 400, "message is too long")
		return
	}
	if b.Emoji != "" && !reactions[b.Emoji] {
		writeErr(w, 400, "unknown reaction")
		return
	}
	if b.Text == "" && b.Emoji == "" {
		writeErr(w, 400, "empty message")
		return
	}
	if b.Emoji != "" {
		b.Text = ""
	}
	if err := s.Party.Say(chi.URLParam(r, "id"), member(u), b.Text, b.Emoji); err != nil {
		s.partyErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
