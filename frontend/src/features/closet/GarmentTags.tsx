import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Chips, MultiChips } from '../../components/Chips';
import { OCCASIONS, SUBCATEGORIES, WEATHER, type Garment, type GarmentPatch, type Pattern } from '../../domain/types';
import { colors, ui } from '../../theme';

const PATTERNS: { key: Pattern; label: string }[] = [
  { key: 'solid', label: 'Solid' },
  { key: 'striped', label: 'Striped' },
  { key: 'checked', label: 'Checked' },
  { key: 'printed', label: 'Printed' },
  { key: 'textured', label: 'Textured' },
];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Metadata tags. Pattern comes pre-filled from the photo; everything else is the user's.
 * Text fields save when they lose focus, so typing doesn't queue an upload per keystroke.
 */
export function GarmentTags({ garment, onChange }: { garment: Garment; onChange: (patch: GarmentPatch) => void }) {
  const [brand, setBrand] = useState(garment.brand ?? '');
  const [size, setSize] = useState(garment.size ?? '');
  const [price, setPrice] = useState(garment.price != null ? String(garment.price) : '');
  const subs = garment.category ? SUBCATEGORIES[garment.category] : [];

  return (
    <View style={styles.wrap}>
      {subs.length > 0 && (
        <>
          <Text style={styles.label}>Type</Text>
          <Chips
            options={subs.map((s) => ({ key: s.slug, label: s.label }))}
            selected={garment.subcategory}
            onSelect={(slug) => onChange({ subcategory: slug === garment.subcategory ? null : slug })}
          />
        </>
      )}
      <Text style={styles.label}>Pattern{garment.pattern ? '' : ' (not detected)'}</Text>
      <Chips options={PATTERNS} selected={garment.pattern} onSelect={(pattern) => onChange({ pattern })} />

      <Text style={styles.label}>Occasions</Text>
      <MultiChips options={OCCASIONS.map((o) => ({ key: o, label: cap(o) }))} selected={garment.occasions} onChange={(occasions) => onChange({ occasions })} />

      <Text style={styles.label}>Weather</Text>
      <MultiChips options={WEATHER.map((w) => ({ key: w, label: cap(w) }))} selected={garment.weather} onChange={(weather) => onChange({ weather })} />

      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.label}>Brand</Text>
          <TextInput
            value={brand}
            onChangeText={setBrand}
            onEndEditing={() => brand !== (garment.brand ?? '') && onChange({ brand })}
            placeholder="e.g. Fabindia"
            maxLength={40}
            style={styles.input}
          />
        </View>
        <View style={styles.small}>
          <Text style={styles.label}>Size</Text>
          <TextInput
            value={size}
            onChangeText={setSize}
            onEndEditing={() => size !== (garment.size ?? '') && onChange({ size })}
            placeholder="M / 32"
            maxLength={12}
            autoCapitalize="characters"
            style={styles.input}
          />
        </View>
        <View style={styles.small}>
          <Text style={styles.label}>Price ₹</Text>
          <TextInput
            value={price}
            onChangeText={(v) => setPrice(v.replace(/[^0-9]/g, ''))}
            onEndEditing={() => {
              const n = price === '' ? null : Number(price);
              if (n !== garment.price) onChange({ price: n, purchasedAt: garment.purchasedAt ?? (n ? garment.createdAt : null) });
            }}
            keyboardType="number-pad"
            placeholder="1499"
            maxLength={7}
            style={styles.input}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { ...ui.muted, marginTop: 10 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  small: { width: 90 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: colors.text, marginTop: 4,
  },
});
