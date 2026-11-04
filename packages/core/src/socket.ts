import type { SessionKind, StageName } from "./events";

// The live Ray socket: phone ⇄ Worker ⇄ your Mind. It stays open for the
// length of a Ray. Control messages are JSON text frames; audio is binary.

/** 16 kHz mono, 20 ms per frame. */
export const AUDIO_RATE = 16_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (AUDIO_RATE * FRAME_MS) / 1000; // 320
/** Ra's voice arrives at 24 kHz (ElevenLabs pcm_24000), in FRAME_RA frames. */
export const RA_AUDIO_RATE = 24_000;

// ── phone → mind ────────────────────────────────────────────────────────────
export type PhoneMessage =
  | {
      t: "hello";
      device: string;
      minutes: number;
      pace?: "normal" | "demo";
      /** minutes east of UTC, for the Watch's 2 AM */
      tz?: number;
      /** Open a prepared Reading (F1) or season review (K2) instead of a Ray. */
      session?: "reading" | "season" | "landfall" | "markers";
      landfallId?: string;
      markersIsland?: string;
      /** E3: opened from a Horizon signal ("What do you make of it?"): its words, so Ra opens on it. */
      signal?: string;
      /** J6: the languages you talk in, as chosen at first light; more than one and Ra follows your switches. */
      langs?: string[];
      /** Optional transport only; model input remains exact PCM. */
      audio?: ("pcm16-predict-v1")[];
    }
  | { t: "landfall.next" }
  | { t: "landfall.review"; resolved: boolean }
  | { t: "vad"; speaking: boolean }
  | { t: "barge_in" }
  /** "Done talking": end this thought now rather than waiting for the pause. */
  | { t: "done" }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "end" }
  | { t: "mirror.keep"; mirrorId: string }
  | { t: "mirror.strike"; mirrorId: string }
  /** B7: the question in your own words ("say it the way you'd ask it"). */
  | { t: "question.keep"; text: string }
  | { t: "trip.choose"; tripId: string }
  /** B9 "Change it": Ra redraws this trip. */
  | { t: "trip.change"; tripId: string }
  /** D2 "That's my star": only you write it, so it's kept only when you say so. */
  | { t: "star.keep"; text: string }
  /** D2 "Not yet" (J5): no star yet is a normal path. */
  | { t: "star.notyet" }
  /** U4 "Type instead", B3 "Type": a thought typed rather than said; Ra answers it like a spoken one. */
  | { t: "typed"; text: string };

// ── mind → phone ────────────────────────────────────────────────────────────
export interface Word {
  text: string;
  /** ms from the start of the utterance */
  startMs: number;
  endMs: number;
  /** 0..1 loudness while the word was said; drives the voice-shaped type */
  loudness: number;
  /** Animation estimate, not model-provided word timestamps. */
  approximate?:true;
}

/** One horizon signal, as the window (B6) and the Chart (E2, E3) show it. */
export interface SignalCard {
  id: string;
  kind: "risen" | "rising" | "early" | "stays-human" | "on-ramp";
  text: string;
  /** B6 "Stays human". */
  staysHuman?: string;
  /** E3 "Direction": how sure the move is, and why. */
  direction?: string;
  /** E3 "Timing", e.g. "Uncertain where you live." */
  timing?: string;
  sources: string[];
  /** Still the seed from the design canvas, not yet read by Wonder: the screen says so. */
  seeded?: boolean;
  verification?:import("./horizon").HorizonVerification;
}

/** A scouting trip card (B8, B9). */
export interface TripCard {
  tripId: string;
  title: string;
  tests: string;
  action: string;
  cost: string;
  bringBack: string;
  whyNow: string;
  sources: string[];
}

export type MindMessage =
  | {t:"markers";island:string;base:string[];statements:{id:string;text:string}[];omitted:number}
  | {
      t: "ready";
      rayId: string;
      session: SessionKind;
      /** The Ray's daylight and when it began, so the phone's sun matches the Mind's. */
      minutes: number;
      startedAt: number;
      /** Time already spent paused, ms. */
      pausedMs: number;
      /** Paused when you left (B3): the sun is holding and waits for you to carry on. */
      paused?: boolean;
      /** Which providers are real and which are stand-ins, so the screen can say so. */
      providers: { transcriber: string; muse: string; voice: string; check: string };
      audio?: "pcm16-predict-v1";
    }
  | { t: "words.partial"; utteranceId: string; words: Word[] }
  | { t: "words.final"; utteranceId: string; words: Word[]; text: string; seq: number }
  /** What sounded like speech held no words; take its line away. */
  | { t: "words.drop"; utteranceId: string }
  | { t: "stage"; name: StageName; sink: number }
  | { t: "ra.line"; lineId: string; text: string }
  | { t: "ra.audio.end"; lineId: string }
  /** The promise check held back a line Ra had started: stop it and drop what is queued. */
  | { t: "ra.cut"; lineId: string }
  /** B5: quotes from when your voice lifted. Keep the real ones. */
  | { t: "mirror"; items: { mirrorId: string; text: string }[] }
  | { t: "mirror.state"; mirrorId: string; state: "kept" | "struck" }
  /** B6: one thing Ra sees from where you stand. */
  | { t: "window"; signal: SignalCard }
  /** B7: the question you came in with, and the one you're leaving with. */
  | { t: "question"; asked: string; leavingWith: string; kept: boolean }
  /** B8: three small trips, made only for you. */
  | { t: "trips"; trips: TripCard[]; chosen: string | null }
  /** D2: phrases that were really yours, to help you write your star. Only you write it. */
  | { t: "star"; candidates: string[]; written: string | null; /** What they said, for them to confirm as their star. */ proposed?: string | null }
  /** J4: they said they're hurting. Ra answers with care, the sun holds, and people to reach are on screen. */
  | { t: "care"; on: boolean; said: string }
  /** B10: your ring, and Ra's goodnight. */
  | { t: "ring"; ringId: string; title: string; text: string; closing: string }
  /** The Mind ended the Ray at sunset (a Reading, a season review, or after the ring). */
  | { t: "ended" }
  | { t: "landfall.review"; unresolved: boolean }
  | { t: "error"; message: string };

const PHONE_TYPES = new Set([
  "hello",
  "landfall.next",
  "landfall.review",
  "vad",
  "barge_in",
  "done",
  "pause",
  "resume",
  "end",
  "mirror.keep",
  "mirror.strike",
  "question.keep",
  "trip.choose",
  "trip.change",
  "star.keep",
  "star.notyet",
  "typed",
]);

export function parsePhoneMessage(text: string): PhoneMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const t = (m as { t?: unknown }).t;
  return typeof t === "string" && PHONE_TYPES.has(t) ? (m as PhoneMessage) : null;
}

// ── binary audio frames ─────────────────────────────────────────────────────
// Byte 0: kind (1 = your mic, 2 = Ra's voice). Byte 1: flags (bit 0 = the
// phone's pause detector hears speech). Bytes 2–3: loudness as uint16
// (0..65535 ↔ 0..1), little-endian. Then 16-bit little-endian PCM samples.

export const FRAME_HEADER = 4;
export const FRAME_MIC = 1;
export const FRAME_RA = 2;

export interface AudioFrame {
  kind: number;
  speaking: boolean;
  loudness: number;
  pcm: Int16Array;
}

export function encodeAudioFrame(frame: AudioFrame): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER + frame.pcm.length * 2);
  const view = new DataView(buf);
  view.setUint8(0, frame.kind);
  view.setUint8(1, frame.speaking ? 1 : 0);
  view.setUint16(2, Math.round(Math.min(1, Math.max(0, frame.loudness)) * 65535), true);
  for (let i = 0; i < frame.pcm.length; i++) view.setInt16(FRAME_HEADER + i * 2, frame.pcm[i] ?? 0, true);
  return buf;
}

export function decodeAudioFrame(buf: ArrayBuffer): AudioFrame | null {
  if (buf.byteLength < FRAME_HEADER || (buf.byteLength - FRAME_HEADER) % 2 !== 0) return null;
  const view = new DataView(buf);
  const n = (buf.byteLength - FRAME_HEADER) / 2;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = view.getInt16(FRAME_HEADER + i * 2, true);
  return {
    kind: view.getUint8(0),
    speaking: (view.getUint8(1) & 1) === 1,
    loudness: view.getUint16(2, true) / 65535,
    pcm,
  };
}

/** Root-mean-square level of a PCM frame, 0..1. */
export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = (pcm[i] ?? 0) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / pcm.length);
}
