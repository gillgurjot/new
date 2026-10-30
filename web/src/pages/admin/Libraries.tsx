import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, Folder, FolderOpen, Pencil, Plus, RefreshCw, Sparkles, Trash2, Tv, X } from 'lucide-react'
import { ApiError, api, del, post, put } from '../../api/client'
import type { Library, ScanStatus } from '../../api/types'
import { timeAgo } from '../../lib/format'
import { toast } from '../../components/ui'

const failed = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : what, 'error')

export default function Libraries() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'libraries'],
    queryFn: () => api<{ libraries: Library[]; scans: ScanStatus[] }>('/api/admin/libraries'),
    refetchInterval: (query) => (query.state.data?.scans.some((s) => s.running) ? 1500 : 10_000),
  })
  const [edit, setEdit] = useState<Library | 'new' | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'libraries'] })
    qc.invalidateQueries({ queryKey: ['libraries'] })
    qc.invalidateQueries({ queryKey: ['home'] })
  }
  const scan = async (id: number) => {
    try {
      await post(`/api/admin/libraries/${id}/scan`)
      setTimeout(refresh, 300)
    } catch (e) {
      failed(e, 'Couldn’t start the scan')
    }
  }
  const meta = async (id: number) => {
    try {
      await post(`/api/admin/libraries/${id}/refresh`)
      toast('Refreshing metadata in the background', 'info')
    } catch (e) {
      failed(e, 'Couldn’t refresh metadata')
    }
  }
  const remove = async (l: Library) => {
    if (!confirm(`Remove “${l.name}” from Lumen? Your files are not touched, but watch history for this library is lost.`)) return
    try {
      await del(`/api/admin/libraries/${l.id}`)
      refresh()
    } catch (e) {
      failed(e, 'Couldn’t remove the library')
    }
  }

  return (
    <div>
      <div className="flex items-center mb-4">
        <p className="text-sm text-muted mr-auto">Folders are watched for changes and rescanned automatically.</p>
        <button onClick={() => setEdit('new')} className="btn-accent"><Plus className="size-4" /> Add library</button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {q.data?.libraries.map((l) => {
          const st = q.data.scans.find((s) => s.libraryId === l.id)
          return (
            <div key={l.id} className="card p-5">
              <div className="flex items-start gap-3">
                <div className="size-11 rounded-xl bg-gradient-to-br from-accent-strong/25 to-accent-2/15 text-accent grid place-items-center shrink-0">
                  {l.type === 'tv' ? <Tv className="size-5" /> : <Clapperboard className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{l.name}</div>
                  <div className="text-xs text-muted">{l.type === 'tv' ? 'TV shows' : 'Movies'} · {l.itemCount} titles · scanned {timeAgo(l.lastScan)}</div>
                </div>
                <button onClick={() => setEdit(l)} className="icon-btn !size-9" title="Edit"><Pencil className="size-4" /></button>
                <button onClick={() => remove(l)} className="icon-btn !size-9 hover:!bg-red-500/30" title="Remove"><Trash2 className="size-4" /></button>
              </div>
              <div className="mt-3 space-y-1">
                {l.paths?.map((p) => <div key={p} className="text-xs font-mono text-fg/70 truncate flex items-center gap-1.5"><Folder className="size-3.5 shrink-0" />{p}</div>)}
              </div>
              {st?.running ? (
                <div className="mt-4">
                  <div className="text-xs text-muted mb-1.5">Scanning · {st.phase} {st.total ? `${st.done}/${st.total}` : ''}</div>
                  <div className="h-1.5 rounded bg-fg/10 overflow-hidden">
                    <div className={`h-full bg-gradient-to-r from-accent-strong to-accent-2 ${st.total ? '' : 'animate-pulse w-1/3'}`} style={st.total ? { width: `${(st.done / st.total) * 100}%` } : undefined} />
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-4">
                  <button onClick={() => scan(l.id)} className="btn-ghost !h-9 !px-4"><RefreshCw className="size-4" /> Scan</button>
                  <button onClick={() => meta(l.id)} className="btn-ghost !h-9 !px-4"><Sparkles className="size-4" /> Refresh metadata</button>
                  {st && (st.added > 0 || st.removed > 0 || st.errors > 0) && (
                    <span className="text-xs text-muted self-center ml-auto">+{st.added} −{st.removed}{st.errors ? ` · ${st.errors} errors` : ''}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {q.data && !q.data.libraries.length && <div className="card p-10 text-center text-muted">No libraries yet. Add the folder where your movies or shows live.</div>}
      {edit && <LibraryDialog lib={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh() }} />}
    </div>
  )
}

function LibraryDialog({ lib, onClose, onSaved }: { lib: Library | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(lib?.name || '')
  const [type, setType] = useState<Library['type']>(lib?.type || 'movies')
  const [paths, setPaths] = useState<string[]>(lib?.paths?.length ? lib.paths : [''])
  const [browse, setBrowse] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const body = { name, type, paths: paths.filter(Boolean) }
      if (lib) await put(`/api/admin/libraries/${lib.id}`, body)
      else await post('/api/admin/libraries', body)
      onSaved()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[6px] grid place-items-center p-4" onClick={onClose}>
      <div className="glass-strong rounded-[32px] w-full max-w-lg p-6 sheet-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-4">
          <h3 className="font-bold text-lg">{lib ? 'Edit library' : 'Add library'}</h3>
          <button onClick={onClose} className="ml-auto icon-btn !size-8"><X className="size-4" /></button>
        </div>
        <div className="space-y-4">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Movies" />
          {!lib && (
            <div className="grid grid-cols-2 gap-2">
              {(['movies', 'tv'] as const).map((t) => (
                <button key={t} onClick={() => { setType(t); if (!name) setName(t === 'tv' ? 'TV Shows' : 'Movies') }} className={`h-14 rounded-2xl border text-sm font-semibold flex items-center justify-center gap-2 transition ${type === t ? 'border-fg/60 bg-fg/10' : 'border-line hover:border-fg/30'}`}>
                  {t === 'tv' ? <Tv className="size-5" /> : <Clapperboard className="size-5" />}{t === 'tv' ? 'TV shows' : 'Movies'}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <div className="text-sm font-medium">Folders</div>
            {paths.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input className="input font-mono !text-xs" value={p} onChange={(e) => setPaths(paths.map((x, j) => (j === i ? e.target.value : x)))} placeholder="/media/movies" />
                <button onClick={() => setBrowse(i)} className="icon-btn shrink-0" title="Browse"><FolderOpen className="size-4" /></button>
                {paths.length > 1 && <button onClick={() => setPaths(paths.filter((_, j) => j !== i))} className="icon-btn shrink-0"><X className="size-4" /></button>}
              </div>
            ))}
            <button onClick={() => setPaths([...paths, ''])} className="text-sm font-medium text-accent hover:text-fg">+ Add another folder</button>
          </div>
          <p className="text-xs text-muted">
            {type === 'tv' ? 'Expected layout: Show Name/Season 01/Show Name S01E01.mkv' : 'Expected layout: Movie Title (2020)/Movie Title (2020).mkv'}
          </p>
          {err && <div className="text-sm text-red-600 dark:text-red-300">{err}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={busy || !name || !paths.some(Boolean)} className="btn-accent">{lib ? 'Save' : 'Add & scan'}</button>
          </div>
        </div>
      </div>
      {browse !== null && (
        <FolderPicker
          start={paths[browse] || '/'}
          onClose={() => setBrowse(null)}
          onPick={(p) => { setPaths(paths.map((x, j) => (j === browse ? p : x))); setBrowse(null) }}
        />
      )}
    </div>
  )
}

function FolderPicker({ start, onPick, onClose }: { start: string; onPick: (p: string) => void; onClose: () => void }) {
  const [path, setPath] = useState(start)
  const q = useQuery({ queryKey: ['browse', path], queryFn: () => api<{ path: string; parent: string; dirs: string[] }>(`/api/admin/browse?path=${encodeURIComponent(path)}`), retry: false })
  const join = (d: string) => (q.data!.path === '/' ? '/' + d : q.data!.path + '/' + d)
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 grid place-items-center p-4" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="glass-strong rounded-[28px] w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden sheet-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-line font-mono text-xs truncate">{q.data?.path || path}</div>
        <div className="overflow-y-auto p-2 flex-1">
          {q.data && q.data.path !== '/' && (
            <button onClick={() => setPath(q.data.parent)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-fg/10 text-sm">..</button>
          )}
          {q.error && <div className="text-sm text-red-600 dark:text-red-300 p-3">Can’t open this folder.</div>}
          {q.data?.dirs.map((d) => (
            <button key={d} onClick={() => setPath(join(d))} className="w-full text-left px-3 py-2 rounded-lg hover:bg-fg/10 text-sm flex items-center gap-2">
              <Folder className="size-4 text-accent" /> {d}
            </button>
          ))}
          {q.data && !q.data.dirs.length && <div className="text-sm text-muted p-3">No sub-folders.</div>}
        </div>
        <div className="p-3 border-t border-line flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost !h-10">Cancel</button>
          <button onClick={() => q.data && onPick(q.data.path)} className="btn-accent !h-10">Use this folder</button>
        </div>
      </div>
    </div>
  )
}
