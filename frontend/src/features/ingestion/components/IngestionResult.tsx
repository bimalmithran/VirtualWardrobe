import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { MatchScoreCard } from '../../../components/MatchScoreCard';
import { CATEGORIES, CATEGORY_LABELS, type Category, type PaletteEntry } from '../../../domain/types';
import { ui } from '../../../theme';
import type { ProcessedGarment } from '../../../vision/pipeline';
import type { IngestionMode, IngestionOutcome } from '../modes';
import { screenStyles } from './screenStyles';

interface Props {
  copy: IngestionMode['copy'];
  result: ProcessedGarment;
  outcome: IngestionOutcome;
  onAgain: () => void;
  onViewCloset: () => void;
  /** Set for saved garments: tags the new garment so it can be used in outfit suggestions. */
  onCategory?: (category: Category) => void;
}

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }));

export function IngestionResult({ copy, result, outcome, onAgain, onViewCloset, onCategory }: Props) {
  const [category, setCategory] = useState<Category | null>(null);
  return (
    <>
      <Text style={ui.h1}>{copy.doneTitle}</Text>
      <View style={[ui.checker, styles.preview]}>
        <Image source={{ uri: outcome.previewUri }} style={styles.previewImage} resizeMode="contain" />
      </View>
      {onCategory && (
        <View style={[ui.card, styles.category]}>
          <Text style={ui.h2}>What is it?</Text>
          <Text style={ui.muted}>Tagging lets the Outfits tab pair it with the rest of your closet.</Text>
          <Chips
            options={CATEGORY_OPTIONS}
            selected={category}
            onSelect={(c) => {
              setCategory(c);
              onCategory(c);
            }}
          />
        </View>
      )}
      {outcome.match && <MatchScoreCard hex={result.colorHex} match={outcome.match} />}
      <Palette palette={result.palette} />
      <Text style={[ui.muted, screenStyles.gap]}>
        {Object.entries(result.timingsMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}
        {result.embedding ? ` · ${result.embedding.length}-d vector` : ''}
      </Text>
      <Button title={copy.againLabel} onPress={onAgain} style={screenStyles.gap} />
      {outcome.garmentId && <Button title="View in closet" variant="secondary" onPress={onViewCloset} style={screenStyles.gap} />}
    </>
  );
}

function Palette({ palette }: { palette: PaletteEntry[] }) {
  return (
    <View style={[ui.card, screenStyles.gap]}>
      <Text style={ui.h2}>Colour breakdown</Text>
      <View style={styles.paletteBar}>
        {palette.map((p) => (
          <View key={p.hex} style={{ flex: p.share, backgroundColor: p.hex }} />
        ))}
      </View>
      <View style={styles.paletteLegend}>
        {palette.map((p, i) => (
          <Text key={p.hex} style={ui.muted}>
            {i === 0 ? 'Primary ' : ''}
            {p.hex} {(p.share * 100).toFixed(0)}%
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  category: { gap: 6, marginBottom: 12 },
  preview: { aspectRatio: 1, borderRadius: 16, marginVertical: 12, overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  paletteBar: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', marginTop: 10 },
  paletteLegend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8 },
});
