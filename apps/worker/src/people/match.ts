import type { CrewKind } from "@ra/core";

// Beacon matching (H1–H3). It reads beacons only, never minds: a short text
// each person wrote, their star and (if they chose) their island, and how
// many landfalls they've made. It looks for four kinds of crewmate: same
// star, a neighbouring star on the same island, a few islands ahead, a few
// behind. Minors and adults are never matched with each other.

export interface Beacon {
  account: string;
  name: string;
  text: string;
  star: string;
  island: string | null;
  minor: boolean;
  landfalls: number;
  starVec: number[] | null;
  islandVec: number[] | null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9']+/g)?.filter((w) => w.length > 2) ?? []);

/** Meaning-close when both have embeddings; otherwise shared words (dev without Workers AI). */
export function similarity(a: string, av: number[] | null, b: string, bv: number[] | null): number {
  if (av && bv) return cosine(av, bv);
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return x.size && y.size ? shared / Math.min(x.size, y.size) : 0;
}

/**
 * Thresholds for bge-m3 cosine. Measure them on real beacons before trusting
 * them: related phrasings of one mission sit around 0.8.
 */
export const THRESHOLDS = { sameStar: 0.85, neighbouringStar: 0.6, sameIsland: 0.75, aheadStar: 0.7 } as const;

/** What kind of crewmate `them` would be for `me`, and the line that says why. Null: no match. */
export function kindOf(me: Beacon, them: Beacon): { kind: CrewKind; why: string; score: number } | null {
  if (me.account === them.account || me.minor !== them.minor) return null;
  const star = similarity(me.star, me.starVec, them.star, them.starVec);
  const island = me.island && them.island ? similarity(me.island, me.islandVec, them.island, them.islandVec) : 0;
  if (star >= THRESHOLDS.sameStar) return { kind: "same-star", why: "Steering by the same star.", score: star };
  if (star >= THRESHOLDS.aheadStar && them.landfalls > me.landfalls) {
    return { kind: "ahead", why: `${them.name} is a few islands ahead of you.`, score: star };
  }
  if (star >= THRESHOLDS.aheadStar && them.landfalls < me.landfalls) {
    return { kind: "behind", why: `${them.name} is a few islands behind you, on the same course.`, score: star };
  }
  if (star >= THRESHOLDS.neighbouringStar && island >= THRESHOLDS.sameIsland) {
    return { kind: "neighbouring-star", why: "Same island, neighbouring stars.", score: (star + island) / 2 };
  }
  return null;
}

/** The best crewmate for `me` among beacons that may meet (not blocked, not already introduced or asked). */
export function pickMatch(me: Beacon, candidates: Beacon[], exclude: Set<string>): { them: Beacon; kind: CrewKind; why: string } | null {
  let best: { them: Beacon; kind: CrewKind; why: string; score: number } | null = null;
  for (const them of candidates) {
    if (exclude.has(them.account)) continue;
    const k = kindOf(me, them);
    if (k && (!best || k.score > best.score)) best = { them, ...k };
  }
  return best && { them: best.them, kind: best.kind, why: best.why };
}

/** How the kind reads on a crewmate's row (H3) and an introduction (H2). */
export const KIND_LABEL: Record<CrewKind, string> = {
  "same-star": "Same star",
  "neighbouring-star": "Neighbouring star",
  ahead: "A few islands ahead",
  behind: "A few islands behind",
};

// ── introductions: two yeses, or nothing ────────────────────────────────────
// Asked one side at a time: the first sees the other's beacon; the other sees
// theirs only after that yes. A "not now" from either ends it, quietly.

export type IntroState = "asked-a" | "asked-b" | "introduced" | "declined" | "expired";

export const INTRO_DAYS = 14;

export function answerIntro(state: IntroState, by: "a" | "b", yes: boolean): IntroState {
  if (state === "asked-a" && by === "a") return yes ? "asked-b" : "declined";
  if (state === "asked-b" && by === "b") return yes ? "introduced" : "declined";
  return state; // not your turn, or already settled
}
