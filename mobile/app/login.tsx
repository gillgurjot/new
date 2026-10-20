import { useState } from 'react'
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown } from 'lucide-react-native'
import { Button } from '../src/components/ui'
import { DEFAULT_SERVER, SignInCancelled, useAuth } from '../src/lib/auth'
import { c, radius } from '../src/theme'

export default function Login() {
  const insets = useSafeAreaInsets()
  const { signIn, server: saved } = useAuth()
  const [server, setServer] = useState(saved || DEFAULT_SERVER)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dev, setDev] = useState('')
  const [showDev, setShowDev] = useState(false)

  const go = async (devUser?: string) => {
    setBusy(true)
    setError('')
    try {
      await signIn(server, devUser)
    } catch (e) {
      if (!(e instanceof SignInCancelled)) setError((e as Error).message || 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <LinearGradient colors={['#1a1430', c.bg, c.bg]} style={StyleSheet.absoluteFill} />
      <View style={[styles.wrap, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <View style={{ alignItems: 'center' }}>
          <Pressable onLongPress={() => setShowDev((s) => !s)} delayLongPress={1500}>
            <LinearGradient colors={['#a78bfa', '#f472b6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
              <View style={styles.tri} />
            </LinearGradient>
          </Pressable>
          <Text style={styles.brand}>Lumen</Text>
          <Text style={styles.tag}>Your movies and shows, everywhere.</Text>
        </View>

        <View style={{ gap: 12 }}>
          {editing ? (
            <TextInput
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              selectTextOnFocus
              placeholder="https://lumen.example.com"
              placeholderTextColor={c.muted}
              style={styles.input}
              onSubmitEditing={() => go()}
            />
          ) : (
            <Pressable onPress={() => setEditing(true)} style={styles.server}>
              <Text style={{ color: c.muted, fontSize: 12 }}>Server</Text>
              <Text style={{ color: c.fg, fontSize: 14, flex: 1, textAlign: 'right' }} numberOfLines={1}>{server.replace(/^https?:\/\//, '')}</Text>
              <ChevronDown size={16} color={c.muted} />
            </Pressable>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button title="Sign in" variant="primary" onPress={() => go()} loading={busy && !dev} style={{ height: 52 }} />
          {showDev && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={dev} onChangeText={setDev} placeholder="Test user name" placeholderTextColor={c.muted} style={[styles.input, { flex: 1 }]} autoCapitalize="none" />
              <Button title="Test sign-in" onPress={() => dev && go(dev)} disabled={!dev} loading={busy && !!dev} />
            </View>
          )}
          <Text style={styles.hint}>You sign in with your Pocket ID account. Lumen works at home or over Tailscale.</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
  logo: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  tri: { width: 0, height: 0, marginLeft: 8, borderTopWidth: 18, borderBottomWidth: 18, borderLeftWidth: 30, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: c.bg },
  brand: { color: c.fg, fontSize: 38, fontWeight: '800', letterSpacing: -1.2, marginTop: 18 },
  tag: { color: c.muted, fontSize: 15, marginTop: 6 },
  input: { height: 52, borderRadius: radius.md, backgroundColor: c.surface2, color: c.fg, paddingHorizontal: 14, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  server: { height: 52, borderRadius: radius.md, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  error: { color: c.danger, fontSize: 14, textAlign: 'center' },
  hint: { color: c.muted, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
})
