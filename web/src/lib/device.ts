import type { DeviceProfile } from '../api/types'

const ManagedMS = (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource
const MS: typeof MediaSource | undefined = window.MediaSource || ManagedMS

function mse(type: string): boolean {
  try {
    return !!MS && MS.isTypeSupported(type)
  } catch {
    return false
  }
}

let probe: HTMLVideoElement | null = null
function canPlay(type: string): boolean {
  probe ||= document.createElement('video')
  return probe.canPlayType(type) !== ''
}

const either = (type: string) => mse(type) || canPlay(type)

export function nativeHls(): boolean {
  return canPlay('application/vnd.apple.mpegurl')
}

export function deviceName(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const standalone = matchMedia('(display-mode: standalone)').matches ? ' (app)' : ''
  return `${br} on ${os}${standalone}`
}

let cached: DeviceProfile | null = null

/**
 * Builds a profile of what this device can decode, using real browser checks.
 * The server uses it to direct play when possible and only convert what's needed.
 */
export function detectProfile(): DeviceProfile {
  if (cached) return cached
  const video: string[] = []
  if (either('video/mp4; codecs="avc1.640028"')) video.push('h264')
  if (either('video/mp4; codecs="hvc1.1.6.L120.90"') || either('video/mp4; codecs="hev1.1.6.L120.90"')) video.push('hevc')
  if (either('video/mp4; codecs="av01.0.08M.08"')) video.push('av1')
  if (either('video/webm; codecs="vp9"') || either('video/mp4; codecs="vp09.00.10.08"')) video.push('vp9')

  const audio: string[] = []
  if (either('audio/mp4; codecs="mp4a.40.2"')) audio.push('aac')
  if (either('audio/mpeg') || either('audio/mp4; codecs="mp4a.6B"')) audio.push('mp3')
  if (either('audio/webm; codecs="opus"') || either('audio/mp4; codecs="opus"')) audio.push('opus')
  if (either('audio/mp4; codecs="flac"') || canPlay('audio/flac')) audio.push('flac')
  if (either('audio/mp4; codecs="ac-3"')) audio.push('ac3')
  if (either('audio/mp4; codecs="ec-3"')) audio.push('eac3')
  if (either('audio/webm; codecs="vorbis"')) audio.push('vorbis')

  const containers = ['mp4']
  if (canPlay('video/webm')) containers.push('webm')
  if (canPlay('video/x-matroska') || canPlay('video/mkv')) containers.push('mkv')

  const hdrDisplay = matchMedia('(dynamic-range: high)').matches || matchMedia('(video-dynamic-range: high)').matches
  const hdrDecode = either('video/mp4; codecs="hvc1.2.4.L153.B0"') || either('video/mp4; codecs="av01.0.12M.10.0.110.09.16.09.0"')

  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const long = Math.max(screen.width, screen.height) * dpr
  const short = Math.min(screen.width, screen.height) * dpr

  // Only cap bitrate on connections that report as slow or data-saving; "downlink" is capped at 10 Mbps in Chrome.
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  let maxBitrate = 0
  if (conn?.saveData) maxBitrate = 1500
  else if (conn?.effectiveType === '3g') maxBitrate = 2000
  else if (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') maxBitrate = 600

  cached = {
    name: deviceName(),
    videoCodecs: video.length ? video : ['h264'],
    audioCodecs: audio.length ? audio : ['aac'],
    containers,
    hls: !!MS || nativeHls(),
    maxWidth: Math.min(Math.round(long), 3840),
    maxHeight: Math.min(Math.round(short), 2160),
    maxBitrate,
    hdr: hdrDisplay && hdrDecode,
    maxAudioChannels: 0,
  }
  return cached
}

/** Conservative profile for Chromecast devices. */
export function chromecastProfile(): DeviceProfile {
  return {
    name: 'Chromecast',
    videoCodecs: ['h264'],
    audioCodecs: ['aac', 'mp3', 'opus', 'flac'],
    containers: ['mp4', 'webm'],
    hls: true,
    maxWidth: 1920,
    maxHeight: 1080,
    maxBitrate: 20000,
    hdr: false,
    maxAudioChannels: 2,
  }
}
