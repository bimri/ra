import { cosine } from "../people/match";

// G3 · Then and now: you, explaining the same thing months apart. Each Mind
// embeds its own lines (bge-m3); the Watch pairs one of today's with one on
// the same topic from long enough ago. The moment needs a year of your voice;
// the code ships early.

const DAY = 86_400_000;

/** How far apart the two lines must be. A year is the moment; months is enough to begin. */
export const THEN_GAP_DAYS = 90;
/** Close enough to be "the same thing". */
export const SAME_TOPIC = 0.75;

export interface Line {
  utteranceId: string;
  at: number;
  vec: number[];
}

/** The best (then, now) pair: now from the latest day, then at least `gapDays` earlier, never a pair already made. */
export function pairThenAndNow(lines: Line[], now: number, gapDays = THEN_GAP_DAYS, paired: Set<string> = new Set()): { then: Line; now: Line; score: number } | null {
  if (!Number.isFinite(now) || !Number.isFinite(gapDays) || gapDays <= 0) return null;
  lines = lines.filter((l) => Number.isFinite(l.at) && l.at <= now && Array.isArray(l.vec)&&l.vec.length > 0 && l.vec.every(Number.isFinite) && l.vec.some((v) => v !== 0)).sort((a,b)=>b.at-a.at||(a.utteranceId<b.utteranceId?-1:a.utteranceId>b.utteranceId?1:0));
  const recent = lines.filter((l) => now - l.at <= DAY && !paired.has(l.utteranceId));
  let best: { then: Line; now: Line; score: number } | null = null;
  for (const n of recent) {
    for (const t of lines) {
      // Never a line with itself, and "then" is always the earlier one.
      if (t.utteranceId === n.utteranceId || t.at >= n.at || paired.has(t.utteranceId) || n.at - t.at < gapDays * DAY) continue;
      if (n.vec.length !== t.vec.length) continue;
      const score = cosine(n.vec, t.vec);
      if (score >= SAME_TOPIC && (!best || score > best.score||score===best.score&&(n.at>best.now.at||n.at===best.now.at&&(t.at<best.then.at||t.at===best.then.at&&(n.utteranceId+":"+t.utteranceId)<(best.now.utteranceId+":"+best.then.utteranceId))))) best = { then: t, now: n, score };
    }
  }
  return best;
}

/** "The same thing, five months apart." */
export function apart(thenAt: number, nowAt: number): string {
  const elapsed=nowAt-thenAt;if(!Number.isFinite(elapsed)||elapsed<0)return "some time apart";
  if(elapsed<86_400_000){const minutes=Math.max(1,Math.round(elapsed/60_000));if(minutes<60)return minutes===1?"a minute apart":`${minutes} minutes apart`;const hours=Math.round(minutes/60);return hours===1?"an hour apart":`${hours} hours apart`}
  const months = Math.round((nowAt - thenAt) / (30.44 * DAY));
  if(months<1){const days=Math.round(elapsed/DAY);return days===1?"a day apart":`${days} days apart`}
  if (months >= 12 && months % 12 <= 1) {
    const years = Math.round(months / 12);
    return years === 1 ? "a year apart" : `${years} years apart`;
  }
  const words = ["", "a month", "two months", "three months", "four months", "five months", "six months", "seven months", "eight months", "nine months", "ten months", "eleven months"];
  return `${words[months] ?? `${months} months`} apart`;
}

/** Production always keeps the full interval. */
export function thenGap(env: { RA_ENV?: string; RA_THEN_GAP_DAYS?: string }): number {
  const value = Number(env.RA_THEN_GAP_DAYS);
  return env.RA_ENV === "dev" && Number.isFinite(value) && value >= 1/1440&&value<=36500 ? value : THEN_GAP_DAYS;
}
