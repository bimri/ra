import { rms, FRAME_MS, type Word } from "@ra/core";
import type { Transcriber, TranscriberSession, TranscriptHandlers } from "./types";

/**
 * A stand-in for Muse Transcribe. It really listens: a frame counts as voice
 * only when the phone's pause detector calls it speech and its level clears a
 * floor. It makes one word per ~360 ms of voice and closes the utterance after
 * 0.9 s of quiet, at the end of its line, or after 15 s, whichever comes
 * first, so steady noise can never grow one endless utterance.
 * The words themselves come from a fixed line (U4's Ray screen), so anyone
 * can see the path works while nobody mistakes it for transcription.
 */
export class FakeTranscriber implements Transcriber {
  readonly name = "fake";
  readonly stub = true;

  static readonly SCRIPT =
    "Everyone says learn to code. Now agents do the exact work I was practising. But last week I opened gran's inverter, and I didn't want to stop.";

  constructor(
    private readonly opts = { threshold: 0.012, msPerWord: 360, endSilenceMs: 900, maxUtteranceMs: 15_000 },
  ) {}

  open(handlers: TranscriptHandlers, makeId: () => string): TranscriberSession {
    const script = FakeTranscriber.SCRIPT.split(" ");
    const { threshold, msPerWord, endSilenceMs, maxUtteranceMs } = this.opts;
    let cursor = 0; // next word in the script
    let clock = 0; // ms since the session opened
    let utterance: { id: string; startMs: number; words: Word[]; voicedMs: number; quietMs: number; levels: number[] } | null =
      null;

    const finish = () => {
      if (!utterance) return;
      const u = utterance;
      utterance = null;
      if (u.words.length === 0) return;
      const last = u.words.at(-1)!;
      handlers.final(
        u.id,
        u.words,
        u.words.map((w) => w.text).join(" "),
        { startMs: u.startMs, endMs: u.startMs + last.endMs },
      );
    };

    return {
      push(frame) {
        clock += FRAME_MS;
        const level = rms(frame.pcm);
        const voiced = frame.speaking && level >= threshold;
        if (!utterance) {
          if (!voiced) return;
          utterance = { id: makeId(), startMs: clock - FRAME_MS, words: [], voicedMs: 0, quietMs: 0, levels: [] };
        }
        const u = utterance;
        const t = clock - u.startMs;
        if (voiced) {
          u.quietMs = 0;
          u.voicedMs += FRAME_MS;
          u.levels.push(level);
          if (u.voicedMs >= msPerWord) {
            const loudness = Math.min(1, (u.levels.reduce((a, b) => a + b, 0) / u.levels.length) * 6);
            u.words.push({ text: script[cursor]!, startMs: t - u.voicedMs, endMs: t, loudness });
            cursor = (cursor + 1) % script.length;
            u.voicedMs = 0;
            u.levels = [];
            handlers.partial(u.id, [...u.words]);
            if (cursor === 0) finish();
          }
          if (t >= maxUtteranceMs) finish();
        } else {
          u.quietMs += FRAME_MS;
          if (u.quietMs >= endSilenceMs) finish();
        }
      },
      close: finish,
    };
  }
}
