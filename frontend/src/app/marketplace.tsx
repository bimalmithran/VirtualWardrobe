import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import type { Listing } from '../api/commerceApi';
import { Chips } from '../components/Chips';
import { CATEGORIES, CATEGORY_LABELS } from '../domain/types';
import { errorMessage } from '../lib/errors';
import { useServices } from '../services/ServicesProvider';
import { colors, ui } from '../theme';

type Tab = 'browse' | 'mine';
const CATEGORY_FILTERS = [{ key: '', label: 'All' }, ...CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }))];

/** Peer-to-peer resale: browse other people's pre-loved pieces, and manage your listings. */
export default function Marketplace() {
  const { commerce } = useServices();
  const [tab, setTab] = useState<Tab>('browse');
  const [category, setCategory] = useState('');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 2 - 10) / 2;

  const load = useCallback(() => {
    if (!commerce) return;
    setRefreshing(true);
    (tab === 'mine' ? commerce.mine() : commerce.feed(category))
      .then((l) => {
        setListings(l);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setRefreshing(false));
  }, [commerce, tab, category]);
  useFocusEffect(load);

  if (!commerce) return <Text style={[ui.muted, styles.pad]}>The marketplace needs the app&apos;s server, which this build doesn&apos;t have.</Text>;

  return (
    <FlatList
      style={ui.screen}
      data={listings ?? []}
      keyExtractor={(l) => l.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 10 }}
      contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
      ListHeaderComponent={
        <View style={{ gap: 6, marginBottom: 8 }}>
          <Chips
            options={[
              { key: 'browse', label: 'Browse' },
              { key: 'mine', label: 'My listings' },
            ]}
            selected={tab}
            onSelect={setTab}
          />
          {tab === 'browse' && <Chips options={CATEGORY_FILTERS} selected={category} onSelect={setCategory} scroll />}
          {tab === 'mine' && <Text style={ui.muted}>To sell something, open it in your closet and tap “List for sale”.</Text>}
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        </View>
      }
      ListEmptyComponent={listings ? <Text style={ui.muted}>{tab === 'mine' ? 'You have no listings yet.' : 'Nothing listed here yet.'}</Text> : null}
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push({ pathname: '/listing/[id]', params: { id: item.id } })} style={[ui.card, styles.tile, { width: tile }]}>
          <View style={[ui.checker, styles.image]}>
            <Image source={{ uri: item.image_url }} style={styles.fill} resizeMode="contain" />
          </View>
          <Text style={ui.body} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.price}>₹{item.price_inr.toLocaleString('en-IN')}</Text>
          <Text style={ui.muted} numberOfLines={1}>
            {item.mine ? `${item.status}${item.inquiries ? ` · ${item.inquiries} inquir${item.inquiries === 1 ? 'y' : 'ies'}` : ''}` : [item.condition, item.city].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 10 },
  tile: { padding: 8, gap: 2 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', marginBottom: 4 },
  fill: { width: '100%', height: '100%' },
  price: { fontWeight: '800', color: colors.accent, fontSize: 16 },
});
