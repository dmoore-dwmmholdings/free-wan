import { Pressable, ScrollView, Text, View } from 'react-native'
import type { Tag, TagWithCount } from '@free-wan/shared'
import { theme } from '@/theme'

function dotColor(tag: Tag): string {
  return tag.color ?? theme.color.primary
}

/**
 * Tag filter row. Selecting more than one narrows to items carrying *all* of them, matching
 * how the API combines the `tag` parameter.
 */
export function TagChips({
  tags,
  selected,
  onToggle,
}: {
  tags: TagWithCount[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  if (tags.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.space(2), paddingVertical: theme.space(1) }}
      style={{ marginBottom: theme.space(2) }}
    >
      {tags.map((tag) => {
        const on = selected.includes(tag.id)
        return (
          <Pressable
            key={tag.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${on ? 'Remove' : 'Add'} tag filter ${tag.name}`}
            onPress={() => onToggle(tag.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space(1.5),
              backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
              borderColor: on ? theme.color.primary : theme.color.border,
              borderWidth: 1,
              borderRadius: theme.radius.full,
              paddingVertical: theme.space(2),
              paddingHorizontal: theme.space(3.5),
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: dotColor(tag),
              }}
            />
            <Text
              style={{
                color: on ? theme.color.text : theme.color.muted,
                fontSize: 13,
                fontWeight: on ? '700' : '600',
              }}
            >
              {tag.name}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/** An item's own tags, shown on the detail screen. Not interactive. */
export function TagList({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) }}>
      {tags.map((tag) => (
        <View
          key={tag.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space(1.5),
            backgroundColor: theme.color.surface,
            borderColor: theme.color.border,
            borderWidth: 1,
            borderRadius: theme.radius.full,
            paddingVertical: theme.space(1.5),
            paddingHorizontal: theme.space(3),
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: dotColor(tag) }} />
          <Text style={{ color: theme.color.muted, fontSize: 12, fontWeight: '600' }}>{tag.name}</Text>
        </View>
      ))}
    </View>
  )
}
