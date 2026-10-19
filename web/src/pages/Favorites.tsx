import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { api } from '../api/client'
import type { Item } from '../api/types'
import { PosterCard, WideCard } from '../components/Cards'

export default function FavoritesPage() {
  const { data } = useQuery({ queryKey: ['favorites'], queryFn: () => api<Item[]>('/api/favorites'), refetchOnMount: 'always' })
  const posters = data?.filter((i) => i.type !== 'episode') || []
  const eps = data?.filter((i) => i.type === 'episode') || []
  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-12">
      <h1 className="text-2xl md:text-3xl font-black tracking-tight mb-6">Favorites</h1>
      {data && !data.length && (
        <div className="text-center text-muted py-20">
          <Heart className="size-10 mx-auto mb-3 opacity-50" />
          Tap the heart on anything to save it here.
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6 mb-10">
        {posters.map((it) => <PosterCard key={it.id} item={it} />)}
      </div>
      {eps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {eps.map((it) => <WideCard key={it.id} item={it} />)}
        </div>
      )}
    </div>
  )
}
