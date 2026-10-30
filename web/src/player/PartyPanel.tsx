import { useEffect, useRef, useState } from 'react'
import { Check, Copy, LogOut, Send, Share2, X } from 'lucide-react'
import type { PartyMessage } from '../api/types'
import { Avatar } from '../components/ui'
import { useUser } from '../lib/user'
import { type PartyConn, REACTIONS, inviteLink } from './party'

/** Side panel (bottom sheet on phones) with who's watching, invite link, chat and reactions. */
export function PartyPanel({ party, itemId, onClose, onLeave }: { party: PartyConn; itemId: number; onClose: () => void; onLeave: () => void }) {
  const me = useUser()
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const link = inviteLink(party.id, itemId)

  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [party.chat.length])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      prompt('Copy this link', link)
    }
  }
  const share = () => navigator.share?.({ title: 'Watch with me on Lumen', url: link }).catch(() => {})
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    await party.say(t).catch(() => setText(t))
  }

  return (
    <div
      className="absolute z-30 inset-x-0 bottom-0 h-[62%] sm:inset-x-auto sm:right-0 sm:top-0 sm:h-auto sm:w-[360px] flex flex-col glass-strong rounded-t-[32px] sm:rounded-[28px] sm:m-3 sheet-in"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Watch together</div>
          <div className="text-xs text-muted flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${party.connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            {party.connected ? `${party.members.length} watching` : 'Reconnecting…'}
          </div>
        </div>
        <button onClick={onLeave} className="icon-btn !size-9" title="Leave the party" aria-label="Leave the party"><LogOut className="size-4" /></button>
        <button onClick={onClose} className="icon-btn !size-9" aria-label="Close"><X className="size-4" /></button>
      </div>

      <div className="px-4 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-none">
        {party.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-2 h-8 pl-1 pr-3 rounded-full bg-white/[.07] shrink-0" title={m.name}>
            <Avatar name={m.name} src={m.avatar} className="size-6 text-[10px]" />
            <span className="text-xs font-medium max-w-24 truncate">{m.userId === me.id ? 'You' : m.name}</span>
          </div>
        ))}
      </div>

      <div className="mx-4 mb-3 flex items-center gap-2 rounded-2xl bg-white/[.05] border border-line p-1.5 pl-3">
        <span className="text-xs text-white/60 truncate flex-1 font-mono">{link.replace(/^https?:\/\//, '')}</span>
        <button onClick={copy} className="btn-ghost !h-8 !px-3 !text-xs">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
        {'share' in navigator && <button onClick={share} className="icon-btn !size-8" aria-label="Share invite"><Share2 className="size-3.5" /></button>}
      </div>

      <div ref={list} className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2.5 border-t border-line">
        {party.chat.length === 0 && <p className="text-xs text-muted text-center py-6">Send the link to someone. Play, pause and seeking stay in sync for everyone.</p>}
        {party.chat.map((m) => <ChatLine key={m.id} m={m} mine={m.userId === me.id} />)}
      </div>

      <div className="flex justify-between px-3 pt-2">
        {REACTIONS.map((r) => (
          <button key={r} onClick={() => party.react(r)} className="size-9 rounded-full grid place-items-center text-xl hover:bg-white/10 active:scale-90 transition" aria-label={`React ${r}`}>{r}</button>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={500} className="input !h-10 !rounded-full" enterKeyHint="send" />
        <button type="submit" className={`icon-btn !size-10 !bg-white !text-black ${text.trim() ? '' : 'opacity-40'}`} aria-label="Send"><Send className="size-4" /></button>
      </form>
    </div>
  )
}

function ChatLine({ m, mine }: { m: PartyMessage; mine: boolean }) {
  if (m.system) return <div className="text-[11px] text-muted text-center">{m.text}</div>
  if (m.emoji) {
    return (
      <div className={`flex items-center gap-2 ${mine ? 'justify-end' : ''}`}>
        {!mine && <span className="text-xs text-muted">{m.name}</span>}
        <span className="text-2xl leading-none">{m.emoji}</span>
      </div>
    )
  }
  return (
    <div className={`flex gap-2 ${mine ? 'justify-end' : ''}`}>
      {!mine && <Avatar name={m.name} src={m.avatar} className="size-6 text-[10px] mt-0.5" />}
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-snug break-words ${mine ? 'bg-accent-strong text-white rounded-br-md' : 'bg-white/[.08] rounded-bl-md'}`}>
        {!mine && <div className="text-[11px] font-semibold text-white/60 mb-0.5">{m.name}</div>}
        {m.text}
      </div>
    </div>
  )
}

/** Chat bubbles and floating reactions shown over the video while the panel is closed. */
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
      <div className="absolute right-4 bottom-28 w-24 h-60 pointer-events-none z-20">
        {floats.map((f) => <span key={f.id} className="absolute bottom-0 text-4xl float-up" style={{ left: `${f.x}%` }}>{f.emoji}</span>)}
      </div>
      {!open && recent.length > 0 && (
        <div className="absolute left-4 top-24 z-20 space-y-2 pointer-events-none max-w-[70%] sm:max-w-sm">
          {recent.map((m) => (
            <div key={m.id} className={`flex items-center gap-2 rounded-2xl bg-black/60 backdrop-blur-md px-3 py-2 text-sm fade-in ${m.system ? 'text-white/70 text-xs' : ''}`}>
              {!m.system && <Avatar name={m.name} src={m.avatar} className="size-6 text-[10px]" />}
              <span className="min-w-0">{!m.system && <span className="font-semibold mr-1.5">{m.name}</span>}{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
