import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Button } from '../components/Button';
import { Chips } from '../components/Chips';
import { ModelSetup } from '../components/ModelSetup';
import { CATEGORIES, type Category, type Garment, type GarmentShape, type SelfPhoto } from '../domain/types';
import { FREE_LIMITS } from '../billing/plans';
import { usePremium } from '../billing/PremiumContext';
import { useProfile } from '../features/profile/ProfileContext';
import { useSelf } from '../features/self/SelfContext';
import { TryOnCanvas } from '../features/tryon/TryOnCanvas';
import { loadRGBA } from '../image/pixels';
import { errorMessage } from '../lib/errors';
import { useModelStatuses } from '../ml/modelStatus';
import { useServices } from '../services/ServicesProvider';
import { cutFit } from '../style/cutFit';
import { buildAvatar } from '../style/tryOn';
import { colors, ui } from '../theme';
import { scalePose, type Pose } from '../vision/pose';

const POSE_SIDE = 512;
const isCategory = (s: string | undefined): s is Category => !!s && (CATEGORIES as readonly string[]).includes(s);

/**
 * Virtual try-on: a closet garment (?garment=id) or a scanned one (?uri=&category=) on the
 * user's own photo, placed by pose estimation, or on an avatar built from the Digital Twin.
 * Pose runs on the phone only: photos of the user never leave it.
 */
export default function TryOn() {
  const params = useLocalSearchParams<{ garment?: string; uri?: string; category?: string; subcategory?: string; shape?: string }>();
  const { closet, self, models, tryOnCounter } = useServices();
  const { premium, upgrade } = usePremium();
  // Free plan: a few try-ons a day, counted once per opened try-on.
  const [freeAllowed, setFreeAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!premium) tryOnCounter.take(FREE_LIMITS.tryOn).then(setFreeAllowed);
  }, [premium, tryOnCounter]);
  const allowed = premium ? true : freeAllowed;
  const statuses = useModelStatuses(models.status);
  const { profile } = useProfile();
  const { photos } = useSelf();
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<'photo' | 'avatar'>(photos.length ? 'photo' : 'avatar');
  const [photo, setPhoto] = useState<SelfPhoto | null>(photos.at(-1) ?? null);
  const [pose, setPose] = useState<Pose | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A closet garment loads from the database; a scanned one is fully described by the params.
  const [closetGarment, setClosetGarment] = useState<Garment | null>(null);
  useEffect(() => {
    if (params.garment) closet.get(params.garment).then(setClosetGarment);
  }, [closet, params.garment]);
  const scanned = useMemo(
    () =>
      params.uri
        ? {
            imageUri: params.uri,
            category: isCategory(params.category) ? params.category : null,
            subcategory: params.subcategory || null,
            shape: params.shape ? (JSON.parse(params.shape) as GarmentShape) : null,
          }
        : null,
    [params.uri, params.category, params.subcategory, params.shape],
  );
  const garment = params.garment ? closetGarment : scanned;

  const poseReady = models.files.isDownloaded('pose') && statuses.pose.state !== 'downloading';

  // Pose for the chosen photo: from the cache, or estimated once on the phone and cached.
  useEffect(() => {
    if (mode !== 'photo' || !photo || !poseReady) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        let normalised = await self.photos.getPose(photo.id);
        if (!normalised) {
          const img = await loadRGBA(photo.imageUri, { width: POSE_SIDE });
          const px = await self.pose.estimate(img);
          normalised = scalePose(px, 1 / img.width, 1 / img.height);
          await self.photos.savePose(photo.id, normalised);
        }
        if (!cancelled) setPose(normalised);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, photo, poseReady, self]);

  const avatar = useMemo(() => (profile ? buildAvatar(profile) : null), [profile]);
  const fit = garment && profile ? cutFit(garment.category, garment.shape, profile) : null;
  const canvasWidth = width - 32;
  const maxHeight = height * 0.6;

  if (!garment || allowed === null) return <View style={ui.screen} />;
  if (!allowed) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.h2}>You&apos;ve used today&apos;s {FREE_LIMITS.tryOn} free try-ons</Text>
        <Text style={ui.body}>Premium gives you unlimited try-ons, plus packing lists and wardrobe insights.</Text>
        <Button title="See Premium" onPress={() => upgrade('Unlimited try-on is a Premium feature.')} style={styles.gap} />
      </View>
    );
  }

  let canvas: ReactNode = null;
  if (mode === 'avatar') {
    canvas = avatar ? (
      <TryOnCanvas garmentUri={garment.imageUri} category={garment.category} subcategory={garment.subcategory} person={{ kind: 'avatar', avatar }} width={canvasWidth} maxHeight={maxHeight} />
    ) : (
      <Text style={ui.muted}>Create your Digital Twin first.</Text>
    );
  } else if (!photo) {
    canvas = (
      <View style={[ui.card, styles.gap]}>
        <Text style={ui.body}>Add a full-length photo of yourself in Your colours to try clothes on yourself.</Text>
        <Button title="Add a photo" onPress={() => router.push('/me')} style={styles.gap} />
      </View>
    );
  } else if (!poseReady) {
    canvas = <ModelSetup required={['pose']} />;
  } else if (busy || !pose) {
    canvas = error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator color={colors.accent} />;
  } else {
    canvas = (
      <PhotoTryOn garment={garment} photo={photo} pose={pose} width={canvasWidth} maxHeight={maxHeight} />
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Chips
        options={[
          { key: 'photo', label: 'On my photo' },
          { key: 'avatar', label: 'On my Digital Twin' },
        ]}
        selected={mode}
        onSelect={setMode}
      />
      {mode === 'photo' && photos.length > 1 && (
        <Chips options={photos.map((p, i) => ({ key: p.id, label: `Photo ${i + 1}` }))} selected={photo?.id ?? null} onSelect={(id) => setPhoto(photos.find((p) => p.id === id) ?? null)} />
      )}
      <View style={styles.canvas}>{canvas}</View>
      {fit && (
        <View style={[ui.card, styles.gap]}>
          <Text style={ui.h2}>
            {fit.silhouette[0].toUpperCase() + fit.silhouette.slice(1)} cut · {fit.score}/100 for your shape
          </Text>
          {fit.notes.map((n) => (
            <Text key={n} style={ui.body}>
              • {n}
            </Text>
          ))}
        </View>
      )}
      <Text style={[ui.muted, styles.gap]}>
        A preview of silhouette and length, not a photoreal render. Your photos and pose stay on this phone.
      </Text>
    </ScrollView>
  );
}

/** The photo's pose is stored normalised; scale it to the image the canvas draws. */
function PhotoTryOn({ garment, photo, pose, width, maxHeight }: { garment: Pick<Garment, 'imageUri' | 'category' | 'subcategory'>; photo: SelfPhoto; pose: Pose; width: number; maxHeight: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    Image.getSize(photo.imageUri, (w, h) => setSize({ w, h }), () => setSize(null));
  }, [photo.imageUri]);
  if (!size) return <ActivityIndicator color={colors.accent} />;
  return (
    <TryOnCanvas
      garmentUri={garment.imageUri}
      category={garment.category}
      subcategory={garment.subcategory}
      person={{ kind: 'photo', uri: photo.imageUri, pose: scalePose(pose, size.w, size.h) }}
      width={width}
      maxHeight={maxHeight}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  canvas: { marginTop: 8, alignItems: 'center', minHeight: 200, justifyContent: 'center' },
  gap: { marginTop: 8 },
});
