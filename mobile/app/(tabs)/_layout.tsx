import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { Tabs } from 'expo-router'
import { CircleUserRound, Download, House, Search, Sparkles, type LucideIcon } from 'lucide-react-native'
import { useRequestsConfig } from '../../src/lib/queries'
import { useDownloadCount } from '../../src/lib/downloads'
import { haptic } from '../../src/lib/haptics'
import { motion } from '../../src/components/expressive'
import { Text } from '../../src/components/ui'
import { makeStyles, useTheme } from '../../src/theme'

const ICONS: Record<string, LucideIcon> = { index: House, search: Search, requests: Sparkles, downloads: Download, me: CircleUserRound }

// M3 navigation bar: the selected tab's icon sits on a pill that springs open.
function Tab({ name, label, focused, badge, onPress }: { name: string; label: string; focused: boolean; badge?: number; onPress: () => void }) {
  const { c } = useTheme()
  const s = useStyles()
  const v = useSharedValue(focused ? 1 : 0)
  useEffect(() => {
    v.value = withSpring(focused ? 1 : 0, motion.bouncy)
  }, [focused, v])
  const pill = useAnimatedStyle(() => ({ transform: [{ scaleX: 0.4 + 0.6 * v.value }], opacity: v.value }))
  const Icon = ICONS[name] ?? House
  const fg = focused ? c.onSecondaryContainer : c.muted
  return (
    <Pressable
      onPress={() => {
        if (!focused) haptic.tick()
        onPress()
      }}
      style={s.tab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
    >
      <View style={s.iconWrap}>
        <Animated.View style={[s.pill, pill]} />
        <Icon size={24} color={fg} strokeWidth={focused ? 2.3 : 1.9} />
        {!!badge && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[s.label, { color: focused ? c.fg : c.muted }, focused && { fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  )
}

export default function TabsLayout() {
  const { c } = useTheme()
  const s = useStyles()
  const cfg = useRequestsConfig()
  const active = useDownloadCount('downloading')
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'fade' }}
      tabBar={({ state, descriptors, insets, navigateToTab }) => (
        <View style={[s.bar, { paddingBottom: insets.bottom }]}>
          {state.routes
            .filter((r) => !descriptors[r.key].options.hidden)
            .map((r) => {
              const o = descriptors[r.key].options
              return (
                <Tab
                  key={r.key}
                  name={r.name}
                  label={o.title ?? r.name}
                  focused={state.routes[state.index].key === r.key}
                  badge={typeof o.tabBarBadge === 'number' ? o.tabBarBadge : undefined}
                  onPress={() => navigateToTab(r.key)}
                />
              )
            })}
        </View>
      )}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', href: cfg.data?.enabled ? undefined : null }} />
      <Tabs.Screen name="downloads" options={{ title: 'Downloads', tabBarBadge: active || undefined }} />
      <Tabs.Screen name="me" options={{ title: 'You' }} />
    </Tabs>
  )
}

const useStyles = makeStyles((c, f) => ({
  bar: { flexDirection: 'row', backgroundColor: c.surface2, paddingTop: 12 },
  tab: { flex: 1, alignItems: 'center', paddingBottom: 12, gap: 4 },
  iconWrap: { width: 64, height: 32, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16, backgroundColor: c.secondaryContainer },
  label: { ...f.labelSmall, fontSize: 12, letterSpacing: 0.2 },
  badge: { position: 'absolute', top: 0, left: 36, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: c.dark ? '#690005' : '#ffffff' },
}))
