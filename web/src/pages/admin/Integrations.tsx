import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Link2, RefreshCw, Unplug } from 'lucide-react'
import { ApiError, api, del, post, put } from '../../api/client'
import type { Integration, Integrations as IntegrationsData, JellyfinStatus } from '../../api/types'
import Spinner from '../../components/Spinner'
import { toast } from '../../components/ui'
import { timeAgo } from '../../lib/format'

export default function Integrations() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'integrations'], queryFn: () => api<IntegrationsData>('/api/admin/integrations') })
  const jf = useQuery({
    queryKey: ['admin', 'jellyfin'],
    queryFn: () => api<JellyfinStatus>('/api/admin/jellyfin'),
    refetchInterval: (x) => (x.state.data?.running ? 2_000 : 30_000),
  })
  const changed = (d: IntegrationsData) => {
    qc.setQueryData(['admin', 'integrations'], d)
    qc.invalidateQueries({ queryKey: ['admin', 'jellyfin'] })
    qc.invalidateQueries({ queryKey: ['requests-config'] })
    setTimeout(() => qc.invalidateQueries({ queryKey: ['admin', 'jellyfin'] }), 2500)
  }
  const syncNow = async () => {
    try {
      qc.setQueryData(['admin', 'jellyfin'], await post<JellyfinStatus>('/api/admin/jellyfin/sync'))
      setTimeout(() => qc.invalidateQueries({ queryKey: ['admin', 'jellyfin'] }), 1500)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Sync failed', 'error')
    }
  }
  if (!q.data) return <Spinner />
  const j = jf.data

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <ServerCard
        name="jellyfin"
        title="Jellyfin"
        blurb="Carries over watch history, Continue watching, favourites and intro markers, both ways. People are matched by user name."
        keyHint="Jellyfin dashboard → API Keys → +"
        urlPlaceholder="http://jellyfin:8096"
        info={q.data.jellyfin}
        onChange={changed}
      >
        {j?.enabled && (
          <div className="rounded-2xl bg-fg/[.05] p-4 text-sm space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${j.error ? 'bg-red-500' : j.running ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="font-medium">{j.running ? 'Syncing…' : j.error ? 'Last sync failed' : j.lastSync ? `Synced ${timeAgo(j.lastSync)}` : 'Waiting for the first sync'}</span>
              <button onClick={syncNow} disabled={j.running} className="ml-auto btn-ghost !h-8 !px-3 !text-[13px]"><RefreshCw className={`size-3.5 ${j.running ? 'animate-spin' : ''}`} /> Sync now</button>
            </div>
            {j.error && <p className="text-red-600 dark:text-red-300 text-xs break-words">{j.error}</p>}
            {!j.error && j.lastSync > 0 && (
              <>
                <p className="text-muted text-xs">{j.linked} files linked · {j.users.length} account{j.users.length === 1 ? '' : 's'} matched{j.users.length > 0 && `: ${j.users.map((u) => (u.lumen === u.jellyfin ? u.lumen : `${u.lumen} ↔ ${u.jellyfin}`)).join(', ')}`}</p>
                <p className="text-muted text-xs">Last run: {j.pulled} updates from Jellyfin, {j.pushed} sent back, {j.segments} intro/credit markers imported.</p>
              </>
            )}
          </div>
        )}
      </ServerCard>

      <ServerCard
        name="seerr"
        title="Seerr"
        blurb="Lets people request movies and shows from the Requests page. Seerr sends them to Radarr and Sonarr."
        keyHint="Seerr → Settings → General → API Key"
        urlPlaceholder="http://seerr:5055"
        info={q.data.seerr}
        onChange={changed}
        withPublicUrl
      />
    </div>
  )
}

function ServerCard({ name, title, blurb, keyHint, urlPlaceholder, info, onChange, withPublicUrl, children }: {
  name: 'jellyfin' | 'seerr'
  title: string
  blurb: string
  keyHint: string
  urlPlaceholder: string
  info: Integration
  onChange: (d: IntegrationsData) => void
  withPublicUrl?: boolean
  children?: React.ReactNode
}) {
  const [url, setUrl] = useState(info.url)
  const [publicUrl, setPublicUrl] = useState(info.publicUrl || '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(!info.enabled)
  useEffect(() => {
    setUrl(info.url)
    setPublicUrl(info.publicUrl || '')
  }, [info.url, info.publicUrl])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const d = await put<IntegrationsData>(`/api/admin/integrations/${name}`, { url, apiKey: key, publicUrl })
      setKey('')
      setEditing(false)
      onChange(d)
      toast(`${title} connected`)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Couldn’t save')
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    if (!confirm(`Disconnect ${title}? ${name === 'jellyfin' ? 'Watch history already in Lumen stays.' : 'The Requests page will be hidden.'}`)) return
    try {
      const d = await del<IntegrationsData>(`/api/admin/integrations/${name}`)
      setEditing(true)
      onChange(d)
      toast(`${title} disconnected`, 'info')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t disconnect', 'error')
    }
  }

  const status = info.enabled
    ? { dot: 'bg-emerald-500', text: info.source === 'env' ? 'Connected (from the server’s environment)' : 'Connected' }
    : { dot: 'bg-fg/30', text: info.source === 'off' ? 'Turned off' : 'Not connected' }

  return (
    <section className="card p-5 md:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-11 rounded-2xl bg-gradient-to-br from-accent-strong/25 to-accent-2/15 text-accent grid place-items-center shrink-0">
          <Link2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-lg leading-tight">{title}</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted mt-1">
            <span className={`size-1.5 rounded-full ${status.dot}`} /> {status.text}
          </div>
        </div>
        {info.enabled && !editing && (
          <button onClick={() => setEditing(true)} className="btn-ghost !h-9 !px-4 !text-sm">Change</button>
        )}
      </div>
      <p className="text-sm text-muted">{blurb}</p>

      {info.enabled && !editing ? (
        <div className="text-sm space-y-1">
          <div className="flex gap-3"><span className="text-muted w-20 shrink-0">Address</span><span className="font-mono text-[13px] break-all">{info.url}</span></div>
          {withPublicUrl && info.publicUrl && <div className="flex gap-3"><span className="text-muted w-20 shrink-0">Link</span><span className="font-mono text-[13px] break-all">{info.publicUrl}</span></div>}
          <div className="flex gap-3"><span className="text-muted w-20 shrink-0">API key</span><span>{info.hasKey ? '•••••••• saved' : 'none'}</span></div>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <div className="text-sm font-medium mb-1.5">Server address</div>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={urlPlaceholder} autoComplete="off" spellCheck={false} required />
          </label>
          <label className="block">
            <div className="text-sm font-medium mb-1.5">API key</div>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
              <input
                className="input !pl-10"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={info.hasKey ? 'Leave empty to keep the saved key' : 'Paste the API key'}
                autoComplete="new-password"
                spellCheck={false}
                required={!info.hasKey}
              />
            </div>
            <div className="text-xs text-muted mt-1.5">{keyHint}. Stored on the server and never shown again.</div>
          </label>
          {withPublicUrl && (
            <label className="block">
              <div className="text-sm font-medium mb-1.5">Public link <span className="text-muted font-normal">(optional)</span></div>
              <input className="input" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://request.example.com" autoComplete="off" spellCheck={false} />
              <div className="text-xs text-muted mt-1.5">Where people can open Seerr themselves.</div>
            </label>
          )}
          {err && <div className="rounded-2xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 text-sm text-red-600 dark:text-red-300">{err}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={busy} className="btn-accent !h-10">{busy ? <Spinner className="size-4" /> : null} {busy ? 'Checking…' : 'Test & save'}</button>
            {info.enabled && <button type="button" onClick={() => { setEditing(false); setErr(''); setKey('') }} className="btn-ghost !h-10">Cancel</button>}
          </div>
        </form>
      )}

      {children}

      {(info.enabled || info.source === 'saved') && (
        <button onClick={disconnect} className="text-sm font-medium text-red-600 dark:text-red-300 hover:underline inline-flex items-center gap-1.5"><Unplug className="size-4" /> Disconnect</button>
      )}
    </section>
  )
}
