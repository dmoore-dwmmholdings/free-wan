import { Tabs } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useBrandingVersion } from '@/lib/branding'
import { theme } from '@/theme'

export default function TabsLayout() {
  // React Navigation keeps these options from when the navigator mounted, and a state change
  // in the root layout does not reach it — so without this the bar keeps whatever palette was
  // in force when the tabs first appeared, which after a first sign-in is the built-in one.
  // The tabs are named explicitly because React Navigation otherwise builds the name from
  // what is inside them, and the first thing inside each is an icon — a `Text` holding a
  // character from a private-use area, which has no pronunciation for a screen reader to
  // find. Every other control in this app that pairs an icon with a word is named for the
  // same reason.
  useBrandingVersion()

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.bg },
        headerTintColor: theme.color.text,
        headerTitleStyle: { fontWeight: '800', letterSpacing: -0.3 },
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
        },
        // `primaryStrong`, not `primary`. React Navigation paints the icon and the label with
        // this one colour, and the label is 11px — normal text by WCAG's reckoning, holding to
        // 4.5:1. The raw primary reaches 3.55:1 against the bar on the default preset, which is
        // fine for the icon and not for the word under it. Measured in a browser: the active
        // label was 3.55:1 where every inactive one was 6.51:1.
        tabBarActiveTintColor: theme.color.primaryStrong,
        tabBarInactiveTintColor: theme.color.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Browse',
          tabBarAccessibilityLabel: 'Browse',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="collections"
        options={{
          title: 'Collections',
          tabBarAccessibilityLabel: 'Collections',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="clips"
        options={{
          title: 'Clips',
          tabBarAccessibilityLabel: 'Clips',
          tabBarIcon: ({ color, size }) => <Ionicons name="cut-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Downloads',
          tabBarAccessibilityLabel: 'Downloads',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="arrow-down-circle-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarAccessibilityLabel: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
