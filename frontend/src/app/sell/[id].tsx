import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Buffer } from 'buffer';
import { File } from 'expo-file-system';

import type { ListingCondition } from '../../api/commerceApi';
import { ApiError } from '../../api/httpClient';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import type { Garment } from '../../domain/types';
import { useConsent } from '../../features/privacy/ConsentContext';
import { makeThumbnail } from '../../image/pixels';
import { errorMessage } from '../../lib/errors';
import { useServices } from '../../services/ServicesProvider';
import { listingDescription, listingTitle, suggestPrice } from '../../style/resale';
import { colors, ui } from '../../theme';

const CONDITIONS: { key: ListingCondition; label: string }[] = [
  { key: 'new', label: 'New with tags' },
  { key: 'like-new', label: 'Like new' },
  { key: 'good', label: 'Good' },
  { key: 'fair', label: 'Fair' },
];
/** Listing photos are shown large, so they are sharper than backup thumbnails. */
const LISTING_IMAGE_SIDE = 1024;

/** One-tap resale: the cutout and tags the closet already has become a listing. */
export default function Sell() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { closet, commerce, sync } = useServices();
  const { allows } = useConsent();
  const [garment, setGarment] = useState<Garment | null>(null);
  const [condition, setCondition] = useState<ListingCondition>('like-new');
  const [form, setForm] = useState<{ title: string; description: string; price: string; size: string; city: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    closet.get(id).then((g) => {
      if (!g) return;
      setGarment(g);
      setForm({
        title: listingTitle(g),
        description: listingDescription(g),
        price: String(suggestPrice(g, 'like-new') ?? ''),
        size: g.size ?? '',
        city: '',
      });
    });
  }, [closet, id]);

  if (!commerce) return <Text style={[ui.muted, styles.content]}>Selling needs the app&apos;s server, which this build doesn&apos;t have.</Text>;
  if (!allows('cloud_sync')) {
    return (
      <View style={[ui.screen, styles.content]}>
        <Text style={ui.body}>Listing an item publishes its photo and details on our server, which needs cloud backup to be on.</Text>
        <Button title="Open Privacy & data" onPress={() => router.push('/privacy')} style={styles.gap} />
      </View>
    );
  }
  if (!garment || !form) return <View style={ui.screen} />;

  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  const price = Number(form.price);
  const valid = form.title.trim().length >= 3 && price >= 1;

  const publish = async () => {
    setBusy(true);
    try {
      await sync.syncAll(); // the server needs the profile before it accepts a listing
      const png = await new File(garment.imageUri).bytes();
      const listing = await commerce.createListing({
        client_item_id: garment.id,
        title: form.title.trim(),
        description: form.description.trim(),
        price_inr: price,
        condition,
        size: form.size.trim(),
        category: garment.category ?? '',
        color_hex: garment.colorHex,
        city: form.city.trim(),
        image_base64: Buffer.from(makeThumbnail(png, LISTING_IMAGE_SIDE, 90)).toString('base64'),
      });
      router.replace({ pathname: '/listing/[id]', params: { id: listing.id } });
    } catch (e) {
      Alert.alert(
        'Could not list it',
        e instanceof ApiError && e.status === 404 ? 'Your profile has not reached the server yet. Check your connection and try again.' : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[ui.checker, styles.hero]}>
        <Image source={{ uri: garment.imageUri }} style={styles.fill} resizeMode="contain" />
      </View>
      <Field label="Title" value={form.title} onChange={set('title')} max={80} />
      <Text style={styles.label}>Condition</Text>
      <Chips
        options={CONDITIONS}
        selected={condition}
        onSelect={(c) => {
          setCondition(c);
          const p = suggestPrice(garment, c);
          if (p) setForm({ ...form, price: String(p) });
        }}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field label="Price ₹" value={form.price} onChange={(v) => set('price')(v.replace(/[^0-9]/g, ''))} max={7} numeric />
        </View>
        <View style={styles.flex}>
          <Field label="Size" value={form.size} onChange={set('size')} max={20} />
        </View>
      </View>
      {garment.price ? <Text style={ui.muted}>Suggested from what you paid ({`₹${garment.price}`}), its condition and wear.</Text> : null}
      <Field label="City" value={form.city} onChange={set('city')} max={60} />
      <Field label="Description" value={form.description} onChange={set('description')} max={1000} multiline />
      <Text style={[ui.muted, styles.gap]}>
        Buyers see the photo, title, price, condition, size, city and description. They message you through the app; your contact details stay private until you reply.
      </Text>
      <Button title="List for sale" onPress={publish} disabled={!valid} busy={busy} style={styles.gap} />
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; max: number; numeric?: boolean; multiline?: boolean }) {
  return (
    <>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        maxLength={props.max}
        keyboardType={props.numeric ? 'number-pad' : 'default'}
        multiline={props.multiline}
        style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }]}
        accessibilityLabel={props.label}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 4 },
  hero: { aspectRatio: 1.3, borderRadius: 16, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  label: { ...ui.muted, marginTop: 10 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.text, marginTop: 4 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  gap: { marginTop: 12 },
});
