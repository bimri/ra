import type { SignalCard, TripCard } from "@ra/core";
import { QUESTION_TASK, developerMessage } from "@ra/prompts";
import type { Muse, Turn } from "../muse";
import {QUESTION_SCHEMA,questionResult,taskText} from "../muse/tasks";

// The Ray's moments: the mirror, the window, the question, the trips, the
// star and the ring. The models are passed in, so these read the same with
// Muse, or with fakes in tests.

/** A decision model: one choice among named options, with probabilities. */
export type Choose = (state: string, instructions: string, criteria: Record<string, string>) => Promise<{
  choice: string;
  probabilities: Record<string, number>;
}>;
/** A decision model: P(yes) for one question. */
export type Ask = (state: string, question: string, signal?:AbortSignal) => Promise<number>;

const said = (lines: string[]) => lines.map((l) => `"${l}"`).join(" ");

/** A choice counts only when the model is reasonably sure; otherwise Ra doesn't guess. */
const SURE = 0.45;

// ── the window (B6) ─────────────────────────────────────────────────────────
export interface FieldInfo {
  id: string;
  name: string;
  about: string;
}

/**
 * One signal from where the person stands: first the field their story is
 * closest to, then the signal in it that touches their story most. Null when
 * neither is clear; Ra then says it will read their horizon tonight.
 */
export async function chooseWindow(
  choose: Choose,
  fields: FieldInfo[],
  signalsFor: (fieldId: string) => Promise<SignalCard[]>,
  yours: string[],
): Promise<{ field: FieldInfo; signal: SignalCard } | null> {
  if (yours.length === 0 || fields.length === 0) return null;
  const state = `In this conversation the person said: ${said(yours.slice(-12))}`;
  const pickField = await choose(
    state,
    "Which field is this person's story closest to?",
    { ...Object.fromEntries(fields.map((f) => [f.id, `${f.name}: ${f.about}`])), none: "None of these" },
  );
  const field = fields.find((f) => f.id === pickField.choice);
  if (!field || (pickField.probabilities[field.id] ?? 0) < SURE) return null;
  const signals = (await signalsFor(field.id)).filter((s) => s.kind === "rising" || s.kind === "early" || s.kind === "risen");
  if (signals.length === 0) return null;
  if (signals.length === 1) return { field, signal: signals[0]! };
  const pickSignal = await choose(
    state,
    "Which of these changes in the world touches this person's story most?",
    Object.fromEntries(signals.map((s) => [s.id, s.text])),
  );
  const signal = signals.find((s) => s.id === pickSignal.choice) ?? signals[0]!;
  return { field, signal };
}

// ── the question (B7) ───────────────────────────────────────────────────────
/** Spark (or its stand-in) writes the question they came with and the one they leave with. */
export async function draftQuestion(muse: Muse, turns: Turn[],signal?:AbortSignal): Promise<{ asked: string; leavingWith: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text=await taskText(()=>muse.spark({ developer: developerMessage(), instructions: QUESTION_TASK, turns, json: true,schema:QUESTION_SCHEMA,maxOutputTokens:400,...(signal?{signal}:{}) }),signal);
    if(text===null)continue;const parsed=questionResult(text);if(parsed)return parsed;
  }
  return null;
}

/**
 * What they said back to the question: agreeing keeps Ra's wording; saying
 * it their own way keeps theirs ("Ra keeps your words"). Anything else (a
 * "no", "what do you mean?", a story) keeps nothing, and Ra answers it.
 */
export async function keptQuestion(choose: Choose, offered: string, reply: string): Promise<string | null> {
  const text = reply.trim();
  const pick = await choose(
    `Ra offered this question: "${offered}"\nThe person replied: "${text}"`,
    "What is the person doing with Ra's question?",
    {
      agree: "Agreeing with it as it is (for example \"that's it\" or \"yes, that one\")",
      own: "Saying the question again in their own words",
      other: "Anything else: disagreeing, unsure, asking what it means, or talking about something else",
    },
  );
  if ((pick.probabilities[pick.choice] ?? 0) < SURE) return null;
  if (pick.choice === "agree") return offered;
  if (pick.choice === "own" && text.split(/\s+/).length >= 4) return text;
  return null;
}

// ── the mirror (B5) ─────────────────────────────────────────────────────────
/** Which offered quote they say is really theirs, if any. */
export async function chosenQuote(choose: Choose, reply: string, items: { mirrorId: string; text: string }[]): Promise<string | null> {
  if (items.length === 0) return null;
  const pick = await choose(
    `These phrases were offered back to the person: ${items.map((i) => `"${i.text}"`).join(", ")}.\nThe person said: "${reply}"`,
    "Which phrase does the person say is really theirs?",
    { ...Object.fromEntries(items.map((i) => [i.mirrorId, i.text])), none: "None, or they didn't pick one" },
  );
  return pick.choice !== "none" && (pick.probabilities[pick.choice] ?? 0) >= SURE ? pick.choice : null;
}

// ── the trips (B8) ──────────────────────────────────────────────────────────
/** Which trip they pick, or ask to change. */
export async function tripReply(
  choose: Choose,
  ask: Ask,
  reply: string,
  trips: TripCard[],
): Promise<{ tripId: string; change: boolean } | null> {
  if (trips.length === 0) return null;
  const state = `Ra offered these trips: ${trips.map((t, i) => `${i + 1}. "${t.title}"`).join(" ")}\nThe person said: "${reply}"`;
  const [pick, change] = await Promise.all([
    choose(state, "Which trip is the person talking about?", {
      ...Object.fromEntries(trips.map((t, i) => [t.tripId, `${ordinal(i)}: ${t.title}`])),
      none: "None of them",
    }),
    ask(state, "Is the person asking Ra to change or replace a trip, rather than choosing it?"),
  ]);
  if (pick.choice === "none" || (pick.probabilities[pick.choice] ?? 0) < SURE) return null;
  return { tripId: pick.choice, change: change >= 0.5 };
}

const ordinal = (i: number) => ["the first one", "the second one", "the third one", "the fourth one"][i] ?? `number ${i + 1}`;

// ── the star (D2) ───────────────────────────────────────────────────────────
/**
 * What they said while writing their star: a star in their own words, "not
 * yet" (J5: that's fine), or neither (a question, a thought out loud), which
 * Ra answers and the star stays open.
 */
export async function spokenStar(choose: Choose, reply: string): Promise<{ star: string } | "not-yet" | null> {
  const text = reply.trim();
  const pick = await choose(
    `Ra asked the person to say their star: the mission only they can write.\nThe person said: "${text}"`,
    "What is the person doing?",
    {
      star: "Saying a mission or purpose of their own",
      notyet: "Saying they don't have one yet, not yet, or would rather not now",
      other: "Anything else: asking what a star is, thinking out loud, or talking about something else",
    },
  );
  if ((pick.probabilities[pick.choice] ?? 0) < SURE) return null;
  if (pick.choice === "notyet") return "not-yet";
  if (pick.choice !== "star" || text.split(/\s+/).length < 3) return null;
  return { star: text.replace(/^(my star is|i think it's|it's)\s+/i, "").replace(/^\w/, (c) => c.toUpperCase()) };
}

// ── the ring (B10) ──────────────────────────────────────────────────────────
/** A ring keeps one line in their own words: the quote they kept, or else their most lifted one. */
export function ringLine(kept: string[], offered: string[], fallback: string | undefined): string {
  return kept[0] ?? offered[0] ?? fallback ?? "";
}

// ── helpers ─────────────────────────────────────────────────────────────────
export function parseJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
