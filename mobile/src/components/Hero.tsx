import { useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Info, Play } from 'lucide-react-native'
import { imagePath, src } from '../api/client'
import type { Item } from '../api/types'
import { formatRuntime, progressPct } from '../lib/format'
import { c } from '../theme'
import { openItem, playItem } from './cards'
import { Button, Img } from './ui'

/** Swipeable featured titles at the top of Home. */
export default function Hero({ items, topInset }: { items: Item[]; topInset: number }) {
  const { width } = useWindowDimensions()
  const height = Math.min(Math.round(width * 1.25), 560)
  const [index, setIndex] = useState(0)
  const onView = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index)
  }).current
  if (!items.length) return <View style={{ height: topInset + 70 }} />
  return (
    <View style={{ height, marginBottom: 20 }}>
      <FlatList
        horizontal
        pagingEnabled
        data={items}
        keyExtractor={(i) => String(i.id)}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onView}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => <Slide it={item} width={width} height={height} topInset={topInset} />}
      />
      {items.length > 1 && (
        <View style={styles.dots}>
          {items.map((it, i) => <View key={it.id} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
      )}
    </View>
  )
}

function Slide({ it, width, height }: { it: Item; width: number; height: number; topInset: number }) {
  const logo = imagePath(it, 'logo', 500)
  const pct = progressPct(it)
  const meta = [it.year, it.contentRating, it.type === 'series' ? (it.childCount ? `${it.childCount} season${it.childCount > 1 ? 's' : ''}` : 'Series') : formatRuntime(it.runtime, it.duration), it.genres?.slice(0, 2).join(', ')]
    .filter(Boolean)
    .join('  ·  ')
  return (
    <View style={{ width, height }}>
      <Img source={src(imagePath(it, 'backdrop', 1280) || imagePath(it, 'poster', 700))} style={StyleSheet.absoluteFill} transition={400} />
      <LinearGradient colors={['rgba(9,9,13,0.55)', 'transparent']} style={[StyleSheet.absoluteFill, { height: 140 }]} />
      <LinearGradient colors={['transparent', 'rgba(9,9,13,0.7)', c.bg]} locations={[0.35, 0.72, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.content}>
        {logo ? (
          <Img source={src(logo)} style={{ width: width * 0.62, height: 90, backgroundColor: 'transparent' }} contentFit="contain" fallback={<Text style={styles.title}>{it.title}</Text>} />
        ) : (
          <Text style={styles.title} numberOfLines={2}>{it.title}</Text>
        )}
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <View style={styles.actions}>
          <Button
            variant="primary"
            title={pct > 0 ? 'Resume' : 'Play'}
            icon={<Play size={18} color={c.black} fill={c.black} />}
            onPress={() => (it.type === 'series' ? openItem(it) : playItem(it.id))}
            style={{ flex: 1 }}
          />
          <Button variant="ghost" title="Details" icon={<Info size={18} color={c.fg} />} onPress={() => openItem(it)} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { position: 'absolute', left: 20, right: 20, bottom: 30, alignItems: 'center' },
  title: { color: c.fg, fontSize: 34, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },
  meta: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 10, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  dots: { position: 'absolute', bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { width: 18, backgroundColor: c.white },
})
