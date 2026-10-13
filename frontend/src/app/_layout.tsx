import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProfileProvider } from '../features/profile/ProfileContext';
import { ServicesProvider, useServices } from '../services/ServicesProvider';
import { DB_NAME, migrate } from '../storage/database';
import { colors } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
        <ServicesProvider>
          <ProfileProvider>
            <ReleaseModelsInBackground />
            <SyncOnForeground />
            <StatusBar style="dark" />
            <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ title: 'Your Digital Twin', headerBackVisible: false, gestureEnabled: false }} />
              <Stack.Screen name="garment/[id]" options={{ title: 'Garment' }} />
              <Stack.Screen name="outfit/new" options={{ title: 'Build an outfit' }} />
              <Stack.Screen name="outfit/[id]" options={{ title: 'Outfit' }} />
            </Stack>
          </ProfileProvider>
        </ServicesProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

/**
 * Model sessions hold a few hundred MB of native memory. Hand it back when the user leaves
 * the app so Android doesn't pick us as the process to kill.
 */
function ReleaseModelsInBackground() {
  const { memory } = useServices().models;
  useEffect(() => {
    const release = () => memory.releaseAll().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => state === 'background' && release());
    const warning = AppState.addEventListener('memoryWarning', release);
    return () => {
      sub.remove();
      warning.remove();
    };
  }, [memory]);
  return null;
}

/** Retries pending uploads at launch and whenever the app returns to the foreground. */
function SyncOnForeground() {
  const { sync } = useServices();
  useEffect(() => {
    if (!sync.enabled) return;
    sync.syncAll().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => state === 'active' && sync.syncAll().catch(() => {}));
    return () => sub.remove();
  }, [sync]);
  return null;
}
