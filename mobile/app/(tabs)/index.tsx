import { useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { CloudOff, Download } from 'lucide-react-native'
import { ApiError, api } from '../../src/api/client'
import type { HomeData } from '../../src/api/types'
import Hero from '../../src/components/Hero'
import { Row } from '../../src/components/cards'
import { Button, Chip, EmptyState, Loading } from '../../src/components/ui'
import { useDownloads } from '../../src/lib/downloads'
import { c } from '../../src/theme'

export default function Home() {
  const insets = useSafeAreaInsets()
  const q = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home') })
  const [refreshing, setRefreshing] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const downloads = useDownloads().filter((d) => d.state === 'done')

  const paused = q.fetchStatus === 'paused' // react-query thinks the phone is offline
  if (!q.data && !q.error && !paused) return <Loading />
  if (!q.data) {
    const offline = paused || (q.error instanceof ApiError && q.error.status === 0)
    return (
      <View style={{ flex: 1, justifyContent: 'center', paddingTop: insets.top }}>
        <EmptyState
          icon={<CloudOff size={28} color={c.muted} />}
          title={offline ? 'Can’t reach Lumen' : 'Something went wrong'}
          action={
            <View style={{ gap: 10, alignItems: 'center' }}>
              <Button title="Try again" variant="primary" onPress={() => q.refetch()} loading={q.isFetching} />
              {downloads.length > 0 && <Button title={`Watch downloads (${downloads.length})`} icon={<Download size={18} color={c.fg} />} onPress={() => router.navigate('/downloads')} />}
            </View>
          }
        >
          {offline ? 'You need to be on your home Wi-Fi or connected to Tailscale. Downloaded titles still play.' : (q.error as Error | null)?.message}
        </EmptyState>
      </View>
    )
  }
  const d = q.data
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 40)}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            progressViewOffset={insets.top + 50}
            tintColor={c.white}
            colors={[c.accentStrong]}
            onRefresh={async () => {
              setRefreshing(true)
              await q.refetch()
              setRefreshing(false)
            }}
          />
        }
      >
        <Hero items={d.featured} topInset={insets.top} />
        <Row title="Continue watching" items={d.continueWatching} kind="landscape" />
        <Row title="Next up" items={d.nextUp} kind="landscape" />
        <Row title="My List" items={d.myList} onMore={() => router.push('/favorites')} />
        {d.latest.map((l) => (
          <Row key={l.library.id} title={`New in ${l.library.name}`} items={l.items} onMore={() => router.push({ pathname: '/library/[id]', params: { id: String(l.library.id), sort: 'added' } })} />
        ))}
        {!d.featured.length && !d.latest.some((l) => l.items.length) && (
          <EmptyState title="Nothing here yet">Once an admin adds a library and it finishes scanning, titles show up here.</EmptyState>
        )}
      </ScrollView>

      {/* Top bar: brand and library shortcuts, fading in a backdrop as you scroll. */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <LinearGradient colors={scrolled ? [c.bg, 'rgba(9,9,13,0.92)'] : ['rgba(0,0,0,0.6)', 'transparent']} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.brandRow}>
          <LinearGradient colors={['#a78bfa', '#f472b6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoDot} />
          <Text style={styles.brand}>Lumen</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {d.libraries.map((l) => (
            <Chip key={l.id} label={l.name} onPress={() => router.push({ pathname: '/library/[id]', params: { id: String(l.id) } })} />
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  logoDot: { width: 22, height: 22, borderRadius: 11 },
  brand: { color: c.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
})
