import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

export interface ChipOption<K extends string> {
  key: K;
  label: string;
}

interface Props<K extends string> {
  options: ChipOption<K>[];
  selected: K | null;
  onSelect: (key: K) => void;
  /** Horizontal single-line scroller (filters) instead of wrapping rows (forms). */
  scroll?: boolean;
}

/** Single-select pill row, used for closet filters and category tagging. */
export function Chips<K extends string>({ options, selected, onSelect, scroll }: Props<K>) {
  const chips = options.map((o) => {
    const active = o.key === selected;
    return (
      <Pressable
        key={o.key}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onSelect(o.key)}
        style={[styles.chip, active && styles.active]}
      >
        <Text style={[styles.label, active && styles.activeLabel]}>{o.label}</Text>
      </Pressable>
    );
  });
  return scroll ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chips}
    </ScrollView>
  ) : (
    <View style={[styles.row, styles.wrap]}>{chips}</View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  wrap: { flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  active: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { fontSize: 14, color: colors.text, fontWeight: '500' },
  activeLabel: { color: colors.accentText },
});
