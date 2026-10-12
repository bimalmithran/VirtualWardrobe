import { StyleSheet, Text, View } from 'react-native';

import type { MatchResult } from '../vision/undertoneMatch';
import { colorName } from '../vision/color';
import { colors, ui } from '../theme';

export function MatchScoreCard({ hex, match }: { hex: string; match: MatchResult }) {
  const tint = match.score >= 75 ? colors.good : match.score >= 55 ? colors.warn : colors.danger;
  return (
    <View style={[ui.card, styles.card]}>
      <View style={styles.row}>
        <View style={[styles.ring, { borderColor: tint }]}>
          <Text style={[styles.score, { color: tint }]}>{match.score}</Text>
          <Text style={ui.muted}>/ 100</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[ui.h2, { color: tint }]}>{match.verdict}</Text>
          <View style={styles.colorRow}>
            <View style={[styles.swatch, { backgroundColor: hex }]} />
            <Text style={ui.body}>
              {colorName(hex)} · {hex}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${match.score}%`, backgroundColor: tint }]} />
      </View>
      <Text style={ui.body}>{match.explanation}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ring: { width: 92, height: 92, borderRadius: 46, borderWidth: 6, alignItems: 'center', justifyContent: 'center' },
  score: { fontSize: 30, fontWeight: '800' },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8 },
});
