import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../components/Button';
import { CameraCapture } from '../components/CameraCapture';
import { ModelSetup } from '../components/ModelSetup';
import { PhotoStrip } from '../components/PhotoStrip';
import type { SelfPhoto } from '../domain/types';
import { useWardrobe } from '../features/outfits/useWardrobe';
import { useProfile } from '../features/profile/ProfileContext';
import { ColouringCard } from '../features/self/ColouringCard';
import { useSelf, useWearer } from '../features/self/SelfContext';
import { WardrobeForYou } from '../features/self/WardrobeForYou';
import { errorMessage } from '../lib/errors';
import { useModelStatuses } from '../ml/modelStatus';
import { useServices } from '../services/ServicesProvider';
import { colors, ui } from '../theme';
import type { Photo } from '../vision/pipeline';

/** Most photos of you one gallery pick takes. */
const MAX_SELF_PICK = 10;

/** Photos of the user → their colouring → what in (and missing from) the closet suits them. */
export default function Me() {
  const { models } = useServices();
  const statuses = useModelStatuses(models.status);
  const { profile, save } = useProfile();
  const { photos, colouring, add, remove } = useSelf();
  const wearer = useWearer();
  const { garments } = useWardrobe();
  const [camera, setCamera] = useState(false);
  // Photos being read, one at a time: { done, total } while busy.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const analyzing = progress !== null;
  const [error, setError] = useState<string | null>(null);

  const ready = models.files.isDownloaded('segmentation') && statuses.segmentation.state !== 'downloading';
  if (!ready) {
    return (
      <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
        <ModelSetup required={['segmentation']} />
      </ScrollView>
    );
  }

  /** Reads each photo in turn (one in memory at a time); one bad photo doesn't stop the rest. */
  const analyze = async (picked: Photo[]) => {
    setCamera(false);
    setError(null);
    const failures: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      setProgress({ done: i, total: picked.length });
      try {
        await add(picked[i]);
      } catch (e) {
        failures.push(picked.length > 1 ? `Photo ${i + 1}: ${errorMessage(e)}` : errorMessage(e));
      }
    }
    setProgress(null);
    if (failures.length) setError(failures.join('\n'));
  };

  const upload = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: MAX_SELF_PICK,
      orderedSelection: true,
    });
    if (res.canceled) return;
    analyze(res.assets.slice(0, MAX_SELF_PICK).map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
  };

  const confirmRemove = (doomed: SelfPhoto[]) =>
    Alert.alert(
      doomed.length === 1 ? 'Remove this photo?' : `Remove ${doomed.length} photos?`,
      'Your colouring will be recalculated from the others.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            for (const photo of doomed) await remove(photo).catch(() => {});
          },
        },
      ],
    );

  if (camera) {
    return (
      <CameraCapture
        initialFacing="front"
        hint="Face a window in daylight. No filters or heavy make-up."
        onCapture={(photo) => analyze([photo])}
        onPickMany={analyze}
        maxPick={MAX_SELF_PICK}
      />
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Text style={ui.h1}>Your colours</Text>
      <Text style={[ui.muted, styles.gap]}>
        Add photos of yourself and the app reads your skin tone, undertone and contrast to suggest what suits you. Photos are
        processed and kept on this phone only; they are never uploaded.
      </Text>

      {photos.length > 0 && (
        <View style={styles.gap}>
          <PhotoStrip photos={photos} onRemove={confirmRemove} />
          <Text style={[ui.muted, styles.hint]}>
            Long-press to select photos to remove. More photos in different light give a steadier result.
          </Text>
        </View>
      )}

      {analyzing ? (
        <View style={[ui.card, styles.analyzing]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={ui.body}>
            {progress.total > 1 ? `Reading photo ${progress.done + 1} of ${progress.total}…` : 'Reading your colouring…'}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button title="Take a photo" onPress={() => setCamera(true)} style={styles.flex} />
          <Button title="Upload photos" variant="secondary" onPress={upload} style={styles.flex} />
        </View>
      )}

      {error && (
        <View style={[ui.card, styles.gap]}>
          <Text style={[ui.h2, { color: colors.danger }]}>Couldn&apos;t read {error.includes('\n') || error.startsWith('Photo ') ? 'some photos' : 'that photo'}</Text>
          <Text style={ui.body}>{error}</Text>
        </View>
      )}

      {colouring ? (
        <>
          <ColouringCard
            colouring={colouring}
            twinUndertone={profile?.undertone ?? null}
            onUseUndertone={(undertone) => profile && save({ ...profile, undertone })}
          />
          {garments && <WardrobeForYou closet={garments} wearer={wearer} colouring={colouring} />}
        </>
      ) : (
        !analyzing && (
          <View style={[ui.card, styles.gap]}>
            <Text style={ui.h2}>Tips for a good reading</Text>
            <Text style={ui.body}>• Daylight from a window, facing it</Text>
            <Text style={ui.body}>• Face and neck clearly visible, hair as usual</Text>
            <Text style={ui.body}>• No beauty filters or heavy make-up</Text>
          </View>
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  gap: { marginTop: 12 },
  hint: { marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginVertical: 16 },
  flex: { flex: 1 },
  analyzing: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
});
