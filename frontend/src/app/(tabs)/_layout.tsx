import { ActivityIndicator, View, type ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useProfile } from '../../features/profile/ProfileContext';
import { useI18n } from '../../i18n/I18nProvider';
import { colors, ui } from '../../theme';

const icon = (name: keyof typeof Ionicons.glyphMap) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };

export default function TabLayout() {
  const { profile, loaded } = useProfile();
  const { t } = useI18n();

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
      <Tabs.Screen name="index" options={{ title: t('tabs.closet'), tabBarIcon: icon('grid-outline') }} />
      <Tabs.Screen name="outfits" options={{ title: t('tabs.outfits'), tabBarIcon: icon('shirt-outline') }} />
      <Tabs.Screen name="add" options={{ title: t('tabs.add'), headerShown: false, tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="shop" options={{ title: t('tabs.shop'), headerShown: false, tabBarIcon: icon('scan-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.twin'), tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
