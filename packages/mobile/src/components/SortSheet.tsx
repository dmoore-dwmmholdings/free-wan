import { Modal, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { SORT_CHOICES, type SortChoice } from '@/lib/media'
import { theme } from '@/theme'

/**
 * How the library is ordered. A button beside the search box, and a sheet of the orderings the
 * server offers.
 *
 * A sheet rather than another toggle in the filter row: seven choices are one too many to
 * spell out in icons, and the row already carries a search box and three of them. Modelled on
 * the subtitle picker, which is the same shape of question.
 */
export function SortSheet({
  choice,
  onChoose,
  open,
  onOpenChange,
}: {
  choice: SortChoice
  onChoose: (choice: SortChoice) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <>
      <Pressable
        onPress={() => onOpenChange(true)}
        accessibilityRole="button"
        // Says what it is and what it is currently set to: a screen reader user has no other
        // way to find out which of the seven is in force.
        accessibilityLabel={`Sort by, currently ${choice.label}`}
        style={({ pressed }) => ({
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          borderRadius: theme.radius.full,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="swap-vertical-outline" size={18} color={theme.color.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => onOpenChange(false)}>
        <Pressable
          onPress={() => onOpenChange(false)}
          // Not an accessibility element itself; one here would hide every row inside it.
          accessible={false}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
        >
          {/* Swallow taps on the sheet, or choosing an ordering would dismiss it. */}
          <Pressable
            onPress={() => {}}
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
              Sort by
            </Text>
            {SORT_CHOICES.map((option) => {
              const active = option.id === choice.id
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    onChoose(option)
                    onOpenChange(false)
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  // Named, or the icon in front of it becomes part of what is announced.
                  accessibilityLabel={option.label}
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
                    {option.label}
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
