import { AUDIO_RATE, rms, type Word } from "@ra/core";

/** A transcript, with timed segments when the model gives them. */
export interface ClipResult {
  text: string;
  segments?: {
    start?: number;
    end?: number;
    text?: string;
    no_speech_prob?: number;
    words?: { word?: string; start?: number; end?: number }[];
  }[];
}

/**
 * The clip's words, timed, with the loudness each was said at (for the
 * voice-shaped type). Segments the model thinks hold no speech are dropped,
 * which keeps it from inventing words out of noise. Words without timings
 * are spread evenly across their segment, or across the clip.
 */
export function toWords(result: ClipResult, pcm: Int16Array): Word[] {
  const durationS = pcm.length / AUDIO_RATE;
  const out: Word[] = [];
  const add = (text: string, startS: number, endS: number) => {
    const t = text.trim();
    if (!t) return;
    const a = Math.max(0, Math.floor(startS * AUDIO_RATE));
    const b = Math.min(pcm.length, Math.max(a + 1, Math.ceil(endS * AUDIO_RATE)));
    out.push({ text: t, startMs: Math.round(startS * 1000), endMs: Math.round(endS * 1000), loudness: Math.min(1, rms(pcm.subarray(a, b)) * 6) });
  };

  const segments = result.segments ?? [];
  if (segments.length === 0) {
    const tokens = result.text.trim().split(/\s+/).filter(Boolean);
    tokens.forEach((t, i) => add(t, (i / tokens.length) * durationS, ((i + 1) / tokens.length) * durationS));
    return out;
  }
  for (const s of segments) {
    if ((s.no_speech_prob ?? 0) > 0.6) continue;
    const timed = (s.words ?? []).filter((w) => w.word && w.start !== undefined && w.end !== undefined);
    if (timed.length > 0) {
      for (const w of timed) add(w.word!, w.start!, w.end!);
    } else {
      const tokens = (s.text ?? "").trim().split(/\s+/).filter(Boolean);
      const start = s.start ?? 0;
      const end = s.end ?? durationS;
      tokens.forEach((t, i) => add(t, start + ((end - start) * i) / tokens.length, start + ((end - start) * (i + 1)) / tokens.length));
    }
  }
  return out;
}

