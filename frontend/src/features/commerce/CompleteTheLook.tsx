import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import type { AffiliateProduct } from '../../api/commerceApi';
import { errorMessage } from '../../lib/errors';
import { useServices } from '../../services/ServicesProvider';
import type { ShoppingNeed } from '../../style/gaps';
import { colors, ui } from '../../theme';

/**
 * "Complete the look": partner product cards for what an outfit (or an orphan) is missing.
 * Loaded only when the user asks, and always labelled as sponsored.
 */
export function CompleteTheLook({ needs }: { needs: ShoppingNeed[] }) {
  const { commerce } = useServices();
  const [state, setState] = useState<{ products: AffiliateProduct[]; disclosure: string } | 'loading' | string | null>(null);
  if (!commerce || needs.length === 0) return null;

  const load = async () => {
    setState('loading');
    try {
      setState(await commerce.recommend(needs));
    } catch (e) {
      setState(errorMessage(e));
    }
  };

  if (state === null) {
    return (
      <Pressable onPress={load} style={styles.cta} accessibilityRole="button">
        <Text style={styles.ctaText}>🛍 Complete the look: {needs.map((n) => `${n.colour} ${n.subcategory ?? n.category}`.replace(/-/g, ' ')).join(', ')}</Text>
      </Pressable>
    );
  }
  if (state === 'loading') return <ActivityIndicator color={colors.accent} style={styles.gap} />;
  if (typeof state === 'string') return <Text style={[ui.muted, styles.gap]}>{state}</Text>;

  return (
    <View style={styles.gap}>
      {needs.map((need, i) => {
        const items = state.products.filter((p) => p.need_index === i);
        if (items.length === 0) return null;
        return (
          <View key={`${need.category}-${i}`} style={styles.gap}>
            <Text style={ui.body}>{need.why}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {items.map((p) => (
                <Pressable
                  key={p.url}
                  onPress={() => WebBrowser.openBrowserAsync(p.url).catch(() => {})}
                  style={[ui.card, styles.card]}
                  accessibilityRole="link"
                  accessibilityLabel={`${p.title} at ${p.partner_name}, sponsored link`}
                >
                  {p.image_url ? (
                    <Image source={{ uri: p.image_url }} style={styles.image} resizeMode="cover" />
                  ) : (
                    <View style={[styles.image, { backgroundColor: p.color_hex }]} />
                  )}
                  <Text style={ui.body} numberOfLines={2}>
                    {p.title}
                  </Text>
                  <Text style={ui.muted}>
                    {p.partner_name}
                    {p.price_inr ? ` · ₹${p.price_inr.toLocaleString('en-IN')}` : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        );
      })}
      <Text style={styles.disclosure}>{state.disclosure}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 8, gap: 6 },
  cta: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  ctaText: { color: colors.accent, fontWeight: '600' },
  row: { gap: 10, paddingVertical: 4 },
  card: { width: 150, gap: 4, padding: 10 },
  image: { width: '100%', height: 90, borderRadius: 8 },
  disclosure: { ...ui.muted, fontSize: 11 },
});
