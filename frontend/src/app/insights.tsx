import { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { usePremium } from '../billing/PremiumContext';
import { Button } from '../components/Button';
import type { Garment } from '../domain/types';
import { useWardrobe } from '../features/outfits/useWardrobe';
import { costReport, formatInr } from '../style/costPerWear';
import { colors, ui } from '../theme';

/** Premium: wardrobe-wide cost-per-wear analytics. */
export default function Insights() {
  const { premium, upgrade } = usePremium();
  const { garments } = useWardrobe();
  const report = useMemo(() => (garments ? costReport(garments) : null), [garments]);

  if (!premium) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.h1}>Wardrobe insights</Text>
        <Text style={ui.body}>See what you spent, your best-value pieces, and what you paid for but never wear.</Text>
        <Button title="Unlock with Premium" onPress={() => upgrade('Cost-per-wear analytics are a Premium feature.')} style={{ marginTop: 12 }} />
      </View>
    );
  }
  if (!report) return <View style={ui.screen} />;
  if (report.pricedCount === 0) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.body}>Add a price to your garments (open one, then Price ₹) to see cost per wear.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <View style={styles.tiles}>
        <Tile label="Spent" value={formatInr(report.totalSpent)} sub={`${report.pricedCount} priced pieces`} />
        <Tile label="Avg cost per wear" value={report.averageCpw !== null ? formatInr(report.averageCpw) : '—'} sub="across priced pieces" />
      </View>
      <Section title="Best value" items={report.bestValue} />
      <Section title="Costing you the most per wear" items={report.worstValue} />
      {report.idle.length > 0 && (
        <>
          <Text style={[ui.h2, styles.section]}>Not worn in 90 days</Text>
          <Text style={ui.muted}>
            {report.idle.length} piece{report.idle.length === 1 ? '' : 's'} worth {formatInr(report.idle.reduce((s, g) => s + (g.price ?? 0), 0))}. Wear them, or list them for sale.
          </Text>
          <View style={styles.grid}>
            {report.idle.map((g) => (
              <Thumb key={g.id} g={g} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={[ui.card, styles.tile]}>
      <Text style={ui.muted}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={ui.muted}>{sub}</Text>
    </View>
  );
}

function Section({ title, items }: { title: string; items: { garment: Garment; cpw: number }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <Text style={[ui.h2, styles.section]}>{title}</Text>
      {items.map(({ garment, cpw }) => (
        <Pressable key={garment.id} onPress={() => router.push({ pathname: '/garment/[id]', params: { id: garment.id } })} style={[ui.card, styles.line]}>
          <Thumb g={garment} />
          <Text style={[ui.body, { flex: 1 }]}>
            {formatInr(cpw)} per wear · worn {garment.wearCount}× · paid {formatInr(garment.price!)}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

function Thumb({ g }: { g: Garment }) {
  return (
    <View style={[ui.checker, styles.thumb]}>
      <Image source={{ uri: g.imageUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 8 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, gap: 2 },
  value: { fontSize: 22, fontWeight: '800', color: colors.text },
  section: { marginTop: 16 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  thumb: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
