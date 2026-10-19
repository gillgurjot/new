import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, Film, HardDrive, MonitorPlay, Pause, Play, Tv, Users, X } from 'lucide-react'
import { api, del } from '../../api/client'
import type { PlaySession, SystemInfo } from '../../api/types'
import { formatTime } from '../../lib/format'

export default function Dashboard() {
  const qc = useQueryClient()
  const sys = useQuery({ queryKey: ['admin', 'system'], queryFn: () => api<SystemInfo>('/api/admin/system'), refetchInterval: 10_000 })
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api<PlaySession[]>('/api/admin/sessions'), refetchInterval: 3_000 })
  const s = sys.data
  const stop = async (id: string) => {
    await del(`/api/admin/sessions/${id}`)
    qc.invalidateQueries({ queryKey: ['admin', 'sessions'] })
  }
  const uptime = s ? `${Math.floor(s.uptime / 86400)}d ${Math.floor((s.uptime % 86400) / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m` : ''
  const active = sessions.data || []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<Film className="size-5" />} label="Movies" value={s?.stats.movie ?? '–'} />
        <Stat icon={<Tv className="size-5" />} label="Shows · Episodes" value={s ? `${s.stats.series ?? 0} · ${s.stats.episode ?? 0}` : '–'} />
        <Stat icon={<Users className="size-5" />} label="Users" value={s?.stats.users ?? '–'} />
        <Stat icon={<MonitorPlay className="size-5" />} label="Streaming now" value={active.length} />
      </div>

      <section className="card p-5">
        <h2 className="font-bold mb-4">Active streams</h2>
        {!active.length && <p className="text-sm text-muted">Nobody is watching right now.</p>}
        <div className="space-y-3">
          {active.map((x) => {
            const tone = x.method === 'transcode' ? 'text-amber-300 bg-amber-400/10' : x.method === 'remux' ? 'text-sky-300 bg-sky-400/10' : 'text-emerald-300 bg-emerald-400/10'
            return (
              <div key={x.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl bg-white/5">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {x.paused ? <Pause className="size-5 text-muted shrink-0" /> : <Play className="size-5 text-violet-300 shrink-0" />}
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{x.title}</div>
                    <div className="text-xs text-muted truncate">{x.username} · {x.device}</div>
                    <div className="mt-1.5 h-1 rounded bg-white/10 overflow-hidden w-48 max-w-full">
                      <div className="h-full bg-violet-400" style={{ width: `${x.duration ? (x.position / x.duration) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>
                <div className="text-xs sm:text-right space-y-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${tone}`}>
                    {x.method === 'direct' ? 'Direct play' : x.method === 'remux' ? 'Direct stream' : `Transcode ${x.decision.height}p`}
                    {x.pipeline && x.method === 'transcode' ? ` · ${x.pipeline}` : ''}
                    {x.throttled ? ' · throttled' : ''}
                  </span>
                  <div className="text-muted">{formatTime(x.position)} / {formatTime(x.duration)}</div>
                  {x.decision.reasons && x.decision.reasons.length > 0 && <div className="text-muted max-w-xs sm:ml-auto">{x.decision.reasons.join(' · ')}</div>}
                </div>
                <button onClick={() => stop(x.id)} className="icon-btn !size-9 shrink-0" title="Stop stream"><X className="size-4" /></button>
              </div>
            )
          })}
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="card p-5 space-y-2 text-sm">
          <h2 className="font-bold mb-2 flex items-center gap-2"><Cpu className="size-5" /> Transcoding</h2>
          <Line k="Encoder" v={s?.hwaccel.description} />
          <Line k="HEVC encode" v={s ? (s.hwaccel.hevc ? 'Yes' : 'No') : ''} />
          <Line k="HDR tone mapping" v={s ? (s.hwaccel.hwTonemap ? 'GPU (VAAPI)' : s.hwaccel.swTonemap ? 'CPU (zscale)' : 'Unavailable') : ''} />
          <Line k="Max transcodes" v={s?.maxTranscodes} />
          <Line k="FFmpeg" v={s?.hwaccel.ffmpegVersion?.split(' ')[0]} />
        </section>
        <section className="card p-5 space-y-2 text-sm">
          <h2 className="font-bold mb-2 flex items-center gap-2"><HardDrive className="size-5" /> Server</h2>
          <Line k="Version" v={s?.version} />
          <Line k="Uptime" v={uptime} />
          <Line k="Memory" v={s ? `${s.memoryMB} MB` : ''} />
          <Line k="Public URL" v={s?.publicUrl} />
          <Line k="Admin group" v={s?.adminGroup} />
          <Line k="Metadata (TMDB)" v={s ? (s.tmdb ? 'Connected' : 'Not configured — set TMDB_API_KEY') : ''} />
        </section>
      </div>
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted text-xs mb-2">{icon}{label}</div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  )
}

function Line({ k, v }: { k: string; v?: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-muted w-36 shrink-0">{k}</span>
      <span className="min-w-0 break-words">{v ?? ''}</span>
    </div>
  )
}
