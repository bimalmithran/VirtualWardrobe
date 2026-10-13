import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button } from '../../components/Button';
import { OutfitCard } from '../../components/OutfitCard';
import { CATEGORIES, CATEGORY_LABELS, type Garment } from '../../domain/types';
import { useWardrobe } from '../../features/outfits/useWardrobe';
import { useWearer } from '../../features/self/SelfContext';
import { useServices } from '../../services/ServicesProvider';
import { scoreOutfit } from '../../style/outfitSuggestions';
import { colors, ui } from '../../theme';

const COLUMNS = 4;
const GAP = 8;
const MAX_ITEMS = 12; // matches the server's MaxOutfitItems

/** Pick garments, watch the score update, save. Grouped by category in outfit order. */
export default function NewOutfit() {
  const { outfits, sync } = useServices();
  const wearer = useWearer();
  const { garments } = useWardrobe();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  const groups = useMemo(() => {
    const all = garments ?? [];
    return [
      ...CATEGORIES.map((c) => ({ title: CATEGORY_LABELS[c], items: all.filter((g) => g.category === c) })),
      { title: 'Untagged', items: all.filter((g) => g.category === null) },
    ].filter((g) => g.items.length > 0);
  }, [garments]);

  const pieces = useMemo(() => {
    const byId = new Map((garments ?? []).map((g) => [g.id, g]));
    // Display in category order (top, bottom, layer, shoes, accessories), not tap order.
    const rank = (g: Garment) => (g.category ? CATEGORIES.indexOf(g.category) : CATEGORIES.length);
    return selected
      .map((id) => byId.get(id))
      .filter((g): g is Garment => !!g)
      .sort((a, b) => rank(a) - rank(b));
  }, [garments, selected]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_ITEMS ? [...s, id] : s));

  const save = async () => {
    setSaving(true);
    try {
      const outfit = await outfits.create({ name: name || `Look ${new Date().toLocaleDateString()}`, itemIds: pieces.map((g) => g.id) });
      sync.syncAll().catch(() => {});
      router.replace({ pathname: '/outfit/[id]', params: { id: outfit.id } });
    } finally {
      setSaving(false);
    }
  };

  if (!garments) return <View style={ui.screen} />;
  if (garments.length === 0) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.muted}>Add garments to your closet first.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextInput value={name} onChangeText={setName} placeholder="Outfit name (optional)" placeholderTextColor={colors.muted} maxLength={80} style={styles.input} />

      {pieces.length > 0 ? (
        <OutfitCard garments={pieces} score={scoreOutfit(pieces, wearer)} style={styles.gap} />
      ) : (
        <Text style={[ui.muted, styles.gap]}>Tap garments below to build an outfit.</Text>
      )}

      {groups.map((group) => (
        <View key={group.title} style={styles.gap}>
          <Text style={[ui.h2, styles.groupTitle]}>{group.title}</Text>
          <View style={styles.grid}>
            {group.items.map((g) => {
              const on = selected.includes(g.id);
              return (
                <Pressable
                  key={g.id}
                  onPress={() => toggle(g.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[ui.checker, styles.tile, { width: tile, height: tile }, on && styles.tileOn]}
                >
                  <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
                  {on && <Ionicons name="checkmark-circle" size={22} color={colors.accent} style={styles.check} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <Button title="Save outfit" busy={saving} disabled={pieces.length === 0} onPress={save} style={styles.save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: colors.text,
  },
  gap: { marginTop: 16 },
  groupTitle: { marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  tileOn: { borderColor: colors.accent },
  fill: { width: '100%', height: '100%' },
  check: { position: 'absolute', right: 2, top: 2 },
  save: { marginTop: 24 },
});
