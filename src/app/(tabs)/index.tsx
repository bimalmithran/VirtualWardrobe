import { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Button } from '../../components/Button';
import { deleteGarment, listGarments, type Garment } from '../../storage/closet';
import { colors, ui } from '../../theme';

const COLUMNS = 3;
const GAP = 8;

export default function Closet() {
  const db = useSQLiteContext();
  const [garments, setGarments] = useState<Garment[] | null>(null);
  const { width } = useWindowDimensions();
  const tile = (width - 16 * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  const load = useCallback(() => {
    listGarments(db).then(setGarments).catch(() => setGarments([]));
  }, [db]);

  useFocusEffect(load);

  const confirmDelete = (g: Garment) =>
    Alert.alert('Remove garment?', 'This deletes the image and its data from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteGarment(db, g).then(load) },
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
      data={garments ?? []}
      keyExtractor={(g) => g.id}
      numColumns={COLUMNS}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={{ gap: GAP }}
      ListHeaderComponent={garments ? <Text style={[ui.muted, styles.count]}>{garments.length} items · long-press to remove</Text> : null}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/garment/[id]', params: { id: item.id } })}
          onLongPress={() => confirmDelete(item)}
          style={[styles.tile, ui.checker, { width: tile, height: tile * 1.2 }]}
        >
          <Image source={{ uri: item.imageUri }} style={styles.image} resizeMode="contain" />
          <View style={[styles.dot, { backgroundColor: item.colorHex }]} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  grid: { padding: 16, gap: GAP },
  count: { marginBottom: 4 },
  tile: { borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  dot: { position: 'absolute', right: 6, bottom: 6, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
});
