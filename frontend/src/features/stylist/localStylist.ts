import type { ChatPayload, StylistEvent } from '../../api/stylistApi';
import { readQuestion } from './chatContext';

/**
 * The basic stylist that runs entirely on the phone: it presents the looks the on-device
 * generator already scored, with a short templated reply. Used without a server, or when
 * the user hasn't consented to the AI stylist, so the chat works for everyone.
 */
export async function localStylist(payload: ChatPayload, onEvent: (e: StylistEvent) => void, signal?: AbortSignal) {
  const question = payload.messages[payload.messages.length - 1].text;
  const { occasion, weather, weatherMentioned } = readQuestion(question);
  const byId = new Map(payload.closet.map((c) => [c.id, c]));
  const describe = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((c) => !!c)
      .map((c) => `${c!.colour} ${(c!.subcategory ?? c!.category).replace(/-/g, ' ')}`)
      .join(', ');

  const picks = payload.candidates.slice(0, 2);
  picks.forEach((c, i) =>
    onEvent({ type: 'outfit', card: { title: `Option ${i + 1}`, item_ids: c.item_ids, reason: `Your ${describe(c.item_ids)}` } }),
  );

  let reply: string;
  if (payload.closet.length === 0) {
    reply = 'Tag a few pieces in your closet with a category and I can put outfits together for you.';
  } else if (picks.length === 0) {
    reply = "I couldn't build a complete outfit for that from your closet yet. A neutral bottom or a pair of everyday shoes would open up more looks.";
  } else {
    reply = `Here ${picks.length === 1 ? 'is a look' : 'are two looks'} from your closet${occasion ? ` for ${occasion}` : ''}. They were picked for colour harmony, your colouring and the ${weather}.`;
    if (weatherMentioned && weather === 'monsoon') reply += ' With rain about, wear closed shoes and keep pale bottoms for a drier day.';
    if (weather === 'winter') reply += ' Add a warm layer if it gets chilly.';
    if (weather === 'summer') reply += ' Keep it breathable: cotton and linen work best.';
  }
  for (const word of reply.split(' ')) {
    if (signal?.aborted) return;
    onEvent({ type: 'delta', text: word + ' ' });
    await new Promise((r) => setTimeout(r, 18));
  }
  onEvent({ type: 'done', provider: 'device' });
}
