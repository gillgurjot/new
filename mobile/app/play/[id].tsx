import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorText, post } from '../../src/api/client'
import type { Party } from '../../src/api/types'
import { toast } from '../../src/components/ui'
import { getDownload } from '../../src/lib/downloads'
import Player from '../../src/player/Player'
import { partyPosition } from '../../src/player/party'
import { c } from '../../src/theme'

export default function PlayScreen() {
  const params = useLocalSearchParams<{ id: string; t?: string; party?: string; invite?: string }>()
  const id = params.id
  const qc = useQueryClient()
  const [partyId, setPartyId] = useState<string | null>(null)
  const [joinAt, setJoinAt] = useState<number | undefined>()
  const [checking, setChecking] = useState(!!params.party)
  const joined = useRef<string | null>(null) // party we're already in, so the URL change doesn't reload
  const dl = getDownload(Number(id))
  const download = dl?.state === 'done' ? dl : undefined

  // Joining a party: look it up first so playback starts where everyone else is.
  useEffect(() => {
    if (!params.party) {
      setChecking(false)
      return
    }
    if (params.party === joined.current) return
    let alive = true
    setChecking(true)
    api<{ party: Party; now: number }>(`/api/party/${params.party}`)
      .then((r) => {
        if (!alive) return
        if (String(r.party.state.itemId) !== id) {
          router.replace({ pathname: '/play/[id]', params: { id: String(r.party.state.itemId), party: params.party! } })
          return
        }
        setJoinAt(partyPosition(r.party.state, r.now - Date.now()))
        joined.current = params.party!
        setPartyId(params.party!)
        setChecking(false)
      })
      .catch((e) => {
        if (!alive) return
        toast(errorText(e, 'Couldn’t join the watch party'), 'error')
        setPartyId(null)
        setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [params.party, id])

  const exit = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['home'] })
    qc.invalidateQueries({ queryKey: ['item'] })
    qc.invalidateQueries({ queryKey: ['children'] })
    if (router.canGoBack()) router.back()
    else router.replace({ pathname: '/item/[id]', params: { id } })
  }, [qc, id])

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: c.black, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={c.white} />
        <Text style={{ color: c.muted, marginTop: 14 }}>Joining the watch party…</Text>
      </View>
    )
  }
  return (
    <Player
      key={id}
      itemId={Number(id)}
      startTime={joinAt ?? (params.t != null ? Number(params.t) : undefined)}
      download={download}
      partyId={partyId}
      partyPanel={params.invite === '1'}
      onExit={exit}
      onNext={(next) => router.replace({ pathname: '/play/[id]', params: { id: String(next), ...(partyId ? { party: partyId } : {}) } })}
      onStartParty={async (position) => {
        try {
          const p = await post<Party>('/api/party', { itemId: Number(id), position })
          joined.current = p.id
          setPartyId(p.id)
          router.setParams({ party: p.id, invite: '1' })
        } catch (e) {
          toast(errorText(e, 'Couldn’t start a watch party'), 'error')
        }
      }}
      onLeaveParty={() => {
        joined.current = null
        setPartyId(null)
        router.setParams({ party: undefined, invite: undefined })
      }}
    />
  )
}
