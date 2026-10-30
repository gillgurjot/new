import type { ReactElement } from 'react'
import { FlatList, useWindowDimensions, View } from 'react-native'
import type { Item } from '../api/types'
import { PosterCard } from './cards'

/** Poster grid that fits the screen width (3 columns on most phones). */
export default function Grid({
  items, header, footer, onEnd, empty, refreshControl,
}: {
  items: Item[]
  header?: ReactElement | null
  footer?: ReactElement | null
  empty?: ReactElement | null
  onEnd?: () => void
  refreshControl?: ReactElement
}) {
  const { width } = useWindowDimensions()
  const cols = Math.max(3, Math.floor((width - 16) / 140))
  const gap = 12
  const w = Math.floor((width - 32 - gap * (cols - 1)) / cols)
  return (
    <FlatList
      key={cols}
      data={items}
      numColumns={cols}
      keyExtractor={(i) => String(i.id)}
      ListHeaderComponent={header ?? undefined}
      ListFooterComponent={footer ?? undefined}
      ListEmptyComponent={empty ?? undefined}
      columnWrapperStyle={{ gap, paddingHorizontal: 16 }}
      contentContainerStyle={{ gap: 16, paddingBottom: 40 }}
      renderItem={({ item }) => <PosterCard it={item} width={w} />}
      onEndReached={onEnd}
      onEndReachedThreshold={1.5}
      refreshControl={refreshControl}
      ItemSeparatorComponent={() => <View />}
      initialNumToRender={18}
      windowSize={7}
      removeClippedSubviews
    />
  )
}
