import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button } from '../../components/Button';
import { Chips, type ChipOption } from '../../components/Chips';
import { CATEGORIES, CATEGORY_LABELS, type Category, type Garment } from '../../domain/types';
import { useServices } from '../../services/ServicesProvider';
import { findOrphans } from '../../style/compatibility';
import { colors, ui } from '../../theme';

const COLUMNS = 3;
const GAP = 8;

type Filter = 'all' | 'favorites' | 'untagged' | 'orphans' | Category;

const FILTERS: ChipOption<Filter>[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: '♥ Favourites' },
  ...CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
  { key: 'untagged', label: 'Untagged' },
  { key: 'orphans', label: '⚠ Orphans' },
];

function matches(g: Garment, filter: Filter, orphans: Map<string, unknown>) {
  switch (filter) {
    case 'orphans':
      return orphans.has(g.id);
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
  const orphans = useMemo(() => findOrphans(garments ?? []), [garments]);
  const visible = useMemo(() => garments?.filter((g) => matches(g, filter, orphans)) ?? [], [garments, filter, orphans]);
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  // Non-null while selecting: long-press starts it, then taps toggle garments in and out.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    closet.list().then(setGarments).catch(() => setGarments([]));
  }, [closet]);

  useFocusEffect(load);
  useEffect(() => sync.onSynced(load), [sync, load]);

  // Leaving the tab ends selection; while selecting, Android back ends it instead of navigating.
  useFocusEffect(
    useCallback(() => {
      if (!selected) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setSelected(null);
        return true;
      });
      return () => sub.remove();
    }, [selected]),
  );
  useFocusEffect(useCallback(() => () => setSelected(null), []));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = !!selected && visible.length > 0 && visible.every((g) => selected.has(g.id));

  const confirmDelete = () => {
    const doomed = (garments ?? []).filter((g) => selected?.has(g.id));
    if (doomed.length === 0) return;
    const one = doomed.length === 1;
    Alert.alert(
      one ? 'Remove garment?' : `Remove ${doomed.length} garments?`,
      `This deletes ${one ? 'the image and its data' : 'their images and data'} from this device${sync.enabled ? ' and your backup' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              // One at a time: each removal also rewrites the outfits that used the garment.
              for (const g of doomed) await closet.remove(g).catch(() => {});
            } finally {
              setDeleting(false);
              setSelected(null);
              load();
              sync.syncAll().catch(() => {}); // propagate the deletes to the server
            }
          },
        },
      ],
    );
  };

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
    <View style={ui.screen}>
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
              {selected ? (
                <View style={styles.selectBar}>
                  <Text style={[ui.body, styles.selectCount]}>{selected.size} selected</Text>
                  <Pressable
                    onPress={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((g) => g.id)))}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.selectAction}>{allVisibleSelected ? 'Select none' : 'Select all'}</Text>
                  </Pressable>
                  <Pressable onPress={() => setSelected(null)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.selectAction}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={[ui.muted, styles.count]}>
                  {filter === 'all' ? garments.length : `${visible.length} of ${garments.length}`} items ·{' '}
                  {syncLabel(garments, sync.enabled)} · long-press to select
                </Text>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={garments ? <Text style={[ui.muted, styles.none]}>Nothing matches this filter.</Text> : null}
        renderItem={({ item }) => {
          const isSelected = !!selected?.has(item.id);
          return (
            <Pressable
              onPress={() => (selected ? toggle(item.id) : router.push({ pathname: '/garment/[id]', params: { id: item.id } }))}
              onLongPress={() => (selected ? toggle(item.id) : setSelected(new Set([item.id])))}
              accessibilityState={selected ? { selected: isSelected } : undefined}
              style={[styles.tile, ui.checker, { width: tile, height: tile * 1.2 }]}
            >
              <Image source={{ uri: item.imageUri }} style={styles.image} resizeMode="contain" />
              <View style={[styles.dot, { backgroundColor: item.colorHex }]} />
              {item.favorite && <Ionicons name="heart" size={16} color={colors.danger} style={styles.heart} />}
              {orphans.has(item.id) && (
                <Ionicons name="alert-circle" size={16} color={colors.warn} style={styles.orphan} accessibilityLabel="Orphan item" />
              )}
              {/* An overlay, not a border on the tile: toggling a border on a clipping view with
                  rounded corners left Android drawing the tile's contents blank afterwards. */}
              {isSelected && <View style={styles.selectedRing} pointerEvents="none" />}
              {selected && (
                <Ionicons
                  name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={isSelected ? colors.accent : colors.muted}
                  style={styles.check}
                />
              )}
            </Pressable>
          );
        }}
      />
      {selected && (
        <View style={styles.actionBar}>
          <Button
            title={selected.size > 0 ? `Delete (${selected.size})` : 'Select garments to delete'}
            onPress={confirmDelete}
            busy={deleting}
            disabled={selected.size === 0}
            style={styles.deleteButton}
          />
        </View>
      )}
    </View>
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
  orphan: { position: 'absolute', right: 6, top: 6 },
  tile: { borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  dot: { position: 'absolute', right: 6, bottom: 6, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.surface },
  selectedRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, borderWidth: 3, borderColor: colors.accent },
  check: { position: 'absolute', left: 6, bottom: 6, backgroundColor: colors.surface, borderRadius: 12 },
  selectBar: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 4, marginBottom: 4 },
  selectCount: { flex: 1, fontWeight: '600' },
  selectAction: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  actionBar: { padding: 16, paddingTop: 8, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  deleteButton: { backgroundColor: colors.danger },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
});
