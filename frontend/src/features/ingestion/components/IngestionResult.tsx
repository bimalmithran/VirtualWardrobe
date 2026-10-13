import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { MatchScoreCard } from '../../../components/MatchScoreCard';
import { PaletteCard } from '../../../components/PaletteCard';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../../../domain/types';
import { ui } from '../../../theme';
import type { ProcessedGarment } from '../../../vision/pipeline';
import type { IngestionMode, IngestionOutcome } from '../modes';
import { screenStyles } from './screenStyles';

interface Props {
  copy: IngestionMode['copy'];
  result: ProcessedGarment;
  outcome: IngestionOutcome;
  onAgain: () => void;
  onExit: () => void;
  /** Set for saved garments: tags the new garment so it can be used in outfit suggestions. */
  onCategory?: (category: Category) => void;
  /** Set when more photos of this garment can be added. */
  onAddPhotos?: () => void;
}

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }));

export function IngestionResult({ copy, result, outcome, onAgain, onExit, onCategory, onAddPhotos }: Props) {
  const [category, setCategory] = useState<Category | null>(null);
  const garment = outcome.garment;
  // A saved garment's palette is fused from all of its photos; show that, not just this shot.
  const palette = garment?.palette ?? result.palette;
  const photoCount = garment?.photoCount ?? 1;
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
      <PaletteCard
        palette={palette}
        caption={photoCount > 1 ? `Combined from ${photoCount} photos of this garment` : undefined}
        style={screenStyles.gap}
      />
      <Text style={[ui.muted, screenStyles.gap]}>
        Pattern: {result.pattern}
        {result.palette[1] ? ` · secondary ${result.palette[1].hex}` : ''} ·{' '}
        {Object.entries(result.timingsMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}
        {result.embedding ? ` · ${result.embedding.length}-d vector` : ''}
      </Text>
      {onAddPhotos && (
        <>
          <Button title="Add another photo of this garment" onPress={onAddPhotos} style={screenStyles.gap} />
          <Text style={[ui.muted, styles.hint]}>The back, a close-up, or other light. More photos give a truer colour and better suggestions.</Text>
        </>
      )}
      <Button title={copy.againLabel} variant={onAddPhotos ? 'secondary' : 'primary'} onPress={onAgain} style={screenStyles.gap} />
      {copy.exitLabel && <Button title={copy.exitLabel} variant="secondary" onPress={onExit} style={screenStyles.gap} />}
    </>
  );
}

const styles = StyleSheet.create({
  category: { gap: 6, marginBottom: 12 },
  preview: { aspectRatio: 1, borderRadius: 16, marginVertical: 12, overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  hint: { marginTop: 6 },
});
