import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { api } from '../api/client'
import type { Item } from '../api/types'
import { CardSkeleton, PosterCard, WideCard } from '../components/Cards'
import { EmptyState, PageTitle } from '../components/ui'
import { plural } from '../lib/format'

export default function FavoritesPage() {
  const { data } = useQuery({ queryKey: ['favorites'], queryFn: () => api<Item[]>('/api/favorites'), refetchOnMount: 'always' })
  const posters = data?.filter((i) => i.type !== 'episode') || []
  const eps = data?.filter((i) => i.type === 'episode') || []
  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-12">
      <PageTitle sub={data?.length ? plural(data.length, 'title') : undefined}>My list</PageTitle>
      {data && !data.length && (
        <EmptyState icon={<Heart className="size-8" />} title="Your list is empty">Tap “My list” on any movie or show to save it here.</EmptyState>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-6 md:gap-x-5 mb-10">
        {!data && Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        {posters.map((it) => <PosterCard key={it.id} item={it} />)}
      </div>
      {eps.length > 0 && (
        <>
          <h2 className="text-[17px] md:text-xl font-semibold tracking-tight mb-4">Episodes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {eps.map((it) => <WideCard key={it.id} item={it} />)}
          </div>
        </>
      )}
    </div>
  )
}
