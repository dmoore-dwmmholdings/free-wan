import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { theme } from '@/theme'

/**
 * Shown over the video frame when the player gives up on a source.
 *
 * Without it the failure is a black rectangle: `expo-video` reports the error and draws
 * nothing, so a rejected token, an HLS ladder that was never built, or a server that went away
 * mid-buffer all look identical to a video that is simply taking its time. This app already
 * refuses to let an empty state stand in for an unreachable server; a silent player is the
 * same lie told by a different screen.
 *
 * Its colours are fixed rather than themed, like the duration pill on a tile and for the same
 * reason: it sits on the black of the video frame, where `theme.color.text` is near-black
 * under any light preset.
 */
export function PlaybackError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space(2),
        paddingHorizontal: theme.space(6),
        backgroundColor: 'rgba(0,0,0,0.85)',
      }}
    >
      <Ionicons name="alert-circle-outline" size={28} color={theme.color.danger} />
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' }}>
        This video would not play
      </Text>
      <Text
        numberOfLines={3}
        style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, textAlign: 'center', lineHeight: 18 }}
      >
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => ({
          marginTop: theme.space(1),
          borderColor: 'rgba(255,255,255,0.4)',
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space(2),
          paddingHorizontal: theme.space(5),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  )
}
