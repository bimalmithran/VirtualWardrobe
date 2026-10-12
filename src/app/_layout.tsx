import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { syncCloset } from '../api/sync';
import { modelManager } from '../ml/modelManager';
import { DB_NAME, migrate } from '../storage/closet';
import { ProfileProvider } from '../storage/profile';
import { colors } from '../theme';

export default function RootLayout() {
  useEffect(() => {
    // Model sessions hold a few hundred MB of native memory. Hand it back when the
    // user leaves the app so Android doesn't pick us as the process to kill.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') modelManager.releaseAll().catch(() => {});
    });
    const memory = AppState.addEventListener('memoryWarning', () => {
      modelManager.releaseAll().catch(() => {});
    });
    return () => {
      sub.remove();
      memory.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
        <ProfileProvider>
          <CloudSync />
          <StatusBar style="dark" />
          <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ title: 'Your Digital Twin', headerBackVisible: false, gestureEnabled: false }} />
            <Stack.Screen name="garment/[id]" options={{ title: 'Garment' }} />
          </Stack>
        </ProfileProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

/** Retries pending uploads at launch and whenever the app returns to the foreground. */
function CloudSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    syncCloset(db).catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncCloset(db).catch(() => {});
    });
    return () => sub.remove();
  }, [db]);
  return null;
}
