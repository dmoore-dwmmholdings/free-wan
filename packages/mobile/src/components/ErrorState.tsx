import { Pressable, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '@/theme'

/**
 * Shown when a request fails. An empty state must never stand in for an unreachable server:
 * on a phone that drifts off the tailnet, "your library is empty" is a lie that sends people
 * looking for the wrong problem.
 */
export function ErrorState({
  onRetry,
  title = 'Cannot reach your server',
  hint,
}: {
  onRetry?: () => void
  title?: string
  hint?: string
}) {
  return (
    <View
      style={{
        paddingTop: theme.space(20),
        paddingHorizontal: theme.space(8),
        alignItems: 'center',
        gap: theme.space(2),
      }}
    >
      <Ionicons name="cloud-offline-outline" size={40} color={theme.color.muted} />
      <Text
        style={{
          color: theme.color.text,
          fontSize: 16,
          fontWeight: '700',
          marginTop: theme.space(2),
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text style={{ color: theme.color.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        {hint ?? 'Check that it is running and that this phone is on the same network or tailnet.'}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: theme.space(3),
            borderColor: theme.color.border,
            borderWidth: 1,
            borderRadius: theme.radius.sm,
            paddingVertical: theme.space(2.5),
            paddingHorizontal: theme.space(6),
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: theme.color.text, fontSize: 14, fontWeight: '700' }}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
