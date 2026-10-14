import { useCallback, useState } from 'react';
import { Alert, Image, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import type { Inquiry, Listing, ListingStatus } from '../../api/commerceApi';
import { Button } from '../../components/Button';
import { errorMessage } from '../../lib/errors';
import { useServices } from '../../services/ServicesProvider';
import { colors, ui } from '../../theme';

/** A listing: buyers send an inquiry; the seller sees inquiries and marks it sold. */
export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { commerce, closet, sync } = useServices();
  const [listing, setListing] = useState<Listing | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [message, setMessage] = useState('Hi! Is this still available?');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!commerce) return;
    commerce
      .getListing(id)
      .then((l) => {
        setListing(l);
        if (l.mine) commerce.inquiries(id).then(setInquiries).catch(() => {});
      })
      .catch((e) => Alert.alert('Listing', errorMessage(e)));
  }, [commerce, id]);
  useFocusEffect(load);

  if (!commerce || !listing) return <View style={ui.screen} />;

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      Alert.alert('Listing', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: ListingStatus) =>
    run(status, async () => {
      await commerce.updateListing(listing.id, { status });
      load();
      if (status === 'sold' && listing.client_item_id) {
        const g = await closet.get(listing.client_item_id);
        if (g) {
          Alert.alert('Sold!', 'Remove it from your closet too?', [
            { text: 'Keep it', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => closet.remove(g).then(() => sync.syncAll().catch(() => {})),
            },
          ]);
        }
      }
    });

  return (
    <ScrollView style={ui.screen} contentContainerStyle={styles.content}>
      <View style={[ui.checker, styles.hero]}>
        <Image source={{ uri: listing.image_url }} style={styles.fill} resizeMode="contain" />
      </View>
      <Text style={ui.h1}>{listing.title}</Text>
      <Text style={styles.price}>₹{listing.price_inr.toLocaleString('en-IN')}</Text>
      <Text style={ui.muted}>{[listing.condition, listing.size && `size ${listing.size}`, listing.city].filter(Boolean).join(' · ')}</Text>
      {listing.status !== 'active' && <Text style={{ color: colors.danger, fontWeight: '700' }}>This item is {listing.status}.</Text>}
      {!!listing.description && <Text style={ui.body}>{listing.description}</Text>}

      {listing.mine ? (
        <>
          <Button
            title="Share listing"
            variant="secondary"
            onPress={() => Share.share({ message: `${listing.title} for ₹${listing.price_inr}: ${commerce.shareUrl(listing.id)}` })}
            style={styles.gap}
          />
          {listing.status === 'active' && (
            <>
              <Button title="Mark as sold" busy={busy === 'sold'} onPress={() => setStatus('sold')} style={styles.gap} />
              <Button title="Withdraw listing" variant="secondary" busy={busy === 'withdrawn'} onPress={() => setStatus('withdrawn')} style={styles.gap} />
            </>
          )}
          <Text style={[ui.h2, styles.section]}>Inquiries</Text>
          {inquiries.length === 0 && <Text style={ui.muted}>No messages yet.</Text>}
          {inquiries.map((q) => (
            <View key={q.id} style={[ui.card, styles.inquiry]}>
              <Text style={ui.body}>{q.message}</Text>
              <Text selectable style={[ui.body, { fontWeight: '700' }]}>
                {q.contact}
              </Text>
              <Text style={ui.muted}>{new Date(q.created_at).toLocaleString()}</Text>
            </View>
          ))}
        </>
      ) : (
        listing.status === 'active' && (
          <View style={[ui.card, styles.section, { gap: 6 }]}>
            <Text style={ui.h2}>I&apos;m interested</Text>
            <TextInput value={message} onChangeText={setMessage} maxLength={500} multiline style={styles.input} accessibilityLabel="Message" />
            <TextInput
              value={contact}
              onChangeText={setContact}
              maxLength={120}
              placeholder="Your phone or email, for the seller to reply"
              style={styles.input}
              accessibilityLabel="Your contact"
            />
            <Text style={ui.muted}>Only the seller sees your contact. Meet in a public place and pay on delivery.</Text>
            <Button
              title="Send to seller"
              busy={busy === 'inquire'}
              disabled={contact.trim().length < 3 || !message.trim()}
              onPress={() =>
                run('inquire', async () => {
                  await commerce.inquire(listing.id, message.trim(), contact.trim());
                  Alert.alert('Sent', 'The seller will get in touch with you.');
                  router.back();
                })
              }
            />
          </View>
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 6 },
  hero: { aspectRatio: 1.1, borderRadius: 16, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  price: { fontSize: 22, fontWeight: '800', color: colors.accent },
  gap: { marginTop: 8 },
  section: { marginTop: 18 },
  inquiry: { gap: 4, marginTop: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: colors.text },
});
