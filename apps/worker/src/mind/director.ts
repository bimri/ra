import type { Prosody, SessionKind, Word } from "@ra/core";
import { SCRIPTS, type StageDef } from "@ra/prompts";

// The Ray director: which stage a Ray is in, decided by the sunset. Pure, so
// the phone could run it too; the Mind owns the clock and the moments.

/** The stages this Ray runs. Ray 2's star stage is skipped once a star is written. */
export function scriptFor(session: SessionKind, opts: { hasStar: boolean }): StageDef[] {
  const script = SCRIPTS[session] ?? SCRIPTS.ray!;
  // A Ray asks for your star until you have one; a season review (K2) asks whether it has moved.
  const stages = script.filter((s) => !(s.kind === "star" && opts.hasStar && session !== "season"));
  // Spread any skipped share over the remaining stages, keeping their proportions.
  const total = stages.reduce((a, s) => a + s.share, 0);
  return stages.map((s) => ({ ...s, share: s.share / total }));
}

/** The stage for this much of the sun set (0..1): where the cumulative shares pass it. */
export function stageIndexAt(script: StageDef[], sink: number): number {
  let edge = 0;
  for (let i = 0; i < script.length; i++) {
    edge += script[i]!.share;
    if (sink < edge - 1e-9) return i;
  }
  return script.length - 1;
}

/** The sink at which a stage begins. */
export function stageStart(script: StageDef[], index: number): number {
  return script.slice(0, index).reduce((a, s) => a + s.share, 0);
}

/**
 * Which words were lifted: said louder than this utterance's own baseline.
 * Measured against the person, not a fixed level (the architecture page:
 * "energy moments are measured against your own baseline").
 */
export function liftedWords(words: Word[]): Prosody {
  const loud = words.map((w) => w.loudness);
  const mean = loud.reduce((a, b) => a + b, 0) / (loud.length || 1);
  const liftWords: number[] = [];
  const lifts: number[] = [];
  words.forEach((w, i) => {
    if (words.length >= 3 && w.loudness >= mean * 1.25) {
      liftWords.push(i);
      lifts.push(w.startMs);
    }
  });
  return { loudness: mean, lifts, liftWords };
}

/**
 * Ra's own voice, heard back. A phone on a speaker, or a mic near the PC that plays Ra,
 * can transcribe Ra's line as if the person said it. A line is Ra's echo when most of
 * its words fall in three-word runs that Ra just said; it is never theirs to ring or quote.
 */
export const ECHO_SHARE = 0.6;

const tokens = (text: string): string[] => text.toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];

function raGrams(raLines: string[]): Set<string> {
  const grams = new Set<string>();
  for (const line of raLines) {
    const w = tokens(line);
    for (let i = 0; i + 3 <= w.length; i++) grams.add(w.slice(i, i + 3).join(" "));
  }
  return grams;
}

function echoShare(text: string, grams: Set<string>): number {
  const w = tokens(text);
  if (w.length < 3 || grams.size === 0) return 0;
  const hit = new Array<boolean>(w.length).fill(false);
  for (let i = 0; i + 3 <= w.length; i++) if (grams.has(w.slice(i, i + 3).join(" "))) hit[i] = hit[i + 1] = hit[i + 2] = true;
  return hit.filter(Boolean).length / w.length;
}

/** True when `text` is mostly Ra's own recent words (see ECHO_SHARE). */
export function echoesRa(text: string, raLines: string[]): boolean {
  return echoShare(text, raGrams(raLines)) >= ECHO_SHARE;
}

/** The person's lines without Ra's echoes. */
export function withoutRaEchoes<T extends { text: string }>(lines: T[], raLines: string[]): T[] {
  const grams = raGrams(raLines);
  return lines.filter((l) => echoShare(l.text, grams) < ECHO_SHARE);
}

export interface SaidLine {
  utteranceId: string;
  text: string;
  prosody?: Prosody | null;
}

export interface MirrorQuote {
  utteranceId: string;
  text: string;
  /** How strongly the voice lifted in this phrase. */
  score: number;
}

const JOINERS = new Set(["and", "but", "so", "because", "then"]);
const FILLER = new Set(["uh", "uhm", "um", "umm", "like", "well"]);

/** Cut a line into clauses by word position: punctuation ends one, a joining word starts the next. */
function clauses(text: string): { words: string[]; at: number[] }[] {
  const out: { words: string[]; at: number[] }[] = [];
  let cur = { words: [] as string[], at: [] as number[] };
  const flush = () => {
    if (cur.words.length) out.push(cur);
    cur = { words: [], at: [] };
  };
  text.split(/\s+/).filter(Boolean).forEach((token, i) => {
    const bare = token.toLowerCase().replace(/[^a-z']/g, "");
    if (JOINERS.has(bare)) return flush();
    if (!(cur.words.length === 0 && FILLER.has(bare))) {
      cur.words.push(token.replace(/[,.;:!?—–"“”]+$/g, "").replace(/^["“]/, ""));
      cur.at.push(i);
    }
    if (/[,.;:!?—–]$/.test(token)) flush();
  });
  flush();
  return out;
}

/**
 * The mirror (B5): short phrases in the person's own words, from where their
 * voice lifted. Each utterance is cut into clauses; a clause scores by how
 * much of it was lifted; the best few, of 3 to 9 words, are offered.
 */
export function mirrorQuotes(lines: SaidLine[], max = 5, raLines: string[] = []): MirrorQuote[] {
  const found: MirrorQuote[] = [];
  const ra = raGrams(raLines);
  lines.forEach((line, order) => {
    const lifted = new Set(line.prosody?.liftWords ?? []);
    for (const c of clauses(line.text)) {
      if (c.words.length < 3 || c.words.length > 9) continue;
      // Ra never hands the person its own words back.
      if (echoShare(c.words.join(" "), ra) >= ECHO_SHARE) continue;
      const liftShare = c.at.filter((i) => lifted.has(i)).length / c.words.length;
      // Later in the Ray counts a little more: people warm up.
      const score = liftShare + order * 0.01;
      found.push({ utteranceId: line.utteranceId, text: c.words.join(" "), score });
    }
  });
  const seen = new Set<string>();
  return found
    .sort((a, b) => b.score - a.score)
    .filter((q) => {
      const key = q.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}
