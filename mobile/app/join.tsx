import { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Users } from 'lucide-react-native'
import { Button, Header } from '../src/components/ui'
import { parseInvite } from '../src/player/party'
import { c, font, radius } from '../src/theme'

export default function Join() {
  const [text, setText] = useState('')
  const invite = parseInvite(text)

  // Fill in a copied invite link straight away.
  useEffect(() => {
    Clipboard.getStringAsync()
      .then((s) => s && parseInvite(s) && setText(s))
      .catch(() => {})
  }, [])

  return (
    <View style={{ flex: 1 }}>
      <Header title="Join a watch party" />
      <View style={{ padding: 20, gap: 14 }}>
        <View style={styles.icon}><Users size={28} color={c.accent} /></View>
        <Text style={[font.body, { color: c.dim, lineHeight: 21 }]}>Paste the invite link someone sent you. Opening the link on this phone works too.</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="https://…/play/123?party=…"
          placeholderTextColor={c.muted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {!!text && !invite && <Text style={{ color: c.warn, fontSize: 13 }}>That doesn’t look like a Lumen invite link.</Text>}
        <Button
          title="Join"
          variant="primary"
          disabled={!invite}
          onPress={() => invite && router.replace({ pathname: '/play/[id]', params: { id: String(invite.itemId), party: invite.partyId } })}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  input: { height: 50, borderRadius: radius.md, backgroundColor: c.surface2, color: c.fg, paddingHorizontal: 14, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
})
