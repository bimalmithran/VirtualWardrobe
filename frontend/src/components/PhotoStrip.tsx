import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  /**
   * Removes the chosen photos (confirming first is the caller's job). Long-press starts
   * choosing; omitted when nothing may be removed.
   */
  onRemove?: (photos: T[]) => void;
  /** Photos that must remain: Delete is disabled if the choice would leave fewer. */
  minKeep?: number;
  /** Omitted to hide the add tile. */
  onAdd?: () => void;
  addLabel?: string;
}

const SIZE = 64;

/**
 * Thumbnails of a set of photos, followed by an "add photo" tile. Long-press switches to
 * choosing photos to delete: taps toggle, and a bar below offers Delete and Cancel.
 */
export function PhotoStrip<T extends StripPhoto>({
  photos,
  selectedUri,
  onSelect,
  onRemove,
  minKeep = 0,
  onAdd,
  addLabel = 'Add a photo of this garment',
}: Props<T>) {
  const [picked, setChosen] = useState<Set<string> | null>(null);
  // Ignore choices whose photo has gone (removed here or elsewhere).
  const chosen = useMemo(
    () => (picked ? new Set([...picked].filter((id) => photos.some((p) => p.id === id))) : null),
    [picked, photos],
  );

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = chosen?.size ?? 0;
  const tooMany = photos.length - count < minKeep;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((p, i) => {
          const isChosen = !!chosen?.has(p.id);
          return (
            <Pressable
              key={p.id}
              onPress={chosen ? () => toggle(p.id) : onSelect ? () => onSelect(p) : undefined}
              onLongPress={onRemove ? () => (chosen ? toggle(p.id) : setChosen(new Set([p.id]))) : undefined}
              accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
              accessibilityState={chosen ? { selected: isChosen } : undefined}
              style={[ui.checker, styles.thumb, !chosen && p.imageUri === selectedUri && styles.selected]}
            >
              <Image source={{ uri: p.imageUri }} style={styles.image} resizeMode="contain" />
              {/* Overlay rather than a border change: see the Closet grid for why. */}
              {isChosen && <View style={styles.chosenRing} pointerEvents="none" />}
              {chosen && (
                <Ionicons
                  name={isChosen ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={isChosen ? colors.accent : colors.muted}
                  style={styles.check}
                />
              )}
            </Pressable>
          );
        })}
        {onAdd && !chosen && (
          <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={addLabel} style={[styles.thumb, styles.add]}>
            <Ionicons name="camera-outline" size={22} color={colors.accent} />
            <Text style={styles.addText}>Add photo</Text>
          </Pressable>
        )}
      </ScrollView>
      {chosen && onRemove && (
        <View style={styles.bar}>
          <Text style={[ui.body, styles.barCount]}>
            {tooMany ? `Keep at least ${minKeep} photo${minKeep === 1 ? '' : 's'}` : `${count} selected`}
          </Text>
          <Pressable
            onPress={() => {
              const doomed = photos.filter((p) => chosen.has(p.id));
              setChosen(null);
              onRemove(doomed);
            }}
            disabled={count === 0 || tooMany}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[styles.barAction, { color: colors.danger }, (count === 0 || tooMany) && styles.disabled]}>
              Delete{count > 0 ? ` (${count})` : ''}
            </Text>
          </Pressable>
          <Pressable onPress={() => setChosen(null)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.barAction}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  thumb: { width: SIZE, height: SIZE, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  selected: { borderColor: colors.accent },
  image: { width: '100%', height: '100%' },
  chosenRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, borderWidth: 3, borderColor: colors.accent },
  check: { position: 'absolute', left: 3, bottom: 3, backgroundColor: colors.surface, borderRadius: 9 },
  add: { alignItems: 'center', justifyContent: 'center', borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.surface },
  addText: { fontSize: 11, color: colors.accent, marginTop: 2 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 8 },
  barCount: { flex: 1, fontWeight: '600' },
  barAction: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.4 },
});
