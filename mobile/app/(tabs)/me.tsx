import { Alert, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronRight, Heart, LogOut, Settings, Shield, Users } from 'lucide-react-native'
import { Avatar, Group, ListRow, Text } from '../../src/components/ui'
import { useAuth } from '../../src/lib/auth'
import { useTheme } from '../../src/theme'

export default function Me() {
  const insets = useSafeAreaInsets()
  const { c, f } = useTheme()
  const { user, server, signOut } = useAuth()
  if (!user) return null
  const name = user.displayName || user.username
  const chevron = <ChevronRight size={20} color={c.muted} />
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: 40 }}>
      <View style={{ alignItems: 'center', marginBottom: 28, paddingHorizontal: 16 }}>
        <Avatar name={name} uri={user.avatar || undefined} size={88} />
        <Text style={[f.h1, { marginTop: 14 }]}>{name}</Text>
        <Text style={f.small} numberOfLines={1}>{user.email || user.username}{user.isAdmin ? ' · Admin' : ''}</Text>
      </View>

      <Group>
        <ListRow icon={Heart} shape="cookie9" tone="primary" title="My List" onPress={() => router.push('/favorites')} right={chevron} />
        <ListRow icon={Users} shape="clover4" tone="tertiary" title="Join a watch party" sub="Paste an invite link" onPress={() => router.push('/join')} right={chevron} />
        <ListRow icon={Settings} shape="sunny" title="Settings" sub="Appearance, languages, subtitles, playback, downloads" onPress={() => router.push('/settings')} right={chevron} />
      </Group>

      {user.isAdmin && (
        <Group>
          <ListRow icon={Shield} shape="pentagon" tone="primary" title="Server admin" sub="Status, Jellyfin sync, libraries, users" onPress={() => router.push('/admin')} right={chevron} />
        </Group>
      )}

      <Group>
        <ListRow
          icon={LogOut}
          title="Sign out"
          danger
          onPress={() =>
            Alert.alert('Sign out?', 'Your downloads stay on this phone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
            ])
          }
        />
      </Group>

      <Text style={[f.tiny, { textAlign: 'center' }]}>
        Lumen {Constants.expoConfig?.version} · {server.replace(/^https?:\/\//, '')}
      </Text>
    </ScrollView>
  )
}
