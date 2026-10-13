import { EMPTY_TAGS, type Garment } from '../../domain/types';
import { buildChatPayload, readQuestion } from './chatContext';

const g = (id: string, category: Garment['category'], colorHex: string): Garment => ({
  id, imageUri: '', colorHex, palette: [], embedding: null, createdAt: 0, syncedAt: null, category,
  favorite: false, wearCount: 0, lastWornAt: null, photoCount: 1, revision: 0, ...EMPTY_TAGS,
});

test('reads occasion and weather from the question', () => {
  expect(readQuestion('What should I wear to a rainy dinner tonight?')).toMatchObject({ occasion: 'party', weather: 'monsoon', weatherMentioned: true });
  expect(readQuestion('Shaadi this weekend').occasion).toBe('wedding');
});

test('payload carries text only, candidates from the closet, and folds earlier cards into text', () => {
  const closet = [g('t', 'tops', '#1B2A4A'), g('b', 'bottoms', '#C3B091'), g('x', null, '#000000')];
  const p = buildChatPayload(
    [
      { id: 1, role: 'user', text: 'office?', cards: [], createdAt: 0 },
      { id: 2, role: 'assistant', text: 'Try this.', cards: [{ title: 'Smart', itemIds: ['t', 'b'], reason: '' }], createdAt: 0 },
    ],
    'and for a rainy day?',
    closet,
    { undertone: 'warm', colouring: null },
    null,
    new Date(2026, 7, 10, 18, 30).getTime(),
  );
  expect(p.messages.at(-1)).toEqual({ role: 'user', text: 'and for a rainy day?' });
  expect(p.messages[1].text).toMatch(/^\[Showed outfit "Smart": navy tops, tan bottoms\] Try this\.$/);
  expect(p.closet.map((c) => c.id)).toEqual(['t', 'b']); // untagged pieces are left out
  expect(JSON.stringify(p)).not.toMatch(/file:|imageUri|embedding/);
  expect(p.candidates[0].item_ids).toEqual(['t', 'b']);
  expect(p.context).toMatch(/monsoon season in India.*mentions monsoon/);
});
