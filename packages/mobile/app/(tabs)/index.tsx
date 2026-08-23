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
import { CategoryChips, type Crumb } from '@/components/CategoryChips'
import { MediaTile, gridMetrics } from '@/components/MediaTile'
import { TagChips } from '@/components/TagChips'
import { useCategoryChildren } from '@/lib/categories'
import { useTags } from '@/lib/tags'
import { useMediaList } from '@/lib/media'
import { theme } from '@/theme'

const GAP = theme.space(2.5)
const PADDING = theme.space(3)

export default function BrowseScreen() {
  const { width: screenWidth } = useWindowDimensions()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [trail, setTrail] = useState<Crumb[]>([])
  const [likedOnly, setLikedOnly] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const currentCategory = trail.length > 0 ? trail[trail.length - 1]!.id : null

  const { columns, tileWidth } = gridMetrics(screenWidth, PADDING, GAP)

  const categories = useCategoryChildren(currentCategory)
  const tags = useTags()
  const list = useMediaList(
    useMemo(
      () => ({
        q: query || undefined,
        category: currentCategory,
        liked: likedOnly || undefined,
        tags: selectedTags,
      }),
      [query, currentCategory, likedOnly, selectedTags],
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
      renderItem={({ item }) => <MediaTile item={item} width={tileWidth} />}
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
        <TagChips
          tags={tags.data?.data ?? []}
          selected={selectedTags}
          onToggle={(id) =>
            setSelectedTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))
          }
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
            {selectedTags.length > 0
              ? 'Nothing carries all of the selected tags. Tap one to remove it.'
              : likedOnly
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
