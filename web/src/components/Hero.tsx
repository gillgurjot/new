import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Play } from 'lucide-react'
import { imageUrl } from '../api/client'
import type { Item } from '../api/types'
import { formatRuntime } from '../lib/format'

/** Rotating featured banner on the home page. */
export default function Hero({ items }: { items: Item[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 9000)
    return () => clearInterval(t)
  }, [items.length])
  if (!items.length) return null
  const it = items[i]
  const logo = imageUrl(it, 'logo', 500)
  return (
    <div className="relative h-[72vh] min-h-[460px] max-h-[820px] overflow-hidden">
      {items.map((x, idx) => (
        <img
          key={x.id}
          src={imageUrl(x, 'backdrop', 1920)}
          alt=""
          className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ${idx === i ? 'opacity-100' : 'opacity-0'}`}
          fetchPriority={idx === 0 ? 'high' : 'low'}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/30 to-transparent" />
      <div key={it.id} className="absolute bottom-[12%] left-4 md:left-10 right-4 max-w-2xl fade-in">
        {logo ? (
          <img src={logo} alt={it.title} className="max-h-28 md:max-h-36 max-w-[70%] object-contain object-left mb-4 drop-shadow-2xl" />
        ) : (
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-3 drop-shadow-xl">{it.title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/80 mb-3">
          {it.year ? <span>{it.year}</span> : null}
          {it.contentRating && <span className="chip">{it.contentRating}</span>}
          {it.runtime && it.type === 'movie' ? <span>{formatRuntime(it.runtime)}</span> : null}
          {it.type === 'series' && it.childCount ? <span>{it.childCount} seasons</span> : null}
          {it.genres.slice(0, 3).map((g) => (
            <span key={g} className="text-white/60">· {g}</span>
          ))}
        </div>
        <p className="text-white/80 line-clamp-3 mb-6 text-sm md:text-base max-w-xl">{it.overview}</p>
        <div className="flex gap-3">
          <Link to={it.type === 'movie' ? `/play/${it.id}` : `/item/${it.id}`} className="btn-primary">
            <Play className="size-5 fill-current" /> {it.type === 'movie' ? 'Play' : 'Watch'}
          </Link>
          <Link to={`/item/${it.id}`} className="btn-ghost">
            <Info className="size-5" /> More info
          </Link>
        </div>
      </div>
      {items.length > 1 && (
        <div className="absolute bottom-6 right-4 md:right-10 flex gap-1.5">
          {items.map((x, idx) => (
            <button key={x.id} onClick={() => setI(idx)} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-6 bg-white' : 'w-1.5 bg-white/40'}`} aria-label={`Show ${x.title}`} />
          ))}
        </div>
      )}
    </div>
  )
}
