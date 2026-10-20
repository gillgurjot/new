import { useEffect, useRef, useState } from 'react'
import { Animated, FlatList, KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, LogOut, Send, Share2, X } from 'lucide-react-native'
import type { PartyMessage } from '../api/types'
import { Avatar, IconButton } from '../components/ui'
import { useUser } from '../lib/auth'
import { c } from '../theme'
import { type PartyConn, REACTIONS, inviteLink } from './party'

/** Side panel with who's watching, the invite link, chat and reactions. */
export function PartyPanel({ party, itemId, onClose, onLeave }: { party: PartyConn; itemId: number; onClose: () => void; onLeave: () => void }) {
  const me = useUser()
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const list = useRef<FlatList<PartyMessage>>(null)
  const link = inviteLink(party.id, itemId)

  useEffect(() => {
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [party.chat.length])

  const copy = async () => {
    await Clipboard.setStringAsync(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const share = () => Share.share({ message: `Watch with me on Lumen: ${link}`, url: link }).catch(() => {})
  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    await party.say(t).catch(() => setText(t))
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.panel}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Watch together</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <View style={[styles.dot, { backgroundColor: party.connected ? c.success : c.warn }]} />
            <Text style={styles.sub}>{party.connected ? `${party.members.length} watching` : 'Reconnecting…'}</Text>
          </View>
        </View>
        <IconButton label="Leave the party" size={34} onPress={onLeave} icon={<LogOut size={16} color={c.fg} />} />
        <IconButton label="Close" size={34} onPress={onClose} icon={<X size={16} color={c.fg} />} style={{ marginLeft: 6 }} />
      </View>

      <View style={styles.members}>
        {party.members.map((m) => (
          <View key={m.userId} style={styles.member}>
            <Avatar name={m.name} uri={m.avatar} size={22} />
            <Text style={styles.memberName} numberOfLines={1}>{m.userId === me.id ? 'You' : m.name}</Text>
          </View>
        ))}
      </View>

      <View style={styles.link}>
        <Text style={styles.linkText} numberOfLines={1}>{link.replace(/^https?:\/\//, '')}</Text>
        <Pressable onPress={copy} style={styles.linkBtn} accessibilityLabel="Copy invite link">
          {copied ? <Check size={14} color={c.fg} /> : <Copy size={14} color={c.fg} />}
          <Text style={{ color: c.fg, fontSize: 12, fontWeight: '600' }}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
        <Pressable onPress={share} style={[styles.linkBtn, { paddingHorizontal: 8 }]} accessibilityLabel="Share invite">
          <Share2 size={14} color={c.fg} />
        </Pressable>
      </View>

      <FlatList
        ref={list}
        data={party.chat}
        keyExtractor={(m) => String(m.id)}
        style={{ flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={<Text style={[styles.sub, { textAlign: 'center', paddingVertical: 16 }]}>Send the link to someone. Play, pause and seeking stay in sync for everyone.</Text>}
        renderItem={({ item }) => <ChatLine m={item} mine={item.userId === me.id} />}
      />

      <View style={styles.reactions}>
        {REACTIONS.map((r) => (
          <Pressable key={r} onPress={() => party.react(r)} hitSlop={4} style={({ pressed }) => [{ padding: 4 }, pressed && { transform: [{ scale: 0.85 }] }]} accessibilityLabel={`React ${r}`}>
            <Text style={{ fontSize: 20 }}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Say something…"
          placeholderTextColor={c.muted}
          maxLength={500}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable onPress={send} style={[styles.send, !text.trim() && { opacity: 0.4 }]} accessibilityLabel="Send">
          <Send size={16} color={c.black} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function ChatLine({ m, mine }: { m: PartyMessage; mine: boolean }) {
  if (m.system) return <Text style={[styles.sub, { textAlign: 'center', fontSize: 11 }]}>{m.text}</Text>
  if (m.emoji) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
        {!mine && <Text style={styles.sub}>{m.name}</Text>}
        <Text style={{ fontSize: 24 }}>{m.emoji}</Text>
      </View>
    )
  }
  return (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      {!mine && <Avatar name={m.name} uri={m.avatar} size={22} />}
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {!mine && <Text style={styles.bubbleName}>{m.name}</Text>}
        <Text style={{ color: c.fg, fontSize: 14, lineHeight: 19 }}>{m.text}</Text>
      </View>
    </View>
  )
}

/** Floating reactions and recent chat shown over the video while the panel is closed. */
export function PartyOverlay({ party, open }: { party: PartyConn; open: boolean }) {
  const me = useUser()
  const [recent, setRecent] = useState<PartyMessage[]>([])
  const [floats, setFloats] = useState<{ id: number; emoji: string; x: number }[]>([])
  const seen = useRef<number | null>(null)

  useEffect(() => {
    const last = party.chat[party.chat.length - 1]
    if (seen.current === null) {
      if (!party.stateVersion) return // wait for the first snapshot
      seen.current = last?.id ?? 0 // don't replay history on join
      return
    }
    if (!last) return
    const fresh = party.chat.filter((m) => m.id > seen.current!)
    seen.current = last.id
    for (const m of fresh) {
      if (m.emoji) {
        const f = { id: m.id, emoji: m.emoji, x: 10 + Math.random() * 70 }
        setFloats((x) => [...x, f])
        setTimeout(() => setFloats((x) => x.filter((y) => y.id !== f.id)), 2700)
      } else if (!open && m.userId !== me.id) {
        setRecent((r) => [...r.slice(-2), m])
        setTimeout(() => setRecent((r) => r.filter((y) => y.id !== m.id)), 5000)
      }
    }
  }, [party.chat, party.stateVersion, open, me.id])

  return (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', right: 24, bottom: 90, width: 90, height: 220 }}>
        {floats.map((f) => <Floater key={f.id} emoji={f.emoji} x={f.x} />)}
      </View>
      {!open && recent.length > 0 && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 24, top: 70, gap: 6, maxWidth: '55%' }}>
          {recent.map((m) => (
            <View key={m.id} style={styles.toastMsg}>
              {!m.system && <Avatar name={m.name} uri={m.avatar} size={20} />}
              <Text style={{ color: c.fg, fontSize: 13, flexShrink: 1 }}>
                {!m.system && <Text style={{ fontWeight: '700' }}>{m.name}  </Text>}
                {m.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </>
  )
}

function Floater({ emoji, x }: { emoji: string; x: number }) {
  const a = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 2600, useNativeDriver: true }).start()
  }, [a])
  return (
    <Animated.Text
      style={{
        position: 'absolute', bottom: 0, left: `${x}%`, fontSize: 34,
        opacity: a.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -200] }) }, { scale: a.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.15, 1] }) }],
      }}
    >
      {emoji}
    </Animated.Text>
  )
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 340, backgroundColor: '#0e0e13', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.line, zIndex: 30 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  title: { color: c.fg, fontWeight: '700', fontSize: 16 },
  sub: { color: c.muted, fontSize: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 10 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingLeft: 3, paddingRight: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)' },
  memberName: { color: c.fg, fontSize: 12, fontWeight: '500', maxWidth: 90 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 14, marginBottom: 10, padding: 5, paddingLeft: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  linkText: { flex: 1, color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)' },
  reactions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  input: { flex: 1, height: 40, borderRadius: 20, backgroundColor: c.surface2, color: c.fg, paddingHorizontal: 14, fontSize: 14 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7 },
  mine: { backgroundColor: c.accentStrong, borderBottomRightRadius: 5 },
  theirs: { backgroundColor: 'rgba(255,255,255,0.08)', borderBottomLeftRadius: 5 },
  bubbleName: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', marginBottom: 1 },
  toastMsg: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14 },
})
