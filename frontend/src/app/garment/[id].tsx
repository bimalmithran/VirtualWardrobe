import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Button } from '../../components/Button';
import { MatchScoreCard } from '../../components/MatchScoreCard';
import { SimilarGrid } from '../../components/SimilarGrid';
import type { Garment } from '../../domain/types';
import { CloudSearchPanel } from '../../features/closet/CloudSearchPanel';
import { useProfile } from '../../features/profile/ProfileContext';
import { useServices } from '../../services/ServicesProvider';
import { ui } from '../../theme';
import { rankBySimilarity, type RankedGarment } from '../../vision/similarity';
import { scoreUndertoneMatch } from '../../vision/undertoneMatch';

const SIMILAR_COUNT = 6;

const openGarment = (id: string) => router.replace({ pathname: '/garment/[id]', params: { id } });

export default function GarmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { closet, similarity } = useServices();
  const { profile } = useProfile();
  const [garment, setGarment] = useState<Garment | null | undefined>(undefined);
  const [similar, setSimilar] = useState<RankedGarment[]>([]);

  useEffect(() => {
    closet.list().then((all) => {
      const current = all.find((g) => g.id === id) ?? null;
      setGarment(current);
      setSimilar(current ? rankBySimilarity(current, all, SIMILAR_COUNT) : []);
    });
  }, [closet, id]);

  if (garment === undefined) return <View style={ui.screen} />;
  if (garment === null) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.muted}>This garment is no longer in your closet on this phone.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <View style={[ui.checker, styles.hero]}>
        <Image source={{ uri: garment.imageUri }} style={styles.fill} resizeMode="contain" />
      </View>
      {profile && <MatchScoreCard hex={garment.colorHex} match={scoreUndertoneMatch(garment.colorHex, profile.undertone)} />}

      <Text style={[ui.h2, styles.section]}>Visually similar in your closet</Text>
      {similar.length === 0 ? (
        <Text style={ui.muted}>Add more garments to see style matches.</Text>
      ) : (
        <SimilarGrid
          items={similar.map(({ garment: g, score }) => ({ key: g.id, imageUri: g.imageUri, score, onPress: () => openGarment(g.id) }))}
        />
      )}

      {similarity && garment.embedding && (
        <CloudSearchPanel garment={{ ...garment, embedding: garment.embedding }} remote={similarity} onOpen={openGarment} />
      )}

      <Button
        title="Remove from closet"
        variant="secondary"
        style={styles.section}
        onPress={async () => {
          await closet.remove(garment);
          router.back();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  hero: { aspectRatio: 1, borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  fill: { width: '100%', height: '100%' },
  section: { marginTop: 20, marginBottom: 8 },
});
