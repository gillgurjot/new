import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Player from './Player'

export default function PlayerPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const t = sp.get('t')
  const exit = () => {
    qc.invalidateQueries({ queryKey: ['home'] })
    qc.invalidateQueries({ queryKey: ['item'] })
    qc.invalidateQueries({ queryKey: ['children'] })
    if (window.history.length > 1) nav(-1)
    else nav(`/item/${id}`, { replace: true })
  }
  return (
    <Player
      key={id}
      itemId={Number(id)}
      startTime={t != null ? Number(t) : undefined}
      onExit={exit}
      onNext={(next) => nav(`/play/${next}`, { replace: true })}
    />
  )
}
