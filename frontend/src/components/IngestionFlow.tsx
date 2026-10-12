import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';

import { syncCloset } from '../api/sync';
import type { ModelKey } from '../config/models';
import type { RGBAImage } from '../image/pixels';
import { errorMessage, modelManager, useModelStatuses } from '../ml/modelManager';
import { insertGarment, newGarmentId } from '../storage/closet';
import { useProfile } from '../storage/profile';
import type { PaletteEntry } from '../vision/colorExtraction';
import type { QualityReport } from '../vision/junkFilter';
import { inspectPhoto, processGarment, type Photo, type ProcessedGarment, type Stage } from '../vision/pipeline';
import { scoreUndertoneMatch, type MatchResult } from '../vision/undertoneMatch';
import { colors, ui } from '../theme';
import { Button } from './Button';
import { CameraCapture } from './CameraCapture';
import { MatchScoreCard } from './MatchScoreCard';
import { ModelSetup } from './ModelSetup';

type Mode = 'closet' | 'shop';

type FlowState =
  | { kind: 'capture' }
  | { kind: 'inspecting' }
  | { kind: 'junk'; photo: Photo; quality: QualityReport }
  | { kind: 'processing'; stage: Stage | 'saving' }
  | { kind: 'done'; previewUri: string; result: ProcessedGarment; match: MatchResult | null; garmentId: string | null }
  | { kind: 'error'; message: string };

const REQUIRED: Record<Mode, ModelKey[]> = {
  closet: ['segmentation', 'embedding'],
  shop: ['segmentation'],
};

const STAGES: Record<Mode, { key: Stage | 'saving'; label: string }[]> = {
  closet: [
    { key: 'segmentation', label: 'Removing background' },
    { key: 'color', label: 'Extracting colours (K-Means)' },
    { key: 'embedding', label: 'Computing style vector (MobileCLIP)' },
    { key: 'saving', label: 'Saving to closet' },
  ],
  shop: [
    { key: 'segmentation', label: 'Removing background' },
    { key: 'color', label: 'Extracting colours (K-Means)' },
  ],
};

export function IngestionFlow({ mode }: { mode: Mode }) {
  const db = useSQLiteContext();
  const { profile } = useProfile();
  const statuses = useModelStatuses();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<FlowState>({ kind: 'capture' });

  // The working image (~4 MB) lives in a ref, not state, so it isn't retained by React
  // and can be dropped the moment processing finishes.
  const working = useRef<RGBAImage | null>(null);
  // Bumped on reset/unmount so late results from an abandoned run are ignored.
  const generation = useRef(0);
  const shopPreview = useRef<File | null>(null);

  const clearShopPreview = () => {
    if (shopPreview.current?.exists) shopPreview.current.delete();
    shopPreview.current = null;
  };

  useEffect(
    () => () => {
      generation.current++;
      working.current = null;
      clearShopPreview();
    },
    [],
  );

  const reset = useCallback(() => {
    generation.current++;
    working.current = null;
    clearShopPreview();
    setState({ kind: 'capture' });
  }, []);

  const run = useCallback(
    async (photo: Photo) => {
      const gen = generation.current;
      const live = () => gen === generation.current;
      const img = working.current;
      if (!img) return;

      try {
        setState({ kind: 'processing', stage: 'segmentation' });
        const result = await processGarment(photo, img, {
          embed: mode === 'closet',
          onStage: (stage) => live() && setState({ kind: 'processing', stage }),
        });
        working.current = null;
        if (!live()) return;

        if (mode === 'closet') {
          setState({ kind: 'processing', stage: 'saving' });
          const garment = await insertGarment(db, {
            id: newGarmentId(),
            png: result.png,
            colorHex: result.colorHex,
            palette: result.palette,
            embedding: result.embedding,
          });
          syncCloset(db).catch(() => {}); // upload in the background; retried later if offline
          if (!live()) return;
          setState({ kind: 'done', previewUri: garment.imageUri, result, match: null, garmentId: garment.id });
        } else {
          clearShopPreview();
          const file = new File(Paths.cache, `shop-${Date.now()}.png`);
          file.write(result.png);
          shopPreview.current = file;
          const match = profile ? scoreUndertoneMatch(result.colorHex, profile.undertone) : null;
          setState({ kind: 'done', previewUri: file.uri, result, match, garmentId: null });
        }
      } catch (e) {
        working.current = null;
        if (live()) setState({ kind: 'error', message: errorMessage(e) });
      }
    },
    [db, mode, profile],
  );

  const onCapture = useCallback(
    async (photo: Photo) => {
      const gen = generation.current;
      setState({ kind: 'inspecting' });
      try {
        const { working: img, quality } = await inspectPhoto(photo);
        if (gen !== generation.current) return;
        working.current = img;
        if (quality.issues.length > 0) setState({ kind: 'junk', photo, quality });
        else await run(photo);
      } catch (e) {
        if (gen === generation.current) setState({ kind: 'error', message: errorMessage(e) });
      }
    },
    [run],
  );

  const modelsReady = REQUIRED[mode].every((k) => statuses[k].state !== 'downloading' && modelManager.isDownloaded(k));
  if (!modelsReady) {
    return (
      <View style={[ui.screen, styles.padded, { paddingTop: insets.top + 16 }]}>
        <ModelSetup required={REQUIRED[mode]} />
      </View>
    );
  }

  switch (state.kind) {
    case 'capture':
      return (
        <CameraCapture
          onCapture={onCapture}
          hint={
            mode === 'closet'
              ? 'Lay the garment flat or hang it against a plain background'
              : 'Point at a shirt in the store to check it against your undertone'
          }
        />
      );

    case 'inspecting':
      return <Centered label="Checking photo quality…" />;

    case 'junk':
      return (
        <ScrollView style={ui.screen} contentContainerStyle={[styles.padded, { paddingTop: insets.top + 16 }]}>
          <View style={[ui.card, styles.warnCard]}>
            <Text style={[ui.h2, { color: colors.warn }]}>This photo may give poor results</Text>
            {state.quality.issues.map((issue) => (
              <Text key={issue} style={ui.body}>• {issue}</Text>
            ))}
            <Text style={ui.muted}>
              Brightness {state.quality.brightness.toFixed(0)} · Contrast {state.quality.contrast.toFixed(0)} · Sharpness{' '}
              {state.quality.sharpness.toFixed(0)}
            </Text>
          </View>
          <Button title="Retake photo" onPress={reset} style={styles.gap} />
          <Button title="Process anyway" variant="secondary" onPress={() => run(state.photo)} style={styles.gap} />
        </ScrollView>
      );

    case 'processing':
      return (
        <View style={[ui.screen, styles.padded, { paddingTop: insets.top + 16 }]}>
          <Text style={ui.h1}>Processing on device</Text>
          <Text style={[ui.muted, styles.gap]}>Nothing leaves your phone. First run loads the models into memory, which takes a few seconds.</Text>
          <View style={[ui.card, styles.gap]}>
            {STAGES[mode].map((s, i) => {
              const current = STAGES[mode].findIndex((x) => x.key === state.stage);
              const status = i < current ? 'done' : i === current ? 'active' : 'pending';
              return (
                <View key={s.key} style={styles.stageRow}>
                  {status === 'active' ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Text style={[styles.stageIcon, status === 'done' && { color: colors.good }]}>{status === 'done' ? '✓' : '○'}</Text>
                  )}
                  <Text style={[ui.body, status === 'pending' && { color: colors.muted }]}>{s.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      );

    case 'error':
      return (
        <View style={[ui.screen, styles.padded, { paddingTop: insets.top + 16 }]}>
          <View style={ui.card}>
            <Text style={[ui.h2, { color: colors.danger }]}>Processing failed</Text>
            <Text style={[ui.body, styles.gap]}>{state.message}</Text>
          </View>
          <Button title="Try again" onPress={reset} style={styles.gap} />
        </View>
      );

    case 'done':
      return (
        <ScrollView style={ui.screen} contentContainerStyle={[styles.padded, { paddingTop: insets.top + 16, paddingBottom: 32 }]}>
          <Text style={ui.h1}>{mode === 'closet' ? 'Added to your closet' : 'In-store match'}</Text>
          <View style={[ui.checker, styles.preview]}>
            <Image source={{ uri: state.previewUri }} style={styles.previewImage} resizeMode="contain" />
          </View>
          {state.match && <MatchScoreCard hex={state.result.colorHex} match={state.match} />}
          <Palette palette={state.result.palette} />
          <Text style={[ui.muted, styles.gap]}>
            {Object.entries(state.result.timingsMs).map(([k, v]) => `${k} ${v} ms`).join(' · ')}
            {state.result.embedding ? ` · ${state.result.embedding.length}-d vector` : ''}
          </Text>
          <Button title={mode === 'closet' ? 'Add another' : 'Scan another'} onPress={reset} style={styles.gap} />
          {state.garmentId && (
            <Button
              title="View in closet"
              variant="secondary"
              onPress={() => {
                reset();
                router.navigate('/');
              }}
              style={styles.gap}
            />
          )}
        </ScrollView>
      );
  }
}

function Palette({ palette }: { palette: PaletteEntry[] }) {
  return (
    <View style={[ui.card, styles.gap]}>
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

function Centered({ label }: { label: string }) {
  return (
    <View style={[ui.screen, styles.center]}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={[ui.body, styles.gap]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  padded: { paddingHorizontal: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },
  gap: { marginTop: 12 },
  warnCard: { gap: 8, backgroundColor: colors.warnBg, borderColor: '#FCD34D' },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stageIcon: { width: 20, textAlign: 'center', fontSize: 16, color: colors.muted },
  preview: { aspectRatio: 1, borderRadius: 16, marginVertical: 12, overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  paletteBar: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', marginTop: 10 },
  paletteLegend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8 },
});
