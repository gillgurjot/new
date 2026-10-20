import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js/light'
import {
  ArrowLeft, AudioLines, Cast, Gauge, Info, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Settings2, SkipForward,
  Subtitles, Users, Volume1, Volume2, VolumeX, X,
} from 'lucide-react'
import { ApiError, api, landscapeUrl, post } from '../api/client'
import type { Item, PlaybackInfo } from '../api/types'
import { chromecastProfile, detectProfile } from '../lib/device'
import { episodeLabel, formatTime } from '../lib/format'
import { loadPrefs, qualityOptions, savePrefs } from '../lib/prefs'
import Spinner from '../components/Spinner'
import { useUser } from '../lib/user'
import { activeCues, type Cue, parseVTT } from './vtt'
import { useTrickplay } from './trickplay'
import { castLoad, endCast, requestCast, useCast } from './cast'
import { partyPosition, useParty } from './party'
import { PartyOverlay, PartyPanel } from './PartyPanel'
import { toast } from '../components/ui'

interface Props {
  itemId: number
  startTime?: number
  onExit: () => void
  onNext: (id: number) => void
  /** Watch party to sync with, if any. */
  partyId?: string | null
  /** Open the watch-together panel straight away (just created a party). */
  partyPanel?: boolean
  onStartParty?: (position: number) => void
  onLeaveParty?: () => void
}

interface StartOpts {
  startTime?: number
  audioIndex?: number | null
  subtitleIndex?: number
  quality?: string
}

type Menu = null | 'subs' | 'audio' | 'quality' | 'speed' | 'info'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function Player({ itemId, startTime, onExit, onNext, partyId, partyPanel, onStartParty, onLeaveParty }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const infoRef = useRef<PlaybackInfo | null>(null)
  const selRef = useRef<{ audio: number | null; sub: number }>({ audio: null, sub: -1 })
  const restarting = useRef(false)
  const retries = useRef(0)

  const me = useUser()
  const [info, setInfo] = useState<PlaybackInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadingRef = useRef(true)
  loadingRef.current = loading
  const [paused, setPaused] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [time, setTime] = useState(0) // absolute media time
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [prefs, setPrefsState] = useState(loadPrefs())
  const [volume, setVolume] = useState(prefs.volume)
  const [muted, setMuted] = useState(prefs.muted)
  const [speed, setSpeed] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [controls, setControls] = useState(true)
  const [menu, setMenu] = useState<Menu>(null)
  const [subIndex, setSubIndex] = useState(-1)
  const [cues, setCues] = useState<Cue[]>([])
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [next, setNext] = useState<Item | null>(null)
  const [upNext, setUpNext] = useState<number | null>(null) // countdown seconds
  const [upNextDismissed, setUpNextDismissed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [casting, setCasting] = useState(false)
  const castState = useCast()
  const trick = useTrickplay(info?.trickplay, info?.media.id)
  const party = useParty(partyId || null)
  const partyRef = useRef(party)
  partyRef.current = party
  const [partyOpen, setPartyOpen] = useState(!!partyPanel)
  const [needTap, setNeedTap] = useState(false)

  const offset = info && info.method !== 'direct' ? info.startOffset : 0
  const duration = info?.duration || 0
  const setPrefs = (p: Partial<typeof prefs>) => {
    savePrefs(p)
    setPrefsState(loadPrefs())
  }

  // ---------- session lifecycle ----------

  const report = useCallback((stop = false) => {
    const i = infoRef.current
    const v = videoRef.current
    if (!i || !v || restarting.current) return Promise.resolve(null)
    const abs = (i.method !== 'direct' ? i.startOffset : 0) + v.currentTime
    const body = { sessionId: i.sessionId, itemId: i.item.id, position: abs, paused: v.paused, audioIndex: selRef.current.audio, subtitleIndex: selRef.current.sub }
    if (stop) {
      return fetch('/api/playback/stop', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Lumen-Request': '1' }, body: JSON.stringify(body) }).catch(() => null)
    }
    return post<{ played: boolean; sessionAlive: boolean }>('/api/playback/progress', body).catch(() => null)
  }, [])

  const attach = useCallback((p: PlaybackInfo, seekTo: number) => {
    const v = videoRef.current!
    hlsRef.current?.destroy()
    hlsRef.current = null
    v.removeAttribute('src')
    if (p.method === 'direct') {
      v.src = p.url
      const onMeta = () => {
        if (seekTo > 0) v.currentTime = seekTo
        v.removeEventListener('loadedmetadata', onMeta)
      }
      v.addEventListener('loadedmetadata', onMeta)
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        startPosition: 0,
        maxBufferLength: 60,
        maxMaxBufferLength: 180,
        backBufferLength: 60,
        liveDurationInfinity: false,
        enableWorker: true,
        manifestLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries.current < 2) {
          retries.current++
          hls.recoverMediaError()
          return
        }
        // Session likely ended (idle or server restart): resume from where we are.
        if (retries.current < 3) {
          retries.current++
          const at = (infoRef.current?.startOffset || 0) + (videoRef.current?.currentTime || 0)
          start({ startTime: at })
        } else {
          setError('Playback failed. The server may be overloaded or the file is unreadable.')
        }
      })
      hls.loadSource(p.url)
      hls.attachMedia(v)
      hlsRef.current = hls
    } else {
      v.src = p.url // native HLS (Safari / iOS)
    }
    v.playbackRate = speed
    v.play().catch(() => setPaused(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async (o: StartOpts = {}) => {
    const prev = infoRef.current
    restarting.current = true
    setLoading(true)
    setError('')
    const q = qualityOptions.find((x) => x.value === (o.quality ?? loadPrefs().quality)) || qualityOptions[0]
    try {
      const p = await post<PlaybackInfo>('/api/playback/start', {
        itemId,
        profile: detectProfile(),
        startTime: o.startTime,
        audioIndex: o.audioIndex !== undefined ? o.audioIndex : prev ? selRef.current.audio : undefined,
        subtitleIndex: o.subtitleIndex !== undefined ? o.subtitleIndex : prev ? selRef.current.sub : undefined,
        maxHeight: q.height,
        maxBitrate: q.kbps,
        replaceSession: prev?.sessionId || '',
      })
      infoRef.current = p
      selRef.current = { audio: p.audioIndex, sub: p.subtitleIndex }
      setInfo(p)
      setSubIndex(p.subtitleIndex)
      setTime(p.startTime)
      attach(p, p.method === 'direct' ? p.startTime : 0)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
      setLoading(false)
    } finally {
      restarting.current = false
    }
  }, [itemId, attach])

  useEffect(() => {
    infoRef.current = null
    retries.current = 0
    setUpNext(null)
    setUpNextDismissed(false)
    setNext(null)
    start({ startTime })
    const iv = setInterval(async () => {
      const r = (await report()) as { sessionAlive?: boolean } | null
      const i = infoRef.current
      if (r && r.sessionAlive === false && i && i.method !== 'direct' && videoRef.current && !videoRef.current.paused) {
        start({ startTime: i.startOffset + videoRef.current.currentTime })
      }
    }, 10_000)
    const unload = () => report(true)
    window.addEventListener('pagehide', unload)
    return () => {
      clearInterval(iv)
      window.removeEventListener('pagehide', unload)
      report(true)
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // Next episode lookup
  useEffect(() => {
    if (info?.item.type !== 'episode') return
    api<Item | null>(`/api/items/${info.item.id}/next`).then(setNext).catch(() => {})
  }, [info?.item.id, info?.item.type])

  // ---------- subtitles ----------

  useEffect(() => {
    setCues([])
    const t = info?.subtitles?.find((s) => s.index === subIndex)
    if (!t?.url) return
    let alive = true
    fetch(t.url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => alive && setCues(parseVTT(txt)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [subIndex, info?.subtitles])

  const chooseSubtitle = (idx: number) => {
    setMenu(null)
    const track = info?.subtitles?.find((s) => s.index === idx)
    const burning = info?.decision.burn != null
    selRef.current.sub = idx
    // Image subtitles are burned in by the server, so switching to/from them restarts the stream.
    if ((track && !track.url) || burning) {
      start({ startTime: time, subtitleIndex: idx })
    } else {
      setSubIndex(idx)
    }
  }

  const chooseAudio = (idx: number) => {
    setMenu(null)
    selRef.current.audio = idx
    start({ startTime: time, audioIndex: idx })
  }

  const chooseQuality = (q: string) => {
    setMenu(null)
    setPrefs({ quality: q })
    start({ startTime: time, quality: q })
  }

  // Moving to another episode takes the whole party along.
  const goNext = useCallback((id: number) => {
    const p = partyRef.current
    // Wait for the room to switch first, or the new page would see the old item and bounce back.
    if (p) p.send('item', 0, id).finally(() => onNext(id))
    else onNext(id)
  }, [onNext])

  // ---------- video events ----------

  useEffect(() => {
    const v = videoRef.current!
    const off = () => (infoRef.current && infoRef.current.method !== 'direct' ? infoRef.current.startOffset : 0)
    const onTime = () => {
      setTime(off() + v.currentTime)
      if (v.buffered.length) setBufferedEnd(off() + v.buffered.end(v.buffered.length - 1))
    }
    const onPlay = () => setPaused(false)
    const onPause = () => {
      setPaused(true)
      setWaiting(false)
      report()
    }
    const onWaiting = () => setWaiting(true)
    const onPlaying = () => {
      setWaiting(false)
      setLoading(false)
      retries.current = 0
    }
    const onCanPlay = () => {
      setLoading(false)
      if (v.paused) setWaiting(false)
    }
    const onEnded = async () => {
      await report()
      if (next && loadPrefs().autoplayNext) goNext(next.id)
    }
    const onErr = () => {
      const i = infoRef.current
      if (!i || hlsRef.current) return
      // Direct play failed (codec surprise): fall back to a server-side conversion.
      if (i.method === 'direct' && retries.current < 1) {
        retries.current++
        post<PlaybackInfo>('/api/playback/start', {
          itemId, profile: { ...detectProfile(), containers: [] }, startTime: off() + v.currentTime, replaceSession: i.sessionId,
          audioIndex: selRef.current.audio, subtitleIndex: selRef.current.sub,
        }).then((p) => {
          infoRef.current = p
          setInfo(p)
          attach(p, 0)
        }).catch(() => setError('This file can’t be played on this device.'))
      } else if (!hlsRef.current) {
        setError('This file can’t be played on this device.')
      }
    }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('progress', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('playing', onPlaying)
    v.addEventListener('canplay', onCanPlay)
    v.addEventListener('ended', onEnded)
    v.addEventListener('error', onErr)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('progress', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('canplay', onCanPlay)
      v.removeEventListener('ended', onEnded)
      v.removeEventListener('error', onErr)
    }
  }, [next, goNext, report, itemId, attach])

  useEffect(() => {
    const v = videoRef.current!
    v.volume = volume
    v.muted = muted
    savePrefs({ volume, muted })
  }, [volume, muted])

  // ---------- seeking ----------

  const seek = useCallback((abs: number, broadcast = true) => {
    const v = videoRef.current
    const i = infoRef.current
    if (!v || !i) return
    abs = Math.max(0, Math.min(abs, (i.duration || abs) - 0.5))
    setTime(abs)
    if (broadcast) partyRef.current?.send('seek', abs)
    if (i.method === 'direct') {
      v.currentTime = abs
      return
    }
    const local = abs - i.startOffset
    let produced = 0
    const det = hlsRef.current?.levels?.[0]?.details
    if (det) produced = det.totalduration
    else if (v.seekable.length) produced = v.seekable.end(v.seekable.length - 1)
    // The server deletes segments ~10 min behind the playhead, so jump further back with a new session.
    const tooFarBack = v.currentTime - local > 540
    if (local >= 0 && local <= produced - 1 && !tooFarBack) {
      v.currentTime = local
    } else {
      start({ startTime: abs })
    }
  }, [start])

  // Where the video is, in media time (HLS sessions start at an offset).
  const nowAbs = useCallback(() => {
    const i = infoRef.current
    const v = videoRef.current
    return (i && i.method !== 'direct' ? i.startOffset : 0) + (v?.currentTime || 0)
  }, [])
  const userPlay = useCallback(() => {
    videoRef.current?.play().catch(() => {})
    setNeedTap(false)
    partyRef.current?.send('play', nowAbs())
  }, [nowAbs])
  const userPause = useCallback(() => {
    videoRef.current?.pause()
    partyRef.current?.send('pause', nowAbs())
  }, [nowAbs])
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) userPlay()
    else userPause()
  }, [userPlay, userPause])

  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current as HTMLElement & { webkitRequestFullscreen?: () => void }
    const v = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (el.requestFullscreen) {
        await el.requestFullscreen()
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        o.lock?.('landscape').catch(() => {})
      } else v.webkitEnterFullscreen?.()
    } catch {
      v.webkitEnterFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const showFlash = (s: string, ms = 600) => {
    setFlash(s)
    setTimeout(() => setFlash((f) => (f === s ? null : f)), ms)
  }

  // ---------- controls visibility ----------

  const hideTimer = useRef<number>(0)
  const poke = useCallback(() => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) {
        setControls(false)
        setMenu(null)
      }
    }, 3000)
  }, [])
  useEffect(() => {
    if (paused) setControls(true)
    else poke()
  }, [paused, poke])

  // ---------- keyboard ----------

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const v = videoRef.current
      if (!v) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
        case 'j':
          seek(time - 10)
          showFlash('-10s')
          break
        case 'ArrowRight':
        case 'l':
          seek(time + 10)
          showFlash('+10s')
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume((x) => Math.min(1, x + 0.1))
          setMuted(false)
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume((x) => Math.max(0, x - 0.1))
          break
        case 'm':
          setMuted((m) => !m)
          break
        case 'f':
          toggleFullscreen()
          break
        case 'c': {
          const subs = info?.subtitles?.filter((s) => s.url) || []
          const i = subs.findIndex((s) => s.index === subIndex)
          const nextSub = i + 1 < subs.length ? subs[i + 1].index : -1
          setSubIndex(nextSub)
          selRef.current.sub = nextSub
          showFlash(nextSub < 0 ? 'Subtitles off' : subs[i + 1].label)
          break
        }
        case 'a': {
          const list = info?.audioTracks || []
          if (list.length < 2) break
          const i = list.findIndex((x) => x.index === info?.audioIndex)
          const n = list[(i + 1) % list.length]
          showFlash(n.label, 1500)
          chooseAudio(n.index)
          break
        }
        case 'n':
          if (next) goNext(next.id)
          break
        case 'Escape':
          if (menu) setMenu(null)
          else if (partyOpen) setPartyOpen(false)
          else if (!document.fullscreenElement) onExit()
          break
        default:
          return
      }
      poke()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [time, seek, togglePlay, toggleFullscreen, info, subIndex, next, goNext, onExit, menu, poke, partyOpen])

  // ---------- chapters / intro / up next ----------

  const chapters = info?.chapters || []
  const intro = chapters.find((c) => /intro|opening|recap|^op$/i.test(c.title) && time >= c.start && time < c.end - 1)
  // End credits: a chapter from the file, else what the server found by looking at the picture.
  const credits = useMemo(() => {
    const ch = chapters.find((c) => /credits|ending|^ed$|outro/i.test(c.title) && c.start > duration * 0.5)
    if (ch) return { start: ch.start, end: ch.end }
    const m = info?.media
    return m?.creditsStart ? { start: m.creditsStart, end: m.creditsEnd || duration } : null
  }, [chapters, info?.media, duration])
  const inCredits = !!credits && time >= credits.start && time < credits.end - 2
  const creditsSkipped = useRef(false)
  useEffect(() => {
    creditsSkipped.current = false
  }, [itemId])
  useEffect(() => {
    if (inCredits && next && prefs.skipCredits && !creditsSkipped.current && !paused) {
      creditsSkipped.current = true
      goNext(next.id)
    }
  }, [inCredits, next, prefs.skipCredits, paused, goNext])
  // Movies: skip to after the credits (a post-credits scene) or finish.
  const skipCredits = () => {
    if (!credits) return
    if (next) return goNext(next.id)
    if (duration - credits.end > 10) return seek(credits.end)
    const i = infoRef.current
    if (i) post('/api/playback/progress', { sessionId: i.sessionId, itemId: i.item.id, position: duration, paused: true }).catch(() => null).finally(onExit)
    else onExit()
  }
  const introSkipped = useRef<number | null>(null)
  useEffect(() => {
    if (intro && prefs.skipIntro && introSkipped.current !== intro.start) {
      introSkipped.current = intro.start
      seek(intro.end)
    }
  }, [intro, prefs.skipIntro, seek])

  useEffect(() => {
    if (!next || upNextDismissed || !duration || !prefs.autoplayNext) return
    const triggerAt = credits && credits.start > duration * 0.7 ? credits.start : duration - 20
    if (time >= triggerAt && upNext === null && !paused) setUpNext(10)
  }, [time, next, duration, credits, upNext, upNextDismissed, paused, prefs.autoplayNext])

  useEffect(() => {
    if (upNext === null) return
    if (upNext <= 0) {
      if (next) goNext(next.id)
      return
    }
    const t = setTimeout(() => setUpNext((n) => (n === null ? null : n - 1)), 1000)
    return () => clearTimeout(t)
  }, [upNext, next, goNext])

  // ---------- media session (lock screen controls) ----------

  useEffect(() => {
    if (!info || !('mediaSession' in navigator)) return
    const it = info.item
    const art = landscapeUrl(it, 512)
    // The OS fetches artwork without our cookie (e.g. Firefox on Android), so pass the media token.
    const src = art && new URL(art, location.origin).toString() + `&t=${encodeURIComponent(info.token)}`
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.title,
      artist: it.seriesTitle ? `${it.seriesTitle} · ${episodeLabel(it)}` : it.year ? String(it.year) : '',
      artwork: src ? [{ src, sizes: '512x288', type: 'image/jpeg' }] : [],
    })
  }, [info])

  // Separate from the metadata above: `time` changes several times a second, and resetting
  // the metadata that often makes the browser refetch the artwork each time.
  useEffect(() => {
    if (!info || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', userPlay)
    ms.setActionHandler('pause', userPause)
    ms.setActionHandler('seekbackward', () => seek(time - 10))
    ms.setActionHandler('seekforward', () => seek(time + 10))
    ms.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime))
    ms.setActionHandler('nexttrack', next ? () => goNext(next.id) : null)
  }, [info, seek, time, next, goNext, userPlay, userPause])

  // ---------- watch together ----------

  // Apply what the room says: same item, same play/pause, same position (within a second or two).
  const seenVersion = useRef(0)
  useEffect(() => {
    const st = party?.state
    const v = videoRef.current
    if (!party || !st || !v || !infoRef.current) return
    if (st.itemId !== itemId) {
      onNext(st.itemId)
      return
    }
    const fresh = party.stateVersion !== seenVersion.current
    seenVersion.current = party.stateVersion
    const target = partyPosition(st, party.offset)
    // While the stream is still starting, wait: this effect runs again once it's playing.
    // Playing: small drift is fine. Paused: line up exactly (a local seek, cheap).
    if (!loading && Math.abs(nowAbs() - target) > (st.playing ? 1.5 : 0.3)) seek(target, false)
    if (st.playing && v.paused) {
      v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true))
    } else if (!st.playing && !v.paused) {
      v.pause()
    }
    if (fresh && st.by && st.by !== (me.displayName || me.username) && st.action && st.action !== 'item') {
      showFlash(`${st.by} ${{ play: 'pressed play', pause: 'paused', seek: 'jumped to ' + formatTime(st.position) }[st.action]}`, 2200)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.stateVersion, !!info, loading])

  // Gently pull back into sync if this device drifts (slow network, buffering).
  const lastCorrect = useRef(0)
  useEffect(() => {
    if (!party) return
    const t = setInterval(() => {
      const st = partyRef.current?.state
      const v = videoRef.current
      if (!st || !v || !st.playing || v.paused || loadingRef.current || Date.now() - lastCorrect.current < 15_000) return
      const target = partyPosition(st, partyRef.current!.offset)
      if (Math.abs(nowAbs() - target) > 3) {
        lastCorrect.current = Date.now()
        seek(target, false)
      }
    }, 4000)
    return () => clearInterval(t)
  }, [!!party, seek, nowAbs])

  useEffect(() => {
    if (party?.ended) {
      toast('The watch party has ended', 'info')
      onLeaveParty?.()
    }
  }, [party?.ended, onLeaveParty])

  // ---------- casting ----------

  const startCast = async () => {
    try {
      if (!castState.connected) await requestCast()
      const i = infoRef.current
      if (!i) return
      const p = await post<PlaybackInfo>('/api/playback/start', {
        itemId, profile: chromecastProfile(), startTime: time, audioIndex: selRef.current.audio, subtitleIndex: selRef.current.sub, device: 'Chromecast',
      })
      const abs = (u: string) => new URL(u, location.origin).toString()
      const img = landscapeUrl(p.item, 1280)
      await castLoad({
        url: abs(p.url),
        mimeType: p.mimeType,
        hls: p.method !== 'direct',
        title: p.item.title,
        subtitle: p.item.seriesTitle ? `${p.item.seriesTitle} · ${episodeLabel(p.item)}` : '',
        image: img ? abs(img) + `&t=${encodeURIComponent(p.token)}` : undefined,
        startTime: p.method === 'direct' ? p.startTime : 0,
        subtitles: (p.subtitles || []).filter((s) => s.url).map((s) => ({ index: s.index, label: s.label, language: s.language, url: abs(s.url!) })),
        activeSubtitle: p.subtitleIndex,
      })
      videoRef.current?.pause()
      setCasting(true)
    } catch (e) {
      if (e && (e as { code?: string }).code !== 'cancel') setError('Casting failed: ' + ((e as Error).message || String(e)))
    }
  }

  // ---------- render ----------

  const pct = duration ? (time / duration) * 100 : 0
  const bufPct = duration ? (bufferedEnd / duration) * 100 : 0
  const item = info?.item
  const subs = info?.subtitles || []
  const audios = info?.audioTracks || []
  const subStyle = { small: 'text-lg md:text-2xl', medium: 'text-xl md:text-[2rem]', large: 'text-2xl md:text-[2.6rem]' }[prefs.subtitleSize]
  const shown = subIndex >= 0 ? activeCues(cues, time) : []

  const barRef = useRef<HTMLDivElement>(null)
  const posFromEvent = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    return { x: f * r.width, t: f * duration }
  }
  const dragging = useRef(false)

  const lastTap = useRef(0)
  const onSurfaceClick = (e: React.MouseEvent) => {
    const touch = matchMedia('(pointer: coarse)').matches
    if (!touch) {
      togglePlay()
      poke()
      return
    }
    const now = Date.now()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const third = (e.clientX - r.left) / r.width
    if (now - lastTap.current < 300) {
      if (third < 0.35) {
        seek(time - 10)
        showFlash('-10s')
      } else if (third > 0.65) {
        seek(time + 10)
        showFlash('+10s')
      }
      lastTap.current = 0
      return
    }
    lastTap.current = now
    setTimeout(() => {
      if (lastTap.current === now) {
        if (controls) setControls(false)
        else poke()
      }
    }, 300)
  }

  return (
    <div
      ref={wrapRef}
      className={`fixed inset-0 bg-black select-none ${controls ? '' : 'cursor-none'}`}
      onMouseMove={poke}
      onTouchStart={() => controls && poke()}
    >
      <video ref={videoRef} className="absolute inset-0 size-full" playsInline preload="auto" crossOrigin="anonymous" />

      {/* Subtitles */}
      {shown.length > 0 && (
        <div className={`absolute inset-x-0 flex flex-col items-center px-6 pointer-events-none transition-all ${controls ? 'bottom-28 md:bottom-32' : 'bottom-10 md:bottom-14'}`}>
          {shown.map((c, i) => (
            <div
              key={i}
              className={`${subStyle} font-semibold text-center leading-snug whitespace-pre-line max-w-5xl ${prefs.subtitleBackground ? 'bg-black/75 px-3 py-1 rounded-md' : ''}`}
              style={{ textShadow: prefs.subtitleBackground ? 'none' : '0 0 4px #000, 0 0 8px #000, 2px 2px 3px #000' }}
              dangerouslySetInnerHTML={{ __html: c.text.replace(/</g, '&lt;').replace(/&lt;(\/?[ib])>/g, '<$1>') }}
            />
          ))}
        </div>
      )}

      {/* Tap surface */}
      <div className="absolute inset-0" onClick={onSurfaceClick} onDoubleClick={(e) => !matchMedia('(pointer: coarse)').matches && (e.preventDefault(), toggleFullscreen())} />

      {(loading || waiting) && !error && !casting && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <Spinner className="size-14" />
        </div>
      )}

      {flash && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="px-5 py-2.5 rounded-full bg-black/60 backdrop-blur text-lg font-semibold fade-in">{flash}</div>
        </div>
      )}

      {casting && (
        <div className="absolute inset-0 grid place-items-center bg-black/80">
          <div className="text-center">
            <Cast className="size-14 mx-auto mb-4 text-accent" />
            <div className="text-xl font-bold mb-1">Playing on {castState.deviceName || 'Chromecast'}</div>
            <div className="text-muted mb-6">{item?.title}</div>
            <button
              className="btn-ghost"
              onClick={() => {
                endCast()
                setCasting(false)
                start({ startTime: time })
              }}
            >
              Stop casting
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6">
          <div className="card p-6 max-w-md text-center">
            <div className="font-bold text-lg mb-2">Playback problem</div>
            <p className="text-muted text-sm mb-5">{error}</p>
            <div className="flex gap-3 justify-center">
              <button className="btn-ghost" onClick={onExit}>Back</button>
              <button className="btn-primary" onClick={() => { retries.current = 0; start({ startTime: time }) }}>Try again</button>
            </div>
          </div>
        </div>
      )}

      {/* Skip intro / credits */}
      {intro && !prefs.skipIntro && (
        <button onClick={() => seek(intro.end)} className="absolute right-4 bottom-32 md:right-10 md:bottom-36 btn-primary !rounded-xl fade-in z-10">
          Skip intro <SkipForward className="size-4" />
        </button>
      )}
      {inCredits && upNext === null && !intro && (
        <button onClick={skipCredits} className="absolute right-4 bottom-32 md:right-10 md:bottom-36 btn-primary !rounded-xl fade-in z-10">
          {next ? 'Next episode' : 'Skip credits'} <SkipForward className="size-4" />
        </button>
      )}

      {/* Autoplay was blocked when joining a party that's already playing */}
      {needTap && !error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/50" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { const st = party?.state; if (st) seek(partyPosition(st, party!.offset), false); videoRef.current?.play().then(() => setNeedTap(false)).catch(() => {}) }} className="btn-primary !h-14 !px-8 !text-base">
            <Play className="size-5 fill-current" /> Join the party
          </button>
        </div>
      )}

      {/* Up next */}
      {upNext !== null && next && (
        <div className="absolute right-4 bottom-28 md:right-10 md:bottom-32 z-10 w-72 max-w-[calc(100%-2rem)] rounded-2xl bg-surface/95 backdrop-blur-xl border border-line overflow-hidden fade-in shadow-2xl">
          <div className="relative aspect-video">
            <img src={landscapeUrl(next, 320)} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
            <div className="absolute bottom-2 left-3 right-3">
              <div className="text-xs text-white/70">Up next in {upNext}s</div>
              <div className="font-semibold truncate">{episodeLabel(next)} · {next.title}</div>
            </div>
          </div>
          <div className="flex gap-2 p-2">
            <button className="btn-ghost !h-9 flex-1" onClick={() => { setUpNext(null); setUpNextDismissed(true) }}>Cancel</button>
            <button className="btn-primary !h-9 flex-1" onClick={() => goNext(next.id)}>Play now</button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className={`absolute top-0 inset-x-0 p-4 md:p-6 flex items-start gap-3 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${controls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button onClick={onExit} className="icon-btn" aria-label="Back"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 pt-1 flex-1">
          <div className="font-semibold text-[17px] truncate">{item?.seriesTitle || item?.title}</div>
          {item?.seriesTitle && <div className="text-sm text-white/65 truncate">{episodeLabel(item)} · {item.title}</div>}
        </div>
        {party ? (!partyOpen &&
          <button onClick={(e) => { e.stopPropagation(); setPartyOpen((o) => !o) }} className={`btn-ghost !h-11 !px-4 ${partyOpen ? '!bg-white !text-black' : ''}`} aria-label="Watch together">
            <Users className="size-5" /> <span className="tabular-nums">{party.members.length || 1}</span>
          </button>
        ) : onStartParty && (
          <button onClick={(e) => { e.stopPropagation(); onStartParty(nowAbs()) }} className="icon-btn" aria-label="Watch together" title="Watch together">
            <Users className="size-5" />
          </button>
        )}
      </div>

      {party && <PartyOverlay party={party} open={partyOpen} />}
      {party && partyOpen && <PartyPanel party={party} itemId={itemId} onClose={() => setPartyOpen(false)} onLeave={() => { setPartyOpen(false); onLeaveParty?.() }} />}

      {/* Centre controls on touch screens */}
      <div className={`absolute inset-0 hidden pointer-coarse:flex items-center justify-center gap-10 pointer-events-none transition-opacity duration-300 ${controls && !loading && !waiting && !error && !casting && !needTap ? 'opacity-100' : 'opacity-0'}`}>
        <button onClick={(e) => { e.stopPropagation(); seek(time - 10); poke() }} className={`size-14 rounded-full grid place-items-center bg-black/35 backdrop-blur-sm ${controls ? 'pointer-events-auto' : ''}`} aria-label="Back 10 seconds"><RotateCcw className="size-7" /></button>
        <button onClick={(e) => { e.stopPropagation(); togglePlay(); poke() }} className={`size-[72px] rounded-full grid place-items-center bg-black/40 backdrop-blur-sm ${controls ? 'pointer-events-auto' : ''}`} aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? <Play className="size-9 fill-current ml-1" /> : <Pause className="size-9 fill-current" />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); seek(time + 10); poke() }} className={`size-14 rounded-full grid place-items-center bg-black/35 backdrop-blur-sm ${controls ? 'pointer-events-auto' : ''}`} aria-label="Forward 10 seconds"><RotateCw className="size-7" /></button>
      </div>

      {/* Bottom controls */}
      <div className={`absolute bottom-0 inset-x-0 px-4 md:px-8 pb-4 md:pb-6 pt-16 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 ${controls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {/* Seek bar */}
        <div
          ref={barRef}
          className="relative h-6 flex items-center cursor-pointer group touch-none"
          onPointerDown={(e) => {
            dragging.current = true
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            setHover(posFromEvent(e.clientX))
          }}
          onPointerMove={(e) => setHover(posFromEvent(e.clientX))}
          onPointerUp={(e) => {
            if (dragging.current) seek(posFromEvent(e.clientX).t)
            dragging.current = false
            if (e.pointerType !== 'mouse') setHover(null)
          }}
          onPointerLeave={() => !dragging.current && setHover(null)}
        >
          <div className="relative w-full h-1 group-hover:h-1.5 transition-all rounded-full bg-white/20 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufPct}%` }} />
            {offset > 0 && <div className="absolute inset-y-0 left-0 bg-white/10" style={{ width: `${(offset / duration) * 100}%` }} />}
            <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${(hover && dragging.current ? hover.t / duration : pct / 100) * 100}%` }} />
          </div>
          {chapters.map((c, i) => i > 0 && duration > 0 && <div key={i} className="absolute h-1.5 w-0.5 bg-black/60" style={{ left: `${(c.start / duration) * 100}%` }} />)}
          {credits && duration > 0 && <div className="absolute h-1 rounded-r-full bg-white/25 pointer-events-none" style={{ left: `${(credits.start / duration) * 100}%`, width: `${((credits.end - credits.start) / duration) * 100}%` }} title="Credits" />}
          <div className="absolute size-3.5 rounded-full bg-white shadow -translate-x-1/2 scale-0 group-hover:scale-100 transition" style={{ left: `${pct}%` }} />
          {hover && (
            <div className="absolute bottom-7 -translate-x-1/2 flex flex-col items-center pointer-events-none" style={{ left: Math.max(trick.width / 2 || 30, Math.min(hover.x, (barRef.current?.clientWidth || 0) - (trick.width / 2 || 30))) }}>
              {trick.ready && trick.thumb(hover.t) && <div className="rounded-lg ring-2 ring-white/80 shadow-2xl mb-1.5 bg-black scale-75 md:scale-100 origin-bottom" style={trick.thumb(hover.t)!} />}
              <div className="px-2 py-0.5 rounded bg-black/80 text-xs font-semibold tabular-nums">
                {formatTime(hover.t)}
                {chapters.length > 0 && (() => { const c = chapters.find((x) => hover.t >= x.start && hover.t < x.end); return c?.title ? ` · ${c.title}` : '' })()}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 md:gap-2 mt-1">
          <button onClick={togglePlay} className="icon-btn !bg-transparent hover:!bg-white/10 pointer-coarse:hidden" aria-label={paused ? 'Play' : 'Pause'}>
            {paused ? <Play className="size-6 fill-current" /> : <Pause className="size-6 fill-current" />}
          </button>
          <button onClick={() => seek(time - 10)} className="icon-btn !bg-transparent hover:!bg-white/10 pointer-coarse:hidden" aria-label="Back 10 seconds"><RotateCcw className="size-5" /></button>
          <button onClick={() => seek(time + 30)} className="icon-btn !bg-transparent hover:!bg-white/10 pointer-coarse:hidden" aria-label="Forward 30 seconds"><RotateCw className="size-5" /></button>
          {next && <button onClick={() => goNext(next.id)} className="icon-btn !bg-transparent hover:!bg-white/10" aria-label="Next episode" title="Next episode (N)"><SkipForward className="size-5" /></button>}
          <div className="hidden sm:flex items-center group/vol">
            <button onClick={() => setMuted((m) => !m)} className="icon-btn !bg-transparent hover:!bg-white/10" aria-label="Mute">
              {muted || volume === 0 ? <VolumeX className="size-5" /> : volume < 0.5 ? <Volume1 className="size-5" /> : <Volume2 className="size-5" />}
            </button>
            <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} onChange={(e) => { setVolume(+e.target.value); setMuted(false) }} className="range w-0 opacity-0 group-hover/vol:w-24 group-hover/vol:opacity-100 transition-all" aria-label="Volume" />
          </div>
          <div className="text-sm tabular-nums text-white/90 ml-1 md:ml-2 whitespace-nowrap">
            {formatTime(time)} <span className="text-white/50">/ {formatTime(duration)}</span>
          </div>

          <div className="ml-auto flex items-center gap-0.5 md:gap-1 relative">
            {subs.length > 0 && <CtrlBtn label="Subtitles (C)" active={menu === 'subs'} onClick={() => setMenu(menu === 'subs' ? null : 'subs')}><Subtitles className={`size-5 ${subIndex >= 0 ? 'text-accent' : ''}`} /></CtrlBtn>}
            {audios.length > 0 && <CtrlBtn label="Audio (A)" active={menu === 'audio'} onClick={() => setMenu(menu === 'audio' ? null : 'audio')}><AudioLines className={`size-5 ${audios.length > 1 ? 'text-accent' : ''}`} /></CtrlBtn>}
            <CtrlBtn label="Quality" active={menu === 'quality'} onClick={() => setMenu(menu === 'quality' ? null : 'quality')}><Settings2 className="size-5" /></CtrlBtn>
            <CtrlBtn label="Speed" active={menu === 'speed'} onClick={() => setMenu(menu === 'speed' ? null : 'speed')}><Gauge className="size-5" /></CtrlBtn>
            <span className="hidden sm:contents"><CtrlBtn label="Playback info" active={menu === 'info'} onClick={() => setMenu(menu === 'info' ? null : 'info')}><Info className="size-5" /></CtrlBtn></span>
            {castState.available && <CtrlBtn label="Cast" onClick={startCast}><Cast className={`size-5 ${castState.connected ? 'text-accent' : ''}`} /></CtrlBtn>}
            {'pictureInPictureEnabled' in document && document.pictureInPictureEnabled && (
              <CtrlBtn label="Picture in picture" onClick={() => { const pr = document.pictureInPictureElement ? document.exitPictureInPicture() : videoRef.current?.requestPictureInPicture(); pr?.catch(() => {}) }}><PictureInPicture2 className="size-5" /></CtrlBtn>
            )}
            <CtrlBtn label="Fullscreen (F)" onClick={toggleFullscreen}>{fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</CtrlBtn>

            {menu && (
              <div className="absolute bottom-14 right-0 w-[min(88vw,340px)] max-h-[60vh] overflow-y-auto rounded-2xl border border-line bg-surface/95 backdrop-blur-xl p-2 shadow-2xl fade-in" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center px-2 pb-1">
                  <span className="text-xs uppercase tracking-wide text-muted font-semibold">{{ subs: 'Subtitles', audio: 'Audio', quality: 'Quality', speed: 'Playback speed', info: 'Playback info' }[menu]}</span>
                  <button className="ml-auto p-1 text-muted hover:text-white" onClick={() => setMenu(null)}><X className="size-4" /></button>
                </div>
                {menu === 'subs' && (
                  <>
                    <Opt on={subIndex < 0} onClick={() => chooseSubtitle(-1)}>Off</Opt>
                    {subs.map((s) => (
                      <Opt key={s.index} on={subIndex === s.index} onClick={() => chooseSubtitle(s.index)}>
                        {s.label}{!s.url && <span className="text-xs text-muted"> · image (converts video)</span>}
                      </Opt>
                    ))}
                  </>
                )}
                {menu === 'audio' && (
                  <>
                    {audios.map((a) => <Opt key={a.index} on={info?.audioIndex === a.index} onClick={() => info?.audioIndex !== a.index ? chooseAudio(a.index) : setMenu(null)}>{a.label}</Opt>)}
                    {audios.length === 1 && <div className="px-3 pt-2 pb-1 text-xs text-muted">This file has only one audio track.</div>}
                  </>
                )}
                {menu === 'quality' && (
                  <>
                    {qualityOptions.map((q) => <Opt key={q.value} on={prefs.quality === q.value} onClick={() => chooseQuality(q.value)}>{q.label}</Opt>)}
                  </>
                )}
                {menu === 'speed' && SPEEDS.map((s) => (
                  <Opt key={s} on={speed === s} onClick={() => { setSpeed(s); if (videoRef.current) videoRef.current.playbackRate = s; setMenu(null) }}>{s === 1 ? 'Normal' : `${s}×`}</Opt>
                ))}
                {menu === 'info' && info && <PlaybackStats info={info} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CtrlBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} title={label} aria-label={label} className={`icon-btn !size-10 md:!size-11 ${active ? '!bg-white/20' : '!bg-transparent hover:!bg-white/10'}`}>
      {children}
    </button>
  )
}

function Opt({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-2.5 rounded-xl text-sm flex items-center gap-2 ${on ? 'bg-white/[.1] text-white' : 'hover:bg-white/[.06] text-white/85'}`}>
      <span className={`size-1.5 rounded-full shrink-0 ${on ? 'bg-white' : 'bg-transparent'}`} />
      <span className="min-w-0">{children}</span>
    </button>
  )
}

function PlaybackStats({ info }: { info: PlaybackInfo }) {
  const d = info.decision
  const m = info.media
  const label = useMemo(() => ({ direct: 'Direct play — original file', remux: 'Direct stream — video untouched', transcode: 'Transcoding' } as Record<string, string>)[d.method], [d.method])
  return (
    <div className="px-2 pb-2 text-sm space-y-2">
      <div className={`font-semibold ${d.method === 'transcode' ? 'text-amber-300' : 'text-emerald-300'}`}>{label}</div>
      <div className="text-white/80">
        Source: {m.videoCodec.toUpperCase()} {m.width}×{m.height}{m.hdr ? ` ${m.hdr.toUpperCase()}` : ''} · {(m.bitrate / 1e6).toFixed(1)} Mbps · {m.container.toUpperCase()}
      </div>
      {d.method === 'transcode' && <div className="text-white/80">Output: {(d.videoCodec || 'h264').toUpperCase()} {d.width}×{d.height} · {(d.videoKbps / 1000).toFixed(1)} Mbps{d.toneMap ? ' · HDR→SDR' : ''}</div>}
      {d.method !== 'direct' && <div className="text-white/80">Audio: {d.audioCopy ? 'original' : `${(d.audioCodec || 'aac').toUpperCase()} ${d.audioChannels}ch ${d.audioKbps} kbps`}</div>}
      {d.reasons && d.reasons.length > 0 && (
        <ul className="text-xs text-muted list-disc pl-4 space-y-0.5">
          {d.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </div>
  )
}
