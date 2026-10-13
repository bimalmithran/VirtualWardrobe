import { Image, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, ui } from '../theme';

interface StripPhoto {
  id: string;
  imageUri: string;
}

interface Props<T extends StripPhoto> {
  photos: T[];
  selectedUri?: string;
  onSelect?: (photo: T) => void;
  /** Long-press handler; omitted when the photo can't be removed (e.g. the only one). */
  onRemove?: (photo: T) => void;
  /** Omitted to hide the add tile. */
  onAdd?: () => void;
  addLabel?: string;
}

const SIZE = 64;

/** Thumbnails of a set of photos, followed by an "add photo" tile. */
export function PhotoStrip<T extends StripPhoto>({ photos, selectedUri, onSelect, onRemove, onAdd, addLabel = 'Add a photo of this garment' }: Props<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {photos.map((p, i) => (
        <Pressable
          key={p.id}
          onPress={onSelect ? () => onSelect(p) : undefined}
          onLongPress={onRemove ? () => onRemove(p) : undefined}
          accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
          style={[ui.checker, styles.thumb, p.imageUri === selectedUri && styles.selected]}
        >
          <Image source={{ uri: p.imageUri }} style={styles.image} resizeMode="contain" />
        </Pressable>
      ))}
      {onAdd && (
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={addLabel} style={[styles.thumb, styles.add]}>
          <Ionicons name="camera-outline" size={22} color={colors.accent} />
          <Text style={styles.addText}>Add photo</Text>
        </Pressable>
      )}
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
