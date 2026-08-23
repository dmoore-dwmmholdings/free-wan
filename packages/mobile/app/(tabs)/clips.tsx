import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { Link } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { ClipDto } from '@free-wan/shared'
import { AuthImage } from '@/components/AuthImage'
import { ErrorState } from '@/components/ErrorState'
import { useClips } from '@/lib/clips'
import { formatDuration } from '@/lib/media'
import { theme } from '@/theme'

function Row({ item }: { item: ClipDto }) {
  const body = (
    <View style={{ flexDirection: 'row', gap: theme.space(3) }}>
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
        {item.posterUrl ? (
          <AuthImage path={item.posterUrl} style={{ width: '100%', height: '100%' }} />
        ) : (
          <Ionicons name="cut-outline" size={20} color={theme.color.muted} />
        )}
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.space(1) }}>
        <Text numberOfLines={2} style={{ color: theme.color.text, fontSize: 15, fontWeight: '600' }}>
          {item.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
          <Text style={{ color: theme.color.muted, fontSize: 12 }}>
            {formatDuration(item.durationS) ?? `${item.durationS.toFixed(1)}s`}
          </Text>
          {item.loop ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(1) }}>
              <Ionicons name="repeat" size={13} color={theme.color.muted} />
              <Text style={{ color: theme.color.muted, fontSize: 12 }}>Loops</Text>
            </View>
          ) : null}
        </View>
        {item.orphaned ? (
          <Text style={{ color: theme.color.danger, fontSize: 12 }}>Source video is gone</Text>
        ) : null}
      </View>
    </View>
  )

  // An orphaned clip has no source left to play, so it stays inert rather than opening a
  // player that can only fail.
  if (item.orphaned) return <View style={{ opacity: 0.6 }}>{body}</View>

  return (
    <Link href={`/clip/${item.id}`} asChild>
      <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable>
    </Link>
  )
}

export default function ClipsScreen() {
  const { data, isLoading, isError, isRefetching, refetch } = useClips()
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
        isError || !data ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : (
          <View style={{ paddingTop: theme.space(24), alignItems: 'center', gap: theme.space(2), paddingHorizontal: theme.space(8) }}>
            <Ionicons name="cut-outline" size={40} color={theme.color.muted} />
            <Text style={{ color: theme.color.text, fontSize: 16, fontWeight: '700', marginTop: theme.space(2) }}>
              No clips
            </Text>
            <Text style={{ color: theme.color.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
              Clips you cut on the web app show up here.
            </Text>
          </View>
        )
      }
    />
  )
}
