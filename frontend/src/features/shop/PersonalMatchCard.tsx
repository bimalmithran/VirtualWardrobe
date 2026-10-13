import { StyleSheet, Text, View } from 'react-native';

import type { CutFit } from '../../style/cutFit';
import { colors, ui } from '../../theme';
import { colorName } from '../../vision/color';
import type { MatchResult } from '../../vision/undertoneMatch';

const tint = (v: number) => (v >= 75 ? colors.good : v >= 55 ? colors.warn : colors.danger);

/** Overall "does it flatter me": colour against skin colouring, cut against body shape. */
export function personalScore(colour: MatchResult | null, cut: CutFit | null): number | null {
  if (!colour && !cut) return null;
  if (!colour) return cut!.score;
  if (!cut) return colour.score;
  return Math.round(0.6 * colour.score + 0.4 * cut.score);
}

export function PersonalMatchCard({ hex, colour, cut }: { hex: string; colour: MatchResult | null; cut: CutFit | null }) {
  const overall = personalScore(colour, cut);
  if (overall === null) return null;
  const verdict = overall >= 75 ? 'Flatters you' : overall >= 55 ? 'Works for you' : 'Not your best';
  return (
    <View style={[ui.card, styles.card]} accessibilityLabel={`Personal match ${overall} out of 100, ${verdict}`}>
      <View style={styles.row}>
        <View style={[styles.ring, { borderColor: tint(overall) }]}>
          <Text style={[styles.score, { color: tint(overall) }]}>{overall}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={[ui.h2, { color: tint(overall) }]}>{verdict}</Text>
          <Text style={ui.muted}>Colour vs your colouring{cut ? ' · cut vs your body shape' : ''}</Text>
        </View>
      </View>
      {colour && (
        <View style={styles.line}>
          <View style={[styles.swatch, { backgroundColor: hex }]} />
          <Text style={[ui.body, styles.flex]}>
            Colour {colour.score}: {colorName(hex)}. {colour.explanation}
          </Text>
        </View>
      )}
      {cut && (
        <Text style={ui.body}>
          Cut {cut.score}: {cut.silhouette}. {cut.notes.join(' ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ring: { width: 72, height: 72, borderRadius: 36, borderWidth: 5, alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 26, fontWeight: '800' },
  flex: { flex: 1 },
  line: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  swatch: { width: 18, height: 18, borderRadius: 9, marginTop: 2, borderWidth: 1, borderColor: colors.border },
});
