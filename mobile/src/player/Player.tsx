import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
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
import { c } from '../theme'
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
  const intro = chapters.find((ch) => /intro|opening|recap|^op$/i.test(ch.title) && time >= ch.start && time < ch.end - 1)
  const credits = useMemo(() => {
    const ch = chapters.find((x) => /credits|ending|^ed$|outro/i.test(x.title) && x.start > duration * 0.5)
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
  const skipCredits = () => {
    if (!credits) return
    if (next) return goNext(next.id)
    if (duration - credits.end > 10) return seek(credits.end)
    cur.current = duration
    report().finally(onExit)
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
          <ActivityIndicator size="large" color={c.white} />
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
            <Btn label="Back" onPress={onExit}><ArrowLeft size={24} color={c.white} /></Btn>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {!!sub && <Text style={styles.subtitle} numberOfLines={1}>{sub}</Text>}
              {local && <Text style={styles.badge}>Downloaded</Text>}
            </View>
            {!local && (
              <Btn label="Watch together" onPress={() => (party ? setPartyOpen((o) => !o) : onStartParty(nowAbs()))} active={!!party}>
                <Users size={22} color={party ? c.black : c.white} />
                {party && party.members.length > 1 && <Text style={styles.count}>{party.members.length}</Text>}
              </Btn>
            )}
            {audios.length > 0 && <Btn label="Audio" onPress={() => setMenu('audio')}><AudioLines size={22} color={c.white} /></Btn>}
            <Btn label="Subtitles" onPress={() => setMenu('subs')} active={subIndex >= 0}><Captions size={22} color={subIndex >= 0 ? c.black : c.white} /></Btn>
            <Btn label="Settings" onPress={() => setMenu('settings')}><Gauge size={22} color={c.white} /></Btn>
            <Btn label={fill ? 'Fit to screen' : 'Zoom to fill'} onPress={() => setFill((f) => !f)}>{fill ? <Shrink size={21} color={c.white} /> : <Expand size={21} color={c.white} />}</Btn>
            <Btn label="Picture in picture" onPress={() => video.current?.enterPictureInPicture()}><PictureInPicture2 size={21} color={c.white} /></Btn>
          </View>

          {!loading && !error && (
            <View style={styles.middle} pointerEvents="box-none">
              <Btn label="Back 10 seconds" big onPress={() => { seek(nowAbs() - 10); poke() }}><RotateCcw size={30} color={c.white} /></Btn>
              <Btn label={paused ? 'Play' : 'Pause'} huge onPress={() => { togglePlay(); poke() }}>
                {paused ? <Play size={38} color={c.white} fill={c.white} /> : <Pause size={38} color={c.white} fill={c.white} />}
              </Btn>
              <Btn label="Forward 10 seconds" big onPress={() => { seek(nowAbs() + 10); poke() }}><RotateCw size={30} color={c.white} /></Btn>
            </View>
          )}

          <View style={[styles.bottom, { paddingLeft: padH, paddingRight: padH, paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.pills}>
              {intro && <Pill label="Skip intro" onPress={() => seek(intro.end)} />}
              {inCredits && <Pill label={next ? 'Next episode' : 'Skip credits'} onPress={skipCredits} />}
              {next && !inCredits && <Pill label="Next episode" icon onPress={() => goNext(next.id)} subtle />}
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
      {!showUi && !pip && (intro || inCredits) && (
        <View style={[styles.floatingPill, { right: padH }]}>
          {intro && <Pill label="Skip intro" onPress={() => seek(intro.end)} />}
          {inCredits && <Pill label={next ? 'Next episode' : 'Skip credits'} onPress={skipCredits} />}
        </View>
      )}

      {upNext !== null && next && !pip && (
        <View style={[styles.upNext, { right: padH }]}>
          <Text style={styles.upNextLabel}>Next episode in {upNext}</Text>
          <Text style={styles.upNextTitle} numberOfLines={1}>{episodeLabel(next)} · {next.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Pressable onPress={() => goNext(next.id)} style={[styles.upBtn, { backgroundColor: c.white }]}><Text style={{ color: c.black, fontWeight: '700' }}>Play now</Text></Pressable>
            <Pressable onPress={() => { setUpNext(null); setUpNextDismissed(true) }} style={styles.upBtn}><Text style={{ color: c.fg, fontWeight: '600' }}>Cancel</Text></Pressable>
          </View>
        </View>
      )}

      {!!error && (
        <View style={[styles.center, { backgroundColor: 'rgba(0,0,0,0.7)', padding: 30 }]}>
          <Text style={{ color: c.fg, fontSize: 16, textAlign: 'center', marginBottom: 18, maxWidth: 420 }}>{error}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => { retries.current = 0; start({ startTime: nowAbs() || time }) }} style={[styles.upBtn, { backgroundColor: c.white, paddingHorizontal: 22 }]}><Text style={{ color: c.black, fontWeight: '700' }}>Try again</Text></Pressable>
            <Pressable onPress={onExit} style={[styles.upBtn, { paddingHorizontal: 22 }]}><Text style={{ color: c.fg, fontWeight: '600' }}>Close</Text></Pressable>
          </View>
        </View>
      )}

      {/* Menus */}
      {menu && (
        <View style={styles.menuWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
          <View style={[styles.menu, { paddingRight: Math.max(insets.right, 12) }]}>
            <View style={styles.menuHead}>
              <Text style={styles.menuTitle}>{menu === 'subs' ? 'Subtitles' : menu === 'audio' ? 'Audio' : 'Playback'}</Text>
              <Pressable onPress={() => setMenu(null)} hitSlop={10} accessibilityLabel="Close"><X size={20} color={c.fg} /></Pressable>
            </View>
            <ScrollView>
              {menu === 'subs' && (
                <>
                  <Opt label="Off" on={subIndex < 0} onPress={() => { chooseSubtitle(-1); setMenu(null) }} />
                  {subs.map((s) => <Opt key={s.index} label={s.label} sub={!s.url ? (local ? 'Not in the download' : 'Picture subtitles · shown in the video') : undefined} on={s.index === subIndex} onPress={() => { chooseSubtitle(s.index); setMenu(null) }} />)}
                  {!subs.length && <Text style={styles.note}>This title has no subtitles{local ? ' saved with the download' : ''}.</Text>}
                  <Text style={styles.section}>Size</Text>
                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14 }}>
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
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14 }}>
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

function Btn({ children, onPress, label, big, huge, active }: { children: React.ReactNode; onPress: () => void; label: string; big?: boolean; huge?: boolean; active?: boolean }) {
  const s = huge ? 76 : big ? 60 : 44
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [
        { width: s, height: s, borderRadius: s / 2, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
        (huge || big) && { backgroundColor: 'rgba(0,0,0,0.35)' },
        active && { backgroundColor: c.white },
        pressed && { backgroundColor: 'rgba(255,255,255,0.15)', transform: [{ scale: 0.94 }] },
      ]}
    >
      {children}
    </Pressable>
  )
}

function Pill({ label, onPress, icon, subtle }: { label: string; onPress: () => void; icon?: boolean; subtle?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.pill, subtle && styles.pillSubtle, pressed && { opacity: 0.8 }]}>
      {icon && <SkipForward size={15} color={subtle ? c.white : c.black} fill={subtle ? c.white : c.black} />}
      <Text style={[styles.pillText, subtle && { color: c.white }]}>{label}</Text>
    </Pressable>
  )
}

function Opt({ label, sub, on, onPress }: { label: string; sub?: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.opt, pressed && { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
      <View style={{ width: 24 }}>{on && <Check size={18} color={c.accent} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optText, on && { fontWeight: '700' }]}>{label}</Text>
        {!!sub && <Text style={styles.optSub}>{sub}</Text>}
      </View>
    </Pressable>
  )
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.seg, on && { backgroundColor: c.white }]}>
      <Text style={{ color: on ? c.black : c.fg, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.black },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', left: 0, right: 0, height: 120 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingTop: 14, gap: 2 },
  title: { color: c.white, fontSize: 17, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 1 },
  badge: { color: c.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
  count: { color: c.black, fontSize: 11, fontWeight: '800', marginLeft: 2 },
  middle: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 48 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  pills: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 6, minHeight: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.white },
  pillSubtle: { backgroundColor: 'rgba(255,255,255,0.14)' },
  pillText: { color: c.black, fontWeight: '800', fontSize: 14 },
  floatingPill: { position: 'absolute', bottom: 28, flexDirection: 'row', gap: 8 },
  subs: { position: 'absolute', left: 60, right: 60, alignItems: 'center', gap: 2 },
  cue: { color: c.white, textAlign: 'center', fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.95)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 }, paddingHorizontal: 8 },
  cueBg: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, textShadowRadius: 0 },
  flashWrap: { position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center' },
  flash: { color: c.white, fontWeight: '700', fontSize: 15, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, overflow: 'hidden' },
  upNext: { position: 'absolute', bottom: 120, width: 280, padding: 14, borderRadius: 16, backgroundColor: 'rgba(20,20,26,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  upNextLabel: { color: c.muted, fontSize: 12, fontWeight: '600' },
  upNextTitle: { color: c.fg, fontSize: 15, fontWeight: '700', marginTop: 3 },
  upBtn: { height: 38, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  menuWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 40 },
  menu: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 330, backgroundColor: c.surface, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line, paddingTop: 12 },
  menuHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  menuTitle: { color: c.fg, fontSize: 17, fontWeight: '700' },
  section: { color: c.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  opt: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, marginHorizontal: 4, borderRadius: 10 },
  optText: { color: c.fg, fontSize: 15 },
  optSub: { color: c.muted, fontSize: 12, marginTop: 2 },
  seg: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  note: { color: c.muted, fontSize: 12.5, paddingHorizontal: 16, paddingVertical: 10, lineHeight: 18 },
})

