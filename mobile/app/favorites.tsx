import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Heart } from 'lucide-react-native'
import { api } from '../src/api/client'
import type { Item } from '../src/api/types'
import Grid from '../src/components/Grid'
import { EmptyState, Header, Loading } from '../src/components/ui'

export default function Favorites() {
  const q = useQuery({ queryKey: ['favorites'], queryFn: () => api<Item[]>('/api/favorites') })
  return (
    <View style={{ flex: 1 }}>
      <Header title="My List" />
      {q.isLoading ? (
        <Loading />
      ) : (
        <Grid
          items={q.data || []}
          header={<View style={{ height: 8 }} />}
          empty={<EmptyState icon={Heart} shape="cookie12" title="Your list is empty">Tap the heart on any title to save it here.</EmptyState>}
        />
      )}
    </View>
  )
}
