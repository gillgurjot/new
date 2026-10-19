import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { api } from '../api/client'
import type { HomeData } from '../api/types'
import Hero from '../components/Hero'
import Row from '../components/Row'
import { CardSkeleton, PosterCard, WideCard } from '../components/Cards'
import { useUser } from '../lib/user'

export default function Home() {
  const user = useUser()
  const { data, isLoading } = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home'), staleTime: 15_000, refetchOnMount: 'always' })

  if (isLoading || !data) {
    return (
      <div className="pt-24 space-y-10">
        <div className="skeleton h-[50vh] mx-4 md:mx-10 rounded-3xl" />
        <div className="flex gap-4 px-4 md:px-10">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="w-40 shrink-0"><CardSkeleton /></div>)}</div>
      </div>
    )
  }

  const empty = !data.latest.length
  return (
    <div className="pb-12">
      {data.featured.length ? <Hero items={data.featured} /> : <div className="h-24" />}
      <div className={`space-y-10 relative z-10 ${data.featured.length ? '-mt-16 md:-mt-24' : ''}`}>
        {empty && (
          <div className="mx-4 md:mx-10 card p-10 text-center fade-in">
            <FolderPlus className="size-12 mx-auto text-violet-300 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Welcome to Lumen</h2>
            {user.isAdmin ? (
              <>
                <p className="text-muted mb-6">Add a library folder with your movies or shows to get started.</p>
                <Link to="/admin/libraries" className="btn-accent">Add a library</Link>
              </>
            ) : (
              <p className="text-muted">Nothing here yet. Ask the server admin to add a library or give you access.</p>
            )}
          </div>
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
        {data.latest.map((r) => (
          <Row key={r.library.id} title={`Recently added in ${r.library.name}`} to={`/library/${r.library.id}?sort=added&order=desc`}>
            {r.items.map((it) => <PosterCard key={it.id} item={it} />)}
          </Row>
        ))}
      </div>
    </div>
  )
}
