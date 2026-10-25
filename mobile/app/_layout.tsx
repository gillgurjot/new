import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as Network from 'expo-network'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '../src/lib/auth'
import { loadPrefs } from '../src/lib/prefs'
import { flushProgress, restoreDownloads } from '../src/lib/downloads'
import { Toaster } from '../src/components/ui'
import { ApiError } from '../src/api/client'
import { ThemeProvider, useTheme } from '../src/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
    },
  },
})

// Refetch when the app comes back to the front, and pause queries while offline.
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'))
  return () => sub.remove()
})
onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((s) => setOnline(s.isConnected !== false))
  return () => sub.remove()
})

function Root() {
  const { ready, user } = useAuth()
  const { c } = useTheme()
  // Wait for the saved theme so the first frame isn't the wrong colours.
  const [prefsReady, setPrefsReady] = useState(false)

  useEffect(() => {
    loadPrefs()
      .then(() => {
        setPrefsReady(true)
        return restoreDownloads()
      })
      .catch(() => setPrefsReady(true))
  }, [])

  useEffect(() => {
    if (ready && prefsReady) SplashScreen.hideAsync().catch(() => {})
  }, [ready, prefsReady])

  // Send progress made on downloads while offline.
  useEffect(() => {
    if (!user) return
    flushProgress()
    const a = AppState.addEventListener('change', (s) => s === 'active' && flushProgress())
    const n = Network.addNetworkStateListener((s) => s.isConnected && flushProgress())
    return () => {
      a.remove()
      n.remove()
    }
  }, [user])

  if (!ready || !prefsReady) return <View style={{ flex: 1, backgroundColor: c.bg }} />
  const signedIn = !!user
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, statusBarStyle: c.dark ? 'light' : 'dark', animation: 'slide_from_right', orientation: 'portrait_up' }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="item/[id]" />
        <Stack.Screen name="library/[id]" />
        <Stack.Screen name="favorites" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="join" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="request/[type]/[id]" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="admin/index" />
        <Stack.Screen name="admin/libraries" />
        <Stack.Screen name="admin/users" />
        <Stack.Screen name="play/[id]" options={{ orientation: 'landscape', animation: 'fade', navigationBarHidden: true, statusBarHidden: true, autoHideHomeIndicator: true }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
      </Stack.Protected>
    </Stack>
  )
}

function Shell() {
  const { c } = useTheme()
  return (
    <>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Root />
        <Toaster />
      </View>
    </>
  )
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
