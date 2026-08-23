import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { Link } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import type { MediaCard } from '@free-wan/shared'
import { AuthImage } from '@/components/AuthImage'
import { CategoryChips, type Crumb } from '@/components/CategoryChips'
import { useCategoryChildren } from '@/lib/categories'
import { formatDuration, useMediaList } from '@/lib/media'
import { theme } from '@/theme'

const GAP = theme.space(2.5)
const PADDING = theme.space(3)

function Tile({ item, width }: { item: MediaCard; width: number }) {
  const duration = formatDuration(item.durationS)
  return (
    <Link href={`/media/${item.id}`} asChild>
      <Pressable style={({ pressed }) => ({ width, opacity: pressed ? 0.7 : 1 })}>
        <View
          style={{
            width,
            aspectRatio: 16 / 10,
            borderRadius: theme.radius.sm,
            overflow: 'hidden',
            backgroundColor: theme.color.surface2,
          }}
        >
          <AuthImage path={item.posterUrl} style={{ width: '100%', height: '100%' }} />
          {duration ? (
            <View
              style={{
                position: 'absolute',
                right: 6,
                bottom: 6,
                backgroundColor: 'rgba(11,11,16,0.82)',
                borderRadius: 5,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: theme.color.text, fontSize: 11, fontVariant: ['tabular-nums'] }}>
                {duration}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={2}
          style={{ color: theme.color.text, fontSize: 13, fontWeight: '600', marginTop: theme.space(2) }}
        >
          {item.title}
        </Text>
      </Pressable>
    </Link>
  )
}

export default function BrowseScreen() {
  const { width: screenWidth } = useWindowDimensions()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [trail, setTrail] = useState<Crumb[]>([])
  const [likedOnly, setLikedOnly] = useState(false)
  const currentCategory = trail.length > 0 ? trail[trail.length - 1]!.id : null

  // Two columns on a phone, more as the viewport grows (tablet, landscape).
  const columns = Math.max(2, Math.floor(screenWidth / 220))
  const tileWidth = (screenWidth - PADDING * 2 - GAP * (columns - 1)) / columns

  const categories = useCategoryChildren(currentCategory)
  const list = useMediaList(
    useMemo(
      () => ({ q: query || undefined, category: currentCategory, liked: likedOnly || undefined }),
      [query, currentCategory, likedOnly],
    ),
  )
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data])

  if (list.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    )
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.color.bg }}
      data={items}
      key={columns}
      numColumns={columns}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ padding: PADDING, gap: GAP }}
      columnWrapperStyle={columns > 1 ? { gap: GAP } : undefined}
      renderItem={({ item }) => <Tile item={item} width={tileWidth} />}
      refreshControl={
        <RefreshControl
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => void list.refetch()}
          tintColor={theme.color.muted}
        />
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
      }}
      ListHeaderComponent={
        <View>
        <View style={{ flexDirection: 'row', gap: theme.space(2), marginBottom: theme.space(2) }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => setQuery(search.trim())}
            returnKeyType="search"
            placeholder="Search your library"
            placeholderTextColor={theme.color.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              flex: 1,
              backgroundColor: theme.color.surface,
              borderColor: theme.color.border,
              borderWidth: 1,
              borderRadius: theme.radius.full,
              color: theme.color.text,
              fontSize: 15,
              paddingHorizontal: theme.space(4),
              paddingVertical: theme.space(2.5),
            }}
          />
          <Pressable
            accessibilityLabel={likedOnly ? 'Show all media' : 'Show only liked media'}
            accessibilityRole="button"
            onPress={() => setLikedOnly((v) => !v)}
            style={({ pressed }) => ({
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              borderRadius: theme.radius.full,
              borderWidth: 1,
              borderColor: likedOnly ? theme.color.primary : theme.color.border,
              backgroundColor: likedOnly ? theme.color.primaryTint : theme.color.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={likedOnly ? 'heart' : 'heart-outline'}
              size={18}
              color={likedOnly ? theme.color.primary : theme.color.muted}
            />
          </Pressable>
        </View>
        <CategoryChips
          trail={trail}
          options={categories.data?.data ?? []}
          onEnter={(node) => setTrail((t) => [...t, { id: node.id, name: node.name }])}
          onExitTo={(depth) => setTrail((t) => t.slice(0, depth))}
        />
        </View>
      }
      ListFooterComponent={
        list.isFetchingNextPage ? (
          <View style={{ paddingVertical: theme.space(6) }}>
            <ActivityIndicator color={theme.color.muted} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={{ paddingTop: theme.space(20), alignItems: 'center', gap: theme.space(2) }}>
          <Text style={{ color: theme.color.text, fontSize: 16, fontWeight: '700' }}>Nothing here</Text>
          <Text style={{ color: theme.color.muted, fontSize: 14, textAlign: 'center' }}>
            {likedOnly
              ? 'Nothing liked yet. Tap the heart on anything you want to find again.'
              : query
              ? `No results for "${query}".`
              : currentCategory
                ? 'This folder has no media directly in it. Try a sub-folder above.'
                : 'Your library is empty, or the server is still scanning.'}
          </Text>
        </View>
      }
    />
  )
}
