import { useState } from 'react'

/** Lazy image with fade-in and a gradient placeholder showing the title when missing. */
export default function Img({ src, alt, className = '', fallback }: { src?: string; alt: string; className?: string; fallback?: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={`${className} bg-gradient-to-br from-surface-2 to-surface-3 grid place-items-center p-3 text-center`}>
        {fallback ?? <span className="text-sm font-semibold text-white/70 line-clamp-3">{alt}</span>}
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
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`${className} object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} bg-surface-2`}
    />
  )
}
