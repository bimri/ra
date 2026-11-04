import type { Word } from "@ra/core";

/** Per word: a weight from 300 to 600 and whether it's a lift, both relative to the line. */
export function emphasis(words: Word[]): { weight: number; lift: boolean }[] {
  const ls = words.map((w) => w.loudness);
  const min = Math.min(...ls);
  const max = Math.max(...ls);
  const mean = ls.reduce((a, b) => a + b, 0) / (ls.length || 1);
  const flat = max - min < 0.08 * max;
  return ls.map((l) => {
    const norm = flat ? 1 / 3 : (l - min) / (max - min);
    return { weight: 300 + Math.round(norm * 3) * 100, lift: !flat && words.length >= 4 && norm >= 0.8 && l >= mean * 1.25 };
  });
}
