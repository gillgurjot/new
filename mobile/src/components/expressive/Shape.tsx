import { useEffect, useMemo, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated'
import type { LucideIcon } from 'lucide-react-native'
import { useTheme } from '../../theme'
import { morphSpring, motion } from './motion'
import { LOADER_SEQUENCE, pathFromPoints, shapePath, shapePoints, type ShapeName } from './shapes'

const AnimatedPath = Animated.createAnimatedComponent(Path)

export type Tone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'surface'

export function useTone(tone: Tone) {
  const { c } = useTheme()
  return {
    primary: [c.accentContainer, c.onAccentContainer],
    secondary: [c.secondaryContainer, c.onSecondaryContainer],
    tertiary: [c.tertiaryContainer, c.onTertiaryContainer],
    error: [c.dangerContainer, c.onDangerContainer],
    surface: [c.surface4, c.muted],
  }[tone] as [string, string]
}

// A slowly turning wrapper, used to give shapes some life.
function useSpin(seconds: number | undefined) {
  const r = useSharedValue(0)
  useEffect(() => {
    if (!seconds) return
    r.value = withRepeat(withTiming(360, { duration: seconds * 1000, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(r)
  }, [seconds, r])
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }))
}

export function Shape({ name, size, color, spin, style, children }: { name: ShapeName; size: number; color: string; spin?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const d = useMemo(() => shapePath(name, size), [name, size])
  const spinStyle = useSpin(spin)
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, spinStyle]}>
        <Svg width={size} height={size}>
          <Path d={d} fill={color} />
        </Svg>
      </Animated.View>
      {children}
    </View>
  )
}

// An icon sitting on a Material Expressive shape.
export function ShapeIcon({ shape = 'circle', icon: Icon, size = 48, tone = 'primary', bg, fg, spin, style }: { shape?: ShapeName; icon: LucideIcon; size?: number; tone?: Tone; bg?: string; fg?: string; spin?: number; style?: StyleProp<ViewStyle> }) {
  const [tb, tf] = useTone(tone)
  return (
    <Shape name={shape} size={size} color={bg ?? tb} spin={spin} style={style}>
      <Icon size={Math.round(size * 0.44)} color={fg ?? tf} />
    </Shape>
  )
}

// Morphs through a list of shapes while turning. Timing follows Compose's
// LoadingIndicator: a new shape every 650 ms on a bouncy spring, a quarter turn
// per morph, on top of a steady full turn every 4.7 s.
export function MorphShape({ shapes, size, color, interval = 650, style, children }: { shapes: ShapeName[]; size: number; color: string; interval?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const list = useMemo(() => shapes.map(shapePoints), [shapes])
  const t = useSharedValue(0)
  const spin = useSharedValue(0)
  useEffect(() => {
    let i = 0
    t.value = 0
    spin.value = 0
    spin.value = withRepeat(withTiming(360, { duration: 4666, easing: Easing.linear }), -1, false)
    const id = setInterval(() => {
      i += 1
      t.value = withSpring(i, morphSpring)
    }, interval)
    return () => {
      clearInterval(id)
      cancelAnimation(spin)
    }
  }, [interval, t, spin])
  const props = useAnimatedProps(() => {
    const n = list.length
    const base = Math.floor(t.value)
    const f = t.value - base
    const a = list[((base % n) + n) % n]
    const b = list[(((base + 1) % n) + n) % n]
    const pts: number[] = new Array(a.length)
    for (let k = 0; k < a.length; k++) pts[k] = a[k] + (b[k] - a[k]) * f
    return { d: pathFromPoints(pts, size) }
  })
  const rot = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value + t.value * 90}deg` }] }))
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, rot]}>
        <Svg width={size} height={size}>
          <AnimatedPath animatedProps={props} fill={color} />
        </Svg>
      </Animated.View>
      {children}
    </View>
  )
}

// Material 3 Expressive loading indicator: a 38dp morphing shape in a 48dp box,
// optionally on a contained circle.
export function LoadingIndicator({ size = 48, contained = false, color }: { size?: number; contained?: boolean; color?: string }) {
  const { c } = useTheme()
  const indicator = <MorphShape shapes={LOADER_SEQUENCE} size={size * (38 / 48)} color={color ?? (contained ? c.onAccentContainer : c.accent)} />
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: contained ? c.accentContainer : 'transparent' }}>
      {indicator}
    </View>
  )
}

// A shape that pops in with a springy scale when it mounts.
export function PopIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const s = useSharedValue(0.82)
  const o = useSharedValue(0)
  useEffect(() => {
    s.value = withDelay(delay, withSpring(1, motion.fastSpatial))
    o.value = withDelay(delay, withSpring(1, motion.effects))
  }, [delay, s, o])
  const a = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: s.value }] }))
  return <Animated.View style={[a, style]}>{children}</Animated.View>
}
