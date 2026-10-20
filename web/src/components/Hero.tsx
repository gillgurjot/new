import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Play } from 'lucide-react'
import { imageUrl } from '../api/client'
import type { Item } from '../api/types'
import { formatRuntime, plural } from '../lib/format'
import { Meta } from './ui'

/** Rotating featured banner on the home page. Swipe on phones, dots everywhere. */
export default function Hero({ items }: { items: Item[] }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const n = items.length

  useEffect(() => {
    if (n < 2 || paused) return
    const t = setInterval(() => {
      if (!document.hidden) setI((x) => (x + 1) % n)
    }, 8000)
    return () => clearInterval(t)
  }, [n, paused, i])

  if (!n) return null
  const it = items[i]
  const logo = imageUrl(it, 'logo', 420)
  const go = (d: number) => setI((x) => (x + d + n) % n)

  return (
    <section
      className="relative overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const s = touch.current
        touch.current = null
        if (!s) return
        const dx = e.changedTouches[0].clientX - s.x
        const dy = e.changedTouches[0].clientY - s.y
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
      }}
      aria-roledescription="carousel"
    >
      {/* Artwork */}
      <div className="absolute inset-0">
        {items.map((x, idx) => (
          <img
            key={x.id}
            src={imageUrl(x, 'backdrop', 1600)}
            alt=""
            className={`absolute inset-0 size-full object-cover object-[center_20%] transition-opacity duration-1000 ${idx === i ? 'opacity-100' : 'opacity-0'}`}
            fetchPriority={idx === 0 ? 'high' : 'low'}
            loading={idx === 0 ? 'eager' : 'lazy'}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/75 via-35% to-bg/10" />
        <div className="absolute inset-0 hidden md:block bg-gradient-to-r from-bg/90 via-bg/40 via-45% to-transparent" />
      </div>

      {/* Content: in normal flow so it never overlaps the rows below */}
      <div className="relative flex flex-col justify-end min-h-[min(78svh,680px)] md:min-h-[min(82vh,780px)] px-4 md:px-10 pt-24 pb-8 md:pb-14">
        <div key={it.id} className="max-w-xl fade-in">
          {logo ? (
            <img src={logo} alt={it.title} className="max-h-24 md:max-h-36 max-w-[78%] md:max-w-[70%] object-contain object-left mb-5 drop-shadow-[0_4px_24px_rgba(0,0,0,.6)]" />
          ) : (
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] mb-4 drop-shadow-xl">{it.title}</h1>
          )}
          <Meta
            className="text-[13px] md:text-sm text-white/75 font-medium mb-3"
            parts={[
              it.year || null,
              it.contentRating ? <span className="chip">{it.contentRating}</span> : null,
              it.type === 'movie' && it.runtime ? formatRuntime(it.runtime) : null,
              it.type === 'series' && it.childCount ? plural(it.childCount, 'season') : null,
              it.genres.slice(0, 2).join(', ') || null,
            ]}
          />
          {it.overview && <p className="text-[15px] leading-relaxed text-white/75 line-clamp-2 md:line-clamp-3 mb-6">{it.overview}</p>}
          <div className="flex items-center gap-3">
            <Link to={it.type === 'movie' ? `/play/${it.id}` : `/item/${it.id}`} className="btn-primary !h-12 !px-7 flex-1 sm:flex-none">
              <Play className="size-5 fill-current" /> {it.type === 'movie' ? 'Play' : 'Watch'}
            </Link>
            <Link to={`/item/${it.id}`} className="btn-ghost !h-12 !px-6 flex-1 sm:flex-none">
              <Info className="size-5" /> Details
            </Link>
          </div>
        </div>
        {n > 1 && (
          <div className="flex gap-1.5 mt-7 justify-center md:justify-start" role="tablist">
            {items.map((x, idx) => (
              <button
                key={x.id}
                onClick={() => setI(idx)}
                role="tab"
                aria-selected={idx === i}
                aria-label={`Show ${x.title}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === i ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
