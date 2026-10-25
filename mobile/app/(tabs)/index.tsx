import { useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { CloudOff, Download, Sparkle } from 'lucide-react-native'
import { ApiError, api } from '../../src/api/client'
import type { HomeData } from '../../src/api/types'
import Hero from '../../src/components/Hero'
import { Row } from '../../src/components/cards'
import { Button, Chip, EmptyState, Loading, Text } from '../../src/components/ui'
import { Shape } from '../../src/components/expressive'
import { useDownloads } from '../../src/lib/downloads'
import { alpha, makeStyles, useTheme } from '../../src/theme'

export default function Home() {
  const insets = useSafeAreaInsets()
  const { c } = useTheme()
  const styles = useStyles()
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
          icon={CloudOff}
          shape="cookie4"
          title={offline ? 'Can’t reach Lumen' : 'Something went wrong'}
          action={
            <View style={{ gap: 10, alignItems: 'center' }}>
              <Button title="Try again" variant="filled" onPress={() => q.refetch()} loading={q.isFetching} />
              {downloads.length > 0 && <Button title={`Watch downloads (${downloads.length})`} icon={Download} onPress={() => router.navigate('/downloads')} />}
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
            tintColor={c.accent}
            colors={[c.onAccentContainer]}
            progressBackgroundColor={c.accentContainer}
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
        <LinearGradient colors={scrolled ? [c.bg, alpha(c.bg, 0.94)] : [alpha(c.bg, 0.7), alpha(c.bg, 0)]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.brandRow}>
          <Shape name="sunny" size={28} color={c.accent} spin={24}>
            <Sparkle size={14} color={c.onAccent} fill={c.onAccent} />
          </Shape>
          <Text style={styles.brand}>Lumen</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {d.libraries.map((l) => (
            <Chip key={l.id} label={l.name} elevated onPress={() => router.push({ pathname: '/library/[id]', params: { id: String(l.id) } })} />
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  brand: { ...f.h2, fontSize: 24, letterSpacing: -0.4 },
}))
