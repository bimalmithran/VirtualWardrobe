import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Button } from '../../components/Button';
import { OutfitCard } from '../../components/OutfitCard';
import { Chips } from '../../components/Chips';
import { OCCASIONS, WEATHER, type Garment, type Occasion, type Weather } from '../../domain/types';
import { piecesOf, useWardrobe } from '../../features/outfits/useWardrobe';
import { useWearer } from '../../features/self/SelfContext';
import { relativeDay } from '../../lib/dates';
import { useServices } from '../../services/ServicesProvider';
import { CompleteTheLook } from '../../features/commerce/CompleteTheLook';
import { lookGaps } from '../../style/gaps';
import { currentWeather, generateLooks } from '../../style/outfitGenerator';
import { scoreOutfit } from '../../style/outfitSuggestions';
import { colors, ui } from '../../theme';

const OCCASION_OPTIONS = [{ key: 'any', label: 'Any occasion' }, ...OCCASIONS.map((o) => ({ key: o, label: cap(o) }))];
const WEATHER_OPTIONS = WEATHER.map((w) => ({ key: w, label: cap(w) }));
function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

export default function Outfits() {
  const { closet, outfits: outfitRepo, sync } = useServices();
  const wearer = useWearer();
  const { garments, outfits, reload } = useWardrobe();
  const [busy, setBusy] = useState<string | null>(null);
  const params = useLocalSearchParams<{ anchor?: string }>();
  const [anchorId, setAnchorId] = useState<string | null>(params.anchor ?? null);
  const [occasion, setOccasion] = useState<Occasion | 'any'>('any');
  const [weather, setWeather] = useState<Weather>(() => currentWeather());
  const { width } = useWindowDimensions();

  // Opening the tab from a garment's "Build outfits around this" selects it.
  const [lastParam, setLastParam] = useState(params.anchor);
  if (params.anchor !== lastParam) {
    setLastParam(params.anchor);
    setAnchorId(params.anchor ?? null);
  }

  const anchor = garments?.find((g) => g.id === anchorId);
  const pickable = useMemo(() => (garments ?? []).filter((g) => g.category && g.category !== 'accessories'), [garments]);
  // Recomputed when garments change (e.g. after "Wear today"), so suggestions rotate.
  const looks = useMemo(
    () =>
      garments
        ? generateLooks(garments, wearer, { anchor, occasion: occasion === 'any' ? null : occasion, weather, limit: 5 })
        : [],
    [garments, wearer, anchor, occasion, weather],
  );
  const untagged = garments?.filter((g) => g.category === null).length ?? 0;

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      reload();
    } finally {
      setBusy(null);
    }
  };

  const save = (pieces: Garment[], key: string) =>
    run(key, async () => {
      const name = occasion === 'any' ? `Look ${outfits.length + 1}` : `${cap(occasion)} look ${outfits.length + 1}`;
      const outfit = await outfitRepo.create({ name, itemIds: pieces.map((g) => g.id) });
      sync.syncAll().catch(() => {});
      router.push({ pathname: '/outfit/[id]', params: { id: outfit.id } });
    });

  const wear = (pieces: Garment[], key: string) => run(key, () => closet.markWorn(pieces.map((g) => g.id)));

  if (!garments) return <View style={ui.screen} />;

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Text style={ui.h2}>Today&apos;s outfit</Text>
      <Text style={ui.muted}>Start from a piece you want to wear, or let the closet decide.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.anchors}>
        <Pressable
          onPress={() => setAnchorId(null)}
          style={[styles.anchor, styles.anyAnchor, !anchor && styles.anchorActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: !anchor }}
        >
          <Text style={ui.body}>Any</Text>
        </Pressable>
        {pickable.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => setAnchorId(g.id === anchorId ? null : g.id)}
            style={[ui.checker, styles.anchor, anchorId === g.id && styles.anchorActive]}
            accessibilityRole="button"
            accessibilityLabel={`Build outfits around this ${g.category}`}
            accessibilityState={{ selected: anchorId === g.id }}
          >
            <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
          </Pressable>
        ))}
      </ScrollView>
      <Chips options={OCCASION_OPTIONS} selected={occasion} onSelect={(o) => setOccasion(o as Occasion | 'any')} scroll />
      <Chips options={WEATHER_OPTIONS} selected={weather} onSelect={setWeather} />

      {!wearer.colouring && (
        <Pressable onPress={() => router.push('/me')} style={[ui.card, styles.gap]}>
          <Text style={ui.h2}>Get suggestions for your colouring</Text>
          <Text style={ui.muted}>Add a photo of yourself and the app reads your skin tone and contrast, on this phone only.</Text>
        </Pressable>
      )}
      {looks.length === 0 ? (
        <View style={[ui.card, styles.gap]}>
          <Text style={ui.body}>
            {anchor ? 'Nothing in your closet completes an outfit with this piece yet.' : 'Tag at least one top and one bottom, or an ethnic set, to get outfit suggestions.'}
          </Text>
          {untagged > 0 && <Text style={ui.muted}>{untagged} garment(s) in your closet have no category yet. Open one to tag it.</Text>}
        </View>
      ) : (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.gap} snapToInterval={width - 24} decelerationRate="fast">
          {looks.map((l, i) => {
            const key = l.garments.map((g) => g.id).join('+');
            return (
              <OutfitCard
                key={key}
                title={`Option ${i + 1} of ${looks.length}`}
                garments={l.garments}
                score={l.score}
                style={[styles.slide, { width: width - 40 }]}
                onPressGarment={(g) => router.push({ pathname: '/garment/[id]', params: { id: g.id } })}
              >
                <CompleteTheLook needs={lookGaps(l.garments, wearer, weather)} />
                <View style={styles.actions}>
                  <Button title="Wear today" variant="secondary" busy={busy === `w${key}`} onPress={() => wear(l.garments, `w${key}`)} style={styles.flex} />
                  <Button title="Save outfit" busy={busy === `s${key}`} onPress={() => save(l.garments, `s${key}`)} style={styles.flex} />
                </View>
              </OutfitCard>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.row, styles.section]}>
        <Text style={[ui.h2, styles.flex]}>Your outfits</Text>
        <Button title="Build one" variant="secondary" onPress={() => router.push('/outfit/new')} style={styles.small} />
      </View>
      {outfits.length === 0 && <Text style={ui.muted}>Saved outfits appear here.</Text>}
      {outfits.map((o) => {
        const pieces = piecesOf(o, garments);
        return (
          <Pressable key={o.id} onPress={() => router.push({ pathname: '/outfit/[id]', params: { id: o.id } })}>
            <OutfitCard title={o.name} garments={pieces} score={scoreOutfit(pieces, wearer)} style={styles.gap}>
              <Text style={ui.muted}>{o.lastWornAt ? `Last worn ${relativeDay(o.lastWornAt)}` : 'Not worn yet'}</Text>
            </OutfitCard>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  gap: { marginTop: 12 },
  section: { marginTop: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flex: { flex: 1 },
  small: { paddingVertical: 8 },
  anchors: { gap: 8, paddingVertical: 8 },
  anchor: { width: 64, height: 76, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  anyAnchor: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border },
  anchorActive: { borderColor: colors.accent },
  fill: { width: '100%', height: '100%' },
  slide: { marginRight: 16 },
});
