import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import type { CollectionDto } from '@free-wan/shared'
import { AuthImage } from '@/components/AuthImage'
import { useCollections } from '@/lib/collections'
import { theme } from '@/theme'

function Row({ item }: { item: CollectionDto }) {
  return (
    <Link href={`/collection/${item.id}`} asChild>
      <Pressable
        style={({ pressed }) => ({
          flexDirection: 'row',
          gap: theme.space(3),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 108,
            aspectRatio: 16 / 10,
            borderRadius: theme.radius.sm,
            overflow: 'hidden',
            backgroundColor: theme.color.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.coverUrl ? (
            <AuthImage path={item.coverUrl} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Ionicons name="albums-outline" size={22} color={theme.color.muted} />
          )}
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.space(1) }}>
          <Text numberOfLines={2} style={{ color: theme.color.text, fontSize: 15, fontWeight: '600' }}>
            {item.name}
          </Text>
          <Text style={{ color: theme.color.muted, fontSize: 12 }}>
            {item.itemCount} item{item.itemCount === 1 ? '' : 's'}
          </Text>
          {item.description ? (
            <Text numberOfLines={1} style={{ color: theme.color.muted, fontSize: 12 }}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  )
}

export default function CollectionsScreen() {
  const { data, isLoading, isRefetching, refetch } = useCollections()
  const items = data?.data ?? []

  if (isLoading) {
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
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: theme.space(3), gap: theme.space(4) }}
      renderItem={({ item }) => <Row item={item} />}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      ListEmptyComponent={
        <View style={{ paddingTop: theme.space(24), alignItems: 'center', gap: theme.space(2), paddingHorizontal: theme.space(8) }}>
          <Ionicons name="albums-outline" size={40} color={theme.color.muted} />
          <Text style={{ color: theme.color.text, fontSize: 16, fontWeight: '700', marginTop: theme.space(2) }}>
            No collections
          </Text>
          <Text style={{ color: theme.color.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Collections you create on the web app show up here.
          </Text>
        </View>
      }
    />
  )
}
