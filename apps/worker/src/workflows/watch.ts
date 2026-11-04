import { makeId } from "@ra/core";
import { MEMORY_TASK, developerMessage } from "@ra/prompts";
import type { Muse } from "../muse";
import { parseJson } from "../mind/moments";
import {MEMORY_SCHEMA,memoryResult,taskText} from "../muse/tasks";

// The Watch (I3): while you sleep, Ra reads the day again. These are its
// pure parts; NightWatch (./index.ts) runs them as durable steps.

/** About 2 AM your time: the Watch's hour (I3's night runs 02:10–02:40). */
export const WATCH_HOUR = 2;

/** The next 2 AM in the person's time zone (offset in minutes east of UTC), after `now`. */
export function nextNightAt(now: number, tzOffsetMin: number): number {
  const local = new Date(now + tzOffsetMin * 60_000);
  const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), WATCH_HOUR, 0, 0) - tzOffsetMin * 60_000;
  return at > now ? at : at + 86_400_000;
}

/** The night's name ("2026-10-30"): the local date the Watch ran on. */
export function nightOf(at: number, tzOffsetMin: number): string {
  return new Date(at + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** "02:10 Read Ray two again…": a night log line, in the person's time. */
export function logLine(at: number, tzOffsetMin: number, text: string): string {
  return `${new Date(at + tzOffsetMin * 60_000).toISOString().slice(11, 16)} ${text}`;
}

export interface SaidLine {
  utteranceId: string;
  text: string;
}

export interface Memory {
  memoryId: string;
  claim: string;
  confidence: number;
  /** Utterance ids of the person's own words it came from. */
  sources: string[];
  /** The words themselves, one per source. */
  quotes: string[];
}

/**
 * Keep only memories whose every quote is found in what the person actually
 * said, and point each at those utterances. A claim Ra can't back with their
 * own words isn't a memory.
 */
export function readMemories(text: string, said: SaidLine[]): Memory[] {
  const parsed = parseJson<{ memories?: unknown }>(text);
  const list = Array.isArray(parsed?.memories) ? parsed.memories : [];
  const out: Memory[] = [];
  for (const raw of list.slice(0, 3)) {
    if (typeof raw !== "object" || raw === null) continue;
    const m = raw as { claim?: unknown; confidence?: unknown; quotes?: unknown };
    if (typeof m.claim !== "string" || !m.claim.trim()) continue;
    const quotes = (Array.isArray(m.quotes) ? m.quotes : [])
      .filter((q): q is string => typeof q === "string")
      // Models often wrap a quote in its own quote marks; the words are what matter.
      .map((q) => q.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim())
      .filter((q) => q.length >= 8);
    // A normalized paraphrase is not an exact quote. Keep only literal source excerpts.
    const sources = quotes.map((q) => said.find((l) => l.text.includes(q))?.utteranceId);
    if (sources.length === 0 || sources.some((s) => !s)) continue;
    // One quote per utterance: the first that came from it.
    const kept = new Map<string, string>();
    sources.forEach((s, i) => kept.has(s!) || kept.set(s!, quotes[i]!));
    const confidence = typeof m.confidence === "number" ? Math.min(0.9, Math.max(0.1, m.confidence)) : 0.5;
    out.push({ memoryId: makeId(), claim: m.claim.trim(), confidence, sources: [...kept.keys()], quotes: [...kept.values()] });
  }
  return out;
}

/** Ask Spark (or its stand-in) what Ra now believes, from the day's own words. */
export async function inferMemories(muse: Muse, said: SaidLine[], existing: string[],signal?:AbortSignal): Promise<Memory[]> {
  if (said.length === 0) return [];
  const instructions = [
    MEMORY_TASK,
    "",
    `What they said today: ${said.map((l) => `"${l.text}"`).join(" ")}`,
    existing.length ? `Existing memories: ${existing.map((e) => `"${e}"`).join(" ")}` : "There are no memories yet.",
  ].join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const text=await taskText(()=>muse.spark({ developer: developerMessage(), instructions, turns: [], json: true,schema:MEMORY_SCHEMA,maxOutputTokens:700,...(signal?{signal}:{}) }),signal);
    if(text===null)continue;const parsed=memoryResult(text);if(parsed){const memories=readMemories(text,said);if(!parsed.memories.length||memories.length)return memories}
  }
  return [];
}
