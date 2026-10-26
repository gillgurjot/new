import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'

// ---------- avatar ----------

const tones = ['from-violet-500 to-fuchsia-500', 'from-sky-500 to-indigo-500', 'from-emerald-500 to-teal-600', 'from-amber-500 to-rose-500', 'from-pink-500 to-rose-600']

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Round avatar: initials on a colour gradient, with the profile picture on top when it loads. */
export function Avatar({ name, src, className = 'size-9 text-sm' }: { name: string; src?: string; className?: string }) {
  const [ok, setOk] = useState(true)
  const tone = tones[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length]
  return (
    <span className={`relative inline-grid place-items-center shrink-0 rounded-full overflow-hidden bg-gradient-to-br ${tone} font-semibold text-white select-none ${className}`}>
      <span aria-hidden>{initials(name)}</span>
      {src && ok && <img src={src} alt="" onError={() => setOk(false)} className="absolute inset-0 size-full object-cover" />}
    </span>
  )
}

// ---------- sheet / dialog ----------

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', key)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[6px] fade-in" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92dvh] flex flex-col glass-strong rounded-t-[32px] sm:rounded-[32px] sheet-in pb-safe overflow-hidden`}>
        <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-fg/20" />
        {title && (
          <div className="flex items-center gap-3 px-5 pt-4 pb-3">
            <h3 className="text-lg font-semibold tracking-tight min-w-0 truncate">{title}</h3>
            <button onClick={onClose} className="ml-auto icon-btn !size-9" aria-label="Close"><X className="size-4" /></button>
          </div>
        )}
        <div className="overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- popover menu ----------

export function Menu({ open, onClose, children, align = 'right', className = '' }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute z-50 mt-2 min-w-56 rounded-3xl glass-strong p-1.5 pop-in ${align === 'right' ? 'right-0' : 'left-0'} ${className}`}>
        {children}
      </div>
    </>
  )
}

export function MenuItem({ icon, children, onClick, href, download, danger }: { icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void; href?: string; download?: boolean; danger?: boolean }) {
  const cls = `w-full flex items-center gap-3 px-3 h-10 rounded-2xl text-sm text-left transition ${danger ? 'text-red-500 hover:bg-red-500/10' : 'text-fg/90 hover:bg-fg/[.08]'}`
  if (href) {
    return <a href={href} download={download} onClick={onClick} className={cls}>{icon}{children}</a>
  }
  return <button onClick={onClick} className={cls}>{icon}{children}</button>
}

// ---------- toasts ----------

type Toast = { id: number; text: string; tone: 'ok' | 'info' | 'error' }
let toasts: Toast[] = []
let nextToast = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: nextToast++, text, tone }
  toasts = [...toasts.slice(-2), t]
  emit()
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emit()
  }, tone === 'error' ? 5000 : 3000)
}

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => toasts,
  )
  return createPortal(
    <div className="fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-8 z-[80] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-2.5 max-w-md rounded-full glass-strong px-4 py-3 text-sm sheet-in">
          {t.tone === 'ok' ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0" /> : t.tone === 'error' ? <TriangleAlert className="size-4 text-red-500 shrink-0" /> : <Info className="size-4 text-accent shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ---------- misc ----------

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-20 px-6 fade-in">
      <div className="size-16 rounded-[22px] glass grid place-items-center text-fg/50 mb-5">{icon}</div>
      <h2 className="text-lg font-semibold mb-1.5">{title}</h2>
      {children && <div className="text-sm text-muted max-w-sm">{children}</div>}
    </div>
  )
}

export function PageTitle({ children, sub, right }: { children: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-6">
      <div className="mr-auto min-w-0">
        <h1 className="text-[28px] md:text-4xl font-bold tracking-tight leading-tight">{children}</h1>
        {sub && <div className="text-sm text-muted mt-1">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

/** Joins meta bits with a centred dot, skipping empty ones. */
export function Meta({ parts, className = '' }: { parts: React.ReactNode[]; className?: string }) {
  const list = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '')
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {list.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span className="size-[3px] rounded-full bg-current opacity-50" aria-hidden />}
          {p}
        </span>
      ))}
    </div>
  )
}
