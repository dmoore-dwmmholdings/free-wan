import { useMemo } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ErrorState } from '@/components/ErrorState'
import { MediaTile, gridMetrics } from '@/components/MediaTile'
import { useCollection } from '@/lib/collections'
import { useMediaList } from '@/lib/media'
import { theme } from '@/theme'

const GAP = theme.space(2.5)
const PADDING = theme.space(3)

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()
  const { columns, tileWidth } = gridMetrics(width, PADDING, GAP)

  const collection = useCollection(id)
  const list = useMediaList(useMemo(() => ({ collection: id }), [id]))
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data])

  return (
    <>
      <Stack.Screen options={{ title: collection?.name ?? 'Collection', headerTransparent: false }} />
      {list.isLoading ? (
        <View style={{ flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : (
        <FlatList
          style={{ backgroundColor: theme.color.bg }}
          data={items}
          key={columns}
          numColumns={columns}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: PADDING, gap: GAP }}
          columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
          renderItem={({ item }) => <MediaTile item={item} width={tileWidth} />}
          refreshControl={
            <RefreshControl
              // Guarded against `isFetchingNextPage` for the same reason as the library: the
              // spinner belongs to a pull, not to scrolling onto the next page.
              refreshing={list.isRefetching && !list.isFetchingNextPage}
              onRefresh={() => void list.refetch()}
              tintColor={theme.color.muted}
            />
          }
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
          }}
          ListEmptyComponent={
            list.isError || !list.data ? (
              <ErrorState onRetry={() => void list.refetch()} />
            ) : (
              <View style={{ paddingTop: theme.space(20), alignItems: 'center' }}>
                <Text style={{ color: theme.color.muted, fontSize: 14 }}>This collection is empty.</Text>
              </View>
            )
          }
        />
      )}
    </>
  )
}
