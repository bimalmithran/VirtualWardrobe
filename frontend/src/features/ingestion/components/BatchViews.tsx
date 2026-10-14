import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { colors, ui } from '../../../theme';
import type { IngestionMode } from '../modes';
import type { BatchItem, BatchStep } from '../useIngestion';
import { screenStyles } from './screenStyles';
import { StepList } from './StatusViews';

export function BatchProgress({
  steps,
  index,
  total,
  step,
  items,
}: {
  steps: IngestionMode['steps'];
  index: number;
  total: number;
  step: BatchStep;
  items: BatchItem[];
}) {
  const added = items.filter((i) => i.status === 'added').length;
  return (
    <>
      <Text style={ui.h1}>Photo {index + 1} of {total}</Text>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: index }}>
        <View style={[styles.fill, { width: `${(index / total) * 100}%` }]} />
      </View>
      <Text style={[ui.muted, screenStyles.gap]}>
        {added} added so far. Photos are processed one at a time on your phone; keep the app open until it finishes.
      </Text>
      {step === 'inspecting' ? (
        <Text style={[ui.body, screenStyles.gap]}>Checking photo quality…</Text>
      ) : (
        <StepList steps={steps} current={step} />
      )}
    </>
  );
}

interface SummaryProps {
  items: BatchItem[];
  copy: IngestionMode['copy'];
  onAgain: () => void;
  onExit?: () => void;
  /** Re-runs the photos that failed the quality check, ignoring it this time. */
  onAddSkipped: (skipped: BatchItem[]) => void;
  /** Opens what an added photo became (its garment page). */
  onOpen?: (item: Extract<BatchItem, { status: 'added' }>) => void;
}

export function BatchSummary({ items, copy, onAgain, onExit, onAddSkipped, onOpen }: SummaryProps) {
  const added = items.filter((i) => i.status === 'added');
  const skipped = items.filter((i) => i.status === 'skipped');
  const lastGarment = added[added.length - 1]?.outcome.garment;
  return (
    <>
      <Text style={ui.h1}>
        {added.length} of {items.length} photos added
      </Text>
      {onOpen && added.length > 0 && (
        <Text style={[ui.muted, screenStyles.gap]}>Tap a garment to tag what it is, so outfits can use it.</Text>
      )}
      {!onOpen && lastGarment && lastGarment.photoCount > 1 && (
        <Text style={[ui.muted, screenStyles.gap]}>This garment now has {lastGarment.photoCount} photos; its colour combines all of them.</Text>
      )}
      <View style={[ui.card, screenStyles.gap, styles.list]}>
        {items.map((item, i) => {
          const row = (
            <View style={styles.row}>
              <View style={[ui.checker, styles.thumb]}>
                <Image
                  source={{ uri: item.status === 'added' ? item.outcome.previewUri : item.photo.uri }}
                  style={styles.thumbImage}
                  resizeMode={item.status === 'added' ? 'contain' : 'cover'}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[ui.body, { color: STATUS_COLOR[item.status] }]}>{STATUS_LABEL[item.status]}</Text>
                {item.status !== 'added' && <Text style={ui.muted} numberOfLines={2}>{item.reason}</Text>}
              </View>
              {item.status === 'added' && onOpen && <Text style={styles.chevron}>›</Text>}
            </View>
          );
          return item.status === 'added' && onOpen ? (
            <Pressable key={i} onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`Open garment ${i + 1}`}>
              {row}
            </Pressable>
          ) : (
            <View key={i}>{row}</View>
          );
        })}
      </View>
      {skipped.length > 0 && (
        <Button
          title={`Add ${skipped.length} skipped ${skipped.length === 1 ? 'photo' : 'photos'} anyway`}
          variant="secondary"
          onPress={() => onAddSkipped(skipped)}
          style={screenStyles.gap}
        />
      )}
      <Button title={copy.againLabel} onPress={onAgain} style={screenStyles.gap} />
      {onExit && copy.exitLabel && <Button title={copy.exitLabel} variant="secondary" onPress={onExit} style={screenStyles.gap} />}
    </>
  );
}

const STATUS_LABEL: Record<BatchItem['status'], string> = { added: 'Added', skipped: 'Skipped: poor photo', failed: 'Failed' };
const STATUS_COLOR: Record<BatchItem['status'], string> = { added: colors.good, skipped: colors.warn, failed: colors.danger };

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: 12, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  list: { paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  thumb: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1 },
  chevron: { fontSize: 22, color: colors.muted },
});
