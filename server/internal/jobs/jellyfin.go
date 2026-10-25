package jobs

import (
	"context"
	"fmt"
	"math"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/gillgurjot/lumen/internal/jellyfin"
	"github.com/gillgurjot/lumen/internal/store"
)

// Jellyfin sync keeps each person's watch history, resume points and favourites the same
// in Lumen and Jellyfin, both ways, and copies the intro/recap/credits segments that
// Jellyfin's Intro Skipper found. Items are matched by file path, people by user name.
//
// For every item the last sync remembers what Jellyfin had and when it ran. Next time,
// whichever side changed since wins; when both did, the one played most recently wins.

// JellyfinStatus is shown on the admin page.
type JellyfinStatus struct {
	Enabled  bool          `json:"enabled"`
	Running  bool          `json:"running"`
	LastSync int64         `json:"lastSync"`
	Error    string        `json:"error,omitempty"`
	Linked   int           `json:"linked"`
	Users    []JellyfinMap `json:"users"`
	Pulled   int           `json:"pulled"`
	Pushed   int           `json:"pushed"`
	Segments int           `json:"segments"`
}

type JellyfinMap struct {
	Lumen    string `json:"lumen"`
	Jellyfin string `json:"jellyfin"`
}

type jfState struct {
	mu     sync.Mutex
	status JellyfinStatus
	wake   chan struct{}
}

func (r *Runner) JellyfinStatus() JellyfinStatus {
	r.jf.mu.Lock()
	defer r.jf.mu.Unlock()
	s := r.jf.status
	s.Enabled = r.Jellyfin.Enabled()
	s.Users = append([]JellyfinMap{}, s.Users...)
	return s
}

// SyncJellyfin asks for a sync soon (after playback stops, when something is marked
// played, or from the admin page). Several calls in a row run one sync.
func (r *Runner) SyncJellyfin() {
	if r.jf.wake == nil {
		return
	}
	select {
	case r.jf.wake <- struct{}{}:
	default:
	}
}

func (r *Runner) jellyfinLoop(ctx context.Context) {
	t := time.NewTicker(r.JellyfinInterval)
	defer t.Stop()
	r.runJellyfin(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-r.jf.wake:
			// Let a burst of changes settle.
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
		r.runJellyfin(ctx)
	}
}

func (r *Runner) runJellyfin(ctx context.Context) {
	r.jf.mu.Lock()
	r.jf.status.Running = true
	r.jf.mu.Unlock()
	res, err := r.syncJellyfin(ctx)
	r.jf.mu.Lock()
	defer r.jf.mu.Unlock()
	r.jf.status.Running = false
	r.jf.status.LastSync = time.Now().Unix()
	r.jf.status.Linked = r.St.JellyfinLinkCount()
	if err != nil {
		if ctx.Err() == nil {
			r.Log.Warn("jellyfin sync failed", "err", err)
		}
		r.jf.status.Error = err.Error()
		return
	}
	r.jf.status.Error = ""
	r.jf.status.Users = res.users
	r.jf.status.Pulled, r.jf.status.Pushed, r.jf.status.Segments = res.pulled, res.pushed, res.segments
	if res.pulled+res.pushed+res.segments > 0 {
		r.Log.Info("jellyfin sync", "pulled", res.pulled, "pushed", res.pushed, "segments", res.segments)
	}
}

type syncResult struct {
	users                    []JellyfinMap
	pulled, pushed, segments int
}

func (r *Runner) syncJellyfin(ctx context.Context) (syncResult, error) {
	var res syncResult
	jfUsers, err := r.Jellyfin.Users(ctx)
	if err != nil {
		return res, err
	}
	users, err := r.St.Users()
	if err != nil {
		return res, err
	}
	files, err := r.St.PlayableFiles()
	if err != nil {
		return res, err
	}
	match := newPathMatcher(files)

	type pair struct {
		u  *store.User
		jf jellyfin.User
	}
	var pairs []pair
	for _, u := range users {
		if jfu, ok := matchUser(u, jfUsers); ok && !u.Disabled {
			pairs = append(pairs, pair{u, jfu})
			res.users = append(res.users, JellyfinMap{Lumen: u.Username, Jellyfin: jfu.Name})
		}
	}

	linked := map[string]bool{}
	link := func(items []jellyfin.Item) map[string]store.FileRef {
		out := map[string]store.FileRef{}
		for _, it := range items {
			f, ok := match.find(it.Path)
			if !ok {
				continue
			}
			out[it.ID] = f
			if !linked[it.ID] {
				linked[it.ID] = true
				r.St.LinkJellyfin(f.ItemID, it.ID)
			}
		}
		return out
	}
	if len(pairs) == 0 && len(jfUsers) > 0 {
		// Nobody to sync, but intro segments are still worth having.
		items, err := r.Jellyfin.Items(ctx, jfUsers[0].ID)
		if err != nil {
			return res, err
		}
		link(items)
	}
	for _, p := range pairs {
		items, err := r.Jellyfin.Items(ctx, p.jf.ID)
		if err != nil {
			return res, err
		}
		refs := link(items)
		pulled, pushed, err := r.syncUser(ctx, p.u, p.jf, items, refs)
		res.pulled += pulled
		res.pushed += pushed
		if err != nil {
			return res, err
		}
	}
	res.segments, err = r.syncSegments(ctx)
	return res, err
}

// matchUser finds the Jellyfin account for a Lumen user: same user name, display name or
// e-mail name, ignoring case.
func matchUser(u *store.User, jfUsers []jellyfin.User) (jellyfin.User, bool) {
	cands := []string{u.Username, u.DisplayName}
	if at := strings.IndexByte(u.Email, '@'); at > 0 {
		cands = append(cands, u.Email[:at])
	}
	for _, c := range cands {
		for _, j := range jfUsers {
			if c != "" && strings.EqualFold(strings.TrimSpace(c), strings.TrimSpace(j.Name)) {
				return j, true
			}
		}
	}
	return jellyfin.User{}, false
}

// pathMatcher pairs Jellyfin paths with Lumen files. The two servers mount the media at
// different places, so it compares the last folders and file name.
type pathMatcher struct{ by2 map[string][]store.FileRef }

func pathTail(p string, n int) string {
	parts := strings.Split(strings.ToLower(path.Clean(strings.ReplaceAll(p, `\`, "/"))), "/")
	if len(parts) > n {
		parts = parts[len(parts)-n:]
	}
	return strings.Join(parts, "/")
}

func newPathMatcher(files []store.FileRef) *pathMatcher {
	m := &pathMatcher{by2: map[string][]store.FileRef{}}
	for _, f := range files {
		k := pathTail(f.Path, 2)
		m.by2[k] = append(m.by2[k], f)
	}
	return m
}

func (m *pathMatcher) find(p string) (store.FileRef, bool) {
	if p == "" {
		return store.FileRef{}, false
	}
	c := m.by2[pathTail(p, 2)]
	if len(c) == 1 {
		return c[0], true
	}
	// Same folder and file name in two shows ("Season 01/01.mkv"): look one folder up.
	var hit []store.FileRef
	for _, f := range c {
		if pathTail(f.Path, 3) == pathTail(p, 3) {
			hit = append(hit, f)
		}
	}
	if len(hit) == 1 {
		return hit[0], true
	}
	return store.FileRef{}, false
}

// view is the part of user data both servers share, rounded so they compare equal.
type view struct {
	played   bool
	position int64 // seconds
	favorite bool
}

func (v view) key() string { return fmt.Sprintf("%t|%d|%t", v.played, v.position, v.favorite) }

func jfView(d *jellyfin.UserData) view {
	if d == nil {
		return view{}
	}
	return view{played: d.Played, position: int64(math.Round(float64(d.PlaybackPositionTicks) / 1e7)), favorite: d.IsFavorite}
}

func lumenView(r store.UDRow) view {
	return view{played: r.Played, position: int64(math.Round(r.Position)), favorite: r.Favorite}
}

func (r *Runner) syncUser(ctx context.Context, u *store.User, jfu jellyfin.User, items []jellyfin.Item, refs map[string]store.FileRef) (pulled, pushed int, err error) {
	local, err := r.St.UserDataRows(u.ID)
	if err != nil {
		return 0, 0, err
	}
	synced, err := r.St.SyncRows(u.ID)
	if err != nil {
		return 0, 0, err
	}
	for _, it := range items {
		if ctx.Err() != nil {
			return pulled, pushed, ctx.Err()
		}
		ref, ok := refs[it.ID]
		if !ok {
			continue
		}
		jd := it.UserData
		if jd == nil {
			jd = &jellyfin.UserData{}
		}
		jv := jfView(jd)
		jLast := int64(0)
		if jd.LastPlayedDate != nil && jd.LastPlayedDate.Year() > 1 {
			jLast = jd.LastPlayedDate.Unix()
		}
		lu, hasLocal := local[ref.ItemID]
		lv := lumenView(lu)
		prev, hasPrev := synced[ref.ItemID]
		if !hasLocal && jv == (view{}) {
			continue
		}
		jfChanged := !hasPrev || prev.JFState != jv.key()
		lumenChanged := hasLocal && (!hasPrev || lu.UpdatedAt > prev.SyncedAt)
		if !jfChanged && !lumenChanged {
			continue
		}

		// Decide what both sides should hold.
		var takeJF bool
		switch {
		case !hasLocal:
			takeJF = true
		case !hasPrev:
			// First sync: the most recently played side wins, favourites from either.
			takeJF = jv != (view{}) && (lv == (view{}) || jLast > lu.LastPlayed)
		case jfChanged && !lumenChanged:
			takeJF = true
		case lumenChanged && !jfChanged:
			takeJF = false
		default:
			takeJF = jLast > lu.LastPlayed
		}
		target := lv
		if takeJF {
			target = jv
		}
		if !hasPrev {
			target.favorite = jv.favorite || lv.favorite
		}
		if target.played {
			target.position = 0
		}

		at := time.Now().UnixMilli()
		syncedAt := lu.UpdatedAt
		if target != lv || !hasLocal {
			row := store.UDRow{Position: float64(target.position), Played: target.played, Favorite: target.favorite,
				PlayCount: max(lu.PlayCount, jd.PlayCount), LastPlayed: max(lu.LastPlayed, jLast)}
			if hasLocal && !takeJF {
				row.Position = lu.Position // keep sub-second precision when only the favourite changed
			}
			if target.played && row.PlayCount == 0 {
				row.PlayCount = 1
			}
			if err := r.St.ApplySyncedUserData(u.ID, ref.ItemID, row, at); err != nil {
				return pulled, pushed, err
			}
			syncedAt = at
			pulled++
		}
		if target != jv {
			d := jellyfin.UserData{PlaybackPositionTicks: target.position * 1e7, Played: target.played, IsFavorite: target.favorite,
				PlayCount: max(lu.PlayCount, jd.PlayCount)}
			if target.played && d.PlayCount == 0 {
				d.PlayCount = 1
			}
			if lu.LastPlayed > 0 {
				t := time.Unix(lu.LastPlayed, 0).UTC()
				d.LastPlayedDate = &t
			}
			if err := r.Jellyfin.UpdateUserData(ctx, jfu.ID, it.ID, d); err != nil {
				return pulled, pushed, err
			}
			pushed++
		}
		r.St.SetSynced(u.ID, ref.ItemID, max(syncedAt, prev.SyncedAt), target.key())
	}
	return pulled, pushed, nil
}

// syncSegments copies Intro Skipper's intro, recap and credits times. Items without an
// intro are checked again every few hours, since the plugin may get to them later.
func (r *Runner) syncSegments(ctx context.Context) (int, error) {
	checks, err := r.St.ItemsNeedingSegments(time.Now().Add(-6*time.Hour).Unix(), 500)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, c := range checks {
		if ctx.Err() != nil {
			return n, ctx.Err()
		}
		segs, err := r.Jellyfin.Segments(ctx, c.JFID)
		if err != nil {
			return n, err
		}
		var g store.Segments
		for _, s := range segs {
			switch s.Type {
			case "Intro":
				g.IntroStart, g.IntroEnd = s.Start(), s.End()
			case "Recap":
				g.RecapStart, g.RecapEnd = s.Start(), s.End()
			case "Outro":
				g.CreditsStart, g.CreditsEnd = s.Start(), s.End()
			}
		}
		if len(segs) > 0 {
			r.St.ApplySegments(c.FileID, g)
			n++
		}
		r.St.MarkSegmentsChecked(c.ItemID)
	}
	return n, nil
}
