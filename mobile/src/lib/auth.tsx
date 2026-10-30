import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import * as Crypto from 'expo-crypto'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getServer, post, setSession, setUnauthorizedHandler } from '../api/client'
import type { User } from '../api/types'

const K_SERVER = 'lumen.server'
const K_USER = 'lumen.user'
const K_TOKEN = 'lumen.token'
export const DEFAULT_SERVER = 'https://lumen.local.xgill.com'
// The server moved domains in 1.0.1; phones signed in on 1.0.0 still have this saved.
const OLD_SERVER = 'https://lumen.local.gurjotgill.com'
const REDIRECT = 'lumen://auth'

interface AuthCtx {
  ready: boolean
  server: string
  user: User | null
  signIn: (server: string, devUser?: string) => Promise<void>
  signOut: () => Promise<void>
  setUser: (u: User) => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function normalizeServer(s: string) {
  let v = s.trim().replace(/\/+$/, '')
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v
  return v
}

const b64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function bytesToB64(bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function param(url: string, name: string) {
  const m = new RegExp(`[?&]${name}=([^&#]*)`).exec(url)
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''
}

export class SignInCancelled extends Error {}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [server, setServer] = useState(DEFAULT_SERVER)
  const [user, setUserState] = useState<User | null>(null)

  const setUser = useCallback((u: User) => {
    setUserState(u)
    AsyncStorage.setItem(K_USER, JSON.stringify(u)).catch(() => {})
  }, [])

  const qc = useQueryClient()
  // Keeps the current address (the restore effect calls this before `server` state catches up)
  // and drops every cached query so the next account never sees this one's library.
  const clear = useCallback(async () => {
    setSession(getServer(), '')
    setUserState(null)
    qc.clear()
    await SecureStore.deleteItemAsync(K_TOKEN).catch(() => {})
    await AsyncStorage.removeItem(K_USER).catch(() => {})
  }, [qc])

  // Restore the last session. Works offline: the cached profile is enough to reach downloads.
  useEffect(() => {
    ;(async () => {
      const [s, t, u] = await Promise.all([
        AsyncStorage.getItem(K_SERVER).catch(() => null),
        SecureStore.getItemAsync(K_TOKEN).catch(() => null),
        AsyncStorage.getItem(K_USER).catch(() => null),
      ])
      const srv = !s || s === OLD_SERVER ? DEFAULT_SERVER : s
      if (s === OLD_SERVER) AsyncStorage.setItem(K_SERVER, srv).catch(() => {})
      setServer(srv)
      if (t) {
        setSession(srv, t)
        if (u) {
          try {
            setUserState(JSON.parse(u))
          } catch {
            /* ignore */
          }
        }
        api<User>('/api/me')
          .then(setUser)
          .catch((e) => {
            if (e instanceof ApiError && e.status === 401) clear()
          })
      }
      setReady(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clear()
    })
    return () => setUnauthorizedHandler(null)
  }, [clear])

  const signIn = useCallback(async (input: string, devUser?: string) => {
    const srv = normalizeServer(input)
    if (!srv) throw new Error('Enter your Lumen address')
    setSession(srv, '')
    // Check the server answers before opening the browser.
    const cfg = await api<{ devLogin: boolean; oidc: boolean }>('/api/auth/config', { timeout: 10_000 })
    if (devUser && !cfg.devLogin) throw new Error('Test sign-in is turned off on this server')
    if (!devUser && !cfg.oidc) throw new Error('This server has no sign-in provider set up')

    const verifier = b64url(bytesToB64(Crypto.getRandomBytes(32)))
    const challenge = b64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }))
    const url = devUser
      ? `${srv}/api/auth/dev-login?user=${encodeURIComponent(devUser)}&admin=1&app=${challenge}`
      : `${srv}/api/auth/login?app=${challenge}`
    const res = await WebBrowser.openAuthSessionAsync(url, REDIRECT, { showInRecents: false })
    if (res.type !== 'success') throw new SignInCancelled('cancelled')
    const err = param(res.url, 'error')
    if (err) throw new Error(err)
    const code = param(res.url, 'code')
    if (!code) throw new Error('Sign-in didn’t finish. Please try again.')
    const { token } = await post<{ token: string }>('/api/auth/app-token', { code, verifier })
    setSession(srv, token)
    await SecureStore.setItemAsync(K_TOKEN, token)
    await AsyncStorage.setItem(K_SERVER, srv)
    setServer(srv)
    const me = await api<User>('/api/me')
    setUser(me)
  }, [setUser])

  const signOut = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {})
    await clear()
  }, [clear])

  const value = useMemo(() => ({ ready, server, user, signIn, signOut, setUser }), [ready, server, user, signIn, signOut, setUser])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

/** The signed-in user. Only use under the signed-in part of the app. */
export function useUser(): User {
  const { user } = useAuth()
  return user as User
}
