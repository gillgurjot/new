import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronRight, Heart, LogOut, Settings, Shield, Users } from 'lucide-react-native'
import { Avatar, Card, ListRow } from '../../src/components/ui'
import { useAuth } from '../../src/lib/auth'
import { c, font } from '../../src/theme'

export default function Me() {
  const insets = useSafeAreaInsets()
  const { user, server, signOut } = useAuth()
  if (!user) return null
  const name = user.displayName || user.username
  const chevron = <ChevronRight size={18} color={c.muted} />
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 20, paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <Avatar name={name} uri={user.avatar || undefined} size={60} />
        <View style={{ flex: 1 }}>
          <Text style={font.h2}>{name}</Text>
          <Text style={font.small} numberOfLines={1}>{user.email || user.username}{user.isAdmin ? ' · Admin' : ''}</Text>
        </View>
      </View>

      <Card>
        <ListRow icon={<Heart size={20} color={c.fg} />} title="My List" onPress={() => router.push('/favorites')} right={chevron} />
        <View style={styles.sep} />
        <ListRow icon={<Users size={20} color={c.fg} />} title="Join a watch party" sub="Paste an invite link" onPress={() => router.push('/join')} right={chevron} />
        <View style={styles.sep} />
        <ListRow icon={<Settings size={20} color={c.fg} />} title="Settings" sub="Languages, subtitles, playback, downloads" onPress={() => router.push('/settings')} right={chevron} />
      </Card>

      {user.isAdmin && (
        <Card>
          <ListRow icon={<Shield size={20} color={c.accent} />} title="Server admin" sub="Status, libraries, users, who's watching" onPress={() => router.push('/admin')} right={chevron} />
        </Card>
      )}

      <Card>
        <ListRow
          icon={<LogOut size={20} color={c.danger} />}
          title="Sign out"
          danger
          onPress={() =>
            Alert.alert('Sign out?', 'Your downloads stay on this phone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
            ])
          }
        />
      </Card>

      <Text style={[font.tiny, { textAlign: 'center' }]}>
        Lumen {Constants.expoConfig?.version} · {server.replace(/^https?:\/\//, '')}
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: 54 },
})
