import { Pressable, Text, View } from 'react-native'
import { Link } from 'expo-router'
import type { MediaCard } from '@free-wan/shared'
import { AuthImage } from './AuthImage'
import { formatDuration } from '@/lib/media'
import { theme } from '@/theme'

/** One grid tile. Shared by Browse and a collection's contents. */
export function MediaTile({ item, width }: { item: MediaCard; width: number }) {
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

/** Column count and tile width for a grid at `screenWidth`, shared so grids stay consistent. */
export function gridMetrics(screenWidth: number, padding: number, gap: number) {
  const columns = Math.max(2, Math.floor(screenWidth / 220))
  const tileWidth = (screenWidth - padding * 2 - gap * (columns - 1)) / columns
  return { columns, tileWidth }
}
