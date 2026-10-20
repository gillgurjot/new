import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { api } from '../api/client'
import type { HomeData } from '../api/types'
import Hero from '../components/Hero'
import Row from '../components/Row'
import { CardSkeleton, PosterCard, WideCard } from '../components/Cards'
import { EmptyState } from '../components/ui'
import { useUser } from '../lib/user'

export default function Home() {
  const user = useUser()
  const { data, isLoading } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home'), staleTime: 15_000, refetchOnMount: 'always' })

  if (isLoading || !data) {
    return (
      <div>
        <div className="skeleton h-[min(78svh,680px)] md:h-[min(82vh,780px)]" />
        <div className="flex gap-3 px-4 md:px-10 mt-8 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="w-[30vw] sm:w-[150px] lg:w-[170px] shrink-0"><CardSkeleton /></div>)}
        </div>
      </div>
    )
  }

  const empty = !data.latest.length
  return (
    <div className="pb-14">
      {data.featured.length ? <Hero items={data.featured} /> : <div className="h-20" />}
      <div className="space-y-9 md:space-y-12 mt-2 md:-mt-6 relative">
        {empty && (
          <EmptyState icon={<FolderPlus className="size-8" />} title="Welcome to Lumen">
            {user.isAdmin ? (
              <>
                <p className="mb-6">Add a folder with your movies or shows to get started.</p>
                <Link to="/admin/libraries" className="btn-accent">Add a library</Link>
              </>
            ) : (
              <p>Nothing here yet. Ask the server admin to add a library or give you access.</p>
            )}
          </EmptyState>
        )}
        {data.continueWatching.length > 0 && (
          <Row title="Continue watching" wide>
            {data.continueWatching.map((it) => <WideCard key={it.id} item={it} play />)}
          </Row>
        )}
        {data.nextUp.length > 0 && (
          <Row title="Next up" wide>
            {data.nextUp.map((it) => <WideCard key={it.id} item={it} play />)}
          </Row>
        )}
        {data.myList?.length > 0 && (
          <Row title="My list" to="/favorites">
            {data.myList.map((it) => <PosterCard key={it.id} item={it} />)}
          </Row>
        )}
        {data.latest.map((r) => (
          <Row key={r.library.id} title={`New in ${r.library.name}`} to={`/library/${r.library.id}?sort=added&order=desc`}>
            {r.items.map((it) => <PosterCard key={it.id} item={it} />)}
          </Row>
        ))}
      </div>
    </div>
  )
}
