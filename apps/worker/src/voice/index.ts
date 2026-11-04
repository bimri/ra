import { readSecret, type Env } from "../env";
import { RA_AUDIO_RATE } from "@ra/core";

// Ra's voice sits behind one interface: ElevenLabs. Muse has no speech synthesis.

export type VoiceName = "elevenlabs";

export interface SpeakRequest {
  lineId: string;
  text: string;
  signal?: AbortSignal;
}

export interface Voice {
  readonly name: VoiceName;
  /** False until the provider's host or key exists and its client is written. */
  readonly ready: boolean;
  readonly label: string;
  /** Mono 16-bit PCM at RA_AUDIO_RATE, streamed as it's made. */
  speak(req: SpeakRequest): Promise<ReadableStream<Uint8Array>>;
}

export class VoiceNotReady extends Error {
  constructor(name: VoiceName, why: string) {
    super(`${name} voice is not ready: ${why}`);
    this.name = "VoiceNotReady";
  }
}

/**
 * Premade ElevenLabs voices (Sarah, George) until Ra's is chosen by ear; RA_ELEVENLABS_VOICE overrides.
 * Library voices answer 402 payment_required on plans without library API access.
 */
/** Ra's voices: male is Osiris (deep, African accent), from the account's ElevenLabs library. */
const ELEVENLABS_VOICES = { female: "EXAVITQu4vr4xnSDxMaL", male: "Mm2mHUWQf6Vl4gbaE2gQ" } as const;

/**
 * ElevenLabs Flash, streamed as raw PCM at RA_AUDIO_RATE. Key from the Secrets Store.
 * Chunks are re-cut on sample boundaries; provider error bodies are never surfaced.
 */
export class ElevenLabsVoice implements Voice {
  readonly name = "elevenlabs";
  constructor(
    private readonly key: string | null,
    private readonly voiceId: string,
    private readonly send: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  get ready(): boolean {
    return this.key !== null;
  }

  get label(): string {
    return this.key ? "elevenlabs (flash v2.5)" : "elevenlabs (no key)";
  }

  async speak(req: SpeakRequest): Promise<ReadableStream<Uint8Array>> {
    if (!this.key) throw new VoiceNotReady(this.name, "no key in the Secrets Store");
    const res = await this.send(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream?output_format=pcm_${RA_AUDIO_RATE}`, {
      method: "POST",
      headers: { "xi-api-key": this.key, "content-type": "application/json", accept: "audio/pcm" },
      body: JSON.stringify({ text: req.text, model_id: "eleven_flash_v2_5" }),
      redirect: "manual",
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok || !res.body) { void res.body?.cancel().catch(() => {}); throw new Error(`ElevenLabs request failed (${res.status})`); }
    let odd: number | null = null;
    return res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        const bytes = odd === null ? chunk : Uint8Array.of(odd, ...chunk);
        odd = bytes.length % 2 ? bytes[bytes.length - 1]! : null;
        const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
        if (even.length) out.enqueue(even.slice());
      },
    }));
  }
}

export async function createVoice(env: Env): Promise<Voice> {
  return new ElevenLabsVoice(await readSecret(env.ELEVENLABS_KEY), env.RA_ELEVENLABS_VOICE || ELEVENLABS_VOICES[env.RA_VOICE_GENDER ?? "female"]);
}
