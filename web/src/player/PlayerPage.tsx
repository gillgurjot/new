import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api, post } from '../api/client'
import type { Party } from '../api/types'
import Spinner from '../components/Spinner'
import { toast } from '../components/ui'
import Player from './Player'
import { partyPosition } from './party'

export default function PlayerPage() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const t = sp.get('t')
  const partyId = sp.get('party')
  // Joining a party: look it up first so playback starts where everyone else is.
  const [join, setJoin] = useState<{ id: string; start: number; item: string } | null>(null)
  const [checking, setChecking] = useState(!!partyId)

  useEffect(() => {
    if (!partyId) {
      setJoin(null)
      setChecking(false)
      return
    }
    if (join?.id === partyId && join.item === id) return
    let alive = true
    setChecking(true)
    api<{ party: Party; now: number }>(`/api/party/${partyId}`)
      .then((r) => {
        if (!alive) return
        if (String(r.party.state.itemId) !== id) {
          nav(`/play/${r.party.state.itemId}?party=${partyId}`, { replace: true })
          return
        }
        setJoin({ id: partyId, start: partyPosition(r.party.state, r.now - Date.now()), item: id! })
        setChecking(false)
      })
      .catch((e) => {
        if (!alive) return
        toast(e instanceof ApiError ? e.message : 'Couldn’t join the watch party', 'error')
        const n = new URLSearchParams(sp)
        n.delete('party')
        n.delete('invite')
        setSp(n, { replace: true })
        setChecking(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, id])

  const exit = () => {
    qc.invalidateQueries({ queryKey: ['home'] })
    qc.invalidateQueries({ queryKey: ['item'] })
    qc.invalidateQueries({ queryKey: ['children'] })
    if (window.history.length > 1) nav(-1)
    else nav(`/item/${id}`, { replace: true })
  }
  const keep = partyId ? `?party=${partyId}` : ''

  if (checking) {
    return (
      <div className="fixed inset-0 bg-black grid place-items-center">
        <div className="text-center">
          <Spinner className="size-12 mx-auto mb-4" />
          <div className="text-sm text-muted">Joining the watch party…</div>
        </div>
      </div>
    )
  }
  return (
    <Player
      key={id}
      itemId={Number(id)}
      startTime={join ? join.start : t != null ? Number(t) : undefined}
      onExit={exit}
      onNext={(next) => nav(`/play/${next}${keep}`, { replace: true })}
      partyId={join?.id}
      partyPanel={sp.get('invite') === '1'}
      onStartParty={async (position) => {
        try {
          const p = await post<Party>('/api/party', { itemId: Number(id), position })
          setJoin({ id: p.id, start: position, item: id! })
          setSp({ party: p.id, invite: '1' }, { replace: true })
        } catch (e) {
          toast(e instanceof ApiError ? e.message : 'Couldn’t start a watch party', 'error')
        }
      }}
      onLeaveParty={() => {
        setJoin(null)
        setSp({}, { replace: true })
      }}
    />
  )
}
