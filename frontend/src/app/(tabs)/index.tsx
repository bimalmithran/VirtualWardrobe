import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button } from '../../components/Button';
import { Chips, type ChipOption } from '../../components/Chips';
import { CATEGORIES, CATEGORY_LABELS, type Category, type Garment } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';
import { colors, ui } from '../../theme';

const COLUMNS = 3;
const GAP = 8;

type Filter = 'all' | 'favorites' | 'untagged' | Category;

const FILTERS: ChipOption<Filter>[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: '♥ Favourites' },
  ...CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
  { key: 'untagged', label: 'Untagged' },
];

function matches(g: Garment, filter: Filter) {
  switch (filter) {
    case 'all':
      return true;
    case 'favorites':
      return g.favorite;
    case 'untagged':
      return g.category === null;
    default:
      return g.category === filter;
  }
}

export default function Closet() {
  const { closet, sync } = useServices();
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(() => garments?.filter((g) => matches(g, filter)) ?? [], [garments, filter]);
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  const load = useCallback(() => {
    closet.list().then(setGarments).catch(() => setGarments([]));
  }, [closet]);

  useFocusEffect(load);
  useEffect(() => sync.onSynced(load), [sync, load]);

  const confirmDelete = (g: Garment) =>
    Alert.alert('Remove garment?', 'This deletes the image and its data from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          closet.remove(g).then(() => {
            load();
            sync.syncAll().catch(() => {}); // propagate the delete to the server
          }),
      },
    ]);

  if (garments && garments.length === 0) {
    return (
      <View style={[ui.screen, styles.empty]}>
        <Text style={ui.h2}>Your closet is empty</Text>
        <Text style={[ui.muted, { textAlign: 'center', marginVertical: 12 }]}>
          Photograph a garment and it will appear here with its background removed.
        </Text>
        <Button title="Add first garment" onPress={() => router.navigate('/add')} />
      </View>
    );
  }

  return (
    <FlatList
      style={ui.screen}
      data={visible}
      keyExtractor={(g) => g.id}
      numColumns={COLUMNS}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={{ gap: GAP }}
      ListHeaderComponent={
        garments ? (
          <View style={styles.header}>
            <Chips options={FILTERS} selected={filter} onSelect={setFilter} scroll />
            <Text style={[ui.muted, styles.count]}>
              {filter === 'all' ? garments.length : `${visible.length} of ${garments.length}`} items ·{' '}
              {syncLabel(garments, sync.enabled)} · long-press to remove
            </Text>
          </View>
        ) : null
      }
      ListEmptyComponent={garments ? <Text style={[ui.muted, styles.none]}>Nothing matches this filter.</Text> : null}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/garment/[id]', params: { id: item.id } })}
          onLongPress={() => confirmDelete(item)}
          style={[styles.tile, ui.checker, { width: tile, height: tile * 1.2 }]}
        >
          <Image source={{ uri: item.imageUri }} style={styles.image} resizeMode="contain" />
          <View style={[styles.dot, { backgroundColor: item.colorHex }]} />
          {item.favorite && <Ionicons name="heart" size={16} color={colors.danger} style={styles.heart} />}
        </Pressable>
      )}
    />
  );
}

function syncLabel(garments: Garment[], cloudEnabled: boolean) {
  if (!cloudEnabled) return 'on-device only';
  const pending = garments.filter((g) => g.syncedAt === null && g.embedding).length;
  return pending === 0 ? 'all synced' : `${pending} waiting to sync`;
}

const styles = StyleSheet.create({
  grid: { padding: 16, gap: GAP },
  header: { gap: 4, marginBottom: 4 },
  count: { marginBottom: 4 },
  none: { textAlign: 'center', marginTop: 24 },
  heart: { position: 'absolute', left: 6, top: 6 },
  tile: { borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  dot: { position: 'absolute', right: 6, bottom: 6, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
});
