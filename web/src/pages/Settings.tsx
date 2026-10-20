import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { Avatar, PageTitle, toast } from '../components/ui'
import { put } from '../api/client'
import type { User } from '../api/types'
import { signOut } from '../components/Layout'
import { detectProfile } from '../lib/device'
import { loadPrefs, qualityOptions, savePrefs } from '../lib/prefs'
import { useUser } from '../lib/user'

export const languages: [string, string][] = [
  ['', 'No preference'], ['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'],
  ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese'], ['hin', 'Hindi'], ['pan', 'Punjabi'], ['ara', 'Arabic'], ['rus', 'Russian'], ['dut', 'Dutch'],
]

export default function SettingsPage() {
  const user = useUser()
  const qc = useQueryClient()
  const [prefs, setPrefs] = useState(loadPrefs())
  const profile = detectProfile()

  const saveServer = async (patch: Partial<User>) => {
    const next = await put<User>('/api/me/preferences', { audioLang: user.audioLang, subtitleLang: user.subtitleLang, subtitleMode: user.subtitleMode, ...patch })
    qc.setQueryData(['me'], next)
    toast('Saved')
  }
  const saveLocal = (p: Partial<typeof prefs>) => {
    savePrefs(p)
    setPrefs(loadPrefs())
    toast('Saved')
  }

  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-16 max-w-3xl">
      <PageTitle>Settings</PageTitle>

      <Section title="Account">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.displayName || user.username} src={user.avatar} className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{user.displayName}</div>
            <div className="text-sm text-muted truncate">{user.email || user.username}{user.isAdmin && ' · Admin'}</div>
          </div>
          <button onClick={signOut} className="btn-ghost !h-10"><LogOut className="size-4" /> Sign out</button>
        </div>
        <p className="text-xs text-muted">Your name, picture and admin access come from Pocket ID.</p>
      </Section>

      <Section title="Languages">
        <Field label="Preferred audio language">
          <select className="select" value={user.audioLang} onChange={(e) => saveServer({ audioLang: e.target.value })}>
            {languages.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Subtitles">
          <select className="select" value={user.subtitleMode} onChange={(e) => saveServer({ subtitleMode: e.target.value as User['subtitleMode'] })}>
            <option value="auto">Automatic — forced subtitles, or when audio isn't in my language</option>
            <option value="always">Always on</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Preferred subtitle language">
          <select className="select" value={user.subtitleLang} onChange={(e) => saveServer({ subtitleLang: e.target.value })}>
            {languages.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Playback on this device">
        <Field label="Streaming quality" hint="Auto plays the original file whenever this device can, and only converts what it can't.">
          <select className="select" value={prefs.quality} onChange={(e) => saveLocal({ quality: e.target.value })}>
            {qualityOptions.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        </Field>
        <Field label="Subtitle size">
          <select className="select" value={prefs.subtitleSize} onChange={(e) => saveLocal({ subtitleSize: e.target.value as typeof prefs.subtitleSize })}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </Field>
        <Toggle label="Subtitle background" checked={prefs.subtitleBackground} onChange={(v) => saveLocal({ subtitleBackground: v })} />
        <Toggle label="Autoplay next episode" checked={prefs.autoplayNext} onChange={(v) => saveLocal({ autoplayNext: v })} />
        <Toggle label="Skip intros automatically" checked={prefs.skipIntro} onChange={(v) => saveLocal({ skipIntro: v })} />
        <Toggle label="Skip credits automatically" hint="When an episode’s end credits start, go straight to the next one." checked={prefs.skipCredits} onChange={(v) => saveLocal({ skipCredits: v })} />
      </Section>

      <Section title="This device can play">
        <div className="text-sm space-y-1.5">
          <div><span className="text-muted">Device:</span> {profile.name}</div>
          <div><span className="text-muted">Video:</span> {profile.videoCodecs.map((c) => c.toUpperCase()).join(', ')}</div>
          <div><span className="text-muted">Audio:</span> {profile.audioCodecs.map((c) => c.toUpperCase()).join(', ')}</div>
          <div><span className="text-muted">Containers:</span> {profile.containers.map((c) => c.toUpperCase()).join(', ')}</div>
          <div><span className="text-muted">Screen:</span> {profile.maxWidth}×{profile.maxHeight} {profile.hdr ? '· HDR' : '· SDR'}</div>
          {user.maxBitrate > 0 && <div><span className="text-muted">Account limit:</span> {(user.maxBitrate / 1000).toFixed(1)} Mbps</div>}
        </div>
      </Section>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 md:p-6 mb-4">
      <h2 className="eyebrow mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-muted mt-1.5">{hint}</div>}
    </label>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full flex items-center justify-between gap-4 py-1 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
      </span>
      <span className={`w-11 h-[26px] shrink-0 rounded-full p-[3px] transition ${checked ? 'bg-accent-strong' : 'bg-white/15'}`}>
        <span className={`block size-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-[18px]' : ''}`} />
      </span>
    </button>
  )
}
