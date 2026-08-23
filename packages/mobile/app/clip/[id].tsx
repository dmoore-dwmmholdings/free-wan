import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useEventListener } from 'expo'
import { VideoView, useVideoPlayer } from 'expo-video'
import { ErrorState } from '@/components/ErrorState'
import { apiUrl, authHeaders } from '@/lib/api'
import { clipCommandFor, useClip, useClipPreview } from '@/lib/clips'
import { formatDuration } from '@/lib/media'
import { theme } from '@/theme'

/** How often the player reports its position; the loop boundary is only as tight as this. */
const TIME_UPDATE_INTERVAL_S = 0.25

export default function ClipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const clip = useClip(id)
  const preview = useClipPreview(id)
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null)

  const sourceUrl = preview.data?.sourceUrl
  useEffect(() => {
    let cancelled = false
    if (!sourceUrl) return
    void (async () => {
      const [uri, headers] = await Promise.all([apiUrl(sourceUrl), authHeaders()])
      if (!cancelled) setSource({ uri, headers })
    })()
    return () => {
      cancelled = true
    }
  }, [sourceUrl])

  const player = useVideoPlayer(source ?? null, (p) => {
    p.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_S
    p.staysActiveInBackground = true
  })

  // A clip is a window onto a longer video, so start at the in-point rather than at zero.
  // Seek twice on purpose: once now, which is enough if the source is already buffered, and
  // again when the player reports itself ready, because a seek issued before the source has
  // loaded can be discarded. The ref keeps a later re-buffer from yanking playback back.
  const startS = preview.data?.startS
  const sought = useRef(false)
  useEffect(() => {
    if (player && startS !== undefined) player.currentTime = startS
  }, [player, startS])

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'readyToPlay' || sought.current || startS === undefined) return
    sought.current = true
    player.currentTime = startS
  })

  // The player has no notion of an out-point: hold the window here, looping or stopping at it.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!preview.data) return
    const command = clipCommandFor(currentTime, preview.data)
    if (!command) return
    if (command.pause) player.pause()
    player.currentTime = command.seekTo
  })

  const title = clip?.name ?? 'Clip'

  if (preview.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    )
  }

  if (!preview.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
        <Stack.Screen options={{ title }} />
        <ErrorState onRetry={() => void preview.refetch()} />
      </View>
    )
  }

  if (preview.data.orphaned || !preview.data.sourceUrl) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
        <Stack.Screen options={{ title }} />
        <ErrorState
          title="Source video is gone"
          hint="This clip points at media that is no longer in the library, so there is nothing to play."
        />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <Stack.Screen options={{ title }} />
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }}>
        {source ? (
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
        )}
      </View>

      <View style={{ padding: theme.space(4), gap: theme.space(2) }}>
        <Text style={{ color: theme.color.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
          {title}
        </Text>
        <Text style={{ color: theme.color.muted, fontSize: 13 }}>
          {[
            formatDuration(preview.data.endS - preview.data.startS),
            preview.data.loop ? 'Loops' : null,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
      </View>
    </View>
  )
}
