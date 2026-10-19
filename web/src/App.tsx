import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'
import type { User } from './api/types'
import Layout from './components/Layout'
import Spinner from './components/Spinner'
import Home from './pages/Home'
import Login from './pages/Login'
import LibraryPage from './pages/Library'
import ItemPage from './pages/Item'
import SearchPage from './pages/Search'
import FavoritesPage from './pages/Favorites'
import SettingsPage from './pages/Settings'
import { UserContext } from './lib/user'

const PlayerPage = lazy(() => import('./player/PlayerPage'))
const AdminPage = lazy(() => import('./pages/admin/Admin'))

function Loading() {
  return (
    <div className="grid place-items-center h-dvh">
      <Spinner />
    </div>
  )
}

export default function App() {
  const loc = useLocation()
  const onLogin = loc.pathname.startsWith('/login')
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/api/me'), enabled: !onLogin, retry: false, staleTime: 300_000 })

  if (onLogin) return <Login />
  if (me.isLoading || !me.data) return <Loading />

  return (
    <UserContext.Provider value={me.data}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/play/:id" element={<PlayerPage />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="/library/:id" element={<LibraryPage />} />
            <Route path="/item/:id" element={<ItemPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin/*" element={me.data.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </UserContext.Provider>
  )
}
