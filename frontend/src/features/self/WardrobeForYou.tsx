import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { SimilarGrid } from '../../components/SimilarGrid';
import type { Garment, PersonalColouring, Wearer } from '../../domain/types';
import { coloursToAdd, rankForWearer } from '../../style/personalFit';
import { colors, ui } from '../../theme';

const BEST_COUNT = 6;

/** The closet ranked for the wearer, and the palette colours it is missing. */
export function WardrobeForYou({ closet, wearer, colouring }: { closet: Garment[]; wearer: Wearer; colouring: PersonalColouring }) {
  const best = rankForWearer(closet, wearer, BEST_COUNT);
  const missing = coloursToAdd(closet, colouring);
  return (
    <>
      <Text style={[ui.h2, styles.section]}>Best on you from your closet</Text>
      {best.length === 0 ? (
        <Text style={ui.muted}>Add garments to see which suit you best.</Text>
      ) : (
        <SimilarGrid
          items={best.map(({ garment, match }) => ({
            key: garment.id,
            imageUri: garment.imageUri,
            caption: `${match.score} · ${match.verdict}`,
            onPress: () => router.push({ pathname: '/garment/[id]', params: { id: garment.id } }),
          }))}
        />
      )}

      <Text style={[ui.h2, styles.section]}>Colours to add to your wardrobe</Text>
      {missing.length === 0 ? (
        <Text style={ui.muted}>Your closet already covers your palette. Nice.</Text>
      ) : (
        <>
          <Text style={ui.muted}>Nothing in your closet comes close to these. Look for them when shopping; Live Shop scores a shirt against you.</Text>
          <View style={styles.missing}>
            {missing.map((m) => (
              <View key={m.hex} style={styles.missingItem}>
                <View style={[styles.swatch, { backgroundColor: m.hex }]} />
                <Text style={ui.muted}>{m.name}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24, marginBottom: 8 },
  missing: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  missingItem: { alignItems: 'center', gap: 4, width: 72 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
});
