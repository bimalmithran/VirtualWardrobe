import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import {
  EMPTY_PROPORTIONS,
  type BodyShape,
  type DigitalTwin,
  type DigitalTwinInput,
  type Proportions,
  type SubSeason,
  type Torso,
  type Undertone,
} from '../domain/types';
import { useI18n } from '../i18n/I18nProvider';
import type { StringKey } from '../i18n/en';
import { inferBodyShape } from '../style/bodyShape';
import { SUB_SEASONS, SUB_SEASON_ORDER } from '../style/seasons';
import { colors, ui } from '../theme';
import { Button } from './Button';
import { Chips } from './Chips';

const SHAPES: { value: BodyShape; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'triangle', label: 'Triangle (pear)' },
  { value: 'inverted-triangle', label: 'Inverted triangle' },
  { value: 'hourglass', label: 'Hourglass' },
  { value: 'oval', label: 'Oval (apple)' },
];
const shapeLabel = (s: BodyShape) => SHAPES.find((x) => x.value === s)!.label;

const UNDERTONES: { value: Undertone; label: string; hint: string; swatch: string }[] = [
  { value: 'warm', label: 'Warm', hint: 'Wrist veins look greenish; gold jewellery flatters you.', swatch: '#D9A066' },
  { value: 'cool', label: 'Cool', hint: 'Wrist veins look blue or purple; silver flatters you.', swatch: '#C9A3B8' },
  { value: 'neutral', label: 'Neutral', hint: 'A mix of both, or hard to tell.', swatch: '#C8B4A0' },
];

const MEASUREMENTS: { key: keyof Omit<Proportions, 'torso'>; label: StringKey; min: number; max: number }[] = [
  { key: 'shoulderCm', label: 'twin.shoulder', min: 25, max: 80 },
  { key: 'bustCm', label: 'twin.bust', min: 50, max: 200 },
  { key: 'waistCm', label: 'twin.waist', min: 40, max: 200 },
  { key: 'hipCm', label: 'twin.hip', min: 50, max: 200 },
];

const TORSOS: Torso[] = ['short', 'balanced', 'long'];

interface Props {
  initial?: DigitalTwin | null;
  submitLabel: string;
  onSubmit: (profile: DigitalTwinInput) => Promise<void>;
  /** Whether the profile is also backed up to the cloud, for the storage note. */
  cloudBackup?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
}

type MeasureText = Record<(typeof MEASUREMENTS)[number]['key'], string>;

export function DigitalTwinForm({ initial, submitLabel, onSubmit, cloudBackup = false, header, footer }: Props) {
  const { t } = useI18n();
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [bodyShape, setBodyShape] = useState<BodyShape | null>(initial?.bodyShape ?? null);
  const [undertone, setUndertone] = useState<Undertone | null>(initial?.undertone ?? null);
  const start = initial?.proportions ?? EMPTY_PROPORTIONS;
  const [measures, setMeasures] = useState<MeasureText>(() => ({
    shoulderCm: start.shoulderCm ? String(start.shoulderCm) : '',
    bustCm: start.bustCm ? String(start.bustCm) : '',
    waistCm: start.waistCm ? String(start.waistCm) : '',
    hipCm: start.hipCm ? String(start.hipCm) : '',
  }));
  const [torso, setTorso] = useState<Torso | null>(start.torso);
  const [season, setSeason] = useState<SubSeason | null>(initial?.season ?? null);
  const [saving, setSaving] = useState(false);

  const heightCm = Number(height);
  const heightValid = Number.isFinite(heightCm) && heightCm >= 120 && heightCm <= 230;
  const parsed = MEASUREMENTS.map((m) => {
    const raw = measures[m.key];
    const n = raw === '' ? null : Number(raw);
    return { ...m, value: n, valid: n === null || (n >= m.min && n <= m.max) };
  });
  const measuresValid = parsed.every((m) => m.valid);
  const proportions: Proportions = {
    ...Object.fromEntries(parsed.map((m) => [m.key, m.valid ? m.value : null])),
    torso,
  } as Proportions;
  const suggested = inferBodyShape(proportions);
  const valid = heightValid && measuresValid && bodyShape && undertone;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSubmit({ heightCm: Math.round(heightCm), bodyShape, undertone, proportions, season });
    } catch (e) {
      Alert.alert('Could not save profile', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {header}
      <Text style={ui.h2}>{t('twin.height')}</Text>
      <View style={styles.row}>
        <TextInput
          value={height}
          onChangeText={(v) => setHeight(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="170"
          maxLength={3}
          style={styles.input}
          accessibilityLabel={t('twin.height')}
        />
        <Text style={ui.body}>cm</Text>
      </View>
      {height.length > 0 && !heightValid && <Text style={styles.error}>{t('twin.heightError')}</Text>}

      <Text style={[ui.h2, styles.section]}>{t('twin.bodyShape')}</Text>
      <Chips options={SHAPES.map((s) => ({ key: s.value, label: s.label }))} selected={bodyShape} onSelect={setBodyShape} />

      <Text style={[ui.h2, styles.section]}>{t('twin.proportions')}</Text>
      <Text style={ui.muted}>{t('twin.proportionsHint')}</Text>
      <View style={styles.grid}>
        {parsed.map((m) => (
          <View key={m.key} style={styles.cell}>
            <Text style={ui.muted}>{t(m.label)}</Text>
            <TextInput
              value={measures[m.key]}
              onChangeText={(v) => setMeasures((prev) => ({ ...prev, [m.key]: v.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              placeholder="cm"
              maxLength={3}
              style={[styles.input, styles.measure, !m.valid && styles.inputError]}
              accessibilityLabel={`${t(m.label)} (cm)`}
            />
          </View>
        ))}
      </View>
      {!measuresValid && <Text style={styles.error}>Check the highlighted measurements.</Text>}
      {suggested && suggested !== bodyShape && (
        <View style={[ui.card, styles.suggest]}>
          <Text style={[ui.body, styles.flex]}>{t('twin.suggestShape', { shape: shapeLabel(suggested) })}</Text>
          <Button title={t('twin.useShape')} variant="secondary" onPress={() => setBodyShape(suggested)} />
        </View>
      )}
      <Text style={[ui.muted, styles.label]}>{t('twin.torso')}</Text>
      <Chips
        options={TORSOS.map((x) => ({ key: x, label: t(`twin.torso.${x}`) }))}
        selected={torso}
        onSelect={(x) => setTorso(x === torso ? null : x)}
      />

      <Text style={[ui.h2, styles.section]}>{t('twin.undertone')}</Text>
      {UNDERTONES.map((u) => (
        <Pressable
          key={u.value}
          onPress={() => setUndertone(u.value)}
          accessibilityRole="radio"
          accessibilityState={{ selected: undertone === u.value }}
          style={[ui.card, styles.undertone, undertone === u.value && styles.active]}
        >
          <View style={[styles.swatch, { backgroundColor: u.swatch }]} />
          <View style={styles.flex}>
            <Text style={ui.h2}>{u.label}</Text>
            <Text style={ui.muted}>{u.hint}</Text>
          </View>
        </Pressable>
      ))}

      <Text style={[ui.h2, styles.section]}>{t('twin.season')}</Text>
      <Text style={ui.muted}>{t('twin.seasonHint')}</Text>
      <Pressable
        onPress={() => setSeason(null)}
        accessibilityRole="radio"
        accessibilityState={{ selected: season === null }}
        style={[ui.card, styles.seasonRow, season === null && styles.active]}
      >
        <Text style={[ui.body, styles.flex]}>{t('twin.seasonAuto')}</Text>
        <Text style={styles.link} onPress={() => router.push('/me')}>
          ›
        </Text>
      </Pressable>
      {SUB_SEASON_ORDER.map((key) => {
        const info = SUB_SEASONS[key];
        const active = season === key;
        return (
          <Pressable
            key={key}
            onPress={() => setSeason(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[ui.card, styles.seasonRow, active && styles.active]}
          >
            <View style={styles.flex}>
              <Text style={ui.body}>{info.label}</Text>
              <Text style={ui.muted}>{info.traits}</Text>
            </View>
            <View style={styles.palette}>
              {info.palette.slice(0, 5).map((hex) => (
                <View key={hex} style={[styles.dot, { backgroundColor: hex }]} />
              ))}
            </View>
          </Pressable>
        );
      })}

      <Text style={[ui.muted, styles.section]}>
        {t('twin.storedLocally', { sync: cloudBackup ? t('twin.storedSync') : '' })}
      </Text>
      <Button title={submitLabel} onPress={submit} disabled={!valid} busy={saving} style={styles.submit} />
      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  section: { marginTop: 24, marginBottom: 4 },
  label: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 18, width: 110, color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  measure: { width: '100%', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  cell: { width: '47%' },
  error: { color: colors.danger, marginTop: 6 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  flex: { flex: 1 },
  undertone: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  active: { borderColor: colors.accent, borderWidth: 2 },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingVertical: 12 },
  palette: { flexDirection: 'row', gap: 3 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  link: { fontSize: 22, color: colors.accent, paddingHorizontal: 8 },
  submit: { marginTop: 16 },
});
