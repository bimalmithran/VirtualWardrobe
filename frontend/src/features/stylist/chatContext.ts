import type { ChatPayload } from '../../api/stylistApi';
import type { DigitalTwin, Garment, Occasion, Wearer, Weather } from '../../domain/types';
import type { ChatMessage } from '../../storage/chatRepository';
import { currentWeather, generateLooks } from '../../style/outfitGenerator';
import { colorName } from '../../vision/color';

const OCCASION_WORDS: [RegExp, Occasion][] = [
  [/wedding|shaadi|sangeet|reception|mehendi/, 'wedding'],
  [/diwali|onam|eid|pooja|puja|festiv|navratri|pongal|vishu/, 'festive'],
  [/office|work|meeting|interview|presentation|client/, 'work'],
  [/formal|gala|black tie/, 'formal'],
  [/party|club|night out|birthday|dinner|date/, 'party'],
  [/gym|run|workout|yoga|trek/, 'sport'],
  [/home|lounge|relax/, 'lounge'],
  [/casual|college|brunch|movie|market|shopping/, 'casual'],
];
const WEATHER_WORDS: [RegExp, Weather][] = [
  [/rain|monsoon|wet|drizzl/, 'monsoon'],
  [/cold|winter|chilly|snow|freezing/, 'winter'],
  [/hot|summer|heat|humid|sunny/, 'summer'],
];

/** Occasion and weather the question mentions, else today's Indian season. */
export function readQuestion(text: string, now = Date.now()): { occasion: Occasion | null; weather: Weather; weatherMentioned: boolean } {
  const q = text.toLowerCase();
  const occasion = OCCASION_WORDS.find(([re]) => re.test(q))?.[1] ?? null;
  const w = WEATHER_WORDS.find(([re]) => re.test(q))?.[1];
  return { occasion, weather: w ?? currentWeather(now), weatherMentioned: !!w };
}

const HISTORY_TURNS = 12;

/**
 * What the stylist gets: the recent conversation, a text summary of the closet (no photos),
 * looks the on-device generator scored for this question, and the person's colouring and
 * shape. Cards the assistant showed earlier are folded into its text.
 */
export function buildChatPayload(
  history: ChatMessage[],
  question: string,
  closet: Garment[],
  wearer: Wearer,
  twin: DigitalTwin | null,
  now = Date.now(),
): ChatPayload {
  const byId = new Map(closet.map((g) => [g.id, g]));
  const name = (id: string) => {
    const g = byId.get(id);
    return g ? `${colorName(g.colorHex)} ${g.subcategory ?? g.category ?? 'piece'}` : 'a removed piece';
  };
  const messages: ChatPayload['messages'] = history.slice(-HISTORY_TURNS).map((m) => ({
    role: m.role,
    text:
      m.cards.length && m.role === 'assistant'
        ? `${m.cards.map((c) => `[Showed outfit "${c.title}": ${c.itemIds.map(name).join(', ')}]`).join(' ')} ${m.text}`.trim()
        : m.text,
  }));
  messages.push({ role: 'user', text: question });

  const { occasion, weather, weatherMentioned } = readQuestion(question, now);
  const looks = generateLooks(closet, wearer, { occasion, weather, now, limit: 5 });
  const d = new Date(now);
  const context = [
    `Today is ${d.toDateString()}, local time ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}.`,
    `It is ${currentWeather(now)} season in India.`,
    weatherMentioned ? `The user mentions ${weather} weather.` : '',
    occasion ? `Occasion: ${occasion}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    messages,
    closet: closet
      .filter((g) => g.category)
      .map((g) => ({
        id: g.id,
        category: g.category!,
        subcategory: g.subcategory ?? undefined,
        colour: colorName(g.colorHex),
        hex: g.colorHex,
        pattern: g.pattern ?? undefined,
        occasions: g.occasions.length ? g.occasions : undefined,
        weather: g.weather.length ? g.weather : undefined,
        wear_count: g.wearCount,
        favourite: g.favorite || undefined,
      })),
    candidates: looks.map((l) => ({ item_ids: l.garments.map((g) => g.id), score: l.score.score })),
    wearer: {
      undertone: wearer.undertone ?? undefined,
      season: wearer.colouring?.subSeason,
      body_shape: twin?.bodyShape,
      height_cm: twin?.heightCm,
    },
    context,
  };
}
