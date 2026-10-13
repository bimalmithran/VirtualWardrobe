import { useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { OutfitCard } from '../../components/OutfitCard';
import { CATEGORIES, CATEGORY_LABELS, EMPTY_TAGS, SUBCATEGORIES, type Category, type Garment } from '../../domain/types';
import { errorMessage } from '../../lib/errors';
import { useServices } from '../../services/ServicesProvider';
import { orphanReason } from '../../style/compatibility';
import { cutFit } from '../../style/cutFit';
import { generateLooks } from '../../style/outfitGenerator';
import { scoreForWearer } from '../../style/personalFit';
import { guessCategory, nearDuplicates, redundancyMessage } from '../../style/redundancy';
import { colors, ui } from '../../theme';
import type { ProcessedGarment } from '../../vision/pipeline';
import { useWardrobe } from '../outfits/useWardrobe';
import { useProfile } from '../profile/ProfileContext';
import { useWearer } from '../self/SelfContext';
import { PersonalMatchCard } from './PersonalMatchCard';

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }));
export const SCAN_ID = 'scan';

/**
 * The in-store assistant's answer for one scanned garment: does it flatter me, do I
 * already own it, what would I wear it with, and can I see it on me.
 */
export function ShopResult({ result, previewUri, onAgain }: { result: ProcessedGarment; previewUri: string; onAgain: () => void }) {
  const { garments } = useWardrobe();
  const { profile } = useProfile();
  const wearer = useWearer();
  const { closet, sync } = useServices();
  const closetItems = useMemo(() => garments ?? [], [garments]);
  const guess = useMemo(() => guessCategory(result.embedding, closetItems), [result.embedding, closetItems]);
  const [picked, setPicked] = useState<{ category: Category | null; subcategory: string | null } | null>(null);
  const category = picked ? picked.category : guess?.category ?? null;
  const subcategory = picked ? picked.subcategory : guess?.subcategory ?? null;
  const [saving, setSaving] = useState(false);

  const scanned: Garment = useMemo(
    () => ({
      id: SCAN_ID,
      imageUri: previewUri,
      colorHex: result.colorHex,
      palette: result.palette,
      embedding: result.embedding,
      createdAt: 0, // not in the closet; nothing reads it
      syncedAt: null,
      category,
      favorite: false,
      wearCount: 0,
      lastWornAt: null,
      photoCount: 1,
      revision: 0,
      ...EMPTY_TAGS,
      subcategory,
      pattern: result.pattern,
      shape: result.shape,
    }),
    [previewUri, result, category, subcategory],
  );

  const colour = scoreForWearer(result.colorHex, wearer);
  const cut = cutFit(category, result.shape, profile);
  const dupes = useMemo(() => nearDuplicates(scanned, closetItems), [scanned, closetItems]);
  const redundancy = redundancyMessage(scanned, dupes);
  const orphan = category ? orphanReason(scanned, closetItems) : null;
  const looks = useMemo(
    () => (category ? generateLooks(closetItems, wearer, { anchor: scanned, limit: 5 }) : []),
    [closetItems, wearer, scanned, category],
  );

  const addToCloset = async () => {
    setSaving(true);
    try {
      const g = await closet.add({ ...result, category });
      if (subcategory) await closet.update(g.id, { subcategory });
      sync.syncAll().catch(() => {});
      Alert.alert('Added to your closet', 'Find it in Closet. Enjoy your new piece!');
    } catch (e) {
      Alert.alert('Could not add it', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const subs = category ? SUBCATEGORIES[category] : [];
  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <View style={[ui.checker, styles.preview]}>
        <Image source={{ uri: previewUri }} style={styles.fill} resizeMode="contain" />
      </View>

      <Text style={ui.h2}>What is it?{guess && !picked ? ' (guessed from your closet)' : ''}</Text>
      <Chips options={CATEGORY_OPTIONS} selected={category} onSelect={(c) => setPicked({ category: c, subcategory: null })} />
      {subs.length > 0 && (
        <Chips
          options={subs.map((s) => ({ key: s.slug, label: s.label }))}
          selected={subcategory}
          onSelect={(s) => setPicked({ category, subcategory: s === subcategory ? null : s })}
        />
      )}

      <PersonalMatchCardSection hex={result.colorHex} colour={colour} cut={cut} />

      {redundancy && (
        <View style={[ui.card, styles.alert]} accessibilityRole="alert">
          <Text style={[ui.h2, { color: colors.warn }]}>You may not need this</Text>
          <Text style={ui.body}>{redundancy}</Text>
          <View style={styles.thumbs}>
            {dupes.slice(0, 4).map((d) => (
              <View key={d.id} style={[ui.checker, styles.thumb]}>
                <Image source={{ uri: d.imageUri }} style={styles.fill} resizeMode="contain" />
              </View>
            ))}
          </View>
        </View>
      )}

      {orphan && (
        <View style={[ui.card, styles.alert]} accessibilityRole="alert">
          <Text style={[ui.h2, { color: colors.warn }]}>It would be an orphan</Text>
          <Text style={ui.body}>{orphan.message} You would need to buy more to wear it.</Text>
        </View>
      )}

      <Text style={[ui.h2, styles.section]}>Wardrobe compatibility</Text>
      {!category ? (
        <Text style={ui.muted}>Pick what it is above to see outfits with your closet.</Text>
      ) : looks.length === 0 ? (
        <Text style={ui.muted}>Nothing in your closet completes an outfit with this yet.</Text>
      ) : (
        <>
          <Text style={ui.muted}>
            {looks.length} outfit{looks.length === 1 ? '' : 's'} from your closet with this piece. Swipe for more.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            {looks.map((l, i) => (
              <OutfitCard key={l.garments.map((g) => g.id).join('+')} title={`Look ${i + 1}`} garments={l.garments} score={l.score} style={styles.look} />
            ))}
          </ScrollView>
        </>
      )}

      <Button
        title="Try it on"
        onPress={() =>
          router.push({
            pathname: '/try-on',
            params: {
              uri: previewUri,
              category: category ?? '',
              subcategory: subcategory ?? '',
              shape: result.shape ? JSON.stringify(result.shape) : '',
            },
          })
        }
        disabled={!category}
        style={styles.section}
      />
      <Button title="I bought it: add to my closet" variant="secondary" onPress={addToCloset} busy={saving} style={styles.gap} />
      <Button title="Scan another" variant="secondary" onPress={onAgain} style={styles.gap} />
    </ScrollView>
  );
}

// Separate so the card stays reusable on the garment page.
function PersonalMatchCardSection(props: Parameters<typeof PersonalMatchCard>[0]) {
  return (
    <View style={styles.gap}>
      <PersonalMatchCard {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  preview: { aspectRatio: 1.2, borderRadius: 16, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  section: { marginTop: 16 },
  gap: { marginTop: 8 },
  alert: { gap: 6, borderColor: colors.warn, marginTop: 8 },
  thumbs: { flexDirection: 'row', gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden' },
  carousel: { gap: 12, paddingVertical: 8 },
  look: { width: 300 },
});
