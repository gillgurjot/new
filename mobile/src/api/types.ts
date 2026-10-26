export interface User {
  id: number
  username: string
  displayName: string
  email: string
  avatar: string
  isAdmin: boolean
  disabled: boolean
  maxBitrate: number
  libraryIds: number[] | null
  audioLang: string
  subtitleLang: string
  subtitleMode: 'auto' | 'always' | 'off'
  createdAt: number
  lastLogin: number
  canDownload: boolean
  canRequest: boolean
}

export interface Library {
  id: number
  name: string
  type: 'movies' | 'tv'
  paths?: string[]
  createdAt: number
  lastScan: number
  itemCount: number
}

export interface UserData {
  position: number
  played: boolean
  playCount: number
  favorite: boolean
  lastPlayed: number
  audioIndex?: number
  subtitleIndex?: number
}

export interface Person {
  name: string
  character?: string
  profile?: string
  role?: string
}

export type ItemType = 'movie' | 'series' | 'season' | 'episode'

export interface Item {
  id: number
  libraryId: number
  type: ItemType
  parentId?: number
  seriesId?: number
  title: string
  originalTitle?: string
  year?: number
  overview?: string
  tagline?: string
  genres: string[]
  rating?: number
  contentRating?: string
  runtime?: number
  premiereDate?: string
  seasonNumber?: number
  episodeNumber?: number
  episodeEnd?: number
  tmdbId?: number
  imdbId?: string
  dateAdded: number
  metadataState: string
  people?: Person[]
  images: { poster?: string; backdrop?: string; logo?: string; still?: string }
  userData?: UserData
  seriesTitle?: string
  childCount?: number
  unplayedCount?: number
  duration?: number
}

export interface Stream {
  index: number
  type: 'audio' | 'subtitle'
  codec: string
  language?: string
  title?: string
  channels?: number
  layout?: string
  default?: boolean
  forced?: boolean
  external?: boolean
  imageBased?: boolean
}

export interface Chapter {
  start: number
  end: number
  title: string
}

export interface MediaFile {
  id: number
  itemId: number
  size: number
  container: string
  duration: number
  bitrate: number
  width: number
  height: number
  videoCodec: string
  videoProfile: string
  pixFmt: string
  hdr?: string
  streams: Stream[]
  sidecars: Stream[]
  chapters: Chapter[]
  trickplay: boolean
  creditsStart?: number
  creditsEnd?: number
  // Found by the server's intro detection or imported from Jellyfin.
  introStart?: number
  introEnd?: number
  recapStart?: number
  recapEnd?: number
}

export interface ItemDetail extends Item {
  media?: MediaFile
}

export interface HomeData {
  continueWatching: Item[]
  nextUp: Item[]
  featured: Item[]
  latest: { library: Library; items: Item[] }[]
  libraries: Library[]
  myList: Item[]
}

export interface DeviceProfile {
  name: string
  videoCodecs: string[]
  audioCodecs: string[]
  containers: string[]
  hls: boolean
  maxWidth: number
  maxHeight: number
  maxBitrate: number
  hdr: boolean
  maxAudioChannels: number
  multiAudio?: boolean
}

export interface Decision {
  method: 'direct' | 'remux' | 'transcode'
  reasons: string[] | null
  videoCopy: boolean
  audioCopy: boolean
  width: number
  height: number
  videoCodec?: string
  audioCodec?: string
  videoKbps: number
  audioKbps: number
  audioChannels: number
  toneMap: boolean
  burn?: { index: number }
}

export interface SubtitleTrack {
  index: number
  label: string
  language: string
  codec: string
  forced: boolean
  default: boolean
  external: boolean
  url?: string
}

export interface AudioTrack {
  index: number
  label: string
  language: string
  codec: string
  channels: number
}

export interface PlaybackInfo {
  sessionId: string
  method: Decision['method']
  url: string
  mimeType: string
  startOffset: number
  startTime: number
  duration: number
  decision: Decision
  token: string
  audioTracks: AudioTrack[] | null
  audioIndex: number | null
  subtitles: SubtitleTrack[] | null
  subtitleIndex: number
  trickplay?: string
  chapters: Chapter[]
  item: Item
  media: MediaFile
}

export interface ScanStatus {
  libraryId: number
  running: boolean
  phase: string
  total: number
  done: number
  added: number
  removed: number
  errors: number
}

export interface PlaySession {
  id: string
  userId: number
  username: string
  itemId: number
  title: string
  device: string
  client: string
  method: Decision['method']
  decision: Decision
  pipeline?: string
  position: number
  duration: number
  paused: boolean
  throttled: boolean
  created: string
}

export interface SystemInfo {
  version: string
  uptime: number
  hwaccel: { mode: string; device: string; h264: boolean; hevc: boolean; hwTonemap: boolean; swTonemap: boolean; ffmpegVersion: string; description: string }
  stats: Record<string, number>
  scans: ScanStatus[]
  tmdb: boolean
  maxTranscodes: number
  memoryMB: number
  publicUrl: string
  adminGroup: string
}

// ---- watch together ----

export interface PartyState {
  itemId: number
  playing: boolean
  position: number
  at: number
  by?: string
  action?: 'play' | 'pause' | 'seek' | 'item'
}

export interface PartyMember {
  userId: number
  name: string
  avatar?: string
}

export interface PartyMessage {
  id: number
  userId: number
  name: string
  avatar?: string
  text?: string
  emoji?: string
  at: number
  system?: boolean
}

export interface Party {
  id: string
  hostId: number
  state: PartyState
  members: PartyMember[]
  chat: PartyMessage[]
}

// ---- requests (Seerr) ----

export type RequestStatus = 'none' | 'pending' | 'processing' | 'partial' | 'available'

export interface RequestTitle {
  mediaType: 'movie' | 'tv'
  tmdbId: number
  title: string
  year?: number
  overview?: string
  poster?: string
  backdrop?: string
  rating?: number
  status: RequestStatus
  itemId?: number
}

export interface RequestSeason {
  seasonNumber: number
  name: string
  episodeCount: number
  status: RequestStatus
}

export interface RequestDetails {
  title: RequestTitle
  genres: string[] | null
  runtime: number
  seasons?: RequestSeason[]
}

export interface RecentRequest {
  id: number
  status: 'pending' | 'approved' | 'declined' | 'failed' | 'available'
  createdAt: string
  requestedBy: string
  seasons?: number[]
  title: RequestTitle
}

export interface RequestsConfig {
  enabled: boolean
  canRequest: boolean
  seerrUrl: string
}

export interface JellyfinStatus {
  enabled: boolean
  running: boolean
  lastSync: number // unix seconds
  error?: string
  linked: number
  users: { lumen: string; jellyfin: string }[]
  pulled: number
  pushed: number
  segments: number
}

/** A server connected from the admin screen. API keys are never sent back, only hasKey. */
export interface Integration {
  url: string
  publicUrl?: string
  hasKey: boolean
  enabled: boolean
  source: '' | 'env' | 'saved' | 'off'
}

export interface Integrations {
  jellyfin: Integration
  seerr: Integration
}
