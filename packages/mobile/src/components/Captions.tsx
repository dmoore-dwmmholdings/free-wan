import { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { useEventListener } from 'expo'
import type { VideoPlayer } from 'expo-video'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { CaptionTrack } from '@free-wan/shared'
import { cueAt, useCaptionCues, type Cue } from '@/lib/captions'
import { theme } from '@/theme'

/**
 * How often the player reports its position for caption timing. Fine enough that a cue appears
 * on the right word, coarse enough not to make work four times a second.
 */
const CAPTION_TICK_S = 0.25

/**
 * Subtitles drawn over the video.
 *
 * `expo-video` has no way to attach an external subtitle file — `VideoSource` carries no
 * field for one, and `availableSubtitleTracks` only sees tracks inside the media itself —
 * while this server keeps captions as separate WebVTT. Drawing them here also covers
 * direct-played files, which an HLS-manifest approach would miss entirely.
 *
 * Takes the player rather than a time, and keeps the cue rather than the clock. Both for the
 * same reason. The position used to be state on the media screen, so every tick re-rendered
 * that whole screen — the player, the poster, the tags, all four buttons and the scroll view
 * around them — four times a second for the length of a subtitled film, to change one line of
 * text inside an overlay. Holding the cue here means React sees the same value between one
 * subtitle and the next and does nothing at all: this re-renders once per line, and nothing
 * above it re-renders at any point.
 */
export function CaptionOverlay({ path, player }: { path: string | null; player: VideoPlayer }) {
  const cues = useCaptionCues(path)
  const [cue, setCue] = useState<Cue | null>(null)

  // The player reports its position only when asked to, and this is the only thing that needs
  // it finely. Asked for while a track is actually showing something, so a video with no
  // subtitles on costs nothing — and so does one whose track has not loaded or would not parse.
  const showing = path !== null && cues.length > 0
  useEffect(() => {
    player.timeUpdateEventInterval = showing ? CAPTION_TICK_S : 0
    if (!showing) setCue(null)
  }, [player, showing])

  // `cueAt` returns the cue out of the array rather than building one, so between two ticks
  // inside the same subtitle this hands React the value it already holds, and React stops
  // there. That identity is what makes this cheap; there is a test on it.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (showing) setCue(cueAt(cues, currentTime))
  })

  if (!cue) return null

  return (
    // Sits inside the video frame, clear of the player's own controls at the bottom edge.
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: theme.space(8),
        alignItems: 'center',
        paddingHorizontal: theme.space(4),
      }}
    >
      <Text
        style={{
          color: '#fff',
          fontSize: 15,
          fontWeight: '600',
          textAlign: 'center',
          lineHeight: 21,
          // A translucent plate rather than a text shadow: white text over a bright scene is
          // unreadable without something behind it.
          backgroundColor: 'rgba(0,0,0,0.72)',
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.space(2.5),
          paddingVertical: theme.space(1.5),
          overflow: 'hidden',
        }}
      >
        {cue.text}
      </Text>
    </View>
  )
}

/** Button plus sheet for choosing a subtitle track. Renders nothing when there are none. */
export function CaptionPicker({
  tracks,
  selectedId,
  onSelect,
  open,
  onOpenChange,
}: {
  tracks: CaptionTrack[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (tracks.length === 0) return null

  const on = selectedId !== null
  const choose = (id: string | null) => {
    onSelect(id)
    onOpenChange(false)
  }

  return (
    <>
      <Pressable
        onPress={() => {
          // With a single track the sheet would ask a one-option question, so just toggle it.
          if (tracks.length === 1) onSelect(on ? null : tracks[0]!.id)
          else onOpenChange(true)
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={on ? 'Subtitles on' : 'Subtitles off'}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space(2),
          borderColor: on ? theme.color.primary : theme.color.border,
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space(3),
          paddingHorizontal: theme.space(4),
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Ionicons
          name="chatbox-ellipses-outline"
          size={18}
          color={on ? theme.color.primary : theme.color.muted}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => onOpenChange(false)}
      >
        <Pressable
          onPress={() => onOpenChange(false)}
          // Not an accessibility element itself. `Pressable` sets `accessible` to true
          // unless told otherwise, and a container that is an element hides its children —
          // which would leave a screen reader with one unlabelled blob where the sheet is,
          // and no way to reach the options inside it. Tapping to dismiss still works.
          accessible={false}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
        >
          {/* Swallow taps on the sheet, or choosing a track would dismiss it. */}
          <Pressable
            onPress={() => {}}
            // Same reason as the backdrop: an element here would swallow the rows below it.
            accessible={false}
            style={{
              backgroundColor: theme.color.surface,
              borderTopLeftRadius: theme.radius.md,
              borderTopRightRadius: theme.radius.md,
              paddingVertical: theme.space(5),
              paddingHorizontal: theme.space(4),
              gap: theme.space(1),
            }}
          >
            <Text
              style={{
                color: theme.color.text,
                fontSize: 17,
                fontWeight: '800',
                marginBottom: theme.space(2),
              }}
            >
              Subtitles
            </Text>
            {[null, ...tracks.map((t) => t.id)].map((id) => {
              const track = tracks.find((t) => t.id === id)
              const label = track ? track.label : 'Off'
              const active = selectedId === id
              return (
                <Pressable
                  key={id ?? 'off'}
                  onPress={() => choose(id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  // Named explicitly, or the name is built from the children — and the first
                  // of those is an icon, which is a `Text` holding one character out of a
                  // private-use area. Nothing sensible is announced for it.
                  accessibilityLabel={label}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space(3),
                    paddingVertical: theme.space(3.5),
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={active ? theme.color.primary : theme.color.muted}
                  />
                  <Text
                    style={{
                      color: active ? theme.color.text : theme.color.muted,
                      fontSize: 15,
                      fontWeight: '600',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}
