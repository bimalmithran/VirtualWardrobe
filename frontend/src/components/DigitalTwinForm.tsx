import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { BodyShape, DigitalTwin, Undertone } from '../storage/profile';
import { colors, ui } from '../theme';
import { Button } from './Button';

const SHAPES: { value: BodyShape; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'triangle', label: 'Triangle (pear)' },
  { value: 'inverted-triangle', label: 'Inverted triangle' },
  { value: 'hourglass', label: 'Hourglass' },
  { value: 'oval', label: 'Oval (apple)' },
];

const UNDERTONES: { value: Undertone; label: string; hint: string; swatch: string }[] = [
  { value: 'warm', label: 'Warm', hint: 'Wrist veins look greenish; gold jewellery flatters you.', swatch: '#D9A066' },
  { value: 'cool', label: 'Cool', hint: 'Wrist veins look blue or purple; silver flatters you.', swatch: '#C9A3B8' },
  { value: 'neutral', label: 'Neutral', hint: 'A mix of both, or hard to tell.', swatch: '#C8B4A0' },
];

interface Props {
  initial?: DigitalTwin | null;
  submitLabel: string;
  onSubmit: (profile: Omit<DigitalTwin, 'updatedAt'>) => Promise<void>;
  footer?: ReactNode;
}

export function DigitalTwinForm({ initial, submitLabel, onSubmit, footer }: Props) {
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [bodyShape, setBodyShape] = useState<BodyShape | null>(initial?.bodyShape ?? null);
  const [undertone, setUndertone] = useState<Undertone | null>(initial?.undertone ?? null);
  const [saving, setSaving] = useState(false);

  const heightCm = Number(height);
  const heightValid = Number.isFinite(heightCm) && heightCm >= 120 && heightCm <= 230;
  const valid = heightValid && bodyShape && undertone;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSubmit({ heightCm: Math.round(heightCm), bodyShape, undertone });
    } catch (e) {
      Alert.alert('Could not save profile', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={ui.h2}>Height</Text>
      <View style={styles.heightRow}>
        <TextInput
          value={height}
          onChangeText={(t) => setHeight(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="170"
          maxLength={3}
          style={styles.input}
        />
        <Text style={ui.body}>cm</Text>
      </View>
      {height.length > 0 && !heightValid && <Text style={styles.error}>Enter a height between 120 and 230 cm.</Text>}

      <Text style={[ui.h2, styles.section]}>Body shape</Text>
      <View style={styles.chips}>
        {SHAPES.map((s) => (
          <Pressable
            key={s.value}
            onPress={() => setBodyShape(s.value)}
            style={[styles.chip, bodyShape === s.value && styles.chipActive]}
          >
            <Text style={[styles.chipText, bodyShape === s.value && styles.chipTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[ui.h2, styles.section]}>Skin undertone</Text>
      {UNDERTONES.map((u) => (
        <Pressable
          key={u.value}
          onPress={() => setUndertone(u.value)}
          style={[ui.card, styles.undertone, undertone === u.value && styles.undertoneActive]}
        >
          <View style={[styles.swatch, { backgroundColor: u.swatch }]} />
          <View style={{ flex: 1 }}>
            <Text style={ui.h2}>{u.label}</Text>
            <Text style={ui.muted}>{u.hint}</Text>
          </View>
        </Pressable>
      ))}

      <Text style={[ui.muted, styles.section]}>Stored only on this device.</Text>
      <Button title={submitLabel} onPress={submit} disabled={!valid} busy={saving} style={styles.submit} />
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  section: { marginTop: 24 },
  heightRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 18, width: 110, color: colors.text,
  },
  error: { color: colors.danger, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.accentText, fontWeight: '600' },
  undertone: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  undertoneActive: { borderColor: colors.accent, borderWidth: 2 },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  submit: { marginTop: 16 },
});
