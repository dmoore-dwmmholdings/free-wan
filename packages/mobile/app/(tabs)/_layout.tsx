import { Tabs } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useBrandingVersion } from '@/lib/branding'
import { theme } from '@/theme'

export default function TabsLayout() {
  // React Navigation keeps these options from when the navigator mounted, and a state change
  // in the root layout does not reach it — so without this the bar keeps whatever palette was
  // in force when the tabs first appeared, which after a first sign-in is the built-in one.
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
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Browse',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="collections"
        options={{
          title: 'Collections',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="clips"
        options={{
          title: 'Clips',
          tabBarIcon: ({ color, size }) => <Ionicons name="cut-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Downloads',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="arrow-down-circle-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
