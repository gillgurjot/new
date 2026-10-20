import { Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CircleUserRound, Download, House, Search, Sparkles } from 'lucide-react-native'
import { useRequestsConfig } from '../../src/lib/queries'
import { useDownloads } from '../../src/lib/downloads'
import { c } from '../../src/theme'

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const cfg = useRequestsConfig()
  const active = useDownloads().filter((d) => d.state === 'downloading').length
  const icon = (I: typeof House) => ({ color, focused }: { color: unknown; focused: boolean }) => <I size={23} color={color as string} strokeWidth={focused ? 2.4 : 1.8} />
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.white,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
        tabBarStyle: { backgroundColor: 'rgba(12,12,17,0.98)', borderTopColor: c.line, height: 58 + insets.bottom, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: c.bg },
        animation: 'fade',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon(House) }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon(Search) }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', tabBarIcon: icon(Sparkles), href: cfg.data?.enabled ? undefined : null }} />
      <Tabs.Screen
        name="downloads"
        options={{ title: 'Downloads', tabBarIcon: icon(Download), tabBarBadge: active || undefined, tabBarBadgeStyle: { backgroundColor: c.accentStrong, fontSize: 10 } }}
      />
      <Tabs.Screen name="me" options={{ title: 'You', tabBarIcon: icon(CircleUserRound) }} />
    </Tabs>
  )
}
