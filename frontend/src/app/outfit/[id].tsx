import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { Button } from '../../components/Button';
import { OutfitCard } from '../../components/OutfitCard';
import { SimilarGrid } from '../../components/SimilarGrid';
import { piecesOf, useWardrobe } from '../../features/outfits/useWardrobe';
import { useWearer } from '../../features/self/SelfContext';
import { relativeDay } from '../../lib/dates';
import { useServices } from '../../services/ServicesProvider';
import { scoreOutfit } from '../../style/outfitSuggestions';
import { ui } from '../../theme';

export default function OutfitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { closet, outfits: repo, sync } = useServices();
  const wearer = useWearer();
  const { garments, outfits, reload } = useWardrobe();

  if (!garments) return <View style={ui.screen} />;
  const outfit = outfits.find((o) => o.id === id);
  if (!outfit) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.muted}>This outfit no longer exists.</Text>
      </View>
    );
  }

  const pieces = piecesOf(outfit, garments);

  const wear = async () => {
    await Promise.all([repo.markWorn(outfit.id), closet.markWorn(pieces.map((g) => g.id))]);
    reload();
  };

  const remove = () =>
    Alert.alert('Delete outfit?', 'The garments stay in your closet.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await repo.remove(outfit.id);
          sync.syncAll().catch(() => {});
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: outfit.name }} />
      <OutfitCard garments={pieces} score={scoreOutfit(pieces, wearer)} />
      <Text style={[ui.muted, styles.gap]}>
        {outfit.lastWornAt ? `Last worn ${relativeDay(outfit.lastWornAt)}` : 'Not worn yet'}
        {' · '}
        {outfit.syncedAt ? 'synced' : sync.enabled ? 'waiting to sync' : 'on-device only'}
      </Text>
      <Button title="Wear today" onPress={wear} style={styles.gap} />

      <Text style={[ui.h2, styles.section]}>Pieces</Text>
      <SimilarGrid
        items={pieces.map((g) => ({
          key: g.id,
          imageUri: g.imageUri,
          caption: g.wearCount === 1 ? 'worn once' : `worn ${g.wearCount}×`,
          onPress: () => router.push({ pathname: '/garment/[id]', params: { id: g.id } }),
        }))}
      />

      <Button title="Delete outfit" variant="secondary" onPress={remove} style={styles.section} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  gap: { marginTop: 12 },
  section: { marginTop: 24, marginBottom: 8 },
});
