import { useCallback, useEffect, useRef, useState } from 'react'
import EventSource from 'react-native-sse'
import { abs, authHeaders, getServer, post } from '../api/client'
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
    const es = new EventSource(abs(`/api/party/${id}/events`), { headers: authHeaders(), pollingInterval: 3000 })
    let failures = 0
    es.addEventListener('open', () => {
      failures = 0
      setConnected(true)
    })
    es.addEventListener('message', (m) => {
      if (!m.data) return
      let ev: Event
      try {
        ev = JSON.parse(m.data)
      } catch {
        return
      }
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
    })
    es.addEventListener('error', (e) => {
      setConnected(false)
      const status = 'xhrStatus' in e ? e.xhrStatus : 0
      // A room that's gone answers 404 (403 if we lost access). Otherwise keep retrying a while.
      if (status === 404 || status === 403 || ++failures > 10) {
        es.close()
        setEnded(true)
      }
    })
    return () => {
      es.removeAllEventListeners()
      es.close()
    }
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

/** Same link the website uses, so it works for people on the web and in the app. */
export function inviteLink(partyId: string, itemId: number) {
  return `${getServer()}/play/${itemId}?party=${partyId}`
}

/** Pulls the party id and title out of an invite link. */
export function parseInvite(text: string): { itemId: number; partyId: string } | null {
  const m = /\/play\/(\d+)\?(?:.*&)?party=([A-Za-z0-9_-]+)/.exec(text.trim())
  return m ? { itemId: Number(m[1]), partyId: m[2] } : null
}
