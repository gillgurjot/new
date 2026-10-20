import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Horizontally scrolling shelf with snap scrolling and desktop arrows. */
export default function Row({ title, to, children, wide = false, action }: { title: string; to?: string; children: React.ReactNode; wide?: boolean; action?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="group/row relative">
      <div className="flex items-center gap-3 px-4 md:px-10 mb-3">
        <h2 className="text-[17px] md:text-xl font-semibold tracking-tight">{title}</h2>
        {to && (
          <Link to={to} className="ml-auto text-[13px] font-medium text-muted hover:text-white transition inline-flex items-center gap-0.5">
            See all <ChevronRight className="size-4" />
          </Link>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="relative">
        <button onClick={() => scroll(-1)} className="hidden md:grid absolute left-0 top-0 bottom-10 z-10 w-12 place-items-center bg-gradient-to-r from-bg/90 to-transparent opacity-0 group-hover/row:opacity-100 transition" aria-label="Scroll left">
          <ChevronLeft className="size-7" />
        </button>
        <div
          ref={ref}
          className={`flex gap-3 md:gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory scroll-px-4 md:scroll-px-10 px-4 md:px-10 pb-1 ${wide ? '[&>*]:w-[68vw] sm:[&>*]:w-[300px] lg:[&>*]:w-[330px]' : '[&>*]:w-[30vw] sm:[&>*]:w-[150px] lg:[&>*]:w-[170px]'} [&>*]:shrink-0 [&>*]:snap-start`}
        >
          {children}
        </div>
        <button onClick={() => scroll(1)} className="hidden md:grid absolute right-0 top-0 bottom-10 z-10 w-12 place-items-center bg-gradient-to-l from-bg/90 to-transparent opacity-0 group-hover/row:opacity-100 transition" aria-label="Scroll right">
          <ChevronRight className="size-7" />
        </button>
      </div>
    </section>
  )
}
