import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { VideoView, useVideoPlayer } from 'expo-video'
import { AuthImage } from '@/components/AuthImage'
import { apiUrl, authHeaders } from '@/lib/api'
import { formatDuration, useMediaDetail, usePlayback } from '@/lib/media'
import { formatBytes, startDownload, useDownloadState } from '@/lib/downloads'
import { theme } from '@/theme'

/** Resolved video source: a local file when downloaded, otherwise the authenticated server URL. */
function useVideoSource(id: string, downloadedUri: string | null, serverPath: string | undefined) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null)

  useEffect(() => {
    let cancelled = false
    // A downloaded copy always wins — it plays with the server unreachable.
    if (downloadedUri) {
      setSource({ uri: downloadedUri })
      return
    }
    if (!serverPath) return
    void (async () => {
      const [uri, headers] = await Promise.all([apiUrl(serverPath), authHeaders()])
      if (!cancelled) setSource({ uri, headers })
    })()
    return () => {
      cancelled = true
    }
  }, [id, downloadedUri, serverPath])

  return source
}

function DownloadButton({
  id,
  title,
  type,
  durationSec,
}: {
  id: string
  title: string
  type: 'video' | 'image'
  durationSec: number | null
}) {
  const state = useDownloadState(id)

  if (state.status === 'done') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(2) }}>
        <Ionicons name="checkmark-circle" size={18} color={theme.color.accent} />
        <Text style={{ color: theme.color.accent, fontSize: 14, fontWeight: '600' }}>
          Available offline · {formatBytes(state.record.bytes)}
        </Text>
      </View>
    )
  }

  if (state.status === 'downloading') {
    const pct = Math.round(state.progress * 100)
    return (
      <View style={{ gap: theme.space(2) }}>
        <Text style={{ color: theme.color.muted, fontSize: 13, fontWeight: '600' }}>
          Downloading… {pct}%
        </Text>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.color.surface2, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: theme.color.primary }} />
        </View>
      </View>
    )
  }

  return (
    <Pressable
      onPress={() => void startDownload({ id, title, type, durationSec })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space(2),
        backgroundColor: theme.color.primaryTint,
        borderColor: theme.color.primary,
        borderWidth: 1,
        borderRadius: theme.radius.sm,
        paddingVertical: theme.space(3),
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name="arrow-down-circle-outline" size={18} color={theme.color.text} />
      <Text style={{ color: theme.color.text, fontWeight: '700', fontSize: 15 }}>Download</Text>
    </Pressable>
  )
}

export default function MediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const detail = useMediaDetail(id)
  const download = useDownloadState(id)
  const downloadedUri = download.status === 'done' ? download.record.localUri : null

  const isVideo = detail.data?.type === 'video'
  // With a local copy there is nothing to ask the server for, so skip the playback call —
  // that is what makes the screen work with no connection.
  const playback = usePlayback(id, isVideo && !downloadedUri)
  const source = useVideoSource(id, downloadedUri, playback.data?.url)

  const player = useVideoPlayer(source ?? null, (p) => {
    p.showNowPlayingNotification = true
    p.staysActiveInBackground = true
  })

  useEffect(() => {
    const resumeAt = playback.data?.resumeAt
    if (player && resumeAt && !downloadedUri) player.currentTime = resumeAt
  }, [player, playback.data?.resumeAt, downloadedUri])

  // Offline, the detail fetch fails — fall back to the title captured at download time.
  const offlineRecord = download.status === 'done' ? download.record : null
  const title = detail.data?.title ?? offlineRecord?.title ?? 'Untitled'
  const duration = useMemo(
    () => formatDuration(detail.data?.durationS ?? offlineRecord?.durationSec ?? null),
    [detail.data?.durationS, offlineRecord],
  )

  if (detail.isLoading && !downloadedUri) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    )
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.bg }}
      contentContainerStyle={{ paddingBottom: insets.bottom + theme.space(10) }}
    >
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}>
        {isVideo || downloadedUri ? (
          source ? (
            <VideoView
              player={player}
              style={{ width: '100%', height: '100%' }}
              allowsFullscreen
              allowsPictureInPicture
              contentFit="contain"
            />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={theme.color.muted} />
            </View>
          )
        ) : (
          <AuthImage path={detail.data?.posterUrl} style={{ width: '100%', height: '100%' }} />
        )}
      </View>

      <View style={{ padding: theme.space(4), gap: theme.space(4) }}>
        <View style={{ gap: theme.space(2) }}>
          <Text style={{ color: theme.color.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
            {title}
          </Text>
          {duration || detail.data?.categoryPath ? (
            <Text style={{ color: theme.color.muted, fontSize: 13 }}>
              {[duration, detail.data?.categoryPath].filter(Boolean).join('  ·  ')}
            </Text>
          ) : null}
        </View>

        <DownloadButton
          id={id}
          title={title}
          type={detail.data?.type ?? 'video'}
          durationSec={detail.data?.durationS ?? null}
        />

        {downloadedUri ? (
          <Text style={{ color: theme.color.muted, fontSize: 12, lineHeight: 18 }}>
            Playing the copy stored on this device. No connection to your server is needed.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  )
}
