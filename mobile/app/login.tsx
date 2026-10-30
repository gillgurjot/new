import { useState } from 'react'
import { KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LogIn, Pencil, Play, Server } from 'lucide-react-native'
import { Button, Field, Text } from '../src/components/ui'
import { MorphShape } from '../src/components/expressive'
import { DEFAULT_SERVER, SignInCancelled, useAuth } from '../src/lib/auth'
import { makeStyles, useTheme } from '../src/theme'

export default function Login() {
  const insets = useSafeAreaInsets()
  const { c } = useTheme()
  const styles = useStyles()
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
      <LinearGradient colors={[c.accentContainer, c.bg, c.bg]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={[styles.wrap, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]}>
        <View style={{ alignItems: 'center' }}>
          <Pressable onLongPress={() => setShowDev((s) => !s)} delayLongPress={1500}>
            <MorphShape shapes={['cookie9', 'sunny', 'clover4', 'softBurst']} size={112} color={c.accent} interval={1400}>
              <Play size={40} color={c.onAccent} fill={c.onAccent} style={{ marginLeft: 6 }} />
            </MorphShape>
          </Pressable>
          <Text style={styles.brand}>Lumen</Text>
          <Text style={styles.tag}>Your movies and shows, everywhere.</Text>
        </View>

        <View style={{ gap: 12 }}>
          {editing ? (
            <Field
              icon={Server}
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              selectTextOnFocus
              placeholder="https://lumen.example.com"
              onSubmitEditing={() => go()}
            />
          ) : (
            <Pressable onPress={() => setEditing(true)} style={styles.server} android_ripple={{ color: c.faint }}>
              <Server size={18} color={c.muted} />
              <Text style={styles.serverText} numberOfLines={1}>{server.replace(/^https?:\/\//, '')}</Text>
              <Pencil size={16} color={c.muted} />
            </Pressable>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button title="Sign in" variant="filled" size="l" icon={LogIn} onPress={() => go()} loading={busy && !dev} />
          {showDev && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Field value={dev} onChangeText={setDev} placeholder="Test user name" style={{ flex: 1 }} autoCapitalize="none" />
              <Button title="Test" onPress={() => dev && go(dev)} disabled={!dev} loading={busy && !!dev} />
            </View>
          )}
          <Text style={styles.hint}>You sign in with your Pocket ID account. Lumen works at home or over Tailscale.</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const useStyles = makeStyles((c, f) => ({
  wrap: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
  brand: { ...f.display, fontSize: 44, lineHeight: 52, marginTop: 22 },
  tag: { ...f.body, color: c.muted, marginTop: 4 },
  server: { height: 56, borderRadius: 28, backgroundColor: c.surface3, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, overflow: 'hidden' },
  serverText: { ...f.body, flex: 1 },
  error: { ...f.small, color: c.danger, textAlign: 'center' },
  hint: { ...f.tiny, textAlign: 'center', lineHeight: 18 },
}))
