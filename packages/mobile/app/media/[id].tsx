import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useEventListener } from 'expo'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { VideoView, useVideoPlayer } from 'expo-video'
import { AuthImage } from '@/components/AuthImage'
import { ErrorState } from '@/components/ErrorState'
import { apiUrl, authHeaders } from '@/lib/api'
import { formatDuration, useMediaDetail, usePlayback } from '@/lib/media'
import { cancelDownload, formatBytes, startDownload, useDownloadState } from '@/lib/downloads'
import { TagList } from '@/components/TagChips'
import { CaptionOverlay, CaptionPicker } from '@/components/Captions'
import { useProgressReporter } from '@/lib/progress'
import { useToggleLike } from '@/lib/social'
import { theme } from '@/theme'

/** How often the player reports its position for caption timing. Fine enough that a cue
 * appears on the right word, coarse enough not to re-render the screen continuously. */
const CAPTION_TICK_S = 0.25

/** Resolved video source: a local file when downloaded, otherwise the authenticated server URL. */
function useVideoSource(
  id: string,
  isVideo: boolean,
  downloadedUri: string | null,
  serverPath: string | undefined,
) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Photos are drawn with an Image, never handed to the player. Without this a downloaded
    // photo would give the video player a JPEG to open.
    if (!isVideo) {
      setSource(null)
      return
    }
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
  }, [id, isVideo, downloadedUri, serverPath])

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

  if (state.status === 'failed') {
    return (
      <Pressable
        onPress={() => void startDownload({ id, title, type, durationSec })}
        accessibilityRole="button"
        style={({ pressed }) => ({
          gap: theme.space(1),
          borderColor: 'rgba(248,113,113,0.4)',
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space(3),
          paddingHorizontal: theme.space(4),
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Text style={{ color: theme.color.danger, fontWeight: '700', fontSize: 14 }}>
          Download failed — tap to try again
        </Text>
        <Text numberOfLines={2} style={{ color: theme.color.muted, fontSize: 12 }}>
          {state.message}
        </Text>
      </Pressable>
    )
  }

  if (state.status === 'downloading') {
    const pct = Math.round(state.progress * 100)
    return (
      <View style={{ gap: theme.space(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3) }}>
          <Text style={{ flex: 1, color: theme.color.muted, fontSize: 13, fontWeight: '600' }}>
            Downloading… {pct}%
          </Text>
          <Pressable
            onPress={() => void cancelDownload(id)}
            accessibilityRole="button"
            accessibilityLabel="Stop downloading"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ color: theme.color.muted, fontSize: 13, fontWeight: '700' }}>Stop</Text>
          </Pressable>
        </View>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.color.surface2, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: theme.color.primary }} />
        </View>
      </View>
    )
  }

  return (
    <Pressable
      onPress={() => void startDownload({ id, title, type, durationSec })}
      accessibilityRole="button"
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

function LikeButton({ id, liked, likeCount }: { id: string; liked: boolean; likeCount: number }) {
  const toggle = useToggleLike(id)
  return (
    <Pressable
      onPress={() => toggle.mutate(liked)}
      accessibilityRole="button"
      accessibilityState={{ selected: liked }}
      // Without this a screen reader announces a heart glyph and a bare number.
      accessibilityLabel={liked ? 'Remove from liked' : 'Add to liked'}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space(2),
        borderColor: theme.color.border,
        borderWidth: 1,
        borderRadius: theme.radius.sm,
        paddingVertical: theme.space(3),
        paddingHorizontal: theme.space(4),
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons
        name={liked ? 'heart' : 'heart-outline'}
        size={18}
        color={liked ? theme.color.primary : theme.color.muted}
      />
      {likeCount > 0 ? (
        <Text style={{ color: theme.color.muted, fontSize: 14, fontWeight: '600' }}>{likeCount}</Text>
      ) : null}
    </Pressable>
  )
}

export default function MediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const detail = useMediaDetail(id)
  const download = useDownloadState(id)
  // Offline the detail fetch fails, so fall back to what was captured at download time.
  const offlineRecord = download.status === 'done' ? download.record : null
  const downloadedUri = offlineRecord?.localUri ?? null

  const isVideo = (detail.data?.type ?? offlineRecord?.type) === 'video'
  // With a local copy there is nothing to ask the server for, so skip the playback call —
  // that is what makes the screen work with no connection.
  const playback = usePlayback(id, isVideo && !downloadedUri)
  const source = useVideoSource(id, isVideo, downloadedUri, playback.data?.url)

  const player = useVideoPlayer(source ?? null, (p) => {
    p.showNowPlayingNotification = true
    p.staysActiveInBackground = true
  })

  useProgressReporter(id, player, detail.data?.durationS ?? null)

  // expo-video cannot attach an external subtitle file (VideoSource has no field for one)
  // and this server keeps captions as separate WebVTT, so they are drawn over the video
  // here. That needs a much finer time signal than the 10s progress reporter uses.
  const tracks = playback.data?.captions ?? []
  const [captionTrackId, setCaptionTrackId] = useState<string | null>(null)
  const [captionPickerOpen, setCaptionPickerOpen] = useState(false)
  const [playheadS, setPlayheadS] = useState(0)

  // Only while a track is showing. The interval defaults to 0, meaning no event at all, and
  // leaving it on for every video would re-render this whole screen — player, poster, tags,
  // buttons — four times a second for the sake of subtitles nobody asked for.
  const captionsOn = captionTrackId !== null
  useEffect(() => {
    if (player) player.timeUpdateEventInterval = captionsOn ? CAPTION_TICK_S : 0
  }, [player, captionsOn])

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (captionsOn) setPlayheadS(currentTime)
  })


  // Resuming has the same hazard as a clip's in-point: a seek issued before the source has
  // loaded can be discarded, so repeat it once the player reports itself ready. The ref stops
  // a later re-buffer from dragging the viewer back to where they resumed from.
  const resumeAt = playback.data?.resumeAt
  const resumed = useRef(false)
  useEffect(() => {
    if (player && resumeAt && !downloadedUri) player.currentTime = resumeAt
  }, [player, resumeAt, downloadedUri])

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'readyToPlay' || resumed.current || !resumeAt || downloadedUri) return
    resumed.current = true
    player.currentTime = resumeAt
  })

  const title = detail.data?.title ?? offlineRecord?.title ?? 'Untitled'
  // A portrait photo in a 16:9 letterbox wastes most of the screen.
  const mediaAspect =
    !isVideo && detail.data?.width && detail.data?.height
      ? detail.data.width / detail.data.height
      : 16 / 9
  const duration = useMemo(
    () => formatDuration(detail.data?.durationS ?? offlineRecord?.durationSec ?? null),
    [detail.data?.durationS, offlineRecord],
  )

  if (detail.isLoading && !offlineRecord) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.color.primary} />
      </View>
    )
  }

  // Nothing to show and nothing still in flight: the fetch failed, or never got to run.
  // Testing `data` rather than `isError` covers both — a query that is pending but not
  // fetching reports neither loading nor error, and would otherwise render an empty shell.
  // A downloaded item still plays with the server unreachable, so it takes precedence.
  if (!detail.data && !offlineRecord && !detail.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
        <ErrorState onRetry={() => void detail.refetch()} />
      </View>
    )
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.bg }}
      contentContainerStyle={{ paddingBottom: insets.bottom + theme.space(10) }}
    >
      <View style={{ width: '100%', aspectRatio: mediaAspect, backgroundColor: '#000' }}>
        {isVideo ? (
          source ? (
            <>
              <VideoView
                player={player}
                style={{ width: '100%', height: '100%' }}
                allowsFullscreen
                allowsPictureInPicture
                contentFit="contain"
              />
              <CaptionOverlay
                path={tracks.find((t) => t.id === captionTrackId)?.url ?? null}
                timeS={playheadS}
              />
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={theme.color.muted} />
            </View>
          )
        ) : (
          // Photos deserve the original file, not the grid thumbnail.
          <AuthImage
            path={`/api/media/${id}/raw`}
            localUri={downloadedUri}
            contentFit="contain"
            style={{ width: '100%', height: '100%' }}
          />
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

        <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: theme.space(3) }}>
          <View style={{ flex: 1 }}>
            <DownloadButton
              id={id}
              title={title}
              type={detail.data?.type ?? 'video'}
              durationSec={detail.data?.durationS ?? null}
            />
          </View>
          <CaptionPicker
            tracks={tracks}
            selectedId={captionTrackId}
            onSelect={setCaptionTrackId}
            open={captionPickerOpen}
            onOpenChange={setCaptionPickerOpen}
          />
          {detail.data ? (
            <LikeButton id={id} liked={detail.data.liked} likeCount={detail.data.likeCount} />
          ) : null}
        </View>

        {detail.data?.tags?.length ? <TagList tags={detail.data.tags} /> : null}

        {downloadedUri ? (
          <Text style={{ color: theme.color.muted, fontSize: 12, lineHeight: 18 }}>
            Playing the copy stored on this device. No connection to your server is needed.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  )
}
