import { useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, KeyRound, Link2, Server, Unplug } from 'lucide-react-native'
import { api, del, errorText, put } from '../../src/api/client'
import type { Integration, Integrations } from '../../src/api/types'
import { Button, Field, Group, Header, ListRow, Loading, Text, toast } from '../../src/components/ui'
import { useTheme } from '../../src/theme'

// Connect Jellyfin (watch-history sync) and Seerr (requests) without touching the server's
// environment. The server checks the address and key before it saves them.

export default function AdminIntegrations() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => api<Integrations>('/api/admin/integrations') })
  const changed = (d: Integrations) => {
    qc.setQueryData(['admin', 'integrations'], d)
    qc.invalidateQueries({ queryKey: ['admin', 'jellyfin'] })
    qc.invalidateQueries({ queryKey: ['requests-config'] })
  }
  return (
    <View style={{ flex: 1 }}>
      <Header title="Integrations" />
      {!q.data ? (
        <Loading />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <ServerSettings
              name="jellyfin"
              title="Jellyfin"
              blurb="Carries over watch history, Continue watching, favourites and intro markers, both ways."
              keyHint="Jellyfin dashboard → API Keys → +"
              urlPlaceholder="http://jellyfin:8096"
              info={q.data.jellyfin}
              onChange={changed}
            />
            <ServerSettings
              name="seerr"
              title="Seerr"
              blurb="Lets people request movies and shows. Seerr sends them to Radarr and Sonarr."
              keyHint="Seerr → Settings → General → API Key"
              urlPlaceholder="http://seerr:5055"
              info={q.data.seerr}
              onChange={changed}
              withPublicUrl
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  )
}

function ServerSettings({ name, title, blurb, keyHint, urlPlaceholder, info, onChange, withPublicUrl }: {
  name: 'jellyfin' | 'seerr'
  title: string
  blurb: string
  keyHint: string
  urlPlaceholder: string
  info: Integration
  onChange: (d: Integrations) => void
  withPublicUrl?: boolean
}) {
  const { c, f } = useTheme()
  const [editing, setEditing] = useState(!info.enabled)
  const [url, setUrl] = useState(info.url)
  const [publicUrl, setPublicUrl] = useState(info.publicUrl || '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    setUrl(info.url)
    setPublicUrl(info.publicUrl || '')
  }, [info.url, info.publicUrl])

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const d = await put<Integrations>(`/api/admin/integrations/${name}`, { url: url.trim(), apiKey: key.trim(), publicUrl: publicUrl.trim() })
      setKey('')
      setEditing(false)
      onChange(d)
      toast(`${title} connected`)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const disconnect = () =>
    Alert.alert(`Disconnect ${title}?`, name === 'jellyfin' ? 'Watch history already in Lumen stays.' : 'Requests will be hidden.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive',
        onPress: async () => {
          try {
            onChange(await del<Integrations>(`/api/admin/integrations/${name}`))
            setEditing(true)
          } catch (e) {
            toast(errorText(e), 'error')
          }
        },
      },
    ])

  const status = info.enabled ? (info.source === 'env' ? 'Connected (server environment)' : 'Connected') : info.source === 'off' ? 'Turned off' : 'Not connected'
  return (
    <Group title={title}>
      <ListRow icon={Link2} shape={name === 'jellyfin' ? 'softBurst' : 'cookie9'} tone={info.enabled ? 'tertiary' : 'surface'} title={status} sub={blurb} numberOfLines={3} />
      {info.enabled && !editing ? (
        <View style={{ padding: 16, gap: 10 }}>
          <Text style={f.small} selectable>{info.url}</Text>
          {withPublicUrl && !!info.publicUrl && <Text style={f.small} selectable>{info.publicUrl}</Text>}
          <Text style={f.tiny}>{info.hasKey ? 'API key saved' : 'No API key'}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Button title="Change" variant="tonal" size="s" onPress={() => setEditing(true)} />
            <Button title="Disconnect" icon={Unplug} variant="text" size="s" onPress={disconnect} />
          </View>
        </View>
      ) : (
        <View style={{ padding: 16, gap: 12 }}>
          <Field icon={Server} value={url} onChangeText={setUrl} placeholder={urlPlaceholder} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Server address" />
          <Field
            icon={KeyRound}
            value={key}
            onChangeText={setKey}
            placeholder={info.hasKey ? 'Leave empty to keep the saved key' : 'API key'}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel="API key"
          />
          <Text style={f.tiny}>{keyHint}. Stored on the server and never shown again.</Text>
          {withPublicUrl && (
            <Field icon={Globe} value={publicUrl} onChangeText={setPublicUrl} placeholder="Public link (optional)" autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Public link" />
          )}
          {!!err && <Text style={[f.small, { color: c.danger }]}>{err}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={busy ? 'Checking…' : 'Test & save'} variant="filled" size="s" onPress={save} loading={busy} disabled={!url.trim() || (!info.hasKey && !key.trim())} />
            {info.enabled && <Button title="Cancel" variant="text" size="s" onPress={() => { setEditing(false); setErr(''); setKey('') }} />}
            {!info.enabled && info.source === 'saved' && <Button title="Disconnect" icon={Unplug} variant="text" size="s" onPress={disconnect} />}
          </View>
        </View>
      )}
    </Group>
  )
}
