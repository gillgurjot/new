// Package party keeps watch-together rooms: shared play/pause/seek state, who is
// watching, and a small chat. Rooms live in memory and vanish when everyone leaves.
package party

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("watch party not found")

// ErrNotMember means the caller hasn't opened the party yet.
var ErrNotMember = errors.New("join the watch party first")

// leaveGrace is how long a member may be disconnected before others see them leave.
var leaveGrace = 8 * time.Second

// State is the shared playback state. Position is where playback was at At (unix ms);
// while playing, clients add the time elapsed since then.
type State struct {
	ItemID   int64   `json:"itemId"`
	Playing  bool    `json:"playing"`
	Position float64 `json:"position"`
	At       int64   `json:"at"`
	By       string  `json:"by,omitempty"`     // display name of whoever changed it
	Action   string  `json:"action,omitempty"` // play | pause | seek | item
}

type Member struct {
	UserID  int64  `json:"userId"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar,omitempty"`
	conns   int
	present bool // announced as joined
}

type Message struct {
	ID     int64  `json:"id"`
	UserID int64  `json:"userId"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
	Text   string `json:"text,omitempty"`
	Emoji  string `json:"emoji,omitempty"` // reactions
	At     int64  `json:"at"`
	System bool   `json:"system,omitempty"` // joined / left notices
}

// Event is sent to every connected client.
type Event struct {
	Type string `json:"type"` // snapshot | state | members | chat
	Data any    `json:"data"`
	Now  int64  `json:"now"` // server clock, so clients can correct for skew
}

type Snapshot struct {
	ID      string    `json:"id"`
	HostID  int64     `json:"hostId"`
	State   State     `json:"state"`
	Members []Member  `json:"members"`
	Chat    []Message `json:"chat"`
}

type room struct {
	id      string
	hostID  int64
	state   State
	members map[int64]*Member
	order   []int64 // join order for display
	chat    []Message
	nextMsg int64
	subs    map[chan Event]int64
	idle    time.Time // when the last client left
}

type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func NewHub() *Hub { return &Hub{rooms: map[string]*room{}} }

func nowMs() int64 { return time.Now().UnixMilli() }

func newID() string {
	b := make([]byte, 5)
	_, _ = rand.Read(b)
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
}

// Create starts a room for an item, paused at position.
func (h *Hub) Create(hostID, itemID int64, position float64) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := newID()
	for h.rooms[id] != nil {
		id = newID()
	}
	h.rooms[id] = &room{id: id, hostID: hostID, members: map[int64]*Member{}, subs: map[chan Event]int64{}, idle: time.Now(),
		state: State{ItemID: itemID, Position: position, At: nowMs()}}
	return id
}

func (r *room) snapshot() Snapshot {
	s := Snapshot{ID: r.id, HostID: r.hostID, State: r.state, Members: r.memberList(), Chat: append([]Message{}, r.chat...)}
	return s
}

func (r *room) memberList() []Member {
	out := []Member{}
	for _, id := range r.order {
		if m := r.members[id]; m != nil && m.conns > 0 {
			out = append(out, *m)
		}
	}
	return out
}

func (r *room) broadcast(typ string, data any) {
	ev := Event{Type: typ, Data: data, Now: nowMs()}
	for ch := range r.subs {
		select {
		case ch <- ev:
		default: // slow client: drop; it resyncs from the next state event
		}
	}
}

func (r *room) addChat(m Message) {
	r.nextMsg++
	m.ID = r.nextMsg
	m.At = nowMs()
	r.chat = append(r.chat, m)
	if len(r.chat) > 100 {
		r.chat = r.chat[len(r.chat)-100:]
	}
	r.broadcast("chat", m)
}

// Snapshot returns the current room state.
func (h *Hub) Snapshot(id string) (Snapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[id]
	if r == nil {
		return Snapshot{}, ErrNotFound
	}
	return r.snapshot(), nil
}

// Join subscribes a client. The returned channel gets a snapshot first; call leave when done.
func (h *Hub) Join(id string, m Member) (<-chan Event, func(), error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[id]
	if r == nil {
		return nil, nil, ErrNotFound
	}
	ch := make(chan Event, 32)
	r.subs[ch] = m.UserID
	cur := r.members[m.UserID]
	if cur == nil {
		cur = &Member{UserID: m.UserID, Name: m.Name, Avatar: m.Avatar}
		r.members[m.UserID] = cur
		r.order = append(r.order, m.UserID)
	}
	cur.conns++
	ch <- Event{Type: "snapshot", Data: r.snapshot(), Now: nowMs()}
	if cur.conns == 1 {
		if !cur.present {
			cur.present = true
			r.addChat(Message{UserID: m.UserID, Name: m.Name, Text: m.Name + " joined", System: true})
		}
		r.broadcast("members", r.memberList())
	}
	var once sync.Once
	leave := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			delete(r.subs, ch)
			if cur.conns--; cur.conns == 0 {
				// Wait a little: a reconnect (network blip, page reload) shouldn't read as leaving.
				time.AfterFunc(leaveGrace, func() {
					h.mu.Lock()
					defer h.mu.Unlock()
					if cur.conns == 0 && cur.present {
						cur.present = false
						r.addChat(Message{UserID: m.UserID, Name: m.Name, Text: m.Name + " left", System: true})
						r.broadcast("members", r.memberList())
					}
				})
			}
			if len(r.subs) == 0 {
				r.idle = time.Now()
				// Nobody is watching: freeze the clock so a rejoin starts where they left.
				if r.state.Playing {
					r.state.Position += float64(nowMs()-r.state.At) / 1000
					r.state.Playing = false
					r.state.At = nowMs()
				}
			}
		})
	}
	return ch, leave, nil
}

// Update applies a play/pause/seek/item change and tells everyone.
func (h *Hub) Update(id string, by Member, action string, position float64, itemID int64) (State, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[id]
	if r == nil {
		return State{}, ErrNotFound
	}
	if _, ok := r.members[by.UserID]; !ok {
		return State{}, ErrNotMember
	}
	s := r.state
	switch action {
	case "play":
		s.Playing = true
	case "pause":
		s.Playing = false
	case "seek":
	case "item":
		if itemID <= 0 || itemID == s.ItemID {
			return r.state, nil
		}
		s.ItemID = itemID
		s.Playing = true
		position = 0
	default:
		return State{}, errors.New("unknown action")
	}
	if position < 0 {
		position = 0
	}
	s.Position = position
	s.At = nowMs()
	s.By = by.Name
	s.Action = action
	r.state = s
	r.broadcast("state", s)
	return s, nil
}

// Say posts a chat message or an emoji reaction.
func (h *Hub) Say(id string, by Member, text, emoji string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[id]
	if r == nil {
		return ErrNotFound
	}
	if _, ok := r.members[by.UserID]; !ok {
		return ErrNotMember
	}
	r.addChat(Message{UserID: by.UserID, Name: by.Name, Avatar: by.Avatar, Text: text, Emoji: emoji})
	return nil
}

// Run removes rooms that have been empty for a while.
func (h *Hub) Run(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.mu.Lock()
			for id, r := range h.rooms {
				if len(r.subs) == 0 && time.Since(r.idle) > 15*time.Minute {
					delete(h.rooms, id)
				}
			}
			h.mu.Unlock()
		}
	}
}
