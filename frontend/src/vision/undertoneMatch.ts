import type { Undertone } from '../domain/types';
import { colorName, hexToRgb, labToLch, rgbToLab } from './color';

export interface MatchResult {
  score: number; // 0..100
  verdict: 'Great match' | 'Works for you' | 'Not your strongest';
  explanation: string;
}

/**
 * Warm/cool position of each hue on the CIELAB LCh wheel, from colour-analysis convention:
 * rust/orange/gold are warm, teal/blue/purple are cool, true red and green sit in between.
 * Linearly interpolated; tune here rather than in the scoring code.
 */
const WARMTH_BY_HUE: [hue: number, warmth: number][] = [
  [0, -0.3], [25, 0.3], [40, 0.6], [60, 1], [80, 1], [105, 0.7], [136, 0.1], [150, -0.2],
  [196, -0.8], [240, -1], [306, -1], [328, -0.7], [351, -0.5], [360, -0.3],
];

function hueWarmth(h: number) {
  for (let i = 1; i < WARMTH_BY_HUE.length; i++) {
    const [h1, w1] = WARMTH_BY_HUE[i];
    if (h <= h1) {
      const [h0, w0] = WARMTH_BY_HUE[i - 1];
      return w0 + ((w1 - w0) * (h - h0)) / (h1 - h0);
    }
  }
  return WARMTH_BY_HUE[0][1];
}

/**
 * Heuristic colour-season match. Hue warmth is scaled by saturation, so muted greys
 * and beiges read as near-neutral and suit everyone.
 */
export function scoreUndertoneMatch(hex: string, undertone: Undertone): MatchResult {
  const { L, C, h } = labToLch(rgbToLab(...hexToRgb(hex)));
  const saturation = Math.min(1, C / 40);
  const warmth = hueWarmth(h) * saturation;

  let score: number;
  switch (undertone) {
    case 'warm':
      score = 62 + 33 * warmth;
      if (C < 8 && L > 93) score -= 10; // stark optic white washes out warm skin; ivory is kinder
      break;
    case 'cool':
      score = 62 - 33 * warmth;
      if (C < 8 && (L > 93 || L < 12)) score += 8; // crisp white and true black flatter cool skin
      break;
    case 'neutral':
      score = 85 - 25 * Math.abs(warmth);
      break;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  const name = colorName(hex);
  const family = Math.abs(warmth) < 0.25 ? 'neutral' : warmth > 0 ? 'warm' : 'cool';
  const verdict = score >= 75 ? 'Great match' : score >= 55 ? 'Works for you' : 'Not your strongest';
  const explanation =
    family === 'neutral'
      ? `This ${name} is a neutral tone, which is easy to wear with a ${undertone} undertone.`
      : family === undertone
        ? `This ${name} is a ${family} colour, in harmony with your ${undertone} undertone.`
        : undertone === 'neutral'
          ? `This ${name} leans ${family}; neutral undertones carry most colours well.`
          : `This ${name} is a ${family} colour, which can clash with a ${undertone} undertone. Try wearing it away from your face.`;

  return { score, verdict, explanation };
}
