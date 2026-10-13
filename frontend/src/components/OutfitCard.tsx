import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Garment } from '../domain/types';
import type { OutfitScore } from '../style/outfitSuggestions';
import { colors, ui } from '../theme';

interface Props {
  title?: string;
  garments: Garment[];
  score: OutfitScore;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Thumbnails of an outfit's pieces with its harmony/personal-fit score and styling notes. */
export function OutfitCard({ title, garments, score, children, style }: Props) {
  const tint = score.score >= 75 ? colors.good : score.score >= 55 ? colors.warn : colors.danger;
  return (
    <View style={[ui.card, styles.card, style]}>
      <View style={styles.header}>
        {title ? <Text style={[ui.h2, styles.title]} numberOfLines={1}>{title}</Text> : <View style={styles.title} />}
        <Text style={[styles.score, { color: tint }]}>{score.score}</Text>
      </View>
      <View style={styles.pieces}>
        {garments.map((g) => (
          <View key={g.id} style={[ui.checker, styles.thumb]}>
            <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
          </View>
        ))}
      </View>
      <Text style={ui.muted}>
        Colour harmony {score.harmony}
        {score.fit !== null ? ` · suits you ${score.fit}` : ''}
      </Text>
      {score.notes.map((n) => (
        <Text key={n} style={ui.body}>• {n}</Text>
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  score: { fontSize: 22, fontWeight: '800' },
  pieces: { flexDirection: 'row', gap: 8 },
  thumb: { flex: 1, maxWidth: 110, aspectRatio: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  fill: { width: '100%', height: '100%' },
});
