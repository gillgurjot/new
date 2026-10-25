import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import Video, { SelectedTrackType, type OnLoadData, type OnProgressData, type VideoRef } from 'react-native-video'
import { File } from 'expo-file-system'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowLeft, AudioLines, Captions, Check, Expand, Gauge, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Shrink, SkipForward, Users, X,
} from 'lucide-react-native'
import { ApiError, abs, api, authHeaders, landscapePath, post } from '../api/client'
import type { Item, PlaybackInfo } from '../api/types'
import { useUser } from '../lib/auth'
import { type Download, queueProgress, saveOfflinePosition, useDownloads } from '../lib/downloads'
import { episodeLabel, formatTime } from '../lib/format'
import { getPrefs, qualityOptions, setPrefs, usePrefs } from '../lib/prefs'
import { deviceProfile, safeProfile } from '../lib/profile'
import { FONT, alpha, makeStyles, useTheme } from '../theme'
import { Text } from '../components/ui'
import { LoadingIndicator, Shape, usePressScale } from '../components/expressive'
import { haptic } from '../lib/haptics'
import Animated from 'react-native-reanimated'
import { PartyOverlay, PartyPanel } from './PartyPanel'
import { partyPosition, useParty } from './party'
import SeekBar, { useTrickplay } from './SeekBar'
import { activeCues, parseVTT, type Cue } from './vtt'
import * as Network from 'expo-network'

interface Props {
  itemId: number
  startTime?: number
  /** Play this downloaded copy instead of streaming. */
  download?: Download
  partyId?: string | null
  partyPanel?: boolean
  onExit: () => void
  onNext: (id: number) => void
  onStartParty: (position: number) => void
  onLeaveParty: () => void
}

interface StartOpts {
  startTime?: number
  audioIndex?: number | null
  subtitleIndex?: number
  quality?: string
  /** The phone's decoder failed: have the server convert everything. */
  safe?: boolean
}

type Menu = null | 'subs' | 'audio' | 'settings'
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** A playback "session" for a file on the phone, shaped like the server's. */
function localInfo(d: Download, start: number, audioLang: string): PlaybackInfo {
  const m = d.item.media!
  const ud = d.item.userData
  const remembered = d.audio.find((a) => a.index === ud?.audioIndex)
  const preferred = d.audio.find((a) => audioLang && a.language === audioLang)
  const def = m.streams.find((s) => s.type === 'audio' && s.default)
  const audioIndex = (remembered || preferred)?.index ?? def?.index ?? d.audio[0]?.index ?? null
  const sub = d.subs.find((s) => s.index === ud?.subtitleIndex)
  return {
    sessionId: '', method: 'direct', url: d.file, mimeType: '', startOffset: 0, startTime: start,
    duration: m.duration || d.item.duration || 0,
    decision: { method: 'direct', reasons: null, videoCopy: true, audioCopy: true, width: m.width, height: m.height, videoKbps: 0, audioKbps: 0, audioChannels: 0, toneMap: false },
    token: '', audioIndex,
    audioTracks: d.audio.map((a) => ({ index: a.index, label: a.label, language: a.language, codec: '', channels: 0 })),
    subtitles: d.subs.map((s) => ({ index: s.index, label: s.label, language: s.language, codec: 'webvtt', forced: false, default: false, external: false, url: s.file })),
    subtitleIndex: sub ? sub.index : -1,
    chapters: m.chapters || [], item: d.item, media: m,
  }
}

export default function Player({ itemId, startTime, download, partyId, partyPanel, onExit, onNext, onStartParty, onLeaveParty }: Props) {
  const me = useUser()
  const prefs = usePrefs()
  const { pc: c } = useTheme()
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const local = !!download
  const video = useRef<VideoRef>(null)
  const infoRef = useRef<PlaybackInfo | null>(null)
  const selRef = useRef<{ audio: number | null; sub: number }>({ audio: null, sub: -1 })
  const retries = useRef(0)
  const restarting = useRef(false)
  const cur = useRef(0) // player-local seconds
  const seekable = useRef(0)
  const pausedRef = useRef(false)
  const safeMode = useRef(false) // a decoder failed on this title; stay converted

  const [info, setInfo] = useState<PlaybackInfo | null>(null)
  const [seekTo, setSeekTo] = useState(0) // where a direct-play source starts
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadingRef = useRef(true)
  loadingRef.current = loading
  const [buffering, setBuffering] = useState(false)
  const [paused, setPausedState] = useState(false)
  const [time, setTime] = useState(startTime || 0)
  const [buffered, setBuffered] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [fill, setFill] = useState(false)
  const [controls, setControls] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [menu, setMenu] = useState<Menu>(null)
  const [subIndex, setSubIndex] = useState(-1)
  const [cues, setCues] = useState<Cue[]>([])
  const [exoAudio, setExoAudio] = useState<{ index: number }[]>([])
  const [audioSel, setAudioSel] = useState<number | null>(null) // server stream index playing
  const [next, setNext] = useState<Item | null>(null)
  const [upNext, setUpNext] = useState<number | null>(null)
  const [upNextDismissed, setUpNextDismissed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [pip, setPip] = useState(false)
  const party = useParty(partyId || null)
  const partyRef = useRef(party)
  partyRef.current = party
  const [partyOpen, setPartyOpen] = useState(!!partyPanel)
  useEffect(() => {
    if (partyId && partyPanel) setPartyOpen(true) // just started one: show the invite link
  }, [partyId, partyPanel])
  const downloads = useDownloads()
  const trick = useTrickplay(local ? undefined : info?.trickplay, info?.media.id)

  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p
    setPausedState(p)
  }, [])

  const offset = info && info.method !== 'direct' ? info.startOffset : 0
  const duration = info?.duration || 0
  const nowAbs = useCallback(() => {
    const i = infoRef.current
    return (i && i.method !== 'direct' ? i.startOffset : 0) + cur.current
  }, [])

  const showFlash = useCallback((s: string, ms = 700) => {
    setFlash(s)
    setTimeout(() => setFlash((f) => (f === s ? null : f)), ms)
  }, [])

  // ---------- progress ----------

  const report = useCallback(async (stop = false) => {
    const i = infoRef.current
    if (!i || restarting.current) return null
    const body = { sessionId: i.sessionId, itemId: i.item.id, position: nowAbs(), paused: pausedRef.current, audioIndex: selRef.current.audio, subtitleIndex: selRef.current.sub }
    if (local) {
      saveOfflinePosition(i.item.id, body.position)
      if (body.position < 1) return null
      return post<{ played: boolean }>('/api/playback/progress', body).catch(() => {
        queueProgress(i.item.id, body.position)
        return null
      })
    }
    if (stop) return post('/api/playback/stop', body).catch(() => null)
    return post<{ played: boolean; sessionAlive: boolean }>('/api/playback/progress', body).catch(() => null)
  }, [local, nowAbs])

  // ---------- session ----------

  const start = useCallback(async (o: StartOpts = {}) => {
    const prev = infoRef.current
    restarting.current = true
    setLoading(true)
    setError('')
    if (local) {
      const p = localInfo(download!, o.startTime ?? startTime ?? download!.position ?? 0, me.audioLang)
      infoRef.current = p
      selRef.current = { audio: p.audioIndex, sub: p.subtitleIndex }
      setInfo(p)
      setSubIndex(p.subtitleIndex)
      setAudioSel(p.audioIndex)
      setSeekTo(p.startTime > 5 && p.startTime < p.duration - 10 ? p.startTime : 0)
      setTime(p.startTime)
      restarting.current = false
      return
    }
    const net = await Network.getNetworkStateAsync().catch(() => null)
    const qv = o.quality ?? (net?.type === Network.NetworkStateType.CELLULAR ? getPrefs().cellularQuality : getPrefs().quality)
    const q = qualityOptions.find((x) => x.value === qv) || qualityOptions[0]
    if (o.safe) safeMode.current = true
    const profile = safeMode.current ? safeProfile() : deviceProfile()
    try {
      const p = await post<PlaybackInfo>('/api/playback/start', {
        itemId,
        profile,
        startTime: o.startTime,
        audioIndex: o.audioIndex !== undefined ? o.audioIndex : prev ? selRef.current.audio : undefined,
        subtitleIndex: o.subtitleIndex !== undefined ? o.subtitleIndex : prev ? selRef.current.sub : undefined,
        maxHeight: q.height,
        maxBitrate: q.kbps,
        replaceSession: prev?.sessionId || '',
        device: profile.name,
      })
      infoRef.current = p
      selRef.current = { audio: p.audioIndex, sub: p.subtitleIndex }
      cur.current = 0
      setInfo(p)
      setSubIndex(p.subtitleIndex)
      setAudioSel(p.audioIndex)
      setSeekTo(p.method === 'direct' ? p.startTime : 0)
      setTime(p.startTime)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t reach Lumen.')
      setLoading(false)
    } finally {
      restarting.current = false
    }
  }, [itemId, local, download, startTime, me.audioLang])

  useEffect(() => {
    infoRef.current = null
    retries.current = 0
    setUpNext(null)
    setUpNextDismissed(false)
    setNext(null)
    start({ startTime })
    const iv = setInterval(async () => {
      if (pausedRef.current) return
      const r = (await report()) as { sessionAlive?: boolean } | null
      const i = infoRef.current
      // The server ends idle conversions; pick up where we are with a new one.
      if (r && r.sessionAlive === false && i && i.method !== 'direct') start({ startTime: nowAbs() })
    }, 10_000)
    return () => {
      clearInterval(iv)
      report(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // Next episode: from the server, or from downloads when playing offline.
  useEffect(() => {
    const it = info?.item
    if (it?.type !== 'episode') return
    api<Item | null>(`/api/items/${it.id}/next`)
      .then(setNext)
      .catch(() => {
        const mine = downloads
          .filter((d) => d.state === 'done' && d.item.seriesId === it.seriesId && d.item.type === 'episode')
          .map((d) => d.item)
          .filter((e) => (e.seasonNumber ?? 0) > (it.seasonNumber ?? 0) || ((e.seasonNumber ?? 0) === (it.seasonNumber ?? 0) && (e.episodeNumber ?? 0) > (it.episodeNumber ?? 0)))
          .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
        setNext(mine[0] || null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.item.id])

  // ---------- subtitles ----------

  useEffect(() => {
    setCues([])
    const t = info?.subtitles?.find((s) => s.index === subIndex)
    if (!t?.url) return
    let alive = true
    const load = t.url.startsWith('file://')
      ? new File(t.url).text()
      : fetch(abs(t.url), { headers: authHeaders() }).then((r) => (r.ok ? r.text() : ''))
    load.then((txt) => alive && setCues(parseVTT(txt))).catch(() => {})
    return () => {
      alive = false
    }
  }, [subIndex, info?.subtitles])

  const chooseSubtitle = (idx: number) => {
    const track = info?.subtitles?.find((s) => s.index === idx)
    const burning = info?.decision.burn != null
    selRef.current.sub = idx
    // Picture-based subtitles are burned in by the server, so switching to/from them restarts the stream.
    if (!local && ((track && !track.url) || burning)) start({ startTime: nowAbs(), subtitleIndex: idx })
    else setSubIndex(idx)
    report()
  }

  // Direct play on Android: switch tracks inside the file. Otherwise ask the server for a new stream.
  const localAudio = !!info && info.method === 'direct' && (local || (!safeMode.current && !!deviceProfile().multiAudio))
  const chooseAudio = (idx: number) => {
    selRef.current.audio = idx
    if (localAudio) {
      setAudioSel(idx)
      report()
    } else {
      start({ startTime: nowAbs(), audioIndex: idx })
    }
  }
  const exoAudioTrack = useMemo(() => {
    if (!localAudio || !info?.audioTracks || audioSel == null || !exoAudio.length) return undefined
    const k = info.audioTracks.findIndex((a) => a.index === audioSel)
    const t = exoAudio[k]
    return t ? { type: SelectedTrackType.INDEX, value: t.index } : undefined
  }, [localAudio, info?.audioTracks, audioSel, exoAudio])

  const chooseQuality = (q: string) => {
    setPrefs({ quality: q })
    start({ startTime: nowAbs(), quality: q })
  }

  const goNext = useCallback((id: number) => {
    const p = partyRef.current
    // Wait for the room to switch first, or the new screen would see the old item and bounce back.
    if (p) p.send('item', 0, id).finally(() => onNext(id))
    else onNext(id)
  }, [onNext])

  // ---------- seeking & play/pause ----------

  const seek = useCallback((target: number, broadcast = true) => {
    const i = infoRef.current
    if (!i) return
    const t = Math.max(0, Math.min(target, (i.duration || target) - 0.5))
    setTime(t)
    if (broadcast) partyRef.current?.send('seek', t)
    if (i.method === 'direct') {
      video.current?.seek(t)
      cur.current = t
      return
    }
    const localT = t - i.startOffset
    // The server deletes segments ~10 min behind the playhead, so jump further back with a new stream.
    const tooFarBack = cur.current - localT > 540
    if (localT >= 0 && localT <= seekable.current - 1 && !tooFarBack) {
      video.current?.seek(localT)
      cur.current = localT
    } else {
      start({ startTime: t })
    }
  }, [start])

  const userPlay = useCallback(() => {
    setPaused(false)
    partyRef.current?.send('play', nowAbs())
  }, [nowAbs, setPaused])
  const userPause = useCallback(() => {
    setPaused(true)
    partyRef.current?.send('pause', nowAbs())
  }, [nowAbs, setPaused])
  const togglePlay = () => (pausedRef.current ? userPlay() : userPause())

  // Tell the server about every play/pause, including ones the party makes.
  const firstPause = useRef(true)
  useEffect(() => {
    if (firstPause.current) {
      firstPause.current = false
      return
    }
    report()
  }, [paused, report])

  // ---------- controls visibility ----------

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poke = useCallback(() => {
    setControls(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!pausedRef.current) setControls(false)
    }, 3500)
  }, [])
  useEffect(() => {
    if (paused || scrubbing || menu) {
      setControls(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    } else poke()
  }, [paused, scrubbing, menu, poke])

  // Double-tap the left or right side to jump 10 seconds.
  const lastTap = useRef<{ t: number; side: 'l' | 'r' } | null>(null)
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSurfaceTap = (x: number) => {
    const side = x < width / 2 ? 'l' : 'r'
    const now = Date.now()
    if (lastTap.current && now - lastTap.current.t < 280 && lastTap.current.side === side) {
      if (singleTap.current) clearTimeout(singleTap.current)
      lastTap.current = null
      seek(nowAbs() + (side === 'l' ? -10 : 10))
      showFlash(side === 'l' ? '−10s' : '+10s')
      return
    }
    lastTap.current = { t: now, side }
    singleTap.current = setTimeout(() => {
      if (menu) setMenu(null)
      else if (controls && !pausedRef.current) setControls(false)
      else poke()
    }, 280)
  }

  // Hardware back: close what's open first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) {
        setMenu(null)
        return true
      }
      if (partyOpen) {
        setPartyOpen(false)
        return true
      }
      onExit()
      return true
    })
    return () => sub.remove()
  }, [menu, partyOpen, onExit])

  // ---------- intro / credits / up next ----------

  const chapters = info?.chapters || []
  // Intro and recap: found by the server (audio fingerprints across a season) or imported
  // from Jellyfin's Intro Skipper; chapter names are the fallback.
  const segments = useMemo(() => {
    const m = info?.media
    const out: { start: number; end: number; label: string }[] = []
    if (m?.recapEnd) out.push({ start: m.recapStart ?? 0, end: m.recapEnd, label: 'Skip recap' })
    if (m?.introEnd) out.push({ start: m.introStart ?? 0, end: m.introEnd, label: 'Skip intro' })
    if (!out.length) {
      for (const ch of chapters) {
        if (/recap|previously/i.test(ch.title)) out.push({ start: ch.start, end: ch.end, label: 'Skip recap' })
        else if (/intro|opening|^op$/i.test(ch.title)) out.push({ start: ch.start, end: ch.end, label: 'Skip intro' })
      }
    }
    return out.filter((x) => x.end - x.start >= 3)
  }, [info?.media, chapters])
  const intro = segments.find((x) => time >= x.start && time < x.end - 1)
  const credits = useMemo(() => {
    const ch = chapters.find((x) => /credits|ending|^ed$|outro/i.test(x.title) && x.start > duration * 0.5)
    if (ch) return { start: ch.start, end: ch.end }
    const m = info?.media
    return m?.creditsStart ? { start: m.creditsStart, end: m.creditsEnd || duration } : null
  }, [chapters, info?.media, duration])
  const inCredits = !!credits && time >= credits.start && time < credits.end - 2
  // "Next episode" only once the credits roll, or in the last 30 seconds when we don't know where they start.
  const showNext = !!next && !!duration && (credits ? inCredits : time >= duration - 30)
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
  const skipCredits = () => {
    if (!credits) return
    if (next) return goNext(next.id)
    if (duration - credits.end > 10) return seek(credits.end)
    cur.current = duration
    report().finally(onExit)
  }
  const introSkipped = useRef<number | null>(null)
  useEffect(() => {
    // Wait until the video has loaded, or the seek is lost and the intro plays anyway.
    if (intro && prefs.skipIntro && !loading && introSkipped.current !== intro.start) {
      introSkipped.current = intro.start
      seek(intro.end)
      showFlash(intro.label === 'Skip recap' ? 'Skipped recap' : 'Skipped intro', 1200)
    }
  }, [intro, prefs.skipIntro, loading, seek, showFlash])

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

  // ---------- watch together ----------

  const seenVersion = useRef(0)
  useEffect(() => {
    const st = party?.state
    if (!party || !st || !infoRef.current) return
    if (st.itemId !== itemId) {
      onNext(st.itemId)
      return
    }
    const fresh = party.stateVersion !== seenVersion.current
    seenVersion.current = party.stateVersion
    const target = partyPosition(st, party.offset)
    if (!loading && Math.abs(nowAbs() - target) > (st.playing ? 1.5 : 0.3)) seek(target, false)
    if (st.playing && pausedRef.current) setPaused(false)
    else if (!st.playing && !pausedRef.current) setPaused(true)
    if (fresh && st.by && st.by !== (me.displayName || me.username) && st.action && st.action !== 'item') {
      showFlash(`${st.by} ${{ play: 'pressed play', pause: 'paused', seek: 'jumped to ' + formatTime(st.position) }[st.action]}`, 2200)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.stateVersion, !!info, loading])

  // Gently pull back into sync if this phone drifts.
  const lastCorrect = useRef(0)
  useEffect(() => {
    if (!party) return
    const t = setInterval(() => {
      const st = partyRef.current?.state
      if (!st || !st.playing || pausedRef.current || loadingRef.current || Date.now() - lastCorrect.current < 15_000) return
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
      showFlash('The watch party has ended', 2500)
      onLeaveParty()
    }
  }, [party?.ended, onLeaveParty, showFlash])

  // ---------- video events ----------

  const onLoad = (d: OnLoadData) => {
    setLoading(false)
    setBuffering(false)
    retries.current = 0
    setExoAudio((d.audioTracks || []).map((t) => ({ index: t.index })))
  }
  const onProgress = (p: OnProgressData) => {
    cur.current = p.currentTime
    seekable.current = p.seekableDuration
    if (!scrubbing) setTime(offset + p.currentTime)
    setBuffered(offset + p.playableDuration)
  }
  const onEnd = async () => {
    await report()
    if (next && getPrefs().autoplayNext) goNext(next.id)
    else if (!next) onExit()
  }
  const onError = () => {
    const i = infoRef.current
    if (!i || local) {
      setError('This file can’t be played on this phone.')
      return
    }
    const at = nowAbs()
    // The phone couldn't decode it (a codec surprise): have the server convert everything.
    if (!safeMode.current) {
      retries.current++
      start({ startTime: at, safe: true })
    } else if (retries.current < 3) {
      retries.current++
      start({ startTime: at })
    } else {
      setError('Playback failed. The server may be busy, or the connection dropped.')
    }
  }

  // ---------- render ----------

  const item = info?.item
  const subs = info?.subtitles || []
  const audios = info?.audioTracks || []
  const shown = subIndex >= 0 ? activeCues(cues, time) : []
  const subSize = { small: 17, medium: 21, large: 27 }[prefs.subtitleSize]
  const imageUri = useMemo(() => {
    if (!item) return undefined
    if (download?.landscape) return download.landscape
    const p = landscapePath(item, 512)
    return p && info?.token ? abs(p) + `&t=${encodeURIComponent(info.token)}` : undefined
  }, [item, download?.landscape, info?.token])

  const source = useMemo(() => {
    if (!info) return undefined
    return {
      uri: local ? info.url : abs(info.url),
      headers: local ? undefined : authHeaders(),
      type: info.method !== 'direct' ? 'm3u8' : undefined,
      startPosition: info.method === 'direct' && seekTo > 0 ? Math.round(seekTo * 1000) : undefined,
      metadata: {
        title: info.item.type === 'episode' ? info.item.title : info.item.title,
        subtitle: info.item.type === 'episode' ? `${info.item.seriesTitle} · ${episodeLabel(info.item)}` : info.item.year ? String(info.item.year) : '',
        imageUri,
      },
      bufferConfig: {
        minBufferMs: 20_000, maxBufferMs: 120_000, bufferForPlaybackMs: 1500, bufferForPlaybackAfterRebufferMs: 3000,
        // Converted streams grow while you watch; don't let the player treat them as live TV.
        live: { minPlaybackSpeed: 1, maxPlaybackSpeed: 1 },
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  const title = item ? (item.type === 'episode' ? item.seriesTitle : item.title) : ''
  const sub = item?.type === 'episode' ? `${episodeLabel(item)} · ${item.title}` : ''
  const showUi = controls && !pip
  const padH = Math.max(insets.left, insets.right, 20)

  return (
    <View style={styles.root}>
      {source && (
        <Video
          key={info?.sessionId || info?.url}
          ref={video}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode={fill ? 'cover' : 'contain'}
          paused={paused}
          rate={speed}
          selectedAudioTrack={exoAudioTrack}
          selectedTextTrack={{ type: SelectedTrackType.DISABLED }}
          onLoad={onLoad}
          onProgress={onProgress}
          onBuffer={({ isBuffering }) => setBuffering(isBuffering)}
          onEnd={onEnd}
          onError={onError}
          onPlaybackStateChanged={({ isPlaying }) => isPlaying && setLoading(false)}
          onPictureInPictureStatusChanged={({ isActive }) => setPip(isActive)}
          progressUpdateInterval={250}
          showNotificationControls
          enterPictureInPictureOnLeave={!paused}
          controls={false}
          controlsStyles={{ hideLiveBadge: true }}
          shutterColor="#000000"
          playInBackground={false}
        />
      )}

      {/* Tap surface */}
      <Pressable style={StyleSheet.absoluteFill} onPress={(e) => onSurfaceTap(e.nativeEvent.locationX)} />

      {/* Subtitles */}
      {shown.length > 0 && (
        <View pointerEvents="none" style={[styles.subs, { bottom: showUi ? 110 : 34 }]}>
          {shown.map((cue, i) => {
            const italic = /<i>/.test(cue.text)
            const text = cue.text.replace(/<\/?[ib]>/g, '')
            return (
              <Text key={i} style={[styles.cue, { fontSize: subSize, lineHeight: subSize * 1.3, fontStyle: italic ? 'italic' : 'normal' }, prefs.subtitleBackground && styles.cueBg]}>
                {text}
              </Text>
            )
          })}
        </View>
      )}

      {party && !pip && <PartyOverlay party={party} open={partyOpen} />}

      {(loading || buffering) && !error && (
        <View pointerEvents="none" style={styles.center}>
          <LoadingIndicator size={64} color={c.accent} />
        </View>
      )}

      {!!flash && (
        <View pointerEvents="none" style={styles.flashWrap}>
          <Text style={styles.flash}>{flash}</Text>
        </View>
      )}

      {/* Controls */}
      {showUi && (
        <>
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.75)', 'transparent']} style={[styles.shade, { top: 0 }]} />
          <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.85)']} style={[styles.shade, { bottom: 0, height: 170 }]} />

          <View style={[styles.top, { paddingLeft: padH, paddingRight: padH }]}>
            <Btn label="Back" onPress={onExit}><ArrowLeft size={24} color={c.fg} /></Btn>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {!!sub && <Text style={styles.subtitle} numberOfLines={1}>{sub}</Text>}
              {local && <Text style={styles.badge}>Downloaded</Text>}
            </View>
            {!local && (
              <Btn label="Watch together" onPress={() => (party ? setPartyOpen((o) => !o) : onStartParty(nowAbs()))} active={!!party}>
                <Users size={22} color={party ? c.onAccent : c.fg} />
                {party && party.members.length > 1 && <Text style={styles.count}>{party.members.length}</Text>}
              </Btn>
            )}
            {audios.length > 0 && <Btn label="Audio" onPress={() => setMenu('audio')}><AudioLines size={22} color={c.fg} /></Btn>}
            <Btn label="Subtitles" onPress={() => setMenu('subs')} active={subIndex >= 0}><Captions size={22} color={subIndex >= 0 ? c.onAccent : c.fg} /></Btn>
            <Btn label="Settings" onPress={() => setMenu('settings')}><Gauge size={22} color={c.fg} /></Btn>
            <Btn label={fill ? 'Fit to screen' : 'Zoom to fill'} onPress={() => setFill((f) => !f)} active={fill}>{fill ? <Shrink size={21} color={c.onAccent} /> : <Expand size={21} color={c.fg} />}</Btn>
            <Btn label="Picture in picture" onPress={() => video.current?.enterPictureInPicture()}><PictureInPicture2 size={21} color={c.fg} /></Btn>
          </View>

          {!loading && !error && (
            <View style={styles.middle} pointerEvents="box-none">
              <Btn label="Back 10 seconds" big onPress={() => { seek(nowAbs() - 10); poke() }}><RotateCcw size={30} color={c.fg} /></Btn>
              <PlayButton paused={paused} onPress={() => { haptic.tick(); togglePlay(); poke() }} />
              <Btn label="Forward 10 seconds" big onPress={() => { seek(nowAbs() + 10); poke() }}><RotateCw size={30} color={c.fg} /></Btn>
            </View>
          )}

          <View style={[styles.bottom, { paddingLeft: padH, paddingRight: padH, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.pills}>
              {intro && <Pill label={intro.label} onPress={() => seek(intro.end)} />}
              {showNext ? <Pill label="Next episode" icon onPress={() => goNext(next!.id)} /> : inCredits && <Pill label="Skip credits" onPress={skipCredits} />}
            </View>
            <SeekBar
              time={time}
              duration={duration}
              buffered={buffered}
              marks={chapters.length > 1 && chapters.length <= 24 ? chapters.slice(1).map((ch) => ch.start) : undefined}
              onSeek={(t) => seek(t)}
              onScrubbing={setScrubbing}
              trick={trick}
            />
          </View>
        </>
      )}

      {/* Skip buttons stay visible with controls hidden */}
      {!showUi && !pip && upNext === null && (intro || inCredits || showNext) && (
        <View style={[styles.floatingPill, { right: padH }]}>
          {intro && <Pill label={intro.label} onPress={() => seek(intro.end)} />}
          {showNext ? <Pill label="Next episode" icon onPress={() => goNext(next!.id)} /> : inCredits && <Pill label="Skip credits" onPress={skipCredits} />}
        </View>
      )}

      {upNext !== null && next && !pip && (
        <View style={[styles.upNext, { right: padH }]}>
          <Text style={styles.upNextLabel}>Next episode in {upNext}</Text>
          <Text style={styles.upNextTitle} numberOfLines={1}>{episodeLabel(next)} · {next.title}</Text>
          <View style={styles.countdown}>
            <View style={[styles.countdownFill, { width: `${((10 - upNext) / 10) * 100}%` }]} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable onPress={() => goNext(next.id)} style={[styles.upBtn, styles.upBtnMain]}>
              <Play size={16} color={c.onAccent} fill={c.onAccent} />
              <Text style={[styles.upBtnText, { color: c.onAccent }]}>Play now</Text>
            </Pressable>
            <Pressable onPress={() => { setUpNext(null); setUpNextDismissed(true) }} style={styles.upBtn}><Text style={styles.upBtnText}>Cancel</Text></Pressable>
          </View>
        </View>
      )}

      {!!error && (
        <View style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.7)', padding: 30 }]}>
          <Text style={styles.errorText}>{error}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => { retries.current = 0; start({ startTime: nowAbs() || time }) }} style={[styles.upBtn, styles.upBtnMain, { paddingHorizontal: 22 }]}><Text style={[styles.upBtnText, { color: c.onAccent }]}>Try again</Text></Pressable>
            <Pressable onPress={onExit} style={[styles.upBtn, { paddingHorizontal: 22 }]}><Text style={styles.upBtnText}>Close</Text></Pressable>
          </View>
        </View>
      )}

      {/* Menus */}
      {menu && (
        <View style={styles.menuWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
          <View style={[styles.menu, { right: Math.max(insets.right, 8) }]}>
            <View style={styles.menuHead}>
              <Text style={styles.menuTitle}>{menu === 'subs' ? 'Subtitles' : menu === 'audio' ? 'Audio' : 'Playback'}</Text>
              <Btn label="Close" onPress={() => setMenu(null)}><X size={22} color={c.fg} /></Btn>
            </View>
            <ScrollView>
              {menu === 'subs' && (
                <>
                  <Opt label="Off" on={subIndex < 0} onPress={() => { chooseSubtitle(-1); setMenu(null) }} />
                  {subs.map((s) => <Opt key={s.index} label={s.label} sub={!s.url ? (local ? 'Not in the download' : 'Picture subtitles · shown in the video') : undefined} on={s.index === subIndex} onPress={() => { chooseSubtitle(s.index); setMenu(null) }} />)}
                  {!subs.length && <Text style={styles.note}>This title has no subtitles{local ? ' saved with the download' : ''}.</Text>}
                  <Text style={styles.section}>Size</Text>
                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
                    {(['small', 'medium', 'large'] as const).map((s) => <Seg key={s} label={s[0].toUpperCase() + s.slice(1)} on={prefs.subtitleSize === s} onPress={() => setPrefs({ subtitleSize: s })} />)}
                  </View>
                  <Opt label="Background behind text" on={prefs.subtitleBackground} onPress={() => setPrefs({ subtitleBackground: !prefs.subtitleBackground })} />
                </>
              )}
              {menu === 'audio' && (
                <>
                  {audios.map((a) => <Opt key={a.index} label={a.label} on={a.index === audioSel} onPress={() => { setMenu(null); if (a.index !== audioSel) { chooseAudio(a.index); showFlash(a.label, 1500) } }} />)}
                  {audios.length === 1 && <Text style={styles.note}>This file has only one audio track.</Text>}
                </>
              )}
              {menu === 'settings' && (
                <>
                  <Text style={styles.section}>Speed</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 }}>
                    {SPEEDS.map((s) => <Seg key={s} label={`${s}×`} on={speed === s} onPress={() => setSpeed(s)} />)}
                  </View>
                  {!local && (
                    <>
                      <Text style={styles.section}>Quality</Text>
                      {qualityOptions.map((q) => <Opt key={q.value} label={q.label} on={prefs.quality === q.value} onPress={() => { setMenu(null); chooseQuality(q.value) }} />)}
                      {info && (
                        <Text style={styles.note}>
                          {info.method === 'direct' ? 'Playing the original file.' : info.method === 'remux' ? 'Original picture, repackaged for this phone.' : `Converted by the server${info.decision.reasons?.length ? ` (${info.decision.reasons[0]})` : ''}.`}
                        </Text>
                      )}
                    </>
                  )}
                  <Opt label="Skip intros automatically" on={prefs.skipIntro} onPress={() => setPrefs({ skipIntro: !prefs.skipIntro })} />
                  <Opt label="Skip credits automatically" on={prefs.skipCredits} onPress={() => setPrefs({ skipCredits: !prefs.skipCredits })} />
                  <Opt label="Autoplay next episode" on={prefs.autoplayNext} onPress={() => setPrefs({ autoplayNext: !prefs.autoplayNext })} />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {party && partyOpen && !pip && item && <PartyPanel party={party} itemId={item.id} onClose={() => setPartyOpen(false)} onLeave={() => { setPartyOpen(false); onLeaveParty() }} />}
    </View>
  )
}

function Btn({ children, onPress, label, big, active }: { children: React.ReactNode; onPress: () => void; label: string; big?: boolean; active?: boolean }) {
  const { pc: c } = useTheme()
  const { style, onPressIn, onPressOut } = usePressScale(0.1)
  const s = big ? 60 : 44
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        hitSlop={6}
        style={({ pressed }) => [
          { width: s, height: s, borderRadius: active ? s * 0.3 : s / 2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
          big && { backgroundColor: 'rgba(0,0,0,0.38)' },
          active && { backgroundColor: c.accent },
          pressed && !active && { backgroundColor: 'rgba(255,255,255,0.16)' },
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}

// The big play/pause: a scalloped Expressive shape while paused, a circle while playing.
function PlayButton({ paused, onPress }: { paused: boolean; onPress: () => void }) {
  const { pc: c } = useTheme()
  const { style, onPressIn, onPressOut } = usePressScale(0.08)
  return (
    <Animated.View style={style}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityLabel={paused ? 'Play' : 'Pause'} accessibilityRole="button" hitSlop={8}>
        <Shape name={paused ? 'cookie9' : 'circle'} size={84} color={c.accentContainer}>
          {paused ? <Play size={36} color={c.onAccentContainer} fill={c.onAccentContainer} style={{ marginLeft: 4 }} /> : <Pause size={34} color={c.onAccentContainer} fill={c.onAccentContainer} />}
        </Shape>
      </Pressable>
    </Animated.View>
  )
}

function Pill({ label, onPress, icon }: { label: string; onPress: () => void; icon?: boolean }) {
  const { pc: c } = useTheme()
  const styles = useStyles()
  const { style, onPressIn, onPressOut } = usePressScale(0.06)
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={() => {
          haptic.tick()
          onPress()
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.pill}
        android_ripple={{ color: alpha(c.onAccent, 0.15) }}
      >
        <SkipForward size={16} color={c.onAccent} fill={icon ? c.onAccent : 'none'} />
        <Text style={styles.pillText}>{label}</Text>
      </Pressable>
    </Animated.View>
  )
}

function Opt({ label, sub, on, onPress }: { label: string; sub?: string; on?: boolean; onPress: () => void }) {
  const { pc: c } = useTheme()
  const styles = useStyles()
  return (
    <Pressable onPress={onPress} android_ripple={{ color: alpha(c.fg, 0.08) }} style={[styles.opt, on && { backgroundColor: c.secondaryContainer }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optText, on && { color: c.onSecondaryContainer, fontWeight: '600' }]}>{label}</Text>
        {!!sub && <Text style={styles.optSub}>{sub}</Text>}
      </View>
      {on && <Check size={18} color={c.onSecondaryContainer} />}
    </Pressable>
  )
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { pc: c } = useTheme()
  const styles = useStyles()
  return (
    <Pressable onPress={onPress} style={[styles.seg, on && { backgroundColor: c.accent, borderRadius: 18 }]}>
      <Text style={[styles.segText, on && { color: c.onAccent }]}>{label}</Text>
    </Pressable>
  )
}

const useStyles = makeStyles((c, f) => ({
  root: { flex: 1, backgroundColor: c.black },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, height: 120 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingTop: 14, gap: 2 },
  title: { ...f.title, fontWeight: '700', color: c.white },
  subtitle: { ...f.small, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  badge: { ...f.labelSmall, color: c.accent, marginTop: 2 },
  count: { ...f.labelSmall, color: c.onAccent, fontWeight: '700', marginLeft: 2 },
  middle: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 48 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  pills: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 8, minHeight: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 20, borderRadius: 24, backgroundColor: c.accent, overflow: 'hidden' },
  pillText: { ...f.label, fontSize: 15, color: c.onAccent },
  floatingPill: { position: 'absolute', bottom: 28, flexDirection: 'row', gap: 8 },
  subs: { position: 'absolute', left: 60, right: 60, alignItems: 'center', gap: 2 },
  cue: { fontFamily: FONT, color: c.white, textAlign: 'center', fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.95)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 }, paddingHorizontal: 8 },
  cueBg: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, textShadowRadius: 0 },
  flashWrap: { position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center' },
  flash: { ...f.label, fontSize: 15, color: c.onInverse, backgroundColor: c.inverse, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, overflow: 'hidden' },
  upNext: { position: 'absolute', bottom: 120, width: 300, padding: 18, borderRadius: 28, backgroundColor: c.surface3 },
  upNextLabel: { ...f.labelSmall, color: c.accent },
  upNextTitle: { ...f.bodyStrong, fontSize: 16, marginTop: 4 },
  countdown: { height: 4, borderRadius: 2, backgroundColor: c.secondaryContainer, marginTop: 12, overflow: 'hidden' },
  countdownFill: { height: '100%', borderRadius: 2, backgroundColor: c.accent },
  upBtn: { height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.secondaryContainer },
  upBtnMain: { backgroundColor: c.accent, flex: 1 },
  upBtnText: { ...f.label, color: c.onSecondaryContainer },
  errorText: { ...f.body, fontSize: 16, textAlign: 'center', marginBottom: 18, maxWidth: 420 },
  menuWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 40, backgroundColor: 'rgba(0,0,0,0.3)' },
  menu: { position: 'absolute', top: 8, right: 8, bottom: 8, width: 340, backgroundColor: c.surface2, borderRadius: 28, paddingTop: 12, overflow: 'hidden' },
  menuHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  menuTitle: { ...f.h2, fontSize: 20 },
  section: { ...f.label, color: c.accent, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  opt: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 52, paddingVertical: 10, marginHorizontal: 8, borderRadius: 26, gap: 10, overflow: 'hidden' },
  optText: { ...f.body, fontSize: 15 },
  optSub: { ...f.tiny, marginTop: 2 },
  seg: { height: 36, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.surface4, alignItems: 'center', justifyContent: 'center' },
  segText: { ...f.label, fontSize: 13.5 },
  note: { ...f.tiny, fontSize: 12.5, paddingHorizontal: 20, paddingVertical: 10, lineHeight: 18 },
}), true)
