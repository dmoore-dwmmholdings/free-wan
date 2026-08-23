import { Modal, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { CaptionTrack } from '@free-wan/shared'
import { cueAt, useCaptionCues } from '@/lib/captions'
import { theme } from '@/theme'

/**
 * Subtitles drawn over the video.
 *
 * `expo-video` has no way to attach an external subtitle file — `VideoSource` carries no
 * field for one, and `availableSubtitleTracks` only sees tracks inside the media itself —
 * while this server keeps captions as separate WebVTT. Drawing them here also covers
 * direct-played files, which an HLS-manifest approach would miss entirely.
 */
export function CaptionOverlay({ path, timeS }: { path: string | null; timeS: number }) {
  const cues = useCaptionCues(path)
  const cue = cues.length > 0 ? cueAt(cues, timeS) : null
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
