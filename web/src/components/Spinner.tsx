export default function Spinner({ className = 'size-10' }: { className?: string }) {
  return <div className={`${className} rounded-full border-[3px] border-white/15 border-t-violet-400 animate-spin`} role="status" aria-label="Loading" />
}
