import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Gauge, Library as LibraryIcon, Plus, Shield } from 'lucide-react'
import { ApiError, api, put } from '../../api/client'
import type { User } from '../../api/types'
import { useLibraries, useRequestsConfig } from '../../components/Layout'
import { Avatar, toast } from '../../components/ui'
import { timeAgo } from '../../lib/format'
import { Toggle } from '../Settings'

const bitrates = [
  [0, 'Unlimited'], [40000, '40 Mbps'], [20000, '20 Mbps'], [10000, '10 Mbps'], [8000, '8 Mbps'], [4000, '4 Mbps'], [2000, '2 Mbps'], [1000, '1 Mbps'],
] as const

export default function Users() {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<User[]>('/api/admin/users') })
  const libs = useLibraries()
  const reqs = useRequestsConfig()
  const save = async (u: User, patch: Partial<User>) => {
    try {
      const n = { disabled: u.disabled, maxBitrate: u.maxBitrate, libraryIds: u.libraryIds, canDownload: u.canDownload, canRequest: u.canRequest, ...patch }
      await put(`/api/admin/users/${u.id}`, n)
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast(`Saved ${u.displayName || u.username}`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Save failed', 'error')
    }
  }
  const toggleLib = (u: User, id: number) => {
    const all = libs.data?.map((l) => l.id) || []
    const cur = u.libraryIds ?? all
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    save(u, { libraryIds: next.length === all.length ? null : next })
  }

  return (
    <div>
      <p className="text-sm text-muted mb-5">
        People appear here after they first sign in with Pocket ID. Admin rights follow the Pocket ID admin group.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {users.data?.map((u) => (
          <div key={u.id} className={`card p-5 ${u.disabled ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-3">
              <Avatar name={u.displayName || u.username} src={u.avatar} className="size-11 text-sm" />
              <div className="min-w-0 mr-auto">
                <div className="font-semibold flex items-center gap-1.5">{u.displayName || u.username} {u.isAdmin && <Shield className="size-4 text-accent" aria-label="Admin" />}</div>
                <div className="text-xs text-muted truncate">{u.email || u.username} · signed in {timeAgo(u.lastLogin)}</div>
              </div>
              {!u.isAdmin && (
                <button onClick={() => save(u, { disabled: !u.disabled })} className={u.disabled ? 'btn !h-9 !px-4 bg-emerald-500/20 hover:bg-emerald-500/30' : 'btn-danger !h-9 !px-4'}>
                  {u.disabled ? 'Enable' : 'Disable'}
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3.5">
              <div className="flex items-center gap-3">
                <Gauge className="size-4 text-muted shrink-0" />
                <span className="text-sm font-medium flex-1">Streaming limit</span>
                <select className="select !w-auto !h-9 !text-sm" value={u.maxBitrate} onChange={(e) => save(u, { maxBitrate: Number(e.target.value) })}>
                  {bitrates.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <Download className="size-4 text-muted shrink-0" />
                <div className="flex-1"><Toggle label="Can download files" checked={u.canDownload} onChange={(v) => save(u, { canDownload: v })} /></div>
              </div>
              {reqs.data?.enabled && (
                <div className="flex items-center gap-3">
                  <Plus className="size-4 text-muted shrink-0" />
                  <div className="flex-1"><Toggle label="Can request titles" checked={u.canRequest} onChange={(v) => save(u, { canRequest: v })} /></div>
                </div>
              )}
              {!u.isAdmin && (libs.data?.length || 0) > 0 && (
                <div className="flex items-start gap-3">
                  <LibraryIcon className="size-4 text-muted shrink-0 mt-2" />
                  <div className="flex-1">
                    <div className="text-sm font-medium mb-2">Libraries</div>
                    <div className="flex flex-wrap gap-2">
                      {libs.data!.map((l) => {
                        const on = u.libraryIds == null || u.libraryIds.includes(l.id)
                        return (
                          <button key={l.id} onClick={() => toggleLib(u, l.id)} className={on ? 'pill-on !h-8 !text-[13px]' : 'pill !h-8 !text-[13px] opacity-70'} aria-pressed={on}>
                            {l.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
