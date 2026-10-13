import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../components/Button';
import { OutfitCard } from '../../components/OutfitCard';
import type { Garment } from '../../domain/types';
import { piecesOf, useWardrobe } from '../../features/outfits/useWardrobe';
import { useProfile } from '../../features/profile/ProfileContext';
import { relativeDay } from '../../lib/dates';
import { useServices } from '../../services/ServicesProvider';
import { scoreOutfit, suggestOutfits } from '../../style/outfitSuggestions';
import { ui } from '../../theme';

export default function Outfits() {
  const { closet, outfits: outfitRepo, sync } = useServices();
  const undertone = useProfile().profile?.undertone ?? null;
  const { garments, outfits, reload } = useWardrobe();
  const [busy, setBusy] = useState<string | null>(null);

  // Recomputed when garments change (e.g. after "Wear today"), so suggestions rotate.
  const suggestions = useMemo(() => (garments ? suggestOutfits(garments, undertone, 3) : []), [garments, undertone]);
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
      const outfit = await outfitRepo.create({ name: `Look ${outfits.length + 1}`, itemIds: pieces.map((g) => g.id) });
      sync.syncAll().catch(() => {});
      router.push({ pathname: '/outfit/[id]', params: { id: outfit.id } });
    });

  const wear = (pieces: Garment[], key: string) => run(key, () => closet.markWorn(pieces.map((g) => g.id)));

  if (!garments) return <View style={ui.screen} />;

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <Text style={ui.h2}>Suggested for you</Text>
      <Text style={ui.muted}>Ranked by colour harmony, your {undertone ?? ''} undertone, and what you haven&apos;t worn lately.</Text>
      {suggestions.length === 0 ? (
        <View style={[ui.card, styles.gap]}>
          <Text style={ui.body}>Tag at least one top and one bottom to get outfit suggestions.</Text>
          {untagged > 0 && <Text style={ui.muted}>{untagged} garment(s) in your closet have no category yet. Open one to tag it.</Text>}
        </View>
      ) : (
        suggestions.map((s, i) => {
          const key = s.garments.map((g) => g.id).join('+');
          return (
            <OutfitCard key={key} title={`Option ${i + 1}`} garments={s.garments} score={s.score} style={styles.gap}>
              <View style={styles.actions}>
                <Button title="Wear today" variant="secondary" busy={busy === `w${key}`} onPress={() => wear(s.garments, `w${key}`)} style={styles.flex} />
                <Button title="Save outfit" busy={busy === `s${key}`} onPress={() => save(s.garments, `s${key}`)} style={styles.flex} />
              </View>
            </OutfitCard>
          );
        })
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
            <OutfitCard title={o.name} garments={pieces} score={scoreOutfit(pieces, undertone)} style={styles.gap}>
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
});
