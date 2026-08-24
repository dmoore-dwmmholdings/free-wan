import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { Link } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AuthImage } from '@/components/AuthImage'
import {
  cancelDownload,
  formatBytes,
  removeDownload,
  startDownload,
  useDownloads,
  type ActiveDownload,
  type DownloadRecord,
  type FailedDownload,
} from '@/lib/downloads'
import { formatDuration } from '@/lib/media'
import { theme } from '@/theme'

function Row({ item }: { item: DownloadRecord }) {
  const duration = formatDuration(item.durationSec)
  const confirmRemove = () => {
    Alert.alert('Remove download?', `"${item.title}" will be deleted from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeDownload(item.id) },
    ])
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3) }}>
      <Link href={`/media/${item.id}`} asChild>
        <Pressable style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: theme.space(3), opacity: pressed ? 0.7 : 1 })}>
          <AuthImage
            localUri={item.posterUri}
            style={{ width: 108, aspectRatio: 16 / 10, borderRadius: theme.radius.sm, backgroundColor: theme.color.surface2 }}
          />
          <View style={{ flex: 1, justifyContent: 'center', gap: theme.space(1) }}>
            <Text numberOfLines={2} style={{ color: theme.color.text, fontSize: 14, fontWeight: '600' }}>
              {item.title}
            </Text>
            <Text style={{ color: theme.color.muted, fontSize: 12 }}>
              {[duration, formatBytes(item.bytes)].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
        </Pressable>
      </Link>
      <Pressable
        onPress={confirmRemove}
        hitSlop={10}
        accessibilityRole="button"
        // Icon-only, and it deletes something. Naming the item matters more here than
        // anywhere else in the app.
        accessibilityLabel={`Remove download ${item.title}`}
        style={({ pressed }) => ({ padding: theme.space(2), opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="trash-outline" size={20} color={theme.color.muted} />
      </Pressable>
    </View>
  )
}

/** A transfer still running. No poster yet, so the tile shows progress instead. */
function ActiveRow({ item }: { item: ActiveDownload }) {
  const pct = Math.round(item.progress * 100)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3) }}>
      <View
        style={{
          width: 108,
          aspectRatio: 16 / 10,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.color.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="arrow-down-circle-outline" size={20} color={theme.color.primary} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.space(2) }}>
        <Text numberOfLines={2} style={{ color: theme.color.text, fontSize: 14, fontWeight: '600' }}>
          {item.title}
        </Text>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.color.surface2, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: theme.color.primary }} />
        </View>
        <Text style={{ color: theme.color.muted, fontSize: 12 }}>
          {pct > 0 ? `Downloading… ${pct}%` : 'Starting…'}
        </Text>
      </View>
      <Pressable
        onPress={() => void cancelDownload(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Stop downloading ${item.title}`}
        // Generous padding: this is a small target next to a progress bar, and hitting it by
        // accident is cheap to undo while missing it on a metered connection is not.
        hitSlop={12}
        style={({ pressed }) => ({ padding: theme.space(2), opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="close" size={20} color={theme.color.muted} />
      </Pressable>
    </View>
  )
}

/**
 * A transfer that stopped short. Tapping starts it again; the cross gives up on it.
 *
 * Both are needed. Failures are listed above everything else because they need a decision, and
 * for a while the only decision on offer was to retry — so a download that cannot ever succeed,
 * because the media is no longer in the library or that server is gone for good, held the top
 * of this tab in front of the downloads that do work.
 */
function FailedRow({ item }: { item: FailedDownload }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3) }}>
      <Pressable
        onPress={() =>
          void startDownload({
            id: item.id,
            title: item.title,
            type: item.type,
            durationSec: item.durationSec,
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`Retry download ${item.title}`}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space(3),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 108,
            aspectRatio: 16 / 10,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.color.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="alert-circle-outline" size={20} color={theme.color.danger} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.space(1) }}>
          <Text numberOfLines={2} style={{ color: theme.color.text, fontSize: 14, fontWeight: '600' }}>
            {item.title}
          </Text>
          <Text style={{ color: theme.color.danger, fontSize: 12 }}>Failed — tap to try again</Text>
          <Text numberOfLines={1} style={{ color: theme.color.muted, fontSize: 12 }}>
            {item.error}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => void removeDownload(item.id)}
        hitSlop={12}
        accessibilityRole="button"
        // No confirmation, unlike the trash on a finished download: nothing is deleted here.
        // The partial file is long gone, and the item is still in the library to download again.
        accessibilityLabel={`Dismiss failed download ${item.title}`}
        style={({ pressed }) => ({ padding: theme.space(2), opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="close" size={20} color={theme.color.muted} />
      </Pressable>
    </View>
  )
}

export default function DownloadsScreen() {
  const { items, active, failed } = useDownloads()
  const totalBytes = items.reduce((sum, i) => sum + i.bytes, 0)
  // In-flight transfers sit above finished ones so progress is the first thing seen.
  // Failures first: they need a decision. Then transfers in flight, then what is on disk.
  const rows: Array<FailedDownload | ActiveDownload | DownloadRecord> = [...failed, ...active, ...items]

  return (
    <FlatList
      style={{ backgroundColor: theme.color.bg }}
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: theme.space(3), gap: theme.space(4) }}
      renderItem={({ item }) =>
        'localUri' in item ? (
          <Row item={item} />
        ) : 'error' in item ? (
          <FailedRow item={item} />
        ) : (
          <ActiveRow item={item} />
        )
      }
      ListHeaderComponent={
        items.length > 0 ? (
          <Text style={{ color: theme.color.muted, fontSize: 12, letterSpacing: 1, fontWeight: '700' }}>
            {items.length} ITEM{items.length === 1 ? '' : 'S'}  ·  {formatBytes(totalBytes)}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        <View style={{ paddingTop: theme.space(24), alignItems: 'center', gap: theme.space(2), paddingHorizontal: theme.space(8) }}>
          <Ionicons name="arrow-down-circle-outline" size={40} color={theme.color.muted} />
          <Text style={{ color: theme.color.text, fontSize: 16, fontWeight: '700', marginTop: theme.space(2) }}>
            No downloads yet
          </Text>
          <Text style={{ color: theme.color.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Open anything in your library and tap Download to keep it on this device. Downloads play
            with no connection to the server.
          </Text>
        </View>
      }
    />
  )
}
