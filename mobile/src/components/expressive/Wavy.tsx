import { useEffect, useState } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import Animated, { Easing, cancelAnimation, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useTheme } from '../../theme'

const AnimatedPath = Animated.createAnimatedComponent(Path)

function usePhase(running: boolean, ms: number) {
  const phase = useSharedValue(0)
  useEffect(() => {
    if (!running) {
      cancelAnimation(phase)
      return
    }
    phase.value = 0
    phase.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false)
    return () => cancelAnimation(phase)
  }, [running, ms, phase])
  return phase
}

// Material 3 Expressive wavy linear progress, sized from the Compose tokens:
// 4dp strokes, 3dp amplitude, 40dp wavelength (20dp indeterminate), 10dp tall,
// 4dp gap before the track and a 4dp stop dot. The wave travels one wavelength
// a second and flattens near 0% and 100%. Without `progress` it is indeterminate.
const EMPHASIZED_ACCEL = Easing.bezier(0.3, 0, 0.8, 0.15)
const STANDARD = Easing.bezier(0.2, 0, 0, 1)
// Material's indeterminate linear keyframe easings.
const LINE1_HEAD = Easing.bezierFn(0.2, 0, 0.8, 1)
const LINE1_TAIL = Easing.bezierFn(0.4, 0, 1, 1)
const LINE2_HEAD = Easing.bezierFn(0, 0, 0.65, 1)
const LINE2_TAIL = Easing.bezierFn(0.1, 0, 0.45, 1)

export function WavyProgress({
  progress,
  wave = true,
  color,
  trackColor,
  style,
}: {
  progress?: number
  // false draws a flat bar (for static gauges).
  wave?: boolean
  color?: string
  trackColor?: string
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  const [w, setW] = useState(0)
  const indeterminate = progress === undefined
  const clamped = Math.min(1, Math.max(0, progress ?? 0))
  const p = useSharedValue(clamped)
  useEffect(() => {
    p.value = withTiming(clamped, { duration: 500, easing: Easing.linear })
  }, [clamped, p])
  const thickness = 4
  const wavelength = indeterminate ? 20 : 40
  const maxAmp = 3
  const flat = !wave || (!indeterminate && (clamped <= 0.1 || clamped >= 0.95))
  const amp = useSharedValue(flat ? 0 : maxAmp)
  useEffect(() => {
    amp.value = withTiming(flat ? 0 : maxAmp, { duration: 500, easing: flat ? EMPHASIZED_ACCEL : STANDARD })
  }, [flat, amp])
  const phase = usePhase(wave, 1000)
  // Indeterminate: two segments chase across the track every 1.8 s.
  const cycle = usePhase(indeterminate, 1800)

  const height = 10
  const mid = height / 2
  const gap = 4
  const cap = thickness / 2

  const wavePath = (from: number, to: number, a: number, ph: number) => {
    'worklet'
    let d = `M${from.toFixed(1)} ${(mid + a * Math.sin((from / wavelength - ph) * 2 * Math.PI)).toFixed(2)}`
    for (let x = from + 2; x < to; x += 2) d += `L${x.toFixed(1)} ${(mid + a * Math.sin((x / wavelength - ph) * 2 * Math.PI)).toFixed(2)}`
    d += `L${to.toFixed(1)} ${(mid + a * Math.sin((to / wavelength - ph) * 2 * Math.PI)).toFixed(2)}`
    return d
  }
  // Head/tail of the two indeterminate segments, as 0..1 of the width.
  const segments = (t: number) => {
    'worklet'
    const ms = t * 1800
    const k = (start: number, dur: number, e: (x: number) => number) => e(Math.min(1, Math.max(0, (ms - start) / dur)))
    return [
      [k(333, 850, LINE1_TAIL), k(0, 750, LINE1_HEAD)],
      [k(1267, 533, LINE2_TAIL), k(1000, 567, LINE2_HEAD)],
    ]
  }

  const active = useAnimatedProps(() => {
    const usable = w - cap * 2
    if (usable <= 0) return { d: 'M0 0', strokeOpacity: 0 }
    if (indeterminate) {
      let d = ''
      for (const [tail, head] of segments(cycle.value)) {
        const from = cap + tail * usable
        const to = cap + head * usable
        if (to - from > 0.5) d += wavePath(from, to, amp.value * Math.min(1, (to - from) / wavelength), phase.value)
      }
      return { d: d || 'M0 0', strokeOpacity: d ? 1 : 0 }
    }
    const to = cap + p.value * usable
    if (to - cap < 0.5) return { d: 'M0 0', strokeOpacity: 0 }
    return { d: wavePath(cap, to, amp.value, phase.value), strokeOpacity: 1 }
  })
  const track = useAnimatedProps(() => {
    const usable = w - cap * 2
    const end = w - cap
    if (usable <= 0) return { d: 'M0 0', strokeOpacity: 0 }
    if (indeterminate) {
      // Track fills the gaps around the two moving segments.
      const segs = segments(cycle.value).map(([t, h]) => [cap + t * usable, cap + h * usable]).filter(([a, b]) => b - a > 0.5).sort((x, y) => x[0] - y[0])
      let d = ''
      let x = cap
      for (const [a, b] of segs) {
        const stop = a - gap - thickness
        if (stop - x > 0.5) d += `M${x.toFixed(1)} ${mid}L${stop.toFixed(1)} ${mid}`
        x = Math.max(x, b + gap + thickness)
      }
      if (end - x > 0.5) d += `M${x.toFixed(1)} ${mid}L${end.toFixed(1)} ${mid}`
      return { d: d || 'M0 0', strokeOpacity: d ? 1 : 0 }
    }
    const from = cap + p.value * usable + (p.value > 0 ? gap + thickness : 0)
    return { d: from < end ? `M${from.toFixed(1)} ${mid}L${end.toFixed(1)} ${mid}` : 'M0 0', strokeOpacity: from < end ? 1 : 0 }
  })

  const fg = color ?? c.accent
  const bg = trackColor ?? c.secondaryContainer
  return (
    <View style={[{ height }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <AnimatedPath animatedProps={track} stroke={bg} strokeWidth={thickness} strokeLinecap="round" fill="none" />
          {indeterminate ? null : <Circle cx={w - cap} cy={mid} r={cap} fill={fg} />}
          <AnimatedPath animatedProps={active} stroke={fg} strokeWidth={thickness} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      )}
    </View>
  )
}

// Circular wavy progress. Without `progress` it spins as an indeterminate indicator.
export function WavyCircle({ size = 48, progress, color, trackColor, thickness = 4, amplitude = 1.6 }: { size?: number; progress?: number; color?: string; trackColor?: string; thickness?: number; amplitude?: number }) {
  const { c: pal } = useTheme()
  const indeterminate = progress === undefined
  const p = useSharedValue(progress ?? 0)
  useEffect(() => {
    if (!indeterminate) p.value = withTiming(Math.min(1, Math.max(0, progress!)), { duration: 500, easing: Easing.linear })
  }, [progress, indeterminate, p])
  const phase = usePhase(true, indeterminate ? 1400 : 2400)
  const c = size / 2
  const r = c - thickness / 2 - amplitude
  const gapA = (thickness + 4) / r
  // A 15dp wavelength around the ring, as in the Compose tokens.
  const waves = Math.max(6, Math.round((2 * Math.PI * r) / 15))

  const active = useAnimatedProps(() => {
    let a0: number
    let sweep: number
    if (indeterminate) {
      // Sweep grows and shrinks while the whole arc turns.
      const s = phase.value
      sweep = (0.15 + 0.6 * Math.abs(Math.sin(s * Math.PI))) * 2 * Math.PI
      a0 = s * 2 * Math.PI * 1.5 - Math.PI / 2
    } else {
      sweep = p.value * 2 * Math.PI - (p.value < 1 ? gapA : 0)
      a0 = -Math.PI / 2
    }
    if (sweep <= 0.01) return { d: 'M0 0', strokeOpacity: 0 }
    const steps = Math.max(8, Math.ceil(sweep * 24))
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps
      const rr = r + amplitude * Math.sin(waves * a - phase.value * 2 * Math.PI)
      d += (i ? 'L' : 'M') + (c + rr * Math.cos(a)).toFixed(2) + ' ' + (c + rr * Math.sin(a)).toFixed(2)
    }
    return { d, strokeOpacity: 1 }
  })
  const track = useAnimatedProps(() => {
    if (indeterminate) return { d: 'M0 0', strokeOpacity: 0 }
    const a0 = -Math.PI / 2 + p.value * 2 * Math.PI + gapA
    const a1 = -Math.PI / 2 + 2 * Math.PI - (p.value > 0 ? gapA : 0)
    if (a1 - a0 <= 0.01) return { d: 'M0 0', strokeOpacity: 0 }
    const large = a1 - a0 > Math.PI ? 1 : 0
    const d = `M${(c + r * Math.cos(a0)).toFixed(2)} ${(c + r * Math.sin(a0)).toFixed(2)}A${r} ${r} 0 ${large} 1 ${(c + r * Math.cos(a1)).toFixed(2)} ${(c + r * Math.sin(a1)).toFixed(2)}`
    return { d, strokeOpacity: 1 }
  })
  return (
    <Svg width={size} height={size}>
      <AnimatedPath animatedProps={track} stroke={trackColor ?? pal.secondaryContainer} strokeWidth={thickness} strokeLinecap="round" fill="none" />
      <AnimatedPath animatedProps={active} stroke={color ?? pal.accent} strokeWidth={thickness} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}
