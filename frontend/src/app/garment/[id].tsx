import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { cloudEnabled, searchSimilar, type CloudMatch } from '../../api/client';
import { Button } from '../../components/Button';
import { MatchScoreCard } from '../../components/MatchScoreCard';
import { deleteGarment, listGarments, type Garment } from '../../storage/closet';
import { useProfile } from '../../storage/profile';
import { cosine } from '../../vision/embedding';
import { scoreUndertoneMatch } from '../../vision/undertoneMatch';
import { colors, ui } from '../../theme';

const SIMILAR_COUNT = 6;

export default function GarmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { profile } = useProfile();
  const [garment, setGarment] = useState<Garment | null>(null);
  const [similar, setSimilar] = useState<{ g: Garment; score: number }[]>([]);

  useEffect(() => {
    // Brute-force cosine search is instant for a personal closet (hundreds of 512-d vectors).
    listGarments(db).then((all) => {
      const current = all.find((g) => g.id === id) ?? null;
      setGarment(current);
      const query = current?.embedding;
      if (!query) return setSimilar([]);
      setSimilar(
        all
          .filter((g) => g.id !== id && g.embedding)
          .map((g) => ({ g, score: cosine(query, g.embedding!) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, SIMILAR_COUNT),
      );
    });
  }, [db, id]);

  if (!garment) return <View style={ui.screen} />;

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
        <View style={styles.row}>
          {similar.map(({ g, score }) => (
            <Pressable key={g.id} onPress={() => router.replace({ pathname: '/garment/[id]', params: { id: g.id } })} style={styles.similar}>
              <View style={[ui.checker, styles.thumb]}>
                <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
              </View>
              <Text style={ui.muted}>{(score * 100).toFixed(0)}% match</Text>
            </Pressable>
          ))}
        </View>
      )}

      {cloudEnabled && garment.embedding && <CloudSearch garment={garment} />}

      <Button
        title="Remove from closet"
        variant="secondary"
        style={styles.section}
        onPress={async () => {
          await deleteGarment(db, garment);
          router.back();
        }}
      />
    </ScrollView>
  );
}

/** Same query as the on-device list above, answered by pgvector's HNSW index on the server. */
function CloudSearch({ garment }: { garment: Garment }) {
  const [state, setState] = useState<{ busy: boolean; results: CloudMatch[] | null; error: string | null }>({
    busy: false,
    results: null,
    error: null,
  });

  const run = async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const results = await searchSimilar(garment.embedding!, 6);
      setState({ busy: false, results: results.filter((r) => r.client_item_id !== garment.id).slice(0, 5), error: null });
    } catch (e) {
      setState({ busy: false, results: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[ui.h2, { marginBottom: 8 }]}>Cloud search (pgvector)</Text>
      {garment.syncedAt === null && <Text style={ui.muted}>This garment hasn&apos;t been uploaded yet.</Text>}
      {state.error && <Text style={[ui.muted, { color: colors.danger }]}>{state.error}</Text>}
      {state.results && state.results.length === 0 && <Text style={ui.muted}>No other garments on the server yet.</Text>}
      {state.results && state.results.length > 0 && (
        <View style={styles.row}>
          {state.results.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => router.replace({ pathname: '/garment/[id]', params: { id: r.client_item_id } })}
              style={styles.similar}
            >
              <View style={[ui.checker, styles.thumb]}>
                <Image source={{ uri: r.image_url }} style={styles.fill} resizeMode="contain" />
              </View>
              <Text style={ui.muted}>{(r.similarity * 100).toFixed(0)}% match</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Button title="Search the cloud" variant="secondary" busy={state.busy} onPress={run} style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  hero: { aspectRatio: 1, borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  fill: { width: '100%', height: '100%' },
  section: { marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  similar: { width: '30%', gap: 4 },
  thumb: { aspectRatio: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
});
