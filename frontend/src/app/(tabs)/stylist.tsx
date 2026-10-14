import { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { usePremium } from '../../billing/PremiumContext';
import type { Garment } from '../../domain/types';
import { useWardrobe } from '../../features/outfits/useWardrobe';
import { useConsent } from '../../features/privacy/ConsentContext';
import { useProfile } from '../../features/profile/ProfileContext';
import { useWearer } from '../../features/self/SelfContext';
import { useStylistChat } from '../../features/stylist/useStylistChat';
import { useI18n } from '../../i18n/I18nProvider';
import { useServices } from '../../services/ServicesProvider';
import type { ChatCard } from '../../storage/chatRepository';
import { colors, ui } from '../../theme';

const STARTERS = [
  'What should I wear to a rainy dinner tonight?',
  'Office tomorrow, something smart but comfortable',
  'A festive look for Diwali',
  'What goes with my favourite piece?',
];

/** Conversational styling: streamed replies with tap-to-view outfit cards from the closet. */
export default function Stylist() {
  const { garments } = useWardrobe();
  const wearer = useWearer();
  const { profile } = useProfile();
  const { history, streaming, error, quotaHit, send, stop, clear, cloud } = useStylistChat(garments, wearer, profile);
  const { upgrade } = usePremium();
  const { stylist } = useServices();
  const { record, decide } = useConsent();
  const { language } = useI18n();
  const [input, setInput] = useState('');
  const scroll = useRef<ScrollView>(null);
  const byId = new Map((garments ?? []).map((g) => [g.id, g]));

  const submit = (text = input) => {
    if (!text.trim()) return;
    setInput('');
    send(text);
  };

  const enableAi = () => record && decide({ ...record.purposes, ai_stylist: true }, language);

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {!cloud && (
          <View style={[ui.card, styles.notice]}>
            <Text style={ui.body}>
              {stylist
                ? 'You are chatting with the basic stylist, which runs on this device. The AI stylist understands any question; it sends a text summary of your closet (no photos) to our AI provider.'
                : 'You are chatting with the basic stylist, which runs on this device.'}
            </Text>
            {stylist && <Text style={styles.link} onPress={enableAi} accessibilityRole="button">Turn on the AI stylist</Text>}
          </View>
        )}
        {history.length === 0 && !streaming && (
          <View style={styles.starters}>
            <Text style={ui.h2}>Ask your stylist</Text>
            {STARTERS.map((s) => (
              <Pressable key={s} onPress={() => submit(s)} style={[ui.card, styles.starter]} accessibilityRole="button">
                <Text style={ui.body}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {history.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.text} cards={m.cards} byId={byId} />
        ))}
        {streaming && <Bubble role="assistant" text={streaming.text || '…'} cards={streaming.cards} byId={byId} live />}
        {error && <Text style={styles.error}>{error}</Text>}
        {quotaHit && (
          <Text style={styles.link} onPress={() => upgrade('Unlimited AI stylist chats are a Premium feature.')} accessibilityRole="button">
            See Premium
          </Text>
        )}
        {history.length > 0 && !streaming && (
          <Text style={styles.clear} onPress={clear} accessibilityRole="button">
            Clear conversation
          </Text>
        )}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about an outfit…"
          style={styles.input}
          multiline
          maxLength={2000}
          onSubmitEditing={() => submit()}
          accessibilityLabel="Message to the stylist"
        />
        {streaming ? (
          <Pressable onPress={stop} style={styles.send} accessibilityLabel="Stop">
            <Ionicons name="stop-circle" size={34} color={colors.danger} />
          </Pressable>
        ) : (
          <Pressable onPress={() => submit()} disabled={!input.trim()} style={styles.send} accessibilityLabel="Send">
            <Ionicons name="arrow-up-circle" size={34} color={input.trim() ? colors.accent : colors.border} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ role, text, cards, byId, live }: { role: 'user' | 'assistant'; text: string; cards: ChatCard[]; byId: Map<string, Garment>; live?: boolean }) {
  const mine = role === 'user';
  return (
    <View style={[styles.bubbleRow, mine && styles.mineRow]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]} accessibilityLiveRegion={live ? 'polite' : undefined}>
        {cards.map((c, i) => (
          <Pressable
            key={`${c.title}-${i}`}
            onPress={() => router.push({ pathname: '/look', params: { ids: c.itemIds.join(','), title: c.title } })}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Outfit: ${c.title}. Tap to view.`}
          >
            <Text style={ui.h2}>{c.title}</Text>
            <View style={styles.thumbs}>
              {c.itemIds.map((id) => {
                const g = byId.get(id);
                return g ? (
                  <View key={id} style={[ui.checker, styles.thumb]}>
                    <Image source={{ uri: g.imageUri }} style={styles.fill} resizeMode="contain" />
                  </View>
                ) : null;
              })}
            </View>
            {!!c.reason && <Text style={ui.muted}>{c.reason}</Text>}
          </Pressable>
        ))}
        {!!text && <Text style={[ui.body, mine && { color: colors.accentText }]}>{text}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  notice: { gap: 6 },
  link: { color: colors.accent, fontWeight: '700', paddingVertical: 4 },
  starters: { gap: 8 },
  starter: { paddingVertical: 12 },
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '88%', borderRadius: 16, padding: 12, gap: 8 },
  mine: { backgroundColor: colors.accent },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  card: { gap: 6, padding: 10, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  thumbs: { flexDirection: 'row', gap: 6 },
  thumb: { width: 60, height: 60, borderRadius: 8, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  error: { color: colors.danger },
  clear: { ...ui.muted, textAlign: 'center', paddingVertical: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 120, fontSize: 16, color: colors.text, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg, borderRadius: 18 },
  send: { paddingBottom: 2 },
});
