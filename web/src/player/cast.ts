// Chromecast sender support (Chrome / Edge only). Loaded lazily.
import { useEffect, useState } from 'react'

let loading: Promise<boolean> | null = null

export function loadCast(): Promise<boolean> {
  if (loading) return loading
  loading = new Promise((resolve) => {
    if (!/Chrome\//.test(navigator.userAgent) || !window.isSecureContext) return resolve(false)
    const w = window as unknown as { __onGCastApiAvailable?: (ok: boolean) => void }
    w.__onGCastApiAvailable = (ok: boolean) => {
      if (ok) {
        cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        })
      }
      resolve(ok)
    }
    const s = document.createElement('script')
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
    s.async = true
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
    setTimeout(() => resolve(false), 8000)
  })
  return loading
}

export interface CastState {
  available: boolean
  connected: boolean
  deviceName: string
}

/** Tracks Chromecast availability and connection. */
export function useCast(): CastState {
  const [st, setSt] = useState<CastState>({ available: false, connected: false, deviceName: '' })
  useEffect(() => {
    let ctx: cast.framework.CastContext | null = null
    const update = () => {
      if (!ctx) return
      const s = ctx.getCastState()
      const sess = ctx.getCurrentSession()
      setSt({
        available: s !== cast.framework.CastState.NO_DEVICES_AVAILABLE,
        connected: s === cast.framework.CastState.CONNECTED,
        deviceName: sess?.getCastDevice().friendlyName || '',
      })
    }
    loadCast().then((ok) => {
      if (!ok) return
      ctx = cast.framework.CastContext.getInstance()
      ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, update)
      update()
    })
    return () => ctx?.removeEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, update)
  }, [])
  return st
}

export interface CastMedia {
  url: string
  mimeType: string
  hls: boolean
  title: string
  subtitle?: string
  image?: string
  startTime: number
  subtitles: { index: number; label: string; language: string; url: string }[]
  activeSubtitle?: number
}

/** Loads media on the connected Chromecast. URLs must be absolute and carry a media token. */
export async function castLoad(m: CastMedia) {
  const sess = cast.framework.CastContext.getInstance().getCurrentSession()
  if (!sess) throw new Error('Not connected to a Chromecast')
  const info = new chrome.cast.media.MediaInfo(m.url, m.mimeType)
  info.streamType = chrome.cast.media.StreamType.BUFFERED
  if (m.hls) {
    // fMP4 HLS segments
    const i = info as unknown as { hlsSegmentFormat: string; hlsVideoSegmentFormat: string }
    i.hlsSegmentFormat = 'fmp4'
    i.hlsVideoSegmentFormat = 'fmp4'
  }
  const md = new chrome.cast.media.GenericMediaMetadata()
  md.title = m.title
  md.subtitle = m.subtitle || ''
  if (m.image) md.images = [new chrome.cast.Image(m.image)]
  info.metadata = md
  info.tracks = m.subtitles.map((s) => {
    const t = new chrome.cast.media.Track(s.index, chrome.cast.media.TrackType.TEXT)
    t.trackContentId = s.url
    t.trackContentType = 'text/vtt'
    t.subtype = chrome.cast.media.TextTrackType.SUBTITLES
    t.name = s.label
    t.language = s.language
    return t
  })
  const req = new chrome.cast.media.LoadRequest(info)
  req.currentTime = m.startTime
  req.autoplay = true
  if (m.activeSubtitle != null && m.activeSubtitle >= 0 && m.subtitles.some((s) => s.index === m.activeSubtitle)) req.activeTrackIds = [m.activeSubtitle]
  await sess.loadMedia(req)
}

export function requestCast() {
  return cast.framework.CastContext.getInstance().requestSession()
}

export function endCast() {
  cast.framework.CastContext.getInstance().endCurrentSession(true)
}
