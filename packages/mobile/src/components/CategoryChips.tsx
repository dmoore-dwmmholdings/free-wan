import { Pressable, ScrollView, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { CategoryNodeDto } from '@free-wan/shared'
import { theme } from '@/theme'

export interface Crumb {
  id: string
  name: string
}

function Chip({
  label,
  onPress,
  icon,
  muted,
}: {
  label: string
  onPress: () => void
  icon?: 'back'
  muted?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Same reason as the subtitle rows: without this the back chevron is read out as the
      // start of the folder's name.
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space(1.5),
        backgroundColor: muted ? 'transparent' : theme.color.surface,
        borderColor: muted ? theme.color.border : theme.color.border,
        borderWidth: 1,
        borderRadius: theme.radius.full,
        paddingVertical: theme.space(2),
        paddingHorizontal: theme.space(3.5),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon === 'back' ? <Ionicons name="chevron-back" size={14} color={theme.color.muted} /> : null}
      <Text style={{ color: muted ? theme.color.muted : theme.color.text, fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * Folder navigation for the library. Drilling in filters the grid to that category and swaps
 * the row for its children; the trail on the left walks back out. A phone has no room for the
 * web app's sidebar tree, and a horizontal row keeps the grid the focus.
 */
export function CategoryChips({
  trail,
  options,
  onEnter,
  onExitTo,
}: {
  trail: Crumb[]
  /** Sub-folders of the current level. Not named `children`: that is React's own prop. */
  options: CategoryNodeDto[]
  onEnter: (node: CategoryNodeDto) => void
  onExitTo: (depth: number) => void
}) {
  if (trail.length === 0 && options.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.space(2), paddingVertical: theme.space(1) }}
      style={{ marginBottom: theme.space(2) }}
    >
      {trail.length > 0 ? (
        <>
          <Chip label="All" icon="back" muted onPress={() => onExitTo(0)} />
          {trail.slice(0, -1).map((c, i) => (
            <Chip key={c.id} label={c.name} muted onPress={() => onExitTo(i + 1)} />
          ))}
          <View
            style={{
              justifyContent: 'center',
              paddingHorizontal: theme.space(1),
            }}
          >
            {/* `primaryStrong`, not `primary`: this is 13px bold, which WCAG counts as normal
                text and holds to 4.5:1, and the raw primary manages 3.87:1 on the default
                preset's background. */}
            <Text style={{ color: theme.color.primaryStrong, fontSize: 13, fontWeight: '700' }}>
              {trail[trail.length - 1]!.name}
            </Text>
          </View>
        </>
      ) : null}

      {options.map((c) => (
        <Chip
          key={c.id}
          label={c.itemCount > 0 ? `${c.name}  ${c.itemCount}` : c.name}
          onPress={() => onEnter(c)}
        />
      ))}
    </ScrollView>
  )
}
