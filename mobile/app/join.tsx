import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Link, Users } from 'lucide-react-native'
import { Button, Field, Header, Text } from '../src/components/ui'
import { ShapeIcon } from '../src/components/expressive'
import { parseInvite } from '../src/player/party'
import { useTheme } from '../src/theme'

export default function Join() {
  const { c, f } = useTheme()
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
      <View style={{ padding: 20, gap: 16 }}>
        <ShapeIcon shape="cookie9" icon={Users} size={72} tone="tertiary" spin={30} />
        <Text style={[f.body, { color: c.muted }]}>Paste the invite link someone sent you. Opening the link on this phone works too.</Text>
        <Field
          icon={Link}
          value={text}
          onChangeText={setText}
          onClear={() => setText('')}
          placeholder="https://…/play/123?party=…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {!!text && !invite && <Text style={[f.small, { color: c.danger }]}>That doesn’t look like a Lumen invite link.</Text>}
        <Button
          title="Join"
          variant="filled"
          size="l"
          icon={Users}
          disabled={!invite}
          onPress={() => invite && router.replace({ pathname: '/play/[id]', params: { id: String(invite.itemId), party: invite.partyId } })}
        />
      </View>
    </View>
  )
}
