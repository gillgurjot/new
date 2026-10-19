import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Horizontally scrolling shelf with snap scrolling and desktop arrows. */
export default function Row({ title, to, children, wide = false }: { title: string; to?: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="group/row relative">
      <div className="flex items-end justify-between px-4 md:px-10 mb-3">
        <h2 className="text-lg md:text-xl font-bold tracking-tight">
          {to ? <Link to={to} className="hover:text-violet-300 transition">{title} <ChevronRight className="inline size-5 -mt-0.5" /></Link> : title}
        </h2>
      </div>
      <div className="relative">
        <button onClick={() => scroll(-1)} className="hidden md:grid absolute left-0 top-0 bottom-8 z-10 w-10 place-items-center bg-gradient-to-r from-bg to-transparent opacity-0 group-hover/row:opacity-100 transition" aria-label="Scroll left">
          <ChevronLeft className="size-7" />
        </button>
        <div
          ref={ref}
          className={`flex gap-3 md:gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory scroll-px-4 md:scroll-px-10 px-4 md:px-10 pb-2 ${wide ? '[&>*]:w-[72vw] sm:[&>*]:w-[300px] lg:[&>*]:w-[340px]' : '[&>*]:w-[36vw] sm:[&>*]:w-[160px] lg:[&>*]:w-[180px]'} [&>*]:shrink-0 [&>*]:snap-start`}
        >
          {children}
        </div>
        <button onClick={() => scroll(1)} className="hidden md:grid absolute right-0 top-0 bottom-8 z-10 w-10 place-items-center bg-gradient-to-l from-bg to-transparent opacity-0 group-hover/row:opacity-100 transition" aria-label="Scroll right">
          <ChevronRight className="size-7" />
        </button>
      </div>
    </section>
  )
}
