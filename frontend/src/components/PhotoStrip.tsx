import { Image, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { GarmentPhoto } from '../domain/types';
import { colors, ui } from '../theme';

interface Props {
  photos: GarmentPhoto[];
  selectedUri: string;
  onSelect: (photo: GarmentPhoto) => void;
  /** Long-press handler; omitted when the photo can't be removed (e.g. the only one). */
  onRemove?: (photo: GarmentPhoto) => void;
  onAdd: () => void;
}

const SIZE = 64;

/** Thumbnails of a garment's photos, followed by an "add photo" tile. */
export function PhotoStrip({ photos, selectedUri, onSelect, onRemove, onAdd }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {photos.map((p, i) => (
        <Pressable
          key={p.id}
          onPress={() => onSelect(p)}
          onLongPress={onRemove ? () => onRemove(p) : undefined}
          accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
          style={[ui.checker, styles.thumb, p.imageUri === selectedUri && styles.selected]}
        >
          <Image source={{ uri: p.imageUri }} style={styles.image} resizeMode="contain" />
        </Pressable>
      ))}
      <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add a photo of this garment" style={[styles.thumb, styles.add]}>
        <Ionicons name="camera-outline" size={22} color={colors.accent} />
        <Text style={styles.addText}>Add photo</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  thumb: { width: SIZE, height: SIZE, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: colors.accent },
  image: { width: '100%', height: '100%' },
  add: { alignItems: 'center', justifyContent: 'center', borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.surface },
  addText: { fontSize: 11, color: colors.accent, marginTop: 2 },
});
