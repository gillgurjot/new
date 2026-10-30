package party

import (
	"testing"
	"time"
)

func next(t *testing.T, ch <-chan Event, typ string) Event {
	t.Helper()
	for {
		select {
		case ev := <-ch:
			if ev.Type == typ {
				return ev
			}
		case <-time.After(time.Second):
			t.Fatalf("no %s event", typ)
		}
	}
}

func TestRoomSync(t *testing.T) {
	leaveGrace = 10 * time.Millisecond
	h := NewHub()
	id := h.Create(1, 42, 30)
	a, leaveA, err := h.Join(id, Member{UserID: 1, Name: "Ann"})
	if err != nil {
		t.Fatal(err)
	}
	snap := next(t, a, "snapshot").Data.(Snapshot)
	if snap.State.ItemID != 42 || snap.State.Position != 30 || snap.State.Playing {
		t.Fatalf("bad snapshot %+v", snap.State)
	}
	b, leaveB, _ := h.Join(id, Member{UserID: 2, Name: "Bob"})
	next(t, b, "snapshot")
	for len(next(t, a, "members").Data.([]Member)) != 2 {
	}

	if _, err := h.Update(id, Member{UserID: 2, Name: "Bob"}, "play", 31, 0); err != nil {
		t.Fatal(err)
	}
	st := next(t, a, "state").Data.(State)
	if !st.Playing || st.Position != 31 || st.By != "Bob" {
		t.Fatalf("bad state %+v", st)
	}
	if _, err := h.Update(id, Member{UserID: 9, Name: "Eve"}, "pause", 0, 0); err == nil {
		t.Fatal("non-member could control the room")
	}
	if err := h.Say(id, Member{UserID: 1, Name: "Ann"}, "hi", ""); err != nil {
		t.Fatal(err)
	}
	for {
		if m := next(t, b, "chat").Data.(Message); !m.System {
			if m.Text != "hi" {
				t.Fatalf("chat %+v", m)
			}
			break
		}
	}

	leaveB()
	leaveA()
	time.Sleep(50 * time.Millisecond)
	s, _ := h.Snapshot(id)
	if s.State.Playing {
		t.Fatal("empty room should pause")
	}
	if len(s.Members) != 0 {
		t.Fatalf("members left: %v", s.Members)
	}
}
