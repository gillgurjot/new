import { Platform } from 'react-native'
import { capabilities } from '../../modules/lumen-device'
import type { DeviceProfile } from '../api/types'

let cached: DeviceProfile | null = null

/**
 * What this phone can play, from the real decoder list. The server direct-plays the
 * original file when it can and only converts what's needed.
 */
/** Plays on anything: the server converts to H.264 + AAC. Used after a decoder fails. */
export function safeProfile(): DeviceProfile {
  return { ...deviceProfile(), videoCodecs: ['h264'], audioCodecs: ['aac'], containers: [], hdr: false, multiAudio: false }
}

export function deviceProfile(): DeviceProfile {
  if (cached) return cached
  const caps = capabilities()
  const dec = new Set(caps?.decoders ?? ['video/avc', 'audio/mp4a-latm'])
  const video: string[] = []
  if (dec.has('video/avc')) video.push('h264')
  // Treat HEVC as unsupported without 10-bit decoding: most HEVC files are 10-bit.
  if (dec.has('video/hevc') && caps?.hevcMain10 !== false) video.push('hevc')
  if (dec.has('video/av01')) video.push('av1')
  if (dec.has('video/x-vnd.on2.vp9')) video.push('vp9')
  const audio: string[] = ['aac']
  if (dec.has('audio/mpeg')) audio.push('mp3')
  if (dec.has('audio/opus')) audio.push('opus')
  if (dec.has('audio/flac') || Platform.OS === 'android') audio.push('flac') // ExoPlayer has its own FLAC decoder
  if (dec.has('audio/vorbis')) audio.push('vorbis')
  if (dec.has('audio/ac3')) audio.push('ac3')
  if (dec.has('audio/eac3')) audio.push('eac3')
  if (dec.has('audio/true-hd')) audio.push('truehd')
  if (dec.has('audio/vnd.dts')) audio.push('dts')
  const android = Platform.OS === 'android'
  cached = {
    name: `Lumen app on ${caps?.model || (android ? 'Android' : 'iOS')}`,
    videoCodecs: video.length ? video : ['h264'],
    audioCodecs: audio,
    // ExoPlayer reads these containers directly; AVPlayer only MP4.
    containers: android ? ['mp4', 'mkv', 'webm', 'ts', 'mov'] : ['mp4', 'mov'],
    hls: true,
    maxWidth: Math.min(caps?.maxWidth || 1920, 3840),
    maxHeight: Math.min(caps?.maxHeight || 1080, 2160),
    maxBitrate: 0,
    hdr: (caps?.hdr?.length ?? 0) > 0,
    maxAudioChannels: 0,
    // ExoPlayer can switch between a file's audio tracks itself.
    multiAudio: android,
  }
  return cached
}
