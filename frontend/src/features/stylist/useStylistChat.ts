import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/httpClient';
import type { StylistEvent } from '../../api/stylistApi';
import type { DigitalTwin, Garment, Wearer } from '../../domain/types';
import { errorMessage } from '../../lib/errors';
import { useServices } from '../../services/ServicesProvider';
import type { ChatCard, ChatMessage } from '../../storage/chatRepository';
import { useConsent } from '../privacy/ConsentContext';
import { buildChatPayload } from './chatContext';
import { localStylist } from './localStylist';

export interface Streaming {
  text: string;
  cards: ChatCard[];
}

/**
 * The chat's state: stored history, the reply streaming in, and which stylist answers.
 * The AI stylist (server, SSE) is used only with a backend and the "AI stylist" consent;
 * otherwise the on-device basic stylist answers, so nothing leaves the phone.
 */
export function useStylistChat(closet: Garment[] | null, wearer: Wearer, twin: DigitalTwin | null) {
  const { chat, stylist } = useServices();
  const { allows } = useConsent();
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const cloud = !!stylist && allows('ai_stylist');

  useEffect(() => {
    chat.list().then(setHistory).catch(() => setHistory([]));
    return () => abort.current?.abort();
  }, [chat]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming || !closet) return;
      setError(null);
      setQuotaHit(false);
      const userMsg = await chat.add({ role: 'user', text: q, cards: [] });
      const prior = history;
      setHistory((h) => [...h, userMsg]);

      const payload = buildChatPayload(prior, q, closet, wearer, twin);
      const acc: Streaming = { text: '', cards: [] };
      setStreaming({ ...acc });
      const controller = new AbortController();
      abort.current = controller;
      let failure: string | null = null;
      const onEvent = (e: StylistEvent) => {
        if (e.type === 'delta') acc.text += e.text;
        else if (e.type === 'outfit') acc.cards.push({ title: e.card.title, itemIds: e.card.item_ids, reason: e.card.reason });
        else if (e.type === 'error') failure = e.message;
        setStreaming({ text: acc.text, cards: [...acc.cards] });
      };
      try {
        if (cloud) await stylist!.chat(payload, onEvent, controller.signal);
        else await localStylist(payload, onEvent, controller.signal);
      } catch (e) {
        const quota = e instanceof ApiError && e.code === 'quota_exceeded';
        if (quota) setQuotaHit(true);
        if (!controller.signal.aborted) {
          failure =
            quota
              ? "You've used today's free stylist chats. Upgrade to Premium for unlimited styling."
              : e instanceof ApiError && e.code === 'consent_required'
                ? 'Turn on the AI stylist in Privacy & data to use it.'
                : errorMessage(e);
        }
      }
      abort.current = null;
      const text = acc.text.trim() || (failure ? '' : '…');
      if (text || acc.cards.length) {
        const saved = await chat.add({ role: 'assistant', text, cards: acc.cards });
        setHistory((h) => [...h, saved]);
      }
      setStreaming(null);
      if (failure) setError(failure);
    },
    [chat, stylist, cloud, closet, wearer, twin, history, streaming],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const clear = useCallback(async () => {
    await chat.clear();
    setHistory([]);
  }, [chat]);

  return { history, streaming, error, quotaHit, send, stop, clear, cloud };
}
