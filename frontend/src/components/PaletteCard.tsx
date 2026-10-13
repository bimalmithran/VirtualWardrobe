import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PaletteEntry } from '../domain/types';
import { ui } from '../theme';

interface Props {
  palette: PaletteEntry[];
  /** Shown under the title, e.g. how many photos the palette was fused from. */
  caption?: string;
  style?: StyleProp<ViewStyle>;
}

/** A garment's colour clusters as a proportional bar with a hex legend. */
export function PaletteCard({ palette, caption, style }: Props) {
  return (
    <View style={[ui.card, style]}>
      <Text style={ui.h2}>Colour breakdown</Text>
      {caption && <Text style={ui.muted}>{caption}</Text>}
      <View style={styles.bar}>
        {palette.map((p) => (
          <View key={p.hex} style={{ flex: p.share, backgroundColor: p.hex }} />
        ))}
      </View>
      <View style={styles.legend}>
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

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', marginTop: 10 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 8 },
});
