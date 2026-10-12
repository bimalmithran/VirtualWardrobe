import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, ui } from '../theme';

export interface SimilarItem {
  key: string;
  imageUri: string;
  /** Cosine similarity, 0..1. */
  score: number;
  onPress: () => void;
}

/** Thumbnail grid with a match percentage under each garment. */
export function SimilarGrid({ items }: { items: SimilarItem[] }) {
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <Pressable key={item.key} onPress={item.onPress} style={styles.cell}>
          <View style={[ui.checker, styles.thumb]}>
            <Image source={{ uri: item.imageUri }} style={styles.fill} resizeMode="contain" />
          </View>
          <Text style={ui.muted}>{(item.score * 100).toFixed(0)}% match</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: '30%', gap: 4 },
  thumb: { aspectRatio: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  fill: { width: '100%', height: '100%' },
});
