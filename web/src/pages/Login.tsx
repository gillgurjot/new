import { useQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { api } from '../api/client'

export default function Login() {
  const params = new URLSearchParams(location.search)
  const error = params.get('error')
  const redirect = params.get('redirect') || '/'
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ devLogin: boolean; provider: string; oidc: boolean }>('/api/auth/config') })
  const loginHref = `/api/auth/login?redirect=${encodeURIComponent(redirect)}`

  return (
    <div className="min-h-dvh grid place-items-center p-6 relative overflow-hidden">
      <div className="absolute -top-40 -left-40 size-[520px] rounded-full bg-violet-600/25 blur-[120px]" />
      <div className="absolute -bottom-40 -right-40 size-[520px] rounded-full bg-pink-600/20 blur-[120px]" />
      <div className="relative w-full max-w-sm text-center fade-in">
        <img src="/favicon.svg" alt="" className="size-16 mx-auto mb-6 drop-shadow-2xl" />
        <h1 className="text-3xl font-black tracking-tight mb-2">Welcome to Lumen</h1>
        <p className="text-muted mb-8">Your movies and shows, streamed from home.</p>
        {error && <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {cfg.data?.oidc !== false && (
          <a href={loginHref} className="btn-accent w-full h-12 text-base">
            <KeyRound className="size-5" /> Sign in with {cfg.data?.provider ? 'Pocket ID' : 'SSO'}
          </a>
        )}
        {cfg.data?.provider && <p className="text-xs text-muted mt-3">via {cfg.data.provider}</p>}
        {cfg.data?.devLogin && (
          <a href={`/api/auth/dev-login?user=admin&admin=1&redirect=${encodeURIComponent(redirect)}`} className="btn-ghost w-full mt-4">
            Developer sign-in (insecure)
          </a>
        )}
      </div>
    </div>
  )
}
