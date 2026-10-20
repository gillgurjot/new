# Lumen

A fast, modern, self-hosted media server for movies and TV — a lightweight alternative to Jellyfin.
One Go binary with the web app built in, SQLite for storage, ffmpeg for streaming, and sign-in through your existing **Pocket ID** (OIDC).

## Features

- **Movies and TV shows**: automatic scanning, live folder watching, TMDB posters, backdrops, logos, cast, ratings and episode info. Local artwork (`poster.jpg`, `fanart.jpg`, `*-thumb.jpg`) is used when present.
- **Device-first playback**: each browser reports what it can decode (codecs, HDR, screen size, slow connections). Lumen then picks the cheapest option:
  1. **Direct play**: the original file, untouched.
  2. **Direct stream**: video copied as is, only the container (and audio, if needed) converted.
  3. **Transcode**: sized to the device's screen and bandwidth, in a codec it supports (H.264, HEVC, VP9 or AV1), with HDR→SDR tone mapping.
- **Hardware transcoding**: Intel/AMD VAAPI or Intel QSV, detected at startup with a test encode. Falls back to CPU automatically, and to a different pipeline if one fails for a file.
- **Player**: resume, seek previews (trickplay thumbnails), audio and subtitle switching (SRT/ASS/VTT, embedded or external; PGS/VobSub burned in), quality selector, playback speed, chapters, skip intro, up next with autoplay, picture-in-picture, keyboard shortcuts, double-tap seek on phones, lock-screen controls.
- **Chromecast** casting from Chrome/Edge.
- **Watch together**: share a link and everyone's play, pause and seeking stay in sync, with chat and reactions.
- **Downloads**: save the original file (untouched, resumable) to watch offline in any player. Can be turned off per user.
- **Skip credits**: end credits are found from chapters or by analysing the picture in the background.
- **Requests**: search any movie or show and request it through Seerr, which hands it to Radarr/Sonarr. Shows what's already in the library, requested or downloading.
- **Installable PWA** for phones and desktops.
- **Home screen**: continue watching, next up, recently added, featured banner. Search (titles, episodes, cast), favorites, watched state, filters and sorting.
- **Admin**: libraries with a folder picker, scan progress, metadata refresh and "fix match", users (disable, bitrate limit, library access), and a live dashboard of streams showing why each one is transcoding.

## Quick start (Docker Compose)

```bash
git clone <this repo> lumen && cd lumen
cp .env.example .env        # fill in PUBLIC_URL, OIDC_* and TMDB_API_KEY
getent group render | cut -d: -f3   # put this number in RENDER_GID
docker compose up -d --build
```

Open `PUBLIC_URL`, sign in with Pocket ID (as a member of the admin group), then go to **Server admin → Libraries → Add library** and pick `/media/...`.

### Pocket ID setup

1. In Pocket ID: **Administration → OIDC Clients → Add OIDC Client**.
   - Name: `Lumen`
   - Callback URL: `https://<your-lumen-host>/api/auth/callback`
   - Logout callback URL: `https://<your-lumen-host>/login`
2. Copy the client ID and secret into `.env` (`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`). Set `OIDC_ISSUER` to your Pocket ID URL, e.g. `https://id.zenith.example.com`.
3. Create a group called `lumen-admins` (or whatever `OIDC_ADMIN_GROUP` says) and add yourself. Admin rights follow this group on every login.
4. Optional: create `lumen-users` and set `OIDC_USER_GROUP=lumen-users` so only those people (plus admins) can sign in. You can also use Pocket ID's "allowed user groups" on the client.

Lumen uses the authorization code flow with PKCE, checks state and nonce, and asks for the `groups` scope. Users are created on first sign-in.

### Reverse proxy

Lumen should sit behind HTTPS (needed for secure cookies, Chromecast and PWA install). Caddy example:

```
lumen.zenith.example.com {
    reverse_proxy lumen:8096
}
```

For nginx, use `proxy_read_timeout 60s` or more (segments can take a few seconds to produce) and don't buffer responses to disk for `/api/hls/`.

### Hardware transcoding

The compose file passes `/dev/dri` and adds the host `render` group. Check what Lumen found under **Server admin → Dashboard → Transcoding**, or run:

```bash
docker exec lumen vainfo --display drm --device /dev/dri/renderD128
```

- Intel (Gen9+ / Arc): works out of the box (`iHD` driver). `LUMEN_HWACCEL=qsv` forces QSV.
- Older Intel (Broadwell and earlier): set `LIBVA_DRIVER_NAME=i965`.
- AMD: `radeonsi` is picked automatically.
- `LUMEN_HWACCEL=none` forces CPU encoding.

The image is built for amd64 (the Intel media driver isn't available on arm64; CPU transcoding still works there if you drop those packages).

## Media layout

Lumen understands the same naming as Jellyfin/Plex, so an existing library works unchanged.

```
/media/movies/Inception (2010)/Inception (2010).mkv
/media/movies/Inception (2010)/Inception (2010).en.srt
/media/movies/Arrival (2016) [tmdbid-329865]/Arrival.mkv     # pin an exact TMDB match

/media/tv/Severance/Season 01/Severance S01E01.mkv
/media/tv/Severance/Season 01/Severance - S01E02-E03.mkv     # multi-episode files
/media/tv/Severance/Specials/Severance S00E01.mkv
```

Folders named `extras`, `featurettes`, `trailers`, `samples` and files ending in `-sample` / `-trailer` are skipped. If a mount goes offline, the library is left alone instead of being emptied.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:8096` | External URL; the OIDC callback is built from it |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | – | Pocket ID client (required) |
| `OIDC_ADMIN_GROUP` | `lumen-admins` | Group that grants admin |
| `OIDC_USER_GROUP` | empty | If set, only this group (and admins) may sign in |
| `TMDB_API_KEY` | empty | TMDB v3 key or v4 token for metadata |
| `LUMEN_HWACCEL` | `auto` | `auto`, `vaapi`, `qsv` or `none` |
| `LUMEN_MAX_TRANSCODES` | `4` | Concurrent full transcodes (direct play/stream are not limited) |
| `LUMEN_SCAN_INTERVAL` | `6h` | Full rescan interval (folder watching handles most changes) |
| `LUMEN_TRICKPLAY` | `true` | Generate seek-preview thumbnails in the background |
| `LUMEN_CREDITS_DETECTION` | `true` | Find end credits in the background (skip credits, earlier up next) |
| `SEERR_URL` | | Seerr/Overseerr/Jellyseerr address, e.g. `http://seerr:5055`. Turns on requests |
| `SEERR_API_KEY` | | Seerr API key (Settings → General) |
| `SEERR_PUBLIC_URL` | | Seerr's public address, for "Open in Seerr" links |
| `LUMEN_CONFIG_DIR` / `LUMEN_TRANSCODE_DIR` | `/config` / `/transcode` | Database, images and cache / transcode scratch space |

## Development

Requirements: Go 1.26+, Node 22+, ffmpeg.

```bash
make dev     # API on :8096 with insecure dev login + Vite dev server on :5173
make test    # go vet, Go tests (including an OIDC flow against a mock provider), TypeScript check
make         # production build → bin/lumen (web app embedded)
```

`LUMEN_DEV_INSECURE_LOGIN=true` adds a sign-in button that skips Pocket ID. Never enable it on a reachable server.

### Layout

```
server/                 Go module
  cmd/lumen             entry point
  internal/auth         OIDC (PKCE), sessions, signed media tokens for Chromecast
  internal/library      filename parsing, ffprobe, scanner, folder watcher
  internal/metadata     TMDB client and metadata fetcher
  internal/stream       playback decision engine, ffmpeg HLS sessions, subtitles
  internal/hwaccel      VAAPI/QSV detection
  internal/jobs         scheduled scans, metadata queue, trickplay generation
  internal/api          REST + streaming endpoints, embedded web app
web/                    React + Vite + Tailwind web app (PWA)
```

### How streaming works

`POST /api/playback/start` receives the device profile and returns either a direct file URL (HTTP range requests) or an HLS playlist. Remux and transcode sessions run ffmpeg writing fMP4 segments. ffmpeg is paused when it gets far ahead of the viewer, old segments are deleted, and idle sessions are stopped after 90 seconds. Seeking outside what's been produced restarts ffmpeg at the new position, and the player keeps the timeline continuous.
