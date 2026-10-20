import { useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { errorText, put } from '../src/api/client'
import type { User } from '../src/api/types'
import { Card, Header, ListRow, MenuSheet, toast } from '../src/components/ui'
import { useAuth } from '../src/lib/auth'
import { applyDownloadSettings } from '../src/lib/downloads'
import { langLabel } from '../src/lib/format'
import { qualityOptions, setPrefs, usePrefs } from '../src/lib/prefs'
import { c, font } from '../src/theme'

const LANGS = ['', 'eng', 'hin', 'pan', 'spa', 'fre', 'ger', 'ita', 'jpn', 'kor', 'chi', 'tam', 'tel', 'urd', 'ara', 'por', 'rus']
const SUB_MODES: { v: User['subtitleMode']; l: string; d: string }[] = [
  { v: 'auto', l: 'Automatic', d: 'Only when the audio isn’t in your language, plus forced subtitles' },
  { v: 'always', l: 'Always on', d: 'Show subtitles whenever there are some' },
  { v: 'off', l: 'Off', d: 'Never turn them on by themselves' },
]

type Picker = null | 'audio' | 'subLang' | 'subMode' | 'quality' | 'cellular'

export default function Settings() {
  const { user, setUser } = useAuth()
  const prefs = usePrefs()
  const [pick, setPick] = useState<Picker>(null)
  if (!user) return null

  const savePref = async (patch: Partial<Pick<User, 'audioLang' | 'subtitleLang' | 'subtitleMode'>>) => {
    try {
      const u = await put<User>('/api/me/preferences', { audioLang: user.audioLang, subtitleLang: user.subtitleLang, subtitleMode: user.subtitleMode, ...patch })
      setUser(u)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const lang = (l: string) => (l ? langLabel(l) : 'No preference')
  const q = (v: string) => qualityOptions.find((o) => o.value === v)?.label || 'Original'
  const toggle = (on: boolean, set: (v: boolean) => void) => <Switch value={on} onValueChange={set} trackColor={{ true: c.accentStrong, false: c.surface3 }} thumbColor={c.white} />

  return (
    <View style={{ flex: 1 }}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text style={styles.section}>Languages · saved to your account</Text>
        <Card>
          <ListRow title="Preferred audio" sub={lang(user.audioLang)} onPress={() => setPick('audio')} right={<ChevronDown size={18} color={c.muted} />} />
          <View style={styles.sep} />
          <ListRow title="Subtitle language" sub={user.subtitleLang ? langLabel(user.subtitleLang) : 'Same as audio'} onPress={() => setPick('subLang')} right={<ChevronDown size={18} color={c.muted} />} />
          <View style={styles.sep} />
          <ListRow title="Subtitles" sub={SUB_MODES.find((m) => m.v === user.subtitleMode)?.l} onPress={() => setPick('subMode')} right={<ChevronDown size={18} color={c.muted} />} />
        </Card>

        <Text style={styles.section}>Playback · this phone</Text>
        <Card>
          <ListRow title="Quality on Wi-Fi" sub={q(prefs.quality)} onPress={() => setPick('quality')} right={<ChevronDown size={18} color={c.muted} />} />
          <View style={styles.sep} />
          <ListRow title="Quality on mobile data" sub={q(prefs.cellularQuality)} onPress={() => setPick('cellular')} right={<ChevronDown size={18} color={c.muted} />} />
          <View style={styles.sep} />
          <ListRow title="Autoplay next episode" right={toggle(prefs.autoplayNext, (v) => setPrefs({ autoplayNext: v }))} />
          <View style={styles.sep} />
          <ListRow title="Skip intros automatically" right={toggle(prefs.skipIntro, (v) => setPrefs({ skipIntro: v }))} />
          <View style={styles.sep} />
          <ListRow title="Skip credits automatically" sub="Goes straight to the next episode" right={toggle(prefs.skipCredits, (v) => setPrefs({ skipCredits: v }))} />
          <View style={styles.sep} />
          <ListRow title="Subtitle background" right={toggle(prefs.subtitleBackground, (v) => setPrefs({ subtitleBackground: v }))} />
        </Card>

        <Text style={styles.section}>Downloads</Text>
        <Card>
          <ListRow
            title="Download on Wi-Fi only"
            sub="Waits for Wi-Fi instead of using mobile data"
            right={toggle(prefs.downloadOnWifiOnly, (v) => {
              setPrefs({ downloadOnWifiOnly: v })
              applyDownloadSettings()
            })}
          />
        </Card>
      </ScrollView>

      <MenuSheet open={pick === 'audio'} onClose={() => setPick(null)} title="Preferred audio" options={LANGS.map((l) => ({ label: lang(l), selected: user.audioLang === l, onPress: () => savePref({ audioLang: l }) }))} />
      <MenuSheet
        open={pick === 'subLang'}
        onClose={() => setPick(null)}
        title="Subtitle language"
        options={LANGS.map((l) => ({ label: l ? langLabel(l) : 'Same as audio', selected: user.subtitleLang === l, onPress: () => savePref({ subtitleLang: l }) }))}
      />
      <MenuSheet open={pick === 'subMode'} onClose={() => setPick(null)} title="Subtitles" options={SUB_MODES.map((m) => ({ label: m.l, sub: m.d, selected: user.subtitleMode === m.v, onPress: () => savePref({ subtitleMode: m.v }) }))} />
      <MenuSheet open={pick === 'quality'} onClose={() => setPick(null)} title="Quality on Wi-Fi" options={qualityOptions.map((o) => ({ label: o.label, selected: prefs.quality === o.value, onPress: () => setPrefs({ quality: o.value }) }))} />
      <MenuSheet
        open={pick === 'cellular'}
        onClose={() => setPick(null)}
        title="Quality on mobile data"
        note="Lower quality uses less data. The server converts the video to fit."
        options={qualityOptions.map((o) => ({ label: o.label, selected: prefs.cellularQuality === o.value, onPress: () => setPrefs({ cellularQuality: o.value }) }))}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { ...font.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12, marginTop: 14, marginBottom: 4, marginLeft: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: 16 },
})
