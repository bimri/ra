import type { AudioFrame, Word } from "@ra/core";

// Transcription sits behind one interface: Muse Transcribe, live in a Ray and one
// clip at a time elsewhere. Omnilingual ASR may come later for Kiswahili and Dholuo.

export interface TranscriptHandlers {
  partial(utteranceId: string, words: Word[]): void;
  /** `pcm` is the thought's audio, when the transcriber has it: kept (sealed) for G2 "hear yourself from then". */
  final(utteranceId: string, words: Word[], text: string, span: { startMs: number; endMs: number; pcm?: Int16Array;respond?:boolean }): void;
  /** The utterance turned out to hold no words (a cough, a door); forget it. */
  drop?(utteranceId: string): void;
  error?(message: string): void;
}

export interface TranscriberSession {
  push(frame: AudioFrame): void;
  close(): void;
  /** Discard pending inference/audio immediately on lock, navigation or deletion. */
  cancel?():void;
}

export interface Transcriber {
  readonly name: string;
  /** True for a stand-in that doesn't really transcribe. */
  readonly stub: boolean;
  open(handlers: TranscriptHandlers, makeId: () => string): TranscriberSession;
}
