import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Garment } from '../domain/types';
import type { OutfitScore } from '../style/outfitSuggestions';
import { colors, ui } from '../theme';

/** Base score plus the optional context dimensions the generator adds. */
export type CardScore = OutfitScore & { occasion?: number | null; weather?: number };

interface Props {
  title?: string;
  garments: Garment[];
  score: CardScore;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tapping a piece opens it. */
  onPressGarment?: (g: Garment) => void;
}

const tintFor = (v: number) => (v >= 75 ? colors.good : v >= 55 ? colors.warn : colors.danger);

/** Labelled mini bars, one per scoring dimension. */
export function ScoreIndicators({ score }: { score: CardScore }) {
  const rows: [string, number][] = [['Colour harmony', score.harmony]];
  if (score.fit !== null) rows.push(['Suits you', score.fit]);
  if (score.occasion != null) rows.push(['Occasion', score.occasion]);
  if (score.weather != null) rows.push(['Season', score.weather]);
  return (
    <View style={styles.indicators}>
      {rows.map(([label, v]) => (
        <View key={label} style={styles.indicator} accessibilityLabel={`${label} ${v} out of 100`}>
          <Text style={styles.indicatorLabel}>{label}</Text>
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${v}%`, backgroundColor: tintFor(v) }]} />
          </View>
          <Text style={styles.indicatorValue}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** Thumbnails of an outfit's pieces with its harmony/personal-fit score and styling notes. */
export function OutfitCard({ title, garments, score, children, style, onPressGarment }: Props) {
  const tint = tintFor(score.score);
  return (
    <View style={[ui.card, styles.card, style]}>
      <View style={styles.header}>
        {title ? <Text style={[ui.h2, styles.title]} numberOfLines={1}>{title}</Text> : <View style={styles.title} />}
        <Text style={[styles.score, { color: tint }]}>{score.score}</Text>
      </View>
      <View style={styles.pieces}>
        {garments.map((g) => (
          <Pressable
            key={g.id}
            disabled={!onPressGarment}
            onPress={() => onPressGarment?.(g)}
            style={[ui.checker, styles.thumb]}
            accessibilityRole={onPressGarment ? 'button' : undefined}
          >
            <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
          </Pressable>
        ))}
      </View>
      <ScoreIndicators score={score} />
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
  indicators: { gap: 4 },
  indicator: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  indicatorLabel: { ...ui.muted, width: 104 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { height: 6 },
  indicatorValue: { ...ui.muted, width: 26, textAlign: 'right' },
});
