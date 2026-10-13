import { Buffer } from 'buffer';

import { SseParser } from './sse';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

test('parses events across arbitrary chunk boundaries, including inside a UTF-8 character', () => {
  const wire = bytes('event: delta\ndata: {"text":"നല്ല"}\n\n: ping\n\nevent: done\r\ndata: {}\r\n\r\n');
  const p = new SseParser();
  const events = [];
  // Feed one byte at a time: the worst case for split characters.
  for (const b of wire) events.push(...p.push(new Uint8Array([b])));
  expect(events).toEqual([
    { event: 'delta', data: '{"text":"നല്ല"}' },
    { event: 'done', data: '{}' },
  ]);
});

test('multi-line data and default event name', () => {
  const p = new SseParser();
  expect(p.push(bytes('data: a\ndata: b\n\n'))).toEqual([{ event: 'message', data: 'a\nb' }]);
});
