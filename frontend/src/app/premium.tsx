import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { usePremium } from '../billing/PremiumContext';
import { PERKS } from '../billing/plans';
import type { Plan } from '../billing/premium';
import { Button } from '../components/Button';
import { errorMessage } from '../lib/errors';
import { useServices } from '../services/ServicesProvider';
import { colors, ui } from '../theme';

/** Free vs Premium, the store's plans, and restore / manage. */
export default function Premium() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { premium: service } = useServices();
  const { premium, expiresAt, storeAvailable } = usePremium();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!storeAvailable) return;
    service
      .plans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [service, storeAvailable]);

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      Alert.alert('Premium', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Text style={ui.h1}>{premium ? 'You have Premium' : 'VirtualWardrobe Premium'}</Text>
      {!!reason && !premium && <Text style={[ui.body, { color: colors.warn }]}>{reason}</Text>}
      {premium && expiresAt && <Text style={ui.muted}>Renews or ends on {new Date(expiresAt).toLocaleDateString()}.</Text>}

      <View style={[ui.card, styles.table]}>
        <View style={styles.row}>
          <Text style={[styles.cell, styles.first, ui.muted]} />
          <Text style={[styles.cell, styles.head]}>Free</Text>
          <Text style={[styles.cell, styles.head, { color: colors.accent }]}>Premium</Text>
        </View>
        {PERKS.map((p) => (
          <View key={p.title} style={styles.row}>
            <Text style={[styles.cell, styles.first, ui.body]}>{p.title}</Text>
            <Text style={[styles.cell, ui.muted]}>{p.free}</Text>
            <Text style={[styles.cell, ui.body]}>{p.premium}</Text>
          </View>
        ))}
      </View>

      {!premium &&
        (!storeAvailable ? (
          <Text style={ui.muted}>
            {Platform.OS === 'web'
              ? 'Subscribe from the Android or iOS app; Premium then works here too.'
              : 'Purchases are not configured in this build.'}
          </Text>
        ) : plans === null ? (
          <Text style={ui.muted}>Loading plans…</Text>
        ) : plans.length === 0 ? (
          <Text style={ui.muted}>No plans are available right now. Please try again later.</Text>
        ) : (
          plans.map((plan) => (
            <Button
              key={plan.id}
              title={`${plan.price}${plan.period ? ` / ${plan.period}` : ''}`}
              busy={busy === plan.id}
              onPress={() =>
                run(plan.id, async () => {
                  if (await service.purchase(plan)) {
                    Alert.alert('Welcome to Premium', 'Thank you! All perks are unlocked.');
                    router.back();
                  }
                })
              }
              style={styles.gap}
            />
          ))
        ))}

      <Button
        title="Restore purchases"
        variant="secondary"
        busy={busy === 'restore'}
        onPress={() =>
          run('restore', async () => {
            const ok = await service.restore();
            Alert.alert('Premium', ok ? 'Your Premium subscription is active.' : 'No active subscription was found for this account.');
          })
        }
        style={styles.gap}
      />
      {premium && storeAvailable && (
        <Button title="Manage subscription" variant="secondary" onPress={() => run('manage', () => service.manage())} style={styles.gap} />
      )}
      <Text style={[ui.muted, styles.gap]}>
        Subscriptions renew automatically until cancelled. Cancel any time in{' '}
        {Platform.OS === 'ios' ? 'your App Store settings' : 'Google Play'} at least 24 hours before the renewal date.
        {Platform.OS === 'android' && (
          <Text style={styles.link} onPress={() => Linking.openURL('https://play.google.com/store/account/subscriptions')}>
            {' '}
            Open Google Play subscriptions
          </Text>
        )}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  table: { gap: 10, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, textAlign: 'center' },
  first: { flex: 1.6, textAlign: 'left' },
  head: { fontWeight: '700', color: colors.text },
  gap: { marginTop: 8 },
  link: { color: colors.accent, fontWeight: '600' },
});
