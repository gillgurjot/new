import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native'
import { Image, type ImageSource } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ArrowLeft, Check, CircleAlert, Info } from 'lucide-react-native'
import { c, font, radius } from '../theme'

// ---------- buttons ----------

type Variant = 'primary' | 'accent' | 'ghost' | 'danger' | 'subtle'

export function Button({
  title, icon, onPress, variant = 'ghost', loading, disabled, style, small, testID,
}: {
  title?: string
  icon?: ReactNode
  onPress?: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  small?: boolean
  testID?: string
}) {
  const v = variants[variant]
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: v.bg },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon}
      {!!title && <Text style={[styles.btnText, small && { fontSize: 13 }, { color: v.fg }]} numberOfLines={1}>{title}</Text>}
    </Pressable>
  )
}

const variants: Record<Variant, { bg: string; fg: string }> = {
  primary: { bg: c.white, fg: c.black },
  accent: { bg: c.accentStrong, fg: c.white },
  ghost: { bg: 'rgba(255,255,255,0.1)', fg: c.fg },
  subtle: { bg: 'transparent', fg: c.fg },
  danger: { bg: 'rgba(248,113,113,0.15)', fg: c.danger },
}

export function IconButton({ icon, onPress, label, size = 40, style, active, ...rest }: { icon: ReactNode; onPress?: () => void; label: string; size?: number; style?: StyleProp<ViewStyle>; active?: boolean } & Omit<PressableProps, 'style'>) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.white : 'rgba(255,255,255,0.1)' },
        pressed && { opacity: 0.7, transform: [{ scale: 0.95 }] },
        style,
      ]}
      {...rest}
    >
      {icon}
    </Pressable>
  )
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.8 }]}>
      {icon}
      <Text style={[styles.chipText, active && { color: c.black }]}>{label}</Text>
    </Pressable>
  )
}

// ---------- layout ----------

export function Header({ title, right, back = true, transparent }: { title?: string; right?: ReactNode; back?: boolean; transparent?: boolean }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }, transparent && { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, backgroundColor: 'transparent' }]}>
      {back && (
        <IconButton
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          icon={<ArrowLeft size={20} color={c.fg} />}
          style={transparent ? { backgroundColor: 'rgba(0,0,0,0.45)' } : undefined}
        />
      )}
      <Text style={[font.h3, { flex: 1, marginLeft: back ? 12 : 4 }]} numberOfLines={1}>{transparent ? '' : title}</Text>
      {right}
    </View>
  )
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={font.h1}>{children}</Text>
      {!!sub && <Text style={[font.small, { marginTop: 4 }]}>{sub}</Text>}
    </View>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 }}>
      <Text style={[font.h2, { flex: 1, fontSize: 18 }]}>{children}</Text>
      {right}
    </View>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
      {icon && <View style={styles.emptyIcon}>{icon}</View>}
      <Text style={[font.h3, { textAlign: 'center' }]}>{title}</Text>
      {!!children && <Text style={[font.small, { textAlign: 'center', marginTop: 6, lineHeight: 19 }]}>{children}</Text>}
      {action && <View style={{ marginTop: 18 }}>{action}</View>}
    </View>
  )
}

export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }, style]}>
      <ActivityIndicator color={c.accent} size="large" />
    </View>
  )
}

export function ProgressBar({ pct, style, color = c.accent }: { pct: number; style?: StyleProp<ViewStyle>; color?: string }) {
  return (
    <View style={[{ height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }, style]}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', backgroundColor: color }} />
    </View>
  )
}

export function Meta({ items, style }: { items: (string | false | undefined | null)[]; style?: StyleProp<TextStyle> }) {
  return <Text style={[font.small, style]}>{items.filter(Boolean).join('  ·  ')}</Text>
}

export function Img({ source, style, contentFit = 'cover', fallback, transition = 200 }: { source?: ImageSource | string; style?: StyleProp<ViewStyle>; contentFit?: 'cover' | 'contain'; fallback?: ReactNode; transition?: number }) {
  const [failed, setFailed] = useState(false)
  if (!source || failed) return <View style={[{ backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>{fallback}</View>
  return (
    <Image
      source={source}
      style={[{ backgroundColor: c.surface2 }, style as never]}
      contentFit={contentFit}
      transition={transition}
      cachePolicy="memory-disk"
      recyclingKey={typeof source === 'string' ? source : source.uri}
      onError={() => setFailed(true)}
    />
  )
}

export function Avatar({ name, uri, size = 32 }: { name: string; uri?: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue},45%,35%)`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.white, fontWeight: '700', fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

/** A settings-style row. */
export function ListRow({ icon, title, sub, right, onPress, danger }: { icon?: ReactNode; title: string; sub?: string; right?: ReactNode; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
      {icon && <View style={{ width: 28, alignItems: 'center' }}>{icon}</View>}
      <View style={{ flex: 1, marginLeft: icon ? 10 : 0 }}>
        <Text style={[font.body, { fontWeight: '500' }, danger && { color: c.danger }]}>{title}</Text>
        {!!sub && <Text style={[font.small, { marginTop: 2 }]} numberOfLines={2}>{sub}</Text>}
      </View>
      {right}
    </Pressable>
  )
}

// ---------- sheet ----------

export function Sheet({ open, onClose, children, title, maxHeight = '85%' }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; maxHeight?: `${number}%` | number }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12, maxHeight }]}>
        <View style={styles.grabber} />
        {!!title && <Text style={[font.h3, { paddingHorizontal: 20, paddingBottom: 8 }]}>{title}</Text>}
        <ScrollView bounces={false} contentContainerStyle={{ paddingHorizontal: 8 }}>{children}</ScrollView>
      </View>
    </Modal>
  )
}

export interface MenuOption {
  label: string
  sub?: string
  selected?: boolean
  icon?: ReactNode
  danger?: boolean
  onPress: () => void
}

/** A list of choices in a bottom sheet. */
export function MenuSheet({ open, onClose, title, options, note }: { open: boolean; onClose: () => void; title?: string; options: MenuOption[]; note?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {options.map((o, i) => (
        <Pressable
          key={i}
          onPress={() => {
            onClose()
            o.onPress()
          }}
          style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: 'rgba(255,255,255,0.06)' }]}
        >
          {o.icon && <View style={{ width: 26 }}>{o.icon}</View>}
          <View style={{ flex: 1 }}>
            <Text style={[font.body, o.danger && { color: c.danger }, o.selected && { fontWeight: '700' }]}>{o.label}</Text>
            {!!o.sub && <Text style={font.small}>{o.sub}</Text>}
          </View>
          {o.selected && <Check size={18} color={c.accent} />}
        </Pressable>
      ))}
      {!!note && <Text style={[font.small, { padding: 12 }]}>{note}</Text>}
    </Sheet>
  )
}

// ---------- toasts ----------

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
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 80, alignItems: 'center', gap: 8 }}>
      {list.map((t) => <ToastView key={t.id} t={t} />)}
    </View>
  )
}

function ToastView({ t }: { t: Toast }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.spring(a, { toValue: 1, useNativeDriver: true }).start()
  }, [a])
  const Icon = t.kind === 'error' ? CircleAlert : t.kind === 'info' ? Info : Check
  const color = t.kind === 'error' ? c.danger : t.kind === 'info' ? c.info : c.success
  return (
    <Animated.View style={[styles.toast, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
      <Icon size={16} color={color} />
      <Text style={{ color: c.fg, fontSize: 14, flexShrink: 1 }}>{t.text}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  btn: { height: 46, paddingHorizontal: 18, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSmall: { height: 36, paddingHorizontal: 14 },
  btnText: { fontSize: 15, fontWeight: '700' },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  chipActive: { backgroundColor: c.white },
  chipText: { color: c.fg, fontSize: 13, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, backgroundColor: c.bg },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, borderRadius: 12, gap: 6 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface3, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, maxWidth: 420 },
})
