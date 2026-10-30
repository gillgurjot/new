import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { isDynamicThemeSupported } from '@pchmn/expo-material3-theme'
import {
  AudioLines, Captions, Check, ChevronDown, Download, FastForward, Languages, ListVideo, Moon, Palette as PaletteIcon, Signal, SkipForward, Smartphone, Sparkles, Sun, SunMoon, Type, Vibrate, Wifi,
} from 'lucide-react-native'
import { errorText, put } from '../src/api/client'
import type { User } from '../src/api/types'
import { Group, Header, ListRow, MenuSheet, SegmentedButtons, Switch, Text, toast } from '../src/components/ui'
import { useAuth } from '../src/lib/auth'
import { applyDownloadSettings } from '../src/lib/downloads'
import { langLabel } from '../src/lib/format'
import { qualityOptions, setPrefs, usePrefs } from '../src/lib/prefs'
import { SEED_COLORS, makeStyles, useTheme } from '../src/theme'
import { haptic } from '../src/lib/haptics'

const LANGS = ['', 'eng', 'hin', 'pan', 'spa', 'fre', 'ger', 'ita', 'jpn', 'kor', 'chi', 'tam', 'tel', 'urd', 'ara', 'por', 'rus']
const SUB_MODES: { v: User['subtitleMode']; l: string; d: string }[] = [
  { v: 'auto', l: 'Automatic', d: 'Only when the audio isn’t in your language, plus forced subtitles' },
  { v: 'always', l: 'Always on', d: 'Show subtitles whenever there are some' },
  { v: 'off', l: 'Off', d: 'Never turn them on by themselves' },
]

type Picker = null | 'audio' | 'subLang' | 'subMode' | 'quality' | 'cellular'

export default function Settings() {
  const { user, setUser } = useAuth()
  const { c } = useTheme()
  const styles = useStyles()
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
  const toggle = (on: boolean, set: (v: boolean) => void) => <Switch value={on} onValueChange={set} />
  const more = <ChevronDown size={20} color={c.muted} />

  return (
    <View style={{ flex: 1 }}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}>
        <Group title="Appearance">
          <View style={styles.block}>
            <SegmentedButtons
              value={prefs.themeMode}
              onValueChange={(v) => setPrefs({ themeMode: v as typeof prefs.themeMode })}
              buttons={[
                { value: 'system', label: 'System', icon: SunMoon },
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
              ]}
            />
          </View>
          {isDynamicThemeSupported ? (
            <ListRow icon={Sparkles} shape="sunny" tone="primary" title="Colours from wallpaper" sub="Material You" right={toggle(prefs.dynamicColor, (v) => setPrefs({ dynamicColor: v }))} />
          ) : null}
          {!(isDynamicThemeSupported && prefs.dynamicColor) ? (
            <View style={styles.block}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <PaletteIcon size={20} color={c.muted} />
                <Text style={styles.blockTitle}>Theme colour</Text>
              </View>
              <View style={styles.swatches}>
                {SEED_COLORS.map((col) => {
                  const on = prefs.seedColor.toLowerCase() === col.toLowerCase()
                  return (
                    <Pressable
                      key={col}
                      accessibilityLabel={`Colour ${col}`}
                      accessibilityState={{ selected: on }}
                      onPress={() => {
                        haptic.tick()
                        setPrefs({ seedColor: col })
                      }}
                      style={[styles.swatch, { backgroundColor: col, borderRadius: on ? 14 : 22 }]}
                    >
                      {on && <Check size={20} color="#fff" strokeWidth={3} />}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}
          <ListRow icon={Vibrate} title="Haptic feedback" right={toggle(prefs.haptics, (v) => setPrefs({ haptics: v }))} />
        </Group>

        <Group title="Languages · saved to your account">
          <ListRow icon={AudioLines} title="Preferred audio" sub={lang(user.audioLang)} onPress={() => setPick('audio')} right={more} />
          <ListRow icon={Languages} title="Subtitle language" sub={user.subtitleLang ? langLabel(user.subtitleLang) : 'Same as audio'} onPress={() => setPick('subLang')} right={more} />
          <ListRow icon={Captions} title="Subtitles" sub={SUB_MODES.find((m) => m.v === user.subtitleMode)?.l} onPress={() => setPick('subMode')} right={more} />
        </Group>

        <Group title="Playback · this phone">
          <ListRow icon={Wifi} title="Quality on Wi-Fi" sub={q(prefs.quality)} onPress={() => setPick('quality')} right={more} />
          <ListRow icon={Signal} title="Quality on mobile data" sub={q(prefs.cellularQuality)} onPress={() => setPick('cellular')} right={more} />
          <ListRow icon={ListVideo} title="Autoplay next episode" sub="Counts down when the credits start" right={toggle(prefs.autoplayNext, (v) => setPrefs({ autoplayNext: v }))} />
          <ListRow icon={FastForward} title="Skip intros automatically" sub="Intros and recaps, found by the server or Jellyfin" right={toggle(prefs.skipIntro, (v) => setPrefs({ skipIntro: v }))} />
          <ListRow icon={SkipForward} title="Skip credits automatically" sub="Goes straight to the next episode" right={toggle(prefs.skipCredits, (v) => setPrefs({ skipCredits: v }))} />
          <ListRow icon={Type} title="Subtitle background" right={toggle(prefs.subtitleBackground, (v) => setPrefs({ subtitleBackground: v }))} />
        </Group>

        <Group title="Downloads">
          <ListRow
            icon={prefs.downloadOnWifiOnly ? Wifi : Download}
            title="Download on Wi-Fi only"
            sub="Waits for Wi-Fi instead of using mobile data"
            right={toggle(prefs.downloadOnWifiOnly, (v) => {
              setPrefs({ downloadOnWifiOnly: v })
              applyDownloadSettings()
            })}
          />
        </Group>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: 0.7 }}>
          <Smartphone size={14} color={c.muted} />
          <Text style={styles.foot}>Playback, appearance and downloads are saved on this phone.</Text>
        </View>
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

const useStyles = makeStyles((c, f) => ({
  block: { padding: 16 },
  blockTitle: { ...f.bodyStrong, fontSize: 16 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  foot: { ...f.tiny },
}))
