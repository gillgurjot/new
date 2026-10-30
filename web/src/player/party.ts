import { useCallback, useEffect, useRef, useState } from 'react'
import { post } from '../api/client'
import type { Party, PartyMember, PartyMessage, PartyState } from '../api/types'

type Event =
  | { type: 'snapshot'; data: Party; now: number }
  | { type: 'state'; data: PartyState; now: number }
  | { type: 'members'; data: PartyMember[]; now: number }
  | { type: 'chat'; data: PartyMessage; now: number }

export interface PartyConn {
  id: string
  state: PartyState | null
  /** Bumps on every state event, so effects re-run even when nothing changed. */
  stateVersion: number
  members: PartyMember[]
  chat: PartyMessage[]
  connected: boolean
  ended: boolean
  /** Server clock minus ours, in ms. */
  offset: number
  send: (action: PartyState['action'], position: number, itemId?: number) => Promise<unknown>
  say: (text: string) => Promise<void>
  react: (emoji: string) => void
}

/** Where the room's playback is right now, in seconds. */
export function partyPosition(s: PartyState, offset: number) {
  return s.playing ? s.position + Math.max(0, Date.now() + offset - s.at) / 1000 : s.position
}

/** Keeps a live connection to a watch party with Server-Sent Events. */
export function useParty(id: string | null): PartyConn | null {
  const [state, setState] = useState<PartyState | null>(null)
  const [stateVersion, setStateVersion] = useState(0)
  const [members, setMembers] = useState<PartyMember[]>([])
  const [chat, setChat] = useState<PartyMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [ended, setEnded] = useState(false)
  const offset = useRef(0)

  useEffect(() => {
    if (!id) return
    setEnded(false)
    const es = new EventSource(`/api/party/${id}/events`)
    let failures = 0
    es.onopen = () => {
      failures = 0
      setConnected(true)
    }
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as Event
      offset.current = ev.now - Date.now()
      switch (ev.type) {
        case 'snapshot':
          setState(ev.data.state)
          setMembers(ev.data.members)
          setChat(ev.data.chat)
          setStateVersion((v) => v + 1)
          break
        case 'state':
          setState(ev.data)
          setStateVersion((v) => v + 1)
          break
        case 'members':
          setMembers(ev.data)
          break
        case 'chat':
          setChat((c) => (c.some((x) => x.id === ev.data.id) ? c : [...c.slice(-150), ev.data]))
          break
      }
    }
    es.onerror = () => {
      setConnected(false)
      // EventSource retries by itself; a room that's gone answers 404 and closes the stream.
      if (es.readyState === EventSource.CLOSED || ++failures > 8) {
        es.close()
        setEnded(true)
      }
    }
    return () => es.close()
  }, [id])

  const send = useCallback(
    (action: PartyState['action'], position: number, itemId?: number) => {
      if (!id) return Promise.resolve()
      return post(`/api/party/${id}/state`, { action, position, itemId }).catch(() => {})
    },
    [id],
  )
  const say = useCallback(async (text: string) => {
    if (id) await post(`/api/party/${id}/chat`, { text })
  }, [id])
  const react = useCallback((emoji: string) => {
    if (id) post(`/api/party/${id}/chat`, { emoji }).catch(() => {})
  }, [id])

  if (!id) return null
  return { id, state, stateVersion, members, chat, connected, ended, offset: offset.current, send, say, react }
}

export const REACTIONS = ['😂', '😮', '😍', '😢', '🔥', '👏', '😱', '👍']

export function inviteLink(partyId: string, itemId: number) {
  return `${location.origin}/play/${itemId}?party=${partyId}`
}
