import {secretOf,type Env} from "../env";
import {MuseTranscriber} from "./muse";
import {museClip,rateOf} from "./museClip";
import { FakeTranscriber } from "./fake";
import type { Transcriber } from "./types";
import {pcmOf} from "./wav";

export { toWords } from "./clip";
export { FakeTranscriber } from "./fake";
export type { Transcriber, TranscriberSession, TranscriptHandlers } from "./types";

/**
 * Muse Transcribe for live Rays; the fake only when explicitly selected (tests, offline dev).
 * Muse reports configuration/connection failure and never falls back to fake.
 */
/** `language`: what you talk in; "auto" when you talk in more than one (J6), so Ra follows your switches. */
export function createTranscriber(env: Env, language = env.RA_LANGUAGE ?? "en"): Transcriber {
  if(env.RA_TRANSCRIBER==="fake")return new FakeTranscriber();
  return new MuseTranscriber(()=>secretOf(env.MUSE_KEY),language);
}

/** One clip outside a live Ray (C3 bring back, J1 walkie, captures, the Ear): one WAV in, text out. */
export async function transcribeClip(env: Env, wavBase64: string, language = env.RA_LANGUAGE ?? "en"): Promise<string> {
  const bytes=Uint8Array.from(atob(wavBase64),c=>c.charCodeAt(0));
  const pcm=pcmOf(bytes);if(!pcm||!pcm.length)throw new Error("the clip is not a WAV recording");
  if(env.RA_TRANSCRIBER==="fake")return "";
  const key=await secretOf(env.MUSE_KEY);if(!key)throw new Error("Muse Transcribe's key is unavailable");
  try{return await museClip(key,pcm,rateOf(bytes)??16_000,language)}finally{pcm.fill(0);bytes.fill(0)}
}
