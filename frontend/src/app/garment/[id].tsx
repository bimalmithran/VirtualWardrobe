import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { MatchScoreCard } from '../../components/MatchScoreCard';
import { PaletteCard } from '../../components/PaletteCard';
import { PhotoStrip } from '../../components/PhotoStrip';
import { SimilarGrid } from '../../components/SimilarGrid';
import { CATEGORIES, CATEGORY_LABELS, type Category, type Garment, type GarmentPhoto } from '../../domain/types';
import { CloudSearchPanel } from '../../features/closet/CloudSearchPanel';
import { openAddPhotos } from '../../features/ingestion/modes';
import { useProfile } from '../../features/profile/ProfileContext';
import { relativeDay } from '../../lib/dates';
import { useServices } from '../../services/ServicesProvider';
import { colors, ui } from '../../theme';
import { rankBySimilarity, type RankedGarment } from '../../vision/similarity';
import { scoreUndertoneMatch } from '../../vision/undertoneMatch';

const SIMILAR_COUNT = 6;
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }));

const openGarment = (id: string) => router.replace({ pathname: '/garment/[id]', params: { id } });

export default function GarmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { closet, photos: photoStore, similarity, sync } = useServices();
  const { profile } = useProfile();
  const [garment, setGarment] = useState<Garment | null | undefined>(undefined);
  const [photos, setPhotos] = useState<GarmentPhoto[]>([]);
  const [shownPhotoId, setShownPhotoId] = useState<string | null>(null);
  const [similar, setSimilar] = useState<RankedGarment[]>([]);

  const load = useCallback(() => {
    Promise.all([closet.list(), photoStore.listPhotos(id)]).then(([all, garmentPhotos]) => {
      const current = all.find((g) => g.id === id) ?? null;
      setGarment(current);
      setPhotos(garmentPhotos);
      setSimilar(current ? rankBySimilarity(current, all, SIMILAR_COUNT) : []);
    });
  }, [closet, photoStore, id]);

  // Reload on focus too: returning from the add-photo screen changes colour and similarity.
  useFocusEffect(load);

  if (garment === undefined) return <View style={ui.screen} />;
  if (garment === null) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.muted}>This garment is no longer in your closet on this phone.</Text>
      </View>
    );
  }

  const setCategory = async (category: Category) => {
    await closet.update(garment.id, { category: category === garment.category ? null : category });
    load();
    sync.syncAll().catch(() => {});
  };

  const toggleFavorite = async () => {
    await closet.update(garment.id, { favorite: !garment.favorite });
    load();
  };

  const woreToday = async () => {
    await closet.markWorn([garment.id]);
    load();
  };

  const removePhoto = (photo: GarmentPhoto) =>
    Alert.alert('Remove this photo?', 'The colour and style will be recalculated from the other photos.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await photoStore.removePhoto(photo);
          } catch (e) {
            Alert.alert('Could not remove photo', e instanceof Error ? e.message : String(e));
            return;
          }
          if (shownPhotoId === photo.id) setShownPhotoId(null);
          load();
          sync.syncAll().catch(() => {});
        },
      },
    ]);

  const shownUri = photos.find((p) => p.id === shownPhotoId)?.imageUri ?? garment.imageUri;

  const remove = () =>
    Alert.alert('Remove garment?', 'This deletes it from this phone, from any outfits, and from the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await closet.remove(garment);
          sync.syncAll().catch(() => {});
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={toggleFavorite} hitSlop={12} accessibilityLabel={garment.favorite ? 'Remove from favourites' : 'Add to favourites'}>
              <Ionicons name={garment.favorite ? 'heart' : 'heart-outline'} size={24} color={garment.favorite ? colors.danger : colors.text} />
            </Pressable>
          ),
        }}
      />
      <View style={[ui.checker, styles.hero]}>
        <Image source={{ uri: shownUri }} style={styles.fill} resizeMode="contain" />
      </View>

      <PhotoStrip
        photos={photos}
        selectedUri={shownUri}
        onSelect={(p) => setShownPhotoId(p.id)}
        onRemove={photos.length > 1 ? removePhoto : undefined}
        onAdd={() => openAddPhotos(garment.id, true)}
      />
      <Text style={[ui.muted, styles.photoHint]}>
        {photos.length > 1
          ? `Colour and style combine all ${photos.length} photos. Long-press a photo to remove it.`
          : 'Add the back, a close-up or a shot in other light for a truer colour and better suggestions.'}
      </Text>

      <Text style={[ui.h2, styles.label]}>Category</Text>
      <Chips options={CATEGORY_OPTIONS} selected={garment.category} onSelect={setCategory} />

      <View style={[ui.card, styles.wear]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.h2}>{wearLabel(garment)}</Text>
          <Text style={ui.muted}>{garment.lastWornAt ? `Last worn ${relativeDay(garment.lastWornAt)}` : 'Not worn yet'}</Text>
        </View>
        <Button title="Wore it today" variant="secondary" onPress={woreToday} />
      </View>

      {profile && <MatchScoreCard hex={garment.colorHex} match={scoreUndertoneMatch(garment.colorHex, profile.undertone)} />}

      <PaletteCard palette={garment.palette} style={styles.palette} />

      <Text style={[ui.h2, styles.section]}>Visually similar in your closet</Text>
      {similar.length === 0 ? (
        <Text style={ui.muted}>Add more garments to see style matches.</Text>
      ) : (
        <SimilarGrid
          items={similar.map(({ garment: g, score }) => ({ key: g.id, imageUri: g.imageUri, score, onPress: () => openGarment(g.id) }))}
        />
      )}

      {similarity && garment.embedding && (
        <CloudSearchPanel garment={{ ...garment, embedding: garment.embedding }} remote={similarity} onOpen={openGarment} />
      )}

      <Button title="Remove from closet" variant="secondary" style={styles.section} onPress={remove} />
    </ScrollView>
  );
}

function wearLabel(g: Garment) {
  return g.wearCount === 0 ? 'Never worn' : g.wearCount === 1 ? 'Worn once' : `Worn ${g.wearCount} times`;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  hero: { aspectRatio: 1, borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  fill: { width: '100%', height: '100%' },
  label: { marginBottom: 4 },
  photoHint: { marginTop: 6, marginBottom: 16 },
  palette: { marginTop: 12 },
  wear: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 },
  section: { marginTop: 20, marginBottom: 8 },
});
