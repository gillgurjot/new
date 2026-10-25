import { Children, isValidElement, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Modal, Pressable, Text as RNText, TextInput, View, useWindowDimensions, type GestureResponderEvent, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native'
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated'
import { Image, type ImageSource } from 'expo-image'
import { GestureDetector, GestureHandlerRootView, ScrollView as GHScrollView, usePanGesture } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ArrowLeft, Check, CircleAlert, Info, Search, X, type LucideIcon } from 'lucide-react-native'
import { FONT, alpha, makeStyles, radius, useTheme, type Palette } from '../theme'
import { LoadingIndicator, ShapeIcon, WavyProgress, motion, usePressValue, type ShapeName, type Tone } from './expressive'
import { haptic } from '../lib/haptics'

// ---------- text ----------

/** Text in Google Sans and the theme's text colour. */
export function Text({ style, ...p }: TextProps) {
  const { c } = useTheme()
  return <RNText {...p} style={[{ fontFamily: FONT, color: c.fg }, style]} />
}

export function Field({ style, icon: Icon, onClear, ...p }: TextInputProps & { icon?: LucideIcon; onClear?: () => void }) {
  const { c } = useTheme()
  const s = useStyles()
  return (
    <View style={[s.field, style as StyleProp<ViewStyle>]}>
      {Icon && <Icon size={20} color={c.muted} />}
      <TextInput placeholderTextColor={c.muted} cursorColor={c.accent} selectionColor={alpha(c.accent, 0.35)} {...p} style={s.fieldInput} />
      {!!onClear && !!p.value && (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel="Clear">
          <X size={20} color={c.muted} />
        </Pressable>
      )}
    </View>
  )
}

/** M3 search bar: a full pill on the highest container. */
export function SearchBar(p: TextInputProps & { onClear?: () => void }) {
  const s = useStyles()
  return <Field icon={Search} returnKeyType="search" autoCorrect={false} {...p} style={[s.search, p.style as StyleProp<ViewStyle>]} />
}

// ---------- buttons ----------

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'light'

function buttonColors(c: Palette, v: ButtonVariant): [string, string] {
  return {
    filled: [c.accent, c.onAccent],
    tonal: [c.secondaryContainer, c.onSecondaryContainer],
    outlined: ['transparent', c.muted],
    text: ['transparent', c.accent],
    danger: [c.dangerContainer, c.onDangerContainer],
    // White on artwork and video.
    light: ['#ffffff', '#000000'],
  }[v] as [string, string]
}

/**
 * Expressive button: a full pill that squares off while pressed and springs back
 * with a little overshoot. size s = 40dp, m = 48dp, l = 56dp.
 */
export function Button({
  title, icon: Icon, onPress, variant = 'tonal', loading, disabled, style, size = 'm', testID, iconFill,
}: {
  title?: string
  icon?: LucideIcon
  onPress?: () => void
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  size?: 's' | 'm' | 'l'
  testID?: string
  iconFill?: boolean
}) {
  const { c, f } = useTheme()
  const h = { s: 40, m: 48, l: 56 }[size]
  const { p, onPressIn, onPressOut } = usePressValue()
  const shape = useAnimatedStyle(() => ({ borderRadius: interpolate(p.value, [0, 1], [h / 2, size === 's' ? 8 : 12]) }))
  const off = disabled || loading
  let [bg, fg] = buttonColors(c, variant)
  if (disabled) {
    bg = variant === 'text' || variant === 'outlined' ? 'transparent' : alpha(c.fg, 0.12)
    fg = alpha(c.fg, 0.38)
  }
  return (
    <Animated.View style={[{ height: h, overflow: 'hidden', backgroundColor: bg }, variant === 'outlined' && { borderWidth: 1, borderColor: c.outline }, style, shape]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        android_ripple={{ color: alpha(fg, 0.14) }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: size === 's' ? 16 : 24 }}
      >
        {loading ? <LoadingIndicator size={22} color={fg} /> : Icon ? <Icon size={size === 'l' ? 22 : 20} color={fg} fill={iconFill ? fg : 'none'} /> : null}
        {!!title && <RNText style={[f.label, { color: fg, fontSize: size === 'l' ? 16 : size === 's' ? 14 : 15 }]} numberOfLines={1}>{title}</RNText>}
      </Pressable>
    </Animated.View>
  )
}

export type IconVariant = 'standard' | 'tonal' | 'filled' | 'outlined' | 'overlay'

/** Expressive icon button: round at rest, squares off while pressed; selected settles on a rounded square. */
export function IconButton({
  icon: Icon, onPress, onLongPress, label, size = 40, variant = 'tonal', selected, disabled, style, color, fill,
}: {
  icon: LucideIcon
  onPress?: () => void
  onLongPress?: () => void
  label: string
  size?: number
  variant?: IconVariant
  selected?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  color?: string
  fill?: boolean
}) {
  const { c } = useTheme()
  const { p, onPressIn, onPressOut } = usePressValue()
  const sel = useSharedValue(selected ? 1 : 0)
  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, motion.fastSpatial)
  }, [selected, sel])
  const shape = useAnimatedStyle(() => {
    const rest = interpolate(sel.value, [0, 1], [size / 2, size * 0.3])
    return { borderRadius: interpolate(p.value, [0, 1], [rest, size * 0.22]) }
  })
  let [bg, fg] = {
    standard: ['transparent', selected ? c.accent : c.muted],
    tonal: [selected ? c.secondary : c.secondaryContainer, selected ? c.onAccent : c.onSecondaryContainer],
    filled: [c.accent, c.onAccent],
    outlined: [selected ? c.inverse : 'transparent', selected ? c.onInverse : c.muted],
    overlay: [selected ? '#ffffff' : 'rgba(0,0,0,0.42)', selected ? '#000000' : '#ffffff'],
  }[variant]
  if (color) fg = color
  if (disabled) fg = alpha(c.fg, 0.38)
  return (
    <Animated.View style={[{ width: size, height: size, overflow: 'hidden', backgroundColor: bg }, variant === 'outlined' && !selected && { borderWidth: 1, borderColor: c.outline }, style, shape]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected, disabled }}
        android_ripple={{ color: alpha(fg, 0.16) }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon size={Math.round(size * 0.5)} color={fg} fill={fill ? fg : 'none'} />
      </Pressable>
    </Animated.View>
  )
}

/** M3 filter chip: 8dp corners, a check and the secondary container once selected. */
/** `elevated` gives the chip a tinted fill instead of an outline, for chips over artwork. */
export function Chip({ label, active, elevated, onPress, icon: Icon, trailing: Trailing }: { label: string; active?: boolean; elevated?: boolean; onPress?: () => void; icon?: LucideIcon; trailing?: LucideIcon }) {
  const { c, f } = useTheme()
  const { p, onPressIn, onPressOut } = usePressValue()
  const shape = useAnimatedStyle(() => ({ borderRadius: interpolate(p.value, [0, 1], [8, 16]) }))
  const fg = active ? c.onSecondaryContainer : c.muted
  const Lead = active && !Icon ? Check : Icon
  return (
    <Animated.View layout={LinearTransition.springify().damping(motion.calm.damping).stiffness(motion.calm.stiffness)} style={[{ height: 34, overflow: 'hidden', backgroundColor: active ? c.secondaryContainer : elevated ? alpha(c.surface3, 0.88) : 'transparent', borderWidth: active || elevated ? 0 : 1, borderColor: c.outline }, shape]}>
      <Pressable
        onPress={() => {
          haptic.tick()
          onPress?.()
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        android_ripple={{ color: alpha(fg, 0.14) }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: Lead ? 10 : 14, paddingRight: Trailing ? 10 : 14 }}
      >
        {Lead && <Lead size={16} color={fg} />}
        <RNText style={[f.label, { color: active ? c.onSecondaryContainer : c.fg, fontSize: 13.5 }]}>{label}</RNText>
        {Trailing && <Trailing size={16} color={fg} />}
      </Pressable>
    </Animated.View>
  )
}

/** Expressive switch: the thumb grows while pressed and slides on the fast spatial spring. */
export function Switch({ value, onValueChange, disabled }: { value: boolean; onValueChange?: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme()
  const on = useSharedValue(value ? 1 : 0)
  const { p, onPressIn, onPressOut } = usePressValue()
  useEffect(() => {
    on.value = withSpring(value ? 1 : 0, motion.fastSpatial)
  }, [value, on])
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [c.surface4, c.accent]),
    borderColor: interpolateColor(on.value, [0, 1], [c.outline, c.accent]),
  }))
  const thumb = useAnimatedStyle(() => {
    const size = interpolate(on.value, [0, 1], [16, 24]) + 4 * p.value
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      transform: [{ translateX: on.value * 20 + (24 - size) / 2 }],
      backgroundColor: interpolateColor(on.value, [0, 1], [c.outline, c.onAccent]),
    }
  })
  return (
    <Pressable
      onPress={() => {
        haptic.toggle(!value)
        onValueChange?.(!value)
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled || !onValueChange}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={{ opacity: disabled ? 0.38 : 1 }}
    >
      <Animated.View style={[{ width: 52, height: 32, borderRadius: 16, borderWidth: 2, justifyContent: 'center', paddingHorizontal: 2 }, track]}>
        <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, thumb]}>
          {value && <Check size={16} color={c.onAccentContainer} strokeWidth={3} />}
        </Animated.View>
      </Animated.View>
    </Pressable>
  )
}

interface Seg {
  value: string
  label?: string
  icon?: LucideIcon
}

// Compose's connected ButtonGroup: the pressed button grows and its neighbours give
// up the space; the selected one becomes a full pill.
const EXPAND = 0.18

function Segment({ b, selected, first, last, height, grow, onPress, onPressIn, onPressOut }: { b: Seg; selected: boolean; first: boolean; last: boolean; height: number; grow: number; onPress: () => void; onPressIn: () => void; onPressOut: () => void }) {
  const { c, f } = useTheme()
  const full = height / 2
  const sel = useSharedValue(selected ? 1 : 0)
  const g = useSharedValue(grow)
  const { p, onPressIn: pin, onPressOut: pout } = usePressValue()
  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, motion.bouncy)
  }, [selected, sel])
  useEffect(() => {
    g.value = withSpring(grow, motion.bouncy)
  }, [grow, g])
  const box = useAnimatedStyle(() => {
    const inner = interpolate(sel.value, [0, 1], [interpolate(p.value, [0, 1], [8, 4]), full])
    const l = first ? full : inner
    const r = last ? full : inner
    return {
      flexGrow: g.value,
      backgroundColor: interpolateColor(sel.value, [0, 1], [c.surface3, c.accent]),
      borderTopLeftRadius: l,
      borderBottomLeftRadius: l,
      borderTopRightRadius: r,
      borderBottomRightRadius: r,
    }
  })
  const fg = selected ? c.onAccent : c.muted
  return (
    <Animated.View style={[{ height, overflow: 'hidden', flexBasis: 0 }, box]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => (pin(), onPressIn())}
        onPressOut={() => (pout(), onPressOut())}
        accessibilityRole="button"
        accessibilityLabel={b.label}
        accessibilityState={{ selected }}
        android_ripple={{ color: alpha(fg, 0.14) }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 }}
      >
        {b.icon && <b.icon size={18} color={fg} />}
        {!!b.label && <RNText style={[f.label, { color: fg }]} numberOfLines={1}>{b.label}</RNText>}
      </Pressable>
    </Animated.View>
  )
}

export function SegmentedButtons({ value, onValueChange, buttons, small, style }: { value: string; onValueChange: (v: string) => void; buttons: Seg[]; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const height = small ? 40 : 48
  const [pressed, setPressed] = useState(-1)
  const last = buttons.length - 1
  const growOf = (i: number) => {
    if (pressed < 0) return 1
    if (i === pressed) return 1 + EXPAND
    if (Math.abs(i - pressed) !== 1) return 1
    return 1 - EXPAND / ((pressed > 0 ? 1 : 0) + (pressed < last ? 1 : 0))
  }
  return (
    <View style={[{ flexDirection: 'row', gap: 2 }, style]}>
      {buttons.map((b, i) => (
        <Segment
          key={b.value}
          b={b}
          selected={b.value === value}
          first={i === 0}
          last={i === last}
          height={height}
          grow={growOf(i)}
          onPressIn={() => setPressed(i)}
          onPressOut={() => setTimeout(() => setPressed((x) => (x === i ? -1 : x)), 70)}
          onPress={() => {
            if (b.value === value) return
            haptic.tick()
            onValueChange(b.value)
          }}
        />
      ))}
    </View>
  )
}

// ---------- layout ----------

/** M3 top app bar. `transparent` floats a round back button over artwork. */
export function Header({ title, right, back = true, transparent }: { title?: string; right?: ReactNode; back?: boolean; transparent?: boolean }) {
  const insets = useSafeAreaInsets()
  const s = useStyles()
  const { c } = useTheme()
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'))
  return (
    <View style={[s.header, { paddingTop: insets.top + 8 }, transparent && s.headerFloat]} pointerEvents="box-none">
      {back && <IconButton label="Back" onPress={goBack} icon={ArrowLeft} size={44} variant={transparent ? 'overlay' : 'standard'} color={transparent ? undefined : c.fg} />}
      <Text style={[s.headerTitle, { marginLeft: back ? 4 : 12 }]} numberOfLines={1}>{transparent ? '' : title}</Text>
      {right}
    </View>
  )
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  const { f } = useTheme()
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={f.display}>{children}</Text>
      {!!sub && <Text style={[f.small, { marginTop: 6 }]}>{sub}</Text>}
    </View>
  )
}

export function SectionTitle({ children, right, style }: { children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { f } = useTheme()
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12, minHeight: 28 }, style]}>
      <Text style={[f.h2, { flex: 1, fontSize: 20 }]}>{children}</Text>
      {right}
    </View>
  )
}

export function EmptyState({ icon, shape = 'cookie9', title, children, action }: { icon?: LucideIcon; shape?: ShapeName; title: string; children?: ReactNode; action?: ReactNode }) {
  const { f } = useTheme()
  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 28 }}>
      {icon && <ShapeIcon shape={shape} icon={icon} size={88} tone="secondary" spin={40} style={{ marginBottom: 18 }} />}
      <Text style={[f.h2, { textAlign: 'center', fontSize: 20 }]}>{title}</Text>
      {!!children && <Text style={[f.small, { textAlign: 'center', marginTop: 8, lineHeight: 20 }]}>{children}</Text>}
      {action && <View style={{ marginTop: 20 }}>{action}</View>}
    </Animated.View>
  )
}

export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }, style]}>
      <LoadingIndicator size={56} />
    </View>
  )
}

/** Thin progress: a rounded bar, or the Expressive wave while something is happening. */
export function ProgressBar({ pct, style, color, track, wavy }: { pct: number; style?: StyleProp<ViewStyle>; color?: string; track?: string; wavy?: boolean }) {
  const { c } = useTheme()
  if (wavy) return <WavyProgress progress={pct / 100} color={color} trackColor={track} style={style} />
  const p = Math.max(0, Math.min(100, pct))
  return (
    <View style={[{ height: 4, flexDirection: 'row', gap: 3 }, style]}>
      <View style={{ width: `${p}%`, height: '100%', borderRadius: 2, backgroundColor: color ?? c.accent }} />
      <View style={{ flex: 1, height: '100%', borderRadius: 2, backgroundColor: track ?? alpha(c.secondaryContainer, 0.9) }} />
    </View>
  )
}

export function Meta({ items, style }: { items: (string | false | undefined | null)[]; style?: StyleProp<TextStyle> }) {
  const { f } = useTheme()
  return <Text style={[f.small, style]}>{items.filter(Boolean).join('  ·  ')}</Text>
}

export function Img({ source, style, contentFit = 'cover', fallback, transition = 200 }: { source?: ImageSource | string; style?: StyleProp<ViewStyle>; contentFit?: 'cover' | 'contain'; fallback?: ReactNode; transition?: number }) {
  const { c } = useTheme()
  const [failed, setFailed] = useState(false)
  if (!source || failed) return <View style={[{ backgroundColor: c.surface3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>{fallback}</View>
  return (
    <Image
      source={source}
      style={[{ backgroundColor: c.surface3 }, style as never]}
      contentFit={contentFit}
      transition={transition}
      cachePolicy="memory-disk"
      recyclingKey={typeof source === 'string' ? source : source.uri}
      onError={() => setFailed(true)}
    />
  )
}

export function Avatar({ name, uri, size = 32 }: { name: string; uri?: string; size?: number }) {
  const { c } = useTheme()
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.tertiaryContainer, alignItems: 'center', justifyContent: 'center' }}>
      <RNText style={{ fontFamily: FONT, color: c.onTertiaryContainer, fontWeight: '600', fontSize: size * 0.4 }}>{initials || '?'}</RNText>
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  return <View style={[s.card, style]}>{children}</View>
}

// One row tile. While a finger rests on it the corners round out, like the
// Expressive lists in Android settings; a scroll lets go straight away.
function Tile({ top, bottom, children }: { top: number; bottom: number; children: ReactNode }) {
  const { c } = useTheme()
  const p = useSharedValue(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const release = () => {
    start.current = null
    p.set(withSpring(0, motion.fastSpatial))
  }
  const style = useAnimatedStyle(() => {
    const t = interpolate(p.value, [0, 1], [top, 24])
    const b = interpolate(p.value, [0, 1], [bottom, 24])
    return { borderTopLeftRadius: t, borderTopRightRadius: t, borderBottomLeftRadius: b, borderBottomRightRadius: b }
  })
  return (
    <Animated.View
      onTouchStart={(e: GestureResponderEvent) => {
        start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }
        p.set(withDelay(60, withSpring(1, motion.fastSpatial)))
      }}
      onTouchMove={(e: GestureResponderEvent) => {
        const st = start.current
        if (st && Math.abs(e.nativeEvent.pageY - st.y) + Math.abs(e.nativeEvent.pageX - st.x) > 10) release()
      }}
      onTouchEnd={release}
      onTouchCancel={release}
      style={[{ overflow: 'hidden', backgroundColor: c.surface2 }, style]}
    >
      {children}
    </Animated.View>
  )
}

/** A titled block of rows. Each row is its own tile: round outer corners, small ones between. */
export function Group({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, f } = useTheme()
  const rows = Children.toArray(children).filter(isValidElement)
  const last = rows.length - 1
  if (!rows.length) return null
  return (
    <View style={[{ marginBottom: 20 }, style]}>
      {!!title && <Text style={[f.label, { color: c.accent, paddingHorizontal: 20, marginBottom: 10 }]}>{title}</Text>}
      <View style={{ marginHorizontal: 16, gap: 2 }}>
        {rows.map((row, i) => (
          <Tile key={row.key ?? i} top={i === 0 ? 24 : 6} bottom={i === last ? 24 : 6}>
            {row}
          </Tile>
        ))}
      </View>
    </View>
  )
}

/** A settings-style row with an icon on an Expressive shape. */
export function ListRow({
  icon, shape = 'circle', tone = 'secondary', title, sub, right, onPress, danger, numberOfLines = 2,
}: {
  icon?: LucideIcon
  shape?: ShapeName
  tone?: Tone
  title: string
  sub?: string
  right?: ReactNode
  onPress?: () => void
  danger?: boolean
  numberOfLines?: number
}) {
  const { c, f } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={!onPress} android_ripple={{ color: alpha(c.fg, 0.08) }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14, minHeight: 64 }}>
      {icon && <ShapeIcon shape={shape} icon={icon} size={40} tone={danger ? 'error' : tone} />}
      <View style={{ flex: 1 }}>
        <Text style={[f.bodyStrong, { fontSize: 16 }, danger && { color: c.danger }]}>{title}</Text>
        {!!sub && <Text style={[f.small, { marginTop: 2 }]} numberOfLines={numberOfLines}>{sub}</Text>}
      </View>
      {right}
    </Pressable>
  )
}

// ---------- sheet ----------

// The surface runs this far past the bottom edge, so the spring's small overshoot never opens a gap.
const SHEET_TAIL = 64

/**
 * M3 bottom sheet: springs up with a slight settle, closes on a drag down, a fling, the scrim or Back,
 * and stays mounted until the close has played out.
 */
export function Sheet({ open, onClose, children, title, maxHeight = '85%' }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; maxHeight?: `${number}%` | number }) {
  const insets = useSafeAreaInsets()
  const s = useStyles()
  const { f } = useTheme()
  const { height: screen } = useWindowDimensions()
  const [shown, setShown] = useState(open)
  const laidOut = useRef(false)
  const h = useSharedValue(screen) // laid-out height of the visible part
  const y = useSharedValue(screen + SHEET_TAIL) // 0 = open, h = just off screen
  const scrollY = useSharedValue(0)
  const grab = useSharedValue(0) // drag distance already spent scrolling the list back to the top
  const close = useRef(onClose)
  close.current = onClose
  const requestClose = () => close.current()
  const unmount = () => {
    laidOut.current = false
    setShown(false)
  }

  useEffect(() => {
    if (open) {
      setShown(true)
      // Reopened while closing: it's already laid out, so spring straight back.
      if (laidOut.current) y.value = withSpring(0, motion.sheet)
    } else if (shown) {
      y.value = withTiming(h.value + SHEET_TAIL, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(unmount)()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pan = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-24, 24],
    onBegin: () => {
      'worklet'
      grab.value = 0
    },
    onUpdate: (e) => {
      'worklet'
      // While the list is scrolled down the drag scrolls it; once it reaches the top the sheet follows.
      if (scrollY.value > 0 && y.value === 0) {
        grab.value = e.translationY
        return
      }
      y.value = Math.max(0, e.translationY - grab.value)
    },
    onDeactivate: (e) => {
      'worklet'
      const fling = e.velocityY > 900
      if (y.value > 0 && (fling || y.value > h.value * 0.35)) {
        y.value = withTiming(h.value + SHEET_TAIL, { duration: 180, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) runOnJS(requestClose)()
        })
      } else if (y.value !== 0) {
        y.value = withSpring(0, { ...motion.sheet, velocity: e.velocityY })
      }
    },
  })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, h.value], [1, 0], 'clamp') }))

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[s.backdrop, scrimStyle]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={(e) => {
              h.value = e.nativeEvent.layout.height - SHEET_TAIL
              if (laidOut.current || !open) return
              laidOut.current = true
              // Start exactly one sheet-height down, then spring up.
              y.value = h.value + SHEET_TAIL
              y.value = withSpring(0, motion.sheet)
            }}
            style={[s.sheet, { bottom: -SHEET_TAIL, paddingBottom: insets.bottom + 12 + SHEET_TAIL, maxHeight }, sheetStyle]}
          >
            <View style={s.grabber} />
            {!!title && <Text style={[f.h2, { paddingHorizontal: 24, paddingBottom: 10, fontSize: 20 }]}>{title}</Text>}
            <GHScrollView
              simultaneousWith={pan}
              bounces={false}
              overScrollMode="never"
              scrollEventThrottle={16}
              onScroll={(e) => {
                scrollY.value = e.nativeEvent.contentOffset.y
              }}
              contentContainerStyle={{ paddingHorizontal: 12 }}
            >
              {children}
            </GHScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  )
}

export interface MenuOption {
  label: string
  sub?: string
  selected?: boolean
  icon?: LucideIcon
  danger?: boolean
  onPress: () => void
}

/** A list of choices in a bottom sheet; the picked one sits on a tonal pill. */
export function MenuSheet({ open, onClose, title, options, note }: { open: boolean; onClose: () => void; title?: string; options: MenuOption[]; note?: string }) {
  const { c, f } = useTheme()
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {options.map((o, i) => {
        const fg = o.danger ? c.danger : o.selected ? c.onSecondaryContainer : c.fg
        return (
          <Pressable
            key={i}
            onPress={() => {
              haptic.tick()
              onClose()
              o.onPress()
            }}
            android_ripple={{ color: alpha(c.fg, 0.08) }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, paddingVertical: 8, borderRadius: 28, gap: 14, marginBottom: 2, backgroundColor: o.selected ? c.secondaryContainer : 'transparent', overflow: 'hidden' }}
          >
            {o.icon && <o.icon size={22} color={o.danger ? c.danger : o.selected ? c.onSecondaryContainer : c.muted} />}
            <View style={{ flex: 1 }}>
              <Text style={[f.body, { color: fg, fontSize: 16 }, o.selected && { fontWeight: '600' }]}>{o.label}</Text>
              {!!o.sub && <Text style={[f.small, o.selected && { color: alpha(c.onSecondaryContainer, 0.8) }]}>{o.sub}</Text>}
            </View>
            {o.selected && <Check size={20} color={c.onSecondaryContainer} />}
          </Pressable>
        )
      })}
      {!!note && <Text style={[f.small, { padding: 16 }]}>{note}</Text>}
    </Sheet>
  )
}

// ---------- snackbars ----------

type Toast = { id: number; text: string; kind: 'ok' | 'error' | 'info' }
let toasts: Toast[] = []
const toastSubs = new Set<() => void>()
let tid = 0

export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const t = { id: ++tid, text, kind }
  toasts = [...toasts.slice(-2), t]
  toastSubs.forEach((f) => f())
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    toastSubs.forEach((f) => f())
  }, 3200)
}

export function Toaster() {
  const list = useSyncExternalStore(
    (f) => {
      toastSubs.add(f)
      return () => toastSubs.delete(f)
    },
    () => toasts,
  )
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 88, alignItems: 'center', gap: 8 }}>
      {list.map((t) => <ToastView key={t.id} t={t} />)}
    </View>
  )
}

function ToastView({ t }: { t: Toast }) {
  const { c, f } = useTheme()
  const Icon = t.kind === 'error' ? CircleAlert : t.kind === 'info' ? Info : Check
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.duration(150)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.inverse, paddingHorizontal: 16, minHeight: 48, paddingVertical: 12, borderRadius: 16, maxWidth: 440, alignSelf: 'stretch', elevation: 3 }}
    >
      <Icon size={18} color={t.kind === 'error' ? (c.dark ? '#b3261e' : '#f2b8b5') : c.inverseAccent} />
      <Text style={[f.body, { color: c.onInverse, flexShrink: 1, fontSize: 14 }]}>{t.text}</Text>
    </Animated.View>
  )
}

const useStyles = makeStyles((c, f) => ({
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, borderRadius: radius.md, backgroundColor: c.surface3, paddingHorizontal: 16 },
  fieldInput: { flex: 1, color: c.fg, fontSize: 16, paddingVertical: 0, fontFamily: FONT },
  search: { borderRadius: radius.pill, backgroundColor: c.surface4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, minHeight: 64, backgroundColor: c.bg },
  headerFloat: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, backgroundColor: 'transparent', paddingHorizontal: 12 },
  headerTitle: { ...f.h2, flex: 1, fontWeight: '500' },
  card: { backgroundColor: c.surface2, borderRadius: 24, overflow: 'hidden' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 6 },
  grabber: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: c.outline, marginTop: 10, marginBottom: 16, opacity: 0.6 },
}))
