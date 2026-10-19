import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import { ApiError, api, put } from '../../api/client'
import type { User } from '../../api/types'
import { useLibraries } from '../../components/Layout'
import { timeAgo } from '../../lib/format'

const bitrates = [
  [0, 'Unlimited'], [40000, '40 Mbps'], [20000, '20 Mbps'], [10000, '10 Mbps'], [8000, '8 Mbps'], [4000, '4 Mbps'], [2000, '2 Mbps'], [1000, '1 Mbps'],
] as const

export default function Users() {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<User[]>('/api/admin/users') })
  const libs = useLibraries()
  const [err, setErr] = useState('')
  const save = async (u: User, patch: Partial<User>) => {
    setErr('')
    try {
      const n = { disabled: u.disabled, maxBitrate: u.maxBitrate, libraryIds: u.libraryIds, ...patch }
      await put(`/api/admin/users/${u.id}`, n)
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed')
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
      <p className="text-sm text-muted mb-4">
        People appear here after they first sign in with Pocket ID. Admin rights follow the Pocket ID admin group.
      </p>
      {err && <div className="text-sm text-red-300 mb-3">{err}</div>}
      <div className="space-y-3">
        {users.data?.map((u) => (
          <div key={u.id} className={`card p-4 ${u.disabled ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 grid place-items-center font-bold overflow-hidden shrink-0">
                {u.avatar ? <img src={u.avatar} alt="" className="size-full object-cover" /> : u.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 mr-auto">
                <div className="font-semibold flex items-center gap-2">{u.displayName} {u.isAdmin && <Shield className="size-4 text-violet-300" />}</div>
                <div className="text-xs text-muted truncate">{u.email || u.username} · last seen {timeAgo(u.lastLogin)}</div>
              </div>
              <select className="input !w-auto !h-9 !text-xs" value={u.maxBitrate} onChange={(e) => save(u, { maxBitrate: Number(e.target.value) })} title="Streaming limit">
                {bitrates.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={() => save(u, { disabled: !u.disabled })} className={`btn !h-9 !px-4 ${u.disabled ? 'bg-emerald-500/20 hover:bg-emerald-500/30' : 'bg-red-500/15 hover:bg-red-500/25'}`}>
                {u.disabled ? 'Enable' : 'Disable'}
              </button>
            </div>
            {!u.isAdmin && (libs.data?.length || 0) > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {libs.data!.map((l) => {
                  const on = u.libraryIds == null || u.libraryIds.includes(l.id)
                  return (
                    <button key={l.id} onClick={() => toggleLib(u, l.id)} className={`chip !py-1 transition ${on ? '!border-violet-400 bg-violet-500/15 text-white' : 'opacity-60'}`}>
                      {on ? '✓ ' : ''}{l.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
