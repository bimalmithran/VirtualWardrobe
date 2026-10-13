import { EMPTY_PROPORTIONS } from '../domain/types';
import { inferBodyShape } from './bodyShape';

const p = (bustCm: number, waistCm: number, hipCm: number) => ({ ...EMPTY_PROPORTIONS, bustCm, waistCm, hipCm });

test.each([
  [p(92, 66, 94), 'hourglass'],
  [p(86, 74, 102), 'triangle'],
  [p(108, 88, 94), 'inverted-triangle'],
  [p(90, 80, 92), 'rectangle'],
  [p(100, 104, 102), 'oval'],
])('%o is %s', (props, shape) => {
  expect(inferBodyShape(props)).toBe(shape);
});

test('needs all three circumferences', () => {
  expect(inferBodyShape({ ...EMPTY_PROPORTIONS, bustCm: 90, hipCm: 90 })).toBeNull();
});
