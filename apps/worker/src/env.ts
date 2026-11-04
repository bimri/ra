import type { HorizonDO } from "./horizon/HorizonDO";
import type { MindDO } from "./mind/MindDO";

export interface Env {
  RA_ENV: "dev" | "staging" | "production";
  /** Muse (default) or the offline stub, for tests and dev without a key. */
  RA_MUSE_PROVIDER?: "muse" | "fake";
  /** Which Muse model holds Ra's conversation and structured tasks: Spark (default) or Wonder. */
  RA_MUSE_TALK?: "spark" | "wonder";
  /** Muse Transcribe (default) or the stub. */
  RA_TRANSCRIBER?: "muse" | "fake";
  /** The language you speak in a Ray, as an ISO code ("en"), or "auto" to let the transcriber guess. */
  RA_LANGUAGE: string;
  /** Which premade ElevenLabs voice is Ra's when RA_ELEVENLABS_VOICE is unset. */
  RA_VOICE_GENDER?: "female" | "male";
  /** An ElevenLabs voice ID for Ra, overriding the premade voice for RA_VOICE_GENDER. */
  RA_ELEVENLABS_VOICE?: string;

  MIND: DurableObjectNamespace<MindDO>;
  HORIZON: DurableObjectNamespace<HorizonDO>;
  DB: D1Database;
  LEDGER: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  /** Workers AI: bge-m3 embeddings for G3's then-and-now pairing. */
  AI?: Ai;

  TRIP_DESIGN: Workflow<{ person: string; rayId: string }>;
  HORIZON_REFRESH: Workflow<{ field: string;operationId?:string }>;
  NIGHT_WATCH: Workflow<{ person: string; night: string }>;
  WEEKLY_READING: Workflow<{ person: string }>;
  SEASON_REVIEW: Workflow<{ person: string; from: number; to: number }>;
  BEACON_MATCH: Workflow<{ account: string }>;

  /** 32 bytes, base64: wraps every person's data key. A Worker secret (`.dev.vars` locally). */
  RA_MASTER_KEY?: string;
  /** Content-free Web Push (VAPID): the public key the phone subscribes with, and the private key as a JWK. */
  RA_VAPID_PUBLIC?: string;
  /** The ledger's Ed25519 signing key (JWK) for claims funders can verify (K1). Secrets Store in production. */
  RA_LEDGER_KEY?: string;
  /** G3: how many days apart a then-and-now pair must be (default 90). Dev only, to try it sooner. */
  RA_THEN_GAP_DAYS?: string;
  RA_VAPID_PRIVATE?: string;
  /** The Ear (WhatsApp Cloud API). The number people link to, its phone-number ID, and the webhook verify token. */
  RA_EAR_NUMBER?: string;
  EAR_PHONE_ID?: string;
  /** Real delivery stays unavailable until verification and explicit approved template configuration. */
  RA_EAR_VERIFIED?:"true";
  EAR_TEMPLATES?:string;
  EAR_GRAPH_VERSION?:string;
  EAR_BUSINESS_ID?:string;
  EAR_VERIFY_TOKEN?: string;
  /** Meta app secret (webhook signatures) and the Cloud API token: Secrets Store in production, .dev.vars in dev. */
  EAR_APP_SECRET?: string | SecretsStoreSecret;
  EAR_TOKEN?: string | SecretsStoreSecret;

  MUSE_KEY: SecretsStoreSecret|string;
  /** Bearer token for POST /muse/probe, the live Muse acceptance check. The route is off while unset. */
  RA_PROBE_TOKEN?: string;
  ELEVENLABS_KEY?: SecretsStoreSecret;
}

/** Read a Secrets Store secret, or null while it hasn't been set. */
export async function readSecret(secret: SecretsStoreSecret | undefined): Promise<string | null> {
  if (!secret) return null;
  try {
    const value = await secret.get();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** A secret from Secrets Store in production, or a plain .dev.vars value in dev. */
export async function secretOf(v: string | SecretsStoreSecret | undefined): Promise<string | null> {
  if (typeof v === "string") return v || null;
  return readSecret(v);
}
