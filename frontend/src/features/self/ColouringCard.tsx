import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import type { PersonalColouring, Undertone } from '../../domain/types';
import { colors, ui } from '../../theme';
import { SEASON_LABELS } from '../../vision/personColouring';

interface Props {
  colouring: PersonalColouring;
  /** The undertone saved in the Digital Twin. */
  twinUndertone: Undertone | null;
  /** Saves the detected undertone to the Digital Twin. */
  onUseUndertone: (undertone: Undertone) => void;
}

/** What the photos say about the user's colouring, and the palette that follows from it. */
export function ColouringCard({ colouring, twinUndertone, onUseUndertone }: Props) {
  const differs = twinUndertone !== colouring.undertone;
  return (
    <View style={[ui.card, styles.card]}>
      <View style={styles.row}>
        <View style={[styles.skin, { backgroundColor: colouring.skinHex ?? colors.border }]} />
        <View style={styles.flex}>
          <Text style={ui.h2}>{SEASON_LABELS[colouring.season]}</Text>
          <Text style={ui.muted}>
            {cap(colouring.undertone)} undertone · {colouring.depth} depth · {colouring.contrast} contrast
          </Text>
          <Text style={ui.muted}>From {colouring.photoCount} photo{colouring.photoCount === 1 ? '' : 's'}</Text>
        </View>
      </View>

      <Text style={[ui.body, styles.label]}>Colours that flatter you</Text>
      <View style={styles.swatches}>
        {colouring.palette.map((hex) => (
          <View key={hex} style={[styles.swatch, { backgroundColor: hex }]} accessibilityLabel={hex} />
        ))}
      </View>

      {differs && (
        <View style={styles.differs}>
          <Text style={ui.muted}>
            Your Digital Twin says {twinUndertone ?? 'nothing yet'}; your photos suggest {colouring.undertone}. Lighting can skew
            this, so you decide.
          </Text>
          <Button title={`Use ${colouring.undertone} undertone`} variant="secondary" onPress={() => onUseUndertone(colouring.undertone)} />
        </View>
      )}
    </View>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  card: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  skin: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.border },
  label: { marginTop: 4 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatch: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  differs: { gap: 8, marginTop: 4 },
});
