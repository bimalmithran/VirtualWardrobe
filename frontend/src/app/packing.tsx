import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { usePremium } from '../billing/PremiumContext';
import { Button } from '../components/Button';
import { Chips, MultiChips } from '../components/Chips';
import { OCCASIONS, WEATHER, type Occasion, type Weather } from '../domain/types';
import { useWardrobe } from '../features/outfits/useWardrobe';
import { useWearer } from '../features/self/SelfContext';
import { currentWeather } from '../style/outfitGenerator';
import { planPacking } from '../style/packing';
import { colors, ui } from '../theme';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Premium: a capsule packing list and a day-by-day outfit plan from the user's closet. */
export default function Packing() {
  const { premium, upgrade } = usePremium();
  const { garments } = useWardrobe();
  const wearer = useWearer();
  const [days, setDays] = useState('4');
  const [weather, setWeather] = useState<Weather>(() => currentWeather());
  const [occasions, setOccasions] = useState<Occasion[]>(['casual']);
  const [laundry, setLaundry] = useState(false);
  const [packed, setPacked] = useState<Set<string>>(new Set());
  const n = Math.max(1, Math.min(30, Number(days) || 1));
  const plan = useMemo(
    () => (premium && garments ? planPacking(garments, wearer, { days: n, weather, occasions, laundry }) : null),
    [premium, garments, wearer, n, weather, occasions, laundry],
  );

  if (!premium) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.h1}>Packing lists</Text>
        <Text style={ui.body}>
          Tell us how long you&apos;re away and what you&apos;re doing, and get a small capsule from your closet that makes a different outfit every day.
        </Text>
        <Button title="Unlock with Premium" onPress={() => upgrade('Packing lists are a Premium feature.')} style={styles.gap} />
      </View>
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <Text style={ui.h2}>Days</Text>
        <TextInput value={days} onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={2} style={styles.input} />
        <Text style={[ui.body, styles.flex]}>Laundry on the trip</Text>
        <Switch value={laundry} onValueChange={setLaundry} trackColor={{ true: colors.accent, false: colors.border }} />
      </View>
      <Text style={ui.muted}>Weather</Text>
      <Chips options={WEATHER.map((w) => ({ key: w, label: cap(w) }))} selected={weather} onSelect={setWeather} />
      <Text style={ui.muted}>Occasions (one per day, in order)</Text>
      <MultiChips options={OCCASIONS.map((o) => ({ key: o, label: cap(o) }))} selected={occasions} onChange={setOccasions} />

      {plan && (
        <>
          <Text style={[ui.h2, styles.section]}>
            Pack {plan.pieces.length} pieces · {packed.size} done
          </Text>
          {plan.pieces.map((g) => {
            const done = packed.has(g.id);
            return (
              <Pressable
                key={g.id}
                onPress={() => setPacked((s) => { const next = new Set(s); if (done) next.delete(g.id); else next.add(g.id); return next; })}
                style={[ui.card, styles.item]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
              >
                <Ionicons name={done ? 'checkbox' : 'square-outline'} size={24} color={done ? colors.accent : colors.muted} />
                <View style={[ui.checker, styles.thumb]}>
                  <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
                </View>
                <Text style={[ui.body, styles.flex, done && styles.struck]}>{cap(g.subcategory ?? g.category ?? 'piece').replace(/-/g, ' ')}</Text>
              </Pressable>
            );
          })}
          {plan.notes.map((note) => (
            <Text key={note} style={[ui.body, { color: colors.warn }]}>• {note}</Text>
          ))}
          <Text style={[ui.h2, styles.section]}>Day by day</Text>
          {plan.schedule.map((s) => (
            <Pressable
              key={s.day}
              style={[ui.card, styles.day]}
              onPress={() => router.push({ pathname: '/look', params: { ids: s.look.garments.map((g) => g.id).join(','), title: `Day ${s.day}` } })}
            >
              <Text style={ui.h2}>
                Day {s.day} · {cap(s.occasion)}
              </Text>
              <View style={styles.row}>
                {s.look.garments.map((g) => (
                  <View key={g.id} style={[ui.checker, styles.thumb]}>
                    <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
                  </View>
                ))}
              </View>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, width: 56, fontSize: 16, color: colors.text },
  section: { marginTop: 16 },
  gap: { marginTop: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  thumb: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  day: { gap: 8 },
});
