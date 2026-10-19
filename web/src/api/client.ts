import type { Item } from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Lumen-Request': '1', ...(init.headers as Record<string, string>) }
  let body = init.body
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' })
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search)
    throw new ApiError(401, 'not signed in')
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText)
  return data as T
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const put = <T>(path: string, json?: unknown) => api<T>(path, { method: 'PUT', json: json ?? {} })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export type ImageKind = 'poster' | 'backdrop' | 'logo' | 'still'

/** URL for an item's image at a given width, or undefined if it has none. */
export function imageUrl(item: Pick<Item, 'id' | 'images'>, kind: ImageKind, width?: number): string | undefined {
  const tag = item.images?.[kind]
  if (!tag) return undefined
  const w = width ? Math.round(width * Math.min(window.devicePixelRatio || 1, 2)) : 0
  return `/api/images/${item.id}/${kind}?tag=${tag}${w ? `&w=${w}` : ''}`
}

/** Landscape artwork: episode still → own backdrop → series backdrop. */
export function landscapeUrl(item: Item, width: number): string | undefined {
  return (
    imageUrl(item, 'still', width) ||
    imageUrl(item, 'backdrop', width) ||
    (item.seriesId ? `/api/images/${item.seriesId}/backdrop?w=${Math.round(width * Math.min(devicePixelRatio || 1, 2))}` : undefined)
  )
}

export function posterUrl(item: Item, width: number): string | undefined {
  return imageUrl(item, 'poster', width) || (item.type === 'season' && item.seriesId ? `/api/images/${item.seriesId}/poster?w=${width * 2}` : undefined)
}

export function personImage(path?: string) {
  return path ? `/api/person-image?p=${encodeURIComponent(path)}` : undefined
}
