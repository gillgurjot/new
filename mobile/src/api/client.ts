import { PixelRatio } from 'react-native'
import type { ImageSource } from 'expo-image'
import type { Item } from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// The signed-in server and session token. Set by the auth provider.
let base = ''
let token = ''
let onUnauthorized: (() => void) | null = null

export function setSession(server: string, t: string) {
  base = server.replace(/\/+$/, '')
  token = t
}
export const getServer = () => base
export const getToken = () => token
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Absolute URL for a server path. */
export const abs = (path: string) => (/^https?:\/\//.test(path) ? path : base + path)

export async function api<T>(path: string, init: RequestInit & { json?: unknown; timeout?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Lumen-Request': '1', Accept: 'application/json', ...authHeaders(), ...(init.headers as Record<string, string>) }
  let body = init.body
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), init.timeout ?? 20_000)
  let res: Response
  try {
    res = await fetch(abs(path), { ...init, headers, body, signal: init.signal ?? ctl.signal })
  } catch {
    throw new ApiError(0, 'Can’t reach Lumen. Check that you’re on your home network or Tailscale.')
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401 && token) {
    onUnauthorized?.()
    throw new ApiError(401, 'Your session has ended. Please sign in again.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error || `Server error (${res.status})`)
  return data as T
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const put = <T>(path: string, json?: unknown) => api<T>(path, { method: 'PUT', json: json ?? {} })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export const errorText = (e: unknown, fallback = 'Something went wrong') => (e instanceof ApiError ? e.message : fallback)

// ---- images ----

export type ImageKind = 'poster' | 'backdrop' | 'logo' | 'still'

const px = (w: number) => Math.round(w * Math.min(PixelRatio.get(), 2.5))

/** An image source with the session header, for expo-image. */
export function src(path?: string): ImageSource | undefined {
  return path ? { uri: abs(path), headers: authHeaders(), cacheKey: path } : undefined
}

export function imagePath(item: Pick<Item, 'id' | 'images'>, kind: ImageKind, width?: number): string | undefined {
  const tag = item.images?.[kind]
  if (!tag) return undefined
  return `/api/images/${item.id}/${kind}?tag=${tag}${width ? `&w=${px(width)}` : ''}`
}

/** Landscape artwork: episode still → own backdrop → series backdrop. */
export function landscapePath(item: Item, width: number): string | undefined {
  return (
    imagePath(item, 'still', width) ||
    imagePath(item, 'backdrop', width) ||
    (item.seriesId ? `/api/images/${item.seriesId}/backdrop?w=${px(width)}` : undefined)
  )
}

export function posterPath(item: Item, width: number): string | undefined {
  return imagePath(item, 'poster', width) || ((item.type === 'season' || item.type === 'episode') && item.seriesId ? `/api/images/${item.seriesId}/poster?w=${px(width)}` : undefined)
}

export const personPath = (p?: string) => (p ? `/api/person-image?p=${encodeURIComponent(p)}` : undefined)

export function tmdbPath(p: string | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' = 'w342') {
  return p ? `/api/tmdb-image?p=${encodeURIComponent(p)}&s=${size}` : undefined
}

export const downloadPath = (itemId: number) => `/api/items/${itemId}/download`
