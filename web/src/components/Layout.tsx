import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clapperboard, Heart, Home, LogOut, Search, Settings, Shield, Tv } from 'lucide-react'
import { api, post } from '../api/client'
import type { Library } from '../api/types'
import { useUser } from '../lib/user'

export function useLibraries() {
  return useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries'), staleTime: 60_000 })
}

export async function signOut() {
  const r = await post<{ redirect: string }>('/api/auth/logout')
  location.href = r.redirect || '/login'
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight text-lg shrink-0">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="bg-gradient-to-r from-violet-300 to-pink-300 bg-clip-text text-transparent">Lumen</span>
    </Link>
  )
}

export default function Layout() {
  const user = useUser()
  const libs = useLibraries()
  const loc = useLocation()
  const nav = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20)
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
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        nav('/search')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [nav])

  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-full text-sm font-medium transition ${isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'}`

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header
        className={`fixed top-0 inset-x-0 z-40 transition-colors duration-300 ${scrolled ? 'bg-bg/85 backdrop-blur-xl border-b border-white/5' : 'bg-gradient-to-b from-black/70 to-transparent'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-4 h-16 px-4 md:px-10">
          <Logo />
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto scrollbar-none">
            <NavLink to="/" end className={link}>Home</NavLink>
            {libs.data?.map((l) => (
              <NavLink key={l.id} to={`/library/${l.id}`} className={link}>{l.name}</NavLink>
            ))}
            <NavLink to="/favorites" className={link}>Favorites</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/search" className="icon-btn !bg-transparent hover:!bg-white/10" aria-label="Search (/)">
              <Search className="size-5" />
            </Link>
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="size-9 rounded-full overflow-hidden ring-2 ring-white/10 hover:ring-violet-400 transition bg-gradient-to-br from-violet-500 to-pink-500 grid place-items-center font-bold text-sm" aria-label="Account menu">
                {user.avatar ? <img src={user.avatar} alt="" className="size-full object-cover" /> : user.displayName.slice(0, 1).toUpperCase()}
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 card p-1.5 shadow-2xl fade-in">
                    <div className="px-3 py-2 border-b border-line mb-1">
                      <div className="font-semibold truncate">{user.displayName}</div>
                      <div className="text-xs text-muted truncate">{user.email || user.username}</div>
                    </div>
                    <MenuLink to="/settings" icon={<Settings className="size-4" />}>Settings</MenuLink>
                    {user.isAdmin && <MenuLink to="/admin" icon={<Shield className="size-4" />}>Server admin</MenuLink>}
                    <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-left">
                      <LogOut className="size-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      {/* Mobile tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-bg/90 backdrop-blur-xl border-t border-white/5 pb-safe">
        <div className="grid grid-cols-5 h-16">
          <Tab to="/" icon={<Home className="size-5" />} label="Home" end />
          {(libs.data || []).slice(0, 2).map((l) => (
            <Tab key={l.id} to={`/library/${l.id}`} icon={l.type === 'tv' ? <Tv className="size-5" /> : <Clapperboard className="size-5" />} label={l.name} />
          ))}
          {Array.from({ length: Math.max(0, 2 - (libs.data?.length || 0)) }).map((_, i) => <span key={i} />)}
          <Tab to="/favorites" icon={<Heart className="size-5" />} label="Favorites" />
          <Tab to="/search" icon={<Search className="size-5" />} label="Search" />
        </div>
      </nav>
    </div>
  )
}

function MenuLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-sm">
      {icon}
      {children}
    </Link>
  )
}

function Tab({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `flex flex-col items-center justify-center gap-1 text-[11px] ${isActive ? 'text-white' : 'text-white/50'}`}>
      {icon}
      <span className="truncate max-w-[70px]">{label}</span>
    </NavLink>
  )
}
