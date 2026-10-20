import { useSyncExternalStore } from 'react'
import { PermissionsAndroid, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import {
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
  type DownloadTask,
} from '@kesha-antonov/react-native-background-downloader'
import { abs, api, authHeaders, downloadPath, imagePath, landscapePath, posterPath, post } from '../api/client'
import type { ItemDetail } from '../api/types'
import { channelLabel, langLabel } from './format'
import { getPrefs } from './prefs'

export type DownloadState = 'downloading' | 'paused' | 'done' | 'failed'

export interface Download {
  itemId: number
  item: ItemDetail // a copy for showing it offline
  state: DownloadState
  bytes: number
  total: number
  dir: string // file:// URI
  file: string // file:// URI of the video
  poster?: string
  landscape?: string
  logo?: string
  subs: { index: number; label: string; language: string; file: string }[]
  audio: { index: number; label: string; language: string }[]
  error?: string
  addedAt: number
  /** Where you got to, saved on the phone (seconds). */
  position: number
}

const KEY = 'lumen.downloads'
const PENDING = 'lumen.pendingProgress'
let all: Record<number, Download> = {}
let list: Download[] = []
const subs = new Set<() => void>()
const tasks = new Map<number, DownloadTask>()

function emit() {
  list = Object.values(all).sort((a, b) => b.addedAt - a.addedAt)
  subs.forEach((f) => f())
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(now = false) {
  if (saveTimer) clearTimeout(saveTimer)
  const write = () => AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => {})
  if (now) write()
  else saveTimer = setTimeout(write, 800)
}

function patch(id: number, p: Partial<Download>, now = false) {
  const d = all[id]
  if (!d) return
  all = { ...all, [id]: { ...d, ...p } }
  emit()
  persist(now)
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export function useDownloads(): Download[] {
  return useSyncExternalStore(subscribe, () => list)
}

export function useDownload(itemId?: number): Download | undefined {
  return useSyncExternalStore(subscribe, () => (itemId ? all[itemId] : undefined))
}

export const getDownload = (itemId: number): Download | undefined => all[itemId]

const plainPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ''))
const taskId = (itemId: number) => `item-${itemId}`

function applyConfig() {
  setConfig({
    allowsCellularAccess: !getPrefs().downloadOnWifiOnly,
    progressInterval: 1000,
    showNotificationsEnabled: true,
  })
}

function bind(itemId: number, t: DownloadTask) {
  tasks.set(itemId, t)
  t.begin(({ expectedBytes }) => patch(itemId, { total: expectedBytes || all[itemId]?.total || 0, state: 'downloading', error: undefined }))
    .progress(({ bytesDownloaded, bytesTotal }) => patch(itemId, { bytes: bytesDownloaded, total: bytesTotal > 0 ? bytesTotal : all[itemId]?.total || 0, state: 'downloading' }))
    .done(({ bytesTotal }) => {
      patch(itemId, { state: 'done', bytes: bytesTotal || all[itemId]?.total || 0, total: bytesTotal || all[itemId]?.total || 0, error: undefined }, true)
      tasks.delete(itemId)
      completeHandler(taskId(itemId))
    })
    .error(({ error, errorCode }) => {
      tasks.delete(itemId)
      if (errorCode === -1) return // cancelled from the notification
      patch(itemId, { state: 'failed', error: friendlyError(error) }, true)
    })
}

function friendlyError(e: string) {
  if (/403/.test(e)) return 'Downloads are turned off for your account'
  if (/space|ENOSPC/i.test(e)) return 'Not enough space on this phone'
  return 'Download stopped. Tap retry.'
}

/** Load saved downloads and reconnect to any still running in the background. */
export async function restoreDownloads() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    all = raw ? JSON.parse(raw) : {}
  } catch {
    all = {}
  }
  emit()
  applyConfig()
  try {
    const existing = await getExistingDownloadTasks()
    for (const t of existing) {
      const id = Number(String(t.id).replace('item-', ''))
      if (!all[id]) {
        await t.stop().catch(() => {})
        continue
      }
      bind(id, t)
      if (t.state === 'PAUSED') patch(id, { state: 'paused', bytes: t.bytesDownloaded, total: t.bytesTotal || all[id].total })
      else if (t.state === 'DONE') patch(id, { state: 'done' })
    }
  } catch {
    /* native module unavailable */
  }
  // Anything that was mid-download with no task behind it got interrupted.
  for (const d of Object.values(all)) {
    if ((d.state === 'downloading' || d.state === 'paused') && !tasks.has(d.itemId)) {
      patch(d.itemId, { state: 'failed', error: 'Download was interrupted. Tap retry.' })
    }
  }
}

async function askNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return
  try {
    await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never)
  } catch {
    /* fine without */
  }
}

async function saveImage(path: string | undefined, dir: Directory, name: string): Promise<string | undefined> {
  if (!path) return undefined
  try {
    const f = new File(dir, name)
    if (f.exists) f.delete()
    const out = await File.downloadFileAsync(abs(path), f, { headers: authHeaders(), idempotent: true })
    return typeof out === 'string' ? out : (out as File).uri
  } catch {
    return undefined
  }
}

/** Start saving the original file (and its artwork and text subtitles) to the phone. */
export async function startDownload(itemId: number) {
  await askNotificationPermission()
  applyConfig()
  const item = await api<ItemDetail>(`/api/items/${itemId}`)
  const m = item.media
  if (!m) throw new Error('This title has no file to download')
  const root = new Directory(Paths.document, 'downloads')
  if (!root.exists) root.create({ intermediates: true })
  const dir = new Directory(root, String(itemId))
  if (!dir.exists) dir.create({ intermediates: true })
  const ext = (m.container === 'mkv' ? 'mkv' : m.container === 'webm' ? 'webm' : m.container === 'ts' ? 'ts' : 'mp4')
  const video = new File(dir, `video.${ext}`)

  const audio = m.streams
    .filter((s) => s.type === 'audio')
    .map((s) => ({ index: s.index, language: s.language || '', label: [s.title, `${langLabel(s.language)} · ${s.codec.toUpperCase()} ${channelLabel(s.channels)}`].filter(Boolean).join(' — ') }))

  all = {
    ...all,
    [itemId]: {
      itemId, item, state: 'downloading', bytes: 0, total: m.size, dir: dir.uri, file: video.uri,
      subs: [], audio, addedAt: Date.now(), position: item.userData?.position || 0,
    },
  }
  emit()
  persist(true)

  const t = createDownloadTask({
    id: taskId(itemId),
    url: abs(downloadPath(itemId)),
    destination: plainPath(video.uri),
    headers: authHeaders(),
    metadata: { itemId },
    notificationTitle: item.seriesTitle ? `${item.seriesTitle} · ${item.title}` : item.title,
  })
  bind(itemId, t)
  t.start()

  // Artwork and subtitles are small; fetch them alongside.
  const [poster, landscape, logo] = await Promise.all([
    saveImage(posterPath(item, 300), dir, 'poster.jpg'),
    saveImage(landscapePath(item, 640), dir, 'landscape.jpg'),
    saveImage(item.seriesId ? `/api/images/${item.seriesId}/logo?w=600` : imagePath(item, 'logo', 600), dir, 'logo.png'),
  ])
  const subsOut: Download['subs'] = []
  const textSubs = [...m.streams, ...(m.sidecars || [])].filter((s) => s.type === 'subtitle' && !s.imageBased)
  for (const s of textSubs) {
    const f = await saveImage(`/api/subtitles/${m.id}/${s.index}.vtt`, dir, `sub-${s.index}.vtt`)
    if (f) {
      const label = [langLabel(s.language), s.title && s.title.toLowerCase() !== langLabel(s.language).toLowerCase() ? s.title : '', s.forced ? '(Forced)' : '']
        .filter(Boolean).join(' · ')
      subsOut.push({ index: s.index, label, language: s.language || '', file: f })
    }
  }
  patch(itemId, { poster, landscape, logo, subs: subsOut }, true)
}

export async function pauseDownload(itemId: number) {
  const t = tasks.get(itemId)
  if (!t) return
  await t.pause().catch(() => {})
  patch(itemId, { state: 'paused' }, true)
}

export async function resumeDownload(itemId: number) {
  const t = tasks.get(itemId)
  if (!t) return retryDownload(itemId)
  applyConfig()
  // The session may have changed since it was paused.
  if (t.downloadParams) await Promise.resolve(t.setDownloadParams({ ...t.downloadParams, headers: authHeaders() })).catch(() => {})
  await t.resume().catch(() => {})
  patch(itemId, { state: 'downloading', error: undefined }, true)
}

export async function retryDownload(itemId: number) {
  const d = all[itemId]
  if (!d) return startDownload(itemId)
  await removeDownload(itemId)
  return startDownload(itemId)
}

export async function removeDownload(itemId: number) {
  const t = tasks.get(itemId)
  if (t) {
    await t.stop().catch(() => {})
    tasks.delete(itemId)
  }
  const d = all[itemId]
  if (d) {
    try {
      const dir = new Directory(d.dir)
      if (dir.exists) dir.delete()
    } catch {
      /* already gone */
    }
  }
  const { [itemId]: _gone, ...rest } = all
  all = rest
  emit()
  persist(true)
}

export function downloadsSize(): number {
  return Object.values(all).reduce((n, d) => n + (d.state === 'done' ? d.total : d.bytes), 0)
}

export function freeSpace(): number {
  try {
    return Paths.availableDiskSpace
  } catch {
    return 0
  }
}

// ---- progress made on downloaded copies ----

/** Remember where you are in a downloaded title, and tell the server when it can be reached. */
export function saveOfflinePosition(itemId: number, position: number) {
  if (all[itemId]) patch(itemId, { position })
}

export async function queueProgress(itemId: number, position: number) {
  try {
    const raw = await AsyncStorage.getItem(PENDING)
    const q: Record<number, { position: number; at: number }> = raw ? JSON.parse(raw) : {}
    q[itemId] = { position, at: Date.now() }
    await AsyncStorage.setItem(PENDING, JSON.stringify(q))
  } catch {
    /* best effort */
  }
}

let flushing = false
/** Send progress saved while offline. Safe to call often. */
export async function flushProgress() {
  if (flushing) return
  flushing = true
  try {
    const raw = await AsyncStorage.getItem(PENDING)
    const q: Record<string, { position: number; at: number }> = raw ? JSON.parse(raw) : {}
    for (const [id, v] of Object.entries(q)) {
      try {
        await post('/api/playback/progress', { sessionId: '', itemId: Number(id), position: v.position, paused: true })
        delete q[id]
      } catch {
        break // still offline
      }
    }
    await AsyncStorage.setItem(PENDING, JSON.stringify(q))
  } catch {
    /* try again later */
  } finally {
    flushing = false
  }
}

export const localUri = (d: Download) => d.file
export const isPlayable = (d?: Download) => !!d && d.state === 'done'
export { applyConfig as applyDownloadSettings }
