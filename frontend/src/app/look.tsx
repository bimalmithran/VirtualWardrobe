import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { Button } from '../components/Button';
import { OutfitCard } from '../components/OutfitCard';
import { useWardrobe } from '../features/outfits/useWardrobe';
import { useWearer } from '../features/self/SelfContext';
import { useServices } from '../services/ServicesProvider';
import { CompleteTheLook } from '../features/commerce/CompleteTheLook';
import { lookGaps } from '../style/gaps';
import { currentWeather } from '../style/outfitGenerator';
import { scoreOutfit } from '../style/outfitSuggestions';
import { ui } from '../theme';

/** One suggested look (from the stylist chat): view its pieces and score, save or wear it. */
export default function Look() {
  const { ids, title } = useLocalSearchParams<{ ids: string; title?: string }>();
  const { garments } = useWardrobe();
  const { outfits, closet, sync } = useServices();
  const wearer = useWearer();
  const [busy, setBusy] = useState<string | null>(null);
  const pieces = useMemo(() => {
    const byId = new Map((garments ?? []).map((g) => [g.id, g]));
    return (ids ?? '').split(',').map((id) => byId.get(id)).filter((g) => !!g);
  }, [garments, ids]);

  if (!garments) return <View style={ui.screen} />;
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: title || 'Look' }} />
      <OutfitCard
        garments={pieces}
        score={scoreOutfit(pieces, wearer)}
        onPressGarment={(g) => router.push({ pathname: '/garment/[id]', params: { id: g.id } })}
      />
      <CompleteTheLook needs={lookGaps(pieces, wearer, currentWeather())} />
      <Button
        title="Save outfit"
        busy={busy === 'save'}
        disabled={pieces.length === 0}
        onPress={() =>
          run('save', async () => {
            const o = await outfits.create({ name: title || 'Stylist look', itemIds: pieces.map((g) => g.id) });
            sync.syncAll().catch(() => {});
            router.replace({ pathname: '/outfit/[id]', params: { id: o.id } });
          })
        }
        style={styles.gap}
      />
      <Button
        title="Wear it today"
        variant="secondary"
        busy={busy === 'wear'}
        disabled={pieces.length === 0}
        onPress={() =>
          run('wear', async () => {
            await closet.markWorn(pieces.map((g) => g.id));
            Alert.alert('Logged', 'Enjoy your day!');
          })
        }
        style={styles.gap}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { padding: 16, paddingBottom: 40 }, gap: { marginTop: 10 } });
