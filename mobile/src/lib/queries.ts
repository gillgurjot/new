import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Library, RequestsConfig } from '../api/types'

export function useRequestsConfig() {
  return useQuery({ queryKey: ['requests-config'], queryFn: () => api<RequestsConfig>('/api/requests/config'), staleTime: 5 * 60_000 })
}

export function useLibraries() {
  return useQuery({ queryKey: ['libraries'], queryFn: () => api<Library[]>('/api/libraries'), staleTime: 5 * 60_000 })
}
