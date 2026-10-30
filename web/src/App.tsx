import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from './api/client'
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
import RequestsPage from './pages/Requests'
import { Toaster } from './components/ui'
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
  // 401: the API client is already on its way to the sign-in page.
  if (me.isLoading || (me.error instanceof ApiError && me.error.status === 401)) return <Loading />
  if (!me.data) {
    // Anything else (server down, restarting) can be retried.
    return (
      <div className="grid place-items-center h-dvh p-6 text-center">
        <div>
          <div className="font-semibold text-lg mb-1">Can’t reach Lumen</div>
          <p className="text-sm text-muted mb-5">{(me.error as Error | null)?.message || 'Something went wrong.'}</p>
          <button className="btn-primary" onClick={() => me.refetch()} disabled={me.isFetching}>{me.isFetching ? 'Trying…' : 'Try again'}</button>
        </div>
      </div>
    )
  }

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
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/admin/*" element={me.data.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </UserContext.Provider>
  )
}
