import { classify, planExecution, type Capabilities } from './capabilities';

const GB = 1024 ** 3;
const phone = (over: Partial<Capabilities> = {}): Capabilities => ({
  platform: 'android',
  totalMemoryBytes: 8 * GB,
  runtimeAvailable: true,
  accelerators: ['nnapi', 'cpu'],
  npu: true,
  gpu: false,
  cpuScoreMs: 40,
  notes: [],
  ...over,
});
const inputs = { cloudAvailable: true, cloudConsent: true, preferNpu: false };

test('tiers', () => {
  expect(classify(phone())).toBe('high');
  expect(classify(phone({ totalMemoryBytes: 4 * GB }))).toBe('mid');
  expect(classify(phone({ totalMemoryBytes: 2 * GB }))).toBe('low');
  expect(classify(phone({ cpuScoreMs: 400 }))).toBe('low');
  expect(classify(phone({ runtimeAvailable: false }))).toBe('low');
});

test('high tier runs everything on the phone, NPU only when preferred', () => {
  const p = planExecution(phone(), inputs);
  expect([p.segmentation, p.embedding, p.maxResidentSessions]).toEqual(['device', 'device', 2]);
  expect(p.executionProviders).toEqual(['cpu']);
  expect(planExecution(phone(), { ...inputs, preferNpu: true }).executionProviders[0]).toBe('nnapi');
});

test('low tier goes hybrid with consent, stays local without it', () => {
  const low = phone({ totalMemoryBytes: 2 * GB });
  expect(planExecution(low, inputs)).toMatchObject({ segmentation: 'cloud', embedding: 'device' });
  expect(planExecution(low, { ...inputs, cloudConsent: false })).toMatchObject({ segmentation: 'device', embedding: 'device' });
  expect(planExecution(phone({ runtimeAvailable: false }), inputs)).toMatchObject({ segmentation: 'cloud', embedding: 'cloud' });
});
