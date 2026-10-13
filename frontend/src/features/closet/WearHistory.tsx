import { StyleSheet, Text, View } from 'react-native';

import type { Garment, Outfit, WearEvent } from '../../domain/types';
import { relativeDay } from '../../lib/dates';
import { costPerWear, formatInr } from '../../style/costPerWear';
import { ui } from '../../theme';

const SHOWN = 8;

/** Dated wear log, with cost per wear when a price is known. */
export function WearHistory({ garment, wears, outfits }: { garment: Garment; wears: WearEvent[]; outfits: Outfit[] }) {
  const names = new Map(outfits.map((o) => [o.id, o.name]));
  // Wears recorded before the log existed were counted but not dated.
  const undated = Math.max(0, garment.wearCount - wears.length);
  const cpw = costPerWear(garment);
  return (
    <View style={[ui.card, styles.card]}>
      <Text style={ui.h2}>Wear history</Text>
      {cpw !== null && (
        <Text style={ui.body}>
          {formatInr(cpw)} per wear · paid {formatInr(garment.price!)}
          {garment.wearCount === 0 ? ' · wear it to bring this down' : ''}
        </Text>
      )}
      {wears.length === 0 && undated === 0 && <Text style={ui.muted}>Not worn yet.</Text>}
      {wears.slice(0, SHOWN).map((w) => (
        <Text key={`${w.wornAt}-${w.outfitId}`} style={ui.muted}>
          • {new Date(w.wornAt).toLocaleDateString()} ({relativeDay(w.wornAt)})
          {w.outfitId && names.get(w.outfitId) ? ` in “${names.get(w.outfitId)}”` : ''}
        </Text>
      ))}
      {wears.length > SHOWN && <Text style={ui.muted}>and {wears.length - SHOWN} more</Text>}
      {undated > 0 && <Text style={ui.muted}>plus {undated} earlier wear{undated === 1 ? '' : 's'} without a date</Text>}
    </View>
  );
}

const styles = StyleSheet.create({ card: { gap: 4, marginVertical: 12 } });
