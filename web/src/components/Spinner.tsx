export default function Spinner({ className = 'size-10' }: { className?: string }) {
  return <div className={`${className} rounded-full border-[3px] border-fg/15 border-t-fg animate-spin`} role="status" aria-label="Loading" />
}
