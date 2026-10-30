import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clapperboard, Heart, Home, LogOut, Plus, Search, Settings, Shield, Tv } from 'lucide-react'
import { api, post } from '../api/client'
import type { Library, RequestsConfig } from '../api/types'
import { useUser } from '../lib/user'
import { Avatar, Menu, MenuItem } from './ui'

export function useLibraries() {
  return useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries'), staleTime: 60_000 })
}

export function useRequestsConfig() {
  return useQuery({ queryKey: ['requests-config'], queryFn: () => api<RequestsConfig>('/api/requests/config'), staleTime: 300_000 })
}

export async function signOut() {
  const r = await post<{ redirect: string }>('/api/auth/logout')
  location.href = r.redirect || '/login'
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 shrink-0 ${className}`} aria-label="Lumen home">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="text-[19px] font-bold tracking-tight">Lumen</span>
    </Link>
  )
}

export default function Layout() {
  const user = useUser()
  const libs = useLibraries()
  const reqs = useRequestsConfig()
  const loc = useLocation()
  const nav = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState(false)
  const canRequest = !!reqs.data?.enabled

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    window.scrollTo(0, 0)
    setMenu(false)
  }, [loc.pathname])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        nav('/search')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [nav])

  const link = ({ isActive }: { isActive: boolean }) =>
    `relative px-3.5 h-9 inline-flex items-center rounded-full text-sm font-medium transition duration-300 ${isActive ? 'text-fg bg-fg/[.1] shadow-[inset_0_1px_0_var(--glass-rim)]' : 'text-fg/60 hover:text-fg'}`

  return (
    <div className="min-h-dvh pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* Floating glass bar. The glass is its own layer so the account menu's overlay isn't trapped by backdrop-filter. */}
      <header className="fixed top-0 inset-x-0 z-40 px-3 md:px-6 pointer-events-none" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
        <div className="relative pointer-events-auto mx-auto max-w-[1680px] flex items-center gap-4 md:gap-6 h-14 pl-4 pr-2 md:pl-5">
          <div className={`absolute inset-0 rounded-full glass-bar transition-opacity duration-500 ${scrolled ? 'opacity-100' : 'opacity-90'}`} aria-hidden />
          <Logo className="relative" />
          <nav className="relative hidden md:flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-none">
            <NavLink to="/" end className={link}>Home</NavLink>
            {libs.data?.map((l) => (
              <NavLink key={l.id} to={`/library/${l.id}`} className={link}>{l.name}</NavLink>
            ))}
            <NavLink to="/favorites" className={link}>My list</NavLink>
            {canRequest && <NavLink to="/requests" className={link}>Requests</NavLink>}
          </nav>
          <div className="relative ml-auto flex items-center gap-1.5">
            <Link to="/search" className="hidden md:inline-flex icon-btn-plain !size-10" aria-label="Search (/)" title="Search (/)">
              <Search className="size-5" />
            </Link>
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="grid place-items-center size-10 rounded-full ring-2 ring-transparent hover:ring-fg/20 transition" aria-label="Account menu">
                <Avatar name={user.displayName || user.username} src={user.avatar} className="size-8 text-xs" />
              </button>
              <Menu open={menu} onClose={() => setMenu(false)}>
                <div className="flex items-center gap-3 px-3 py-2.5 mb-1 border-b border-line">
                  <Avatar name={user.displayName || user.username} src={user.avatar} className="size-9 text-sm" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{user.displayName}</div>
                    <div className="text-xs text-muted truncate">{user.email || user.username}</div>
                  </div>
                </div>
                <MenuItem icon={<Heart className="size-4" />} onClick={() => nav('/favorites')}>My list</MenuItem>
                <MenuItem icon={<Settings className="size-4" />} onClick={() => nav('/settings')}>Settings</MenuItem>
                {user.isAdmin && <MenuItem icon={<Shield className="size-4" />} onClick={() => nav('/admin')}>Server admin</MenuItem>}
                <MenuItem icon={<LogOut className="size-4" />} onClick={signOut}>Sign out</MenuItem>
              </Menu>
            </div>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      {/* Phone tab bar: a floating glass capsule */}
      <nav className="md:hidden fixed inset-x-3 z-40" style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="absolute inset-0 rounded-[28px] glass-bar" aria-hidden />
        <div className="relative grid grid-cols-5 h-16 px-1.5">
          <Tab to="/" icon={<Home />} label="Home" end />
          {(libs.data || []).slice(0, 2).map((l) => (
            <Tab key={l.id} to={`/library/${l.id}`} icon={l.type === 'tv' ? <Tv /> : <Clapperboard />} label={l.name} />
          ))}
          {Array.from({ length: Math.max(0, 2 - (libs.data?.length || 0)) }).map((_, i) => <span key={i} />)}
          {canRequest ? <Tab to="/requests" icon={<Plus />} label="Request" /> : <Tab to="/favorites" icon={<Heart />} label="My list" />}
          <Tab to="/search" icon={<Search />} label="Search" />
        </div>
      </nav>
    </div>
  )
}

function Tab({ to, icon, label, end }: { to: string; icon: React.ReactElement; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `relative group flex flex-col items-center justify-center gap-0.5 my-1.5 rounded-[22px] text-[10.5px] font-medium transition duration-300 active:scale-95 ${isActive ? 'text-accent bg-fg/[.08] shadow-[inset_0_1px_0_var(--glass-rim)]' : 'text-fg/55'}`}>
      <span className="grid place-items-center h-6 [&>svg]:size-[21px]">{icon}</span>
      <span className="truncate max-w-[68px]">{label}</span>
    </NavLink>
  )
}
