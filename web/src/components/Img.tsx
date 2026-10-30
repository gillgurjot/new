import { useState } from 'react'

/** Lazy image with fade-in and a gradient placeholder showing the title when missing. */
export default function Img({ src, alt, className = '', fallback }: { src?: string; alt: string; className?: string; fallback?: React.ReactNode }) {
  // Keyed by src: a card reused for another title (or new artwork) starts over.
  const [loaded, setLoaded] = useState<string>()
  const [failed, setFailed] = useState<string>()
  if (!src || failed === src) {
    return (
      <div className={`${className} bg-gradient-to-br from-surface-2 to-surface-3 grid place-items-center p-3 text-center`}>
        {fallback ?? <span className="text-sm font-semibold text-fg/70 line-clamp-3">{alt}</span>}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(src)}
      onError={() => setFailed(src)}
      className={`${className} object-cover transition-opacity duration-300 ${loaded === src ? 'opacity-100' : 'opacity-0'} bg-surface-2`}
    />
  )
}
