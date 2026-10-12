import { ActivityIndicator, View, type ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useProfile } from '../../storage/profile';
import { colors, ui } from '../../theme';

const icon = (name: keyof typeof Ionicons.glyphMap) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };

export default function TabLayout() {
  const { profile, loaded } = useProfile();

  if (!loaded) {
    return (
      <View style={[ui.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!profile) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Closet', tabBarIcon: icon('grid-outline') }} />
      <Tabs.Screen name="add" options={{ title: 'Add', headerShown: false, tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="shop" options={{ title: 'Live Shop', headerShown: false, tabBarIcon: icon('scan-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Twin', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
