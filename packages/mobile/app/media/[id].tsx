import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, PixelRatio, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useEventListener } from 'expo'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { VideoView, useVideoPlayer } from 'expo-video'
import { AuthImage } from '@/components/AuthImage'
import { ErrorState } from '@/components/ErrorState'
import { apiUrl, authHeaders } from '@/lib/api'
import { displayWidthFor, formatDuration, useMediaDetail, usePlayback } from '@/lib/media'
import { cancelDownload, formatBytes, startDownload, useDownloadState } from '@/lib/downloads'
import { TagList } from '@/components/TagChips'
import { CaptionOverlay, CaptionPicker } from '@/components/Captions'
import { PlaybackError } from '@/components/PlaybackError'
import { resumeSeek, useProgressReporter } from '@/lib/progress'
import { useToggleLike } from '@/lib/social'
import { theme } from '@/theme'

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
        {/* The tick carries the accent; the words do not. An icon is a graphical object and
            holds to 3:1, which every preset's accent clears — but this is 14px text, which
            holds to 4.5:1, and `linen` puts its accent at 3.44:1 against the background. The
            web app has no accent-strong token to borrow, and inventing one here would split
            the two token sets apart for a single label. */}
        <Ionicons name="checkmark-circle" size={18} color={theme.color.accent} />
        <Text style={{ color: theme.color.text, fontSize: 14, fontWeight: '600' }}>
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
      // Named rather than left to its children: the first of those is an icon, and an icon is
      // a `Text` holding a private-use character that reads as nothing.
      accessibilityLabel="Download"
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
  const { width: screenWidth } = useWindowDimensions()
  const detail = useMediaDetail(id)
  const download = useDownloadState(id)
  // Offline the detail fetch fails, so fall back to what was captured at download time.
  const offlineRecord = download.status === 'done' ? download.record : null
  const downloadedUri = offlineRecord?.localUri ?? null

  const isVideo = (detail.data?.type ?? offlineRecord?.type) === 'video'
  // Asked for even when there is a local copy, whose URL this does not need. It is also where
  // the resume position and the subtitle tracks come from, and a downloaded video deserves
  // both — it is the same video, and this app has been reporting its position to the server
  // all along, so the web app would resume it while this one started it over. The call fails
  // with no connection and nothing on the screen depends on it, which is what keeps a
  // downloaded item playable offline.
  const playback = usePlayback(id, isVideo)
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


  // Where playback starts. `resumeSeek` holds the rules and why each one is there; all this
  // does is feed it and record that the decision has been made.
  const [ready, setReady] = useState(false)
  // `error` is the player's own message and is the only clue about why a source was refused,
  // so it is shown rather than replaced with something friendlier and useless.
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status === 'readyToPlay') {
      setReady(true)
      setPlaybackError(null)
    } else if (status === 'error') {
      setPlaybackError(error?.message ?? 'The player did not say why.')
    }
  })

  const resumed = useRef(false)
  // Where a retry after a playback error should pick up. A reloaded source starts at the top,
  // and the position the server knows is by then both stale and beside the point — what
  // matters is where the viewer was when it broke.
  const [retryFrom, setRetryFrom] = useState<number | null>(null)
  const resumeAt = playback.data?.resumeAt ?? null
  useEffect(() => {
    if (!player) return
    let playedTo = 0
    try {
      playedTo = player.currentTime
    } catch {
      // Released mid-decision; nothing has been watched that could be interrupted.
    }
    const seek = resumeSeek({
      ready,
      pending: playback.isPending,
      resumed: resumed.current,
      resumeAt: retryFrom ?? resumeAt,
      playedTo,
    })
    if (!seek) return
    resumed.current = true
    if (seek.seekTo) player.currentTime = seek.seekTo
  }, [player, ready, playback.isPending, resumeAt, retryFrom])

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
  const photoWidth = displayWidthFor({
    screenWidth,
    pixelRatio: PixelRatio.get(),
    sourceWidth: detail.data?.width ?? null,
  })

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
                player={player}
              />
              {playbackError ? (
                <PlaybackError
                  message={playbackError}
                  onRetry={() => {
                    let at = 0
                    try {
                      at = player.currentTime
                    } catch {
                      // Player already released; start from the top.
                    }
                    setPlaybackError(null)
                    // A fresh attempt, so the once-only resume is allowed to run again — this
                    // time towards where the viewer actually was.
                    setRetryFrom(at > 0 ? at : null)
                    resumed.current = false
                    setReady(false)
                    void player.replaceAsync(source).catch(() => {
                      // Whatever went wrong comes back as another status change, which puts
                      // this overlay back with the player's own account of it.
                    })
                  }}
                />
              ) : null}
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={theme.color.muted} />
            </View>
          )
        ) : (
          // Photos deserve better than the grid thumbnail, but not the whole original: see
          // `displayWidthFor` for what is asked for instead, and why it sometimes is the
          // original after all. A downloaded copy is used as-is and asks for nothing.
          <AuthImage
            path={`/api/media/${id}/raw${photoWidth ? `?w=${photoWidth}` : ''}`}
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
