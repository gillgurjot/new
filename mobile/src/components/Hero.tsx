import { useEffect, useRef, useState } from 'react'
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Info, Play } from 'lucide-react-native'
import { imagePath, src } from '../api/client'
import type { Item } from '../api/types'
import { formatRuntime, progressPct } from '../lib/format'
import { alpha, makeStyles, useTheme } from '../theme'
import { openItem, playItem } from './cards'
import { Button, Img, Text } from './ui'
import { motion } from './expressive'

/** Swipeable featured titles at the top of Home. */
export default function Hero({ items, topInset }: { items: Item[]; topInset: number }) {
  const { width } = useWindowDimensions()
  const s = useStyles()
  const height = Math.min(Math.round(width * 1.3), 580)
  const [index, setIndex] = useState(0)
  const onView = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index)
  }).current
  if (!items.length) return <View style={{ height: topInset + 70 }} />
  return (
    <View style={{ height, marginBottom: 24 }}>
      <FlatList
        horizontal
        pagingEnabled
        data={items}
        keyExtractor={(i) => String(i.id)}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onView}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => <Slide it={item} width={width} height={height} />}
      />
      {items.length > 1 && (
        <View style={s.dots} pointerEvents="none">
          {items.map((it, i) => <Dot key={it.id} on={i === index} />)}
        </View>
      )}
    </View>
  )
}

// The current page's dot stretches into a pill on a bouncy spring.
function Dot({ on }: { on: boolean }) {
  const { c } = useTheme()
  const v = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    v.value = withSpring(on ? 1 : 0, motion.bouncy)
  }, [on, v])
  const style = useAnimatedStyle(() => ({ width: 6 + 16 * v.value, opacity: 0.35 + 0.65 * v.value }))
  return <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: c.fg }, style]} />
}

function Slide({ it, width, height }: { it: Item; width: number; height: number }) {
  const s = useStyles()
  const { c } = useTheme()
  const logo = imagePath(it, 'logo', 500)
  const pct = progressPct(it)
  const meta = [it.year, it.contentRating, it.type === 'series' ? (it.childCount ? `${it.childCount} season${it.childCount > 1 ? 's' : ''}` : 'Series') : formatRuntime(it.runtime, it.duration), it.genres?.slice(0, 2).join(', ')]
    .filter(Boolean)
    .join('  ·  ')
  return (
    <View style={{ width, height }}>
      <Img source={src(imagePath(it, 'backdrop', 1280) || imagePath(it, 'poster', 700))} style={StyleSheet.absoluteFill} transition={400} />
      <LinearGradient colors={[alpha(c.bg, 0.6), 'transparent']} style={[StyleSheet.absoluteFill, { height: 150 }]} />
      <LinearGradient colors={['transparent', alpha(c.bg, 0.75), c.bg]} locations={[0.35, 0.72, 1]} style={StyleSheet.absoluteFill} />
      <View style={s.content}>
        {logo ? (
          <Img source={src(logo)} style={{ width: width * 0.62, height: 90, backgroundColor: 'transparent' }} contentFit="contain" fallback={<Text style={s.title}>{it.title}</Text>} />
        ) : (
          <Text style={s.title} numberOfLines={2}>{it.title}</Text>
        )}
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
        <View style={s.actions}>
          <Button variant="filled" size="l" title={pct > 0 ? 'Resume' : 'Play'} icon={Play} iconFill onPress={() => (it.type === 'series' ? openItem(it) : playItem(it.id))} style={{ flex: 1.3 }} />
          <Button variant="tonal" size="l" title="Details" icon={Info} onPress={() => openItem(it)} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  content: { position: 'absolute', left: 20, right: 20, bottom: 32, alignItems: 'center' },
  title: { ...f.display, textAlign: 'center' },
  meta: { ...f.small, color: c.dim, marginTop: 10, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18, alignSelf: 'stretch' },
  dots: { position: 'absolute', bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
}))
