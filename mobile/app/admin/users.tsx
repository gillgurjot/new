import { useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Shield } from 'lucide-react-native'
import { api, errorText, put } from '../../src/api/client'
import type { User } from '../../src/api/types'
import { Avatar, Button, Card, Chip, Header, Loading, MenuSheet, toast } from '../../src/components/ui'
import { timeAgo } from '../../src/lib/format'
import { useLibraries } from '../../src/lib/queries'
import { c, font } from '../../src/theme'

const BITRATES = [
  { v: 0, l: 'No limit' },
  { v: 20000, l: '20 Mbps' },
  { v: 8000, l: '8 Mbps (1080p)' },
  { v: 4000, l: '4 Mbps (720p)' },
  { v: 1500, l: '1.5 Mbps (480p)' },
]

export default function AdminUsers() {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<User[]>('/api/admin/users') })
  const libs = useLibraries()
  const [bitrateFor, setBitrateFor] = useState<User | null>(null)
  const all = (libs.data || []).map((l) => l.id)

  const save = async (u: User, patch: Partial<User>) => {
    const n = { disabled: u.disabled, maxBitrate: u.maxBitrate, libraryIds: u.libraryIds, canDownload: u.canDownload, canRequest: u.canRequest, ...patch }
    // Show the change straight away.
    qc.setQueryData<User[]>(['admin', 'users'], (old) => old?.map((x) => (x.id === u.id ? { ...x, ...patch } : x)))
    try {
      await put(`/api/admin/users/${u.id}`, n)
    } catch (e) {
      toast(errorText(e), 'error')
    }
    qc.invalidateQueries({ queryKey: ['admin', 'users'] })
  }
  const toggleLib = (u: User, id: number) => {
    const cur = u.libraryIds ?? all
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    save(u, { libraryIds: next.length === all.length ? null : next })
  }
  const sw = (on: boolean, set: (v: boolean) => void) => <Switch value={on} onValueChange={set} trackColor={{ true: c.accentStrong, false: c.surface3 }} thumbColor={c.white} />

  return (
    <View style={{ flex: 1 }}>
      <Header title="Users" />
      {users.isLoading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          {users.data?.map((u) => {
            const name = u.displayName || u.username
            return (
              <Card key={u.id} style={[{ padding: 16, gap: 12 }, u.disabled && { opacity: 0.6 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={name} uri={u.avatar || undefined} size={40} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={font.h3} numberOfLines={1}>{name}</Text>
                      {u.isAdmin && <Shield size={15} color={c.accent} />}
                    </View>
                    <Text style={font.small} numberOfLines={1}>{u.email || u.username} · seen {timeAgo(u.lastLogin)}</Text>
                  </View>
                  {!u.isAdmin && <Button small variant={u.disabled ? 'ghost' : 'danger'} title={u.disabled ? 'Enable' : 'Disable'} onPress={() => save(u, { disabled: !u.disabled })} />}
                </View>
                {u.isAdmin ? (
                  <Text style={font.small}>Admins can see every library. Admin rights come from the Pocket ID group.</Text>
                ) : (
                  <>
                    <View>
                      <Text style={styles.label}>Libraries</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {(libs.data || []).map((l) => <Chip key={l.id} label={l.name} active={(u.libraryIds ?? all).includes(l.id)} onPress={() => toggleLib(u, l.id)} />)}
                      </View>
                    </View>
                    <View style={styles.row}><Text style={[font.body, { flex: 1 }]}>Can download</Text>{sw(u.canDownload, (v) => save(u, { canDownload: v }))}</View>
                    <View style={styles.row}><Text style={[font.body, { flex: 1 }]}>Can request</Text>{sw(u.canRequest, (v) => save(u, { canRequest: v }))}</View>
                    <View style={styles.row}>
                      <Text style={[font.body, { flex: 1 }]}>Streaming limit</Text>
                      <Chip label={BITRATES.find((b) => b.v === u.maxBitrate)?.l || `${u.maxBitrate} kbps`} icon={<ChevronDown size={14} color={c.fg} />} onPress={() => setBitrateFor(u)} />
                    </View>
                  </>
                )}
              </Card>
            )
          })}
        </ScrollView>
      )}
      <MenuSheet
        open={!!bitrateFor}
        onClose={() => setBitrateFor(null)}
        title="Streaming limit"
        note="Higher-bitrate files are converted down for this person. Downloads are always the original file."
        options={BITRATES.map((b) => ({ label: b.l, selected: bitrateFor?.maxBitrate === b.v, onPress: () => bitrateFor && save(bitrateFor, { maxBitrate: b.v }) }))}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  label: { ...font.small, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
})
