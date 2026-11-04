import { HttpMuse } from "./http";
import {sparkTurns,sparkSystem,outputLimit,wonderTask} from "./messages";
import type { StageName } from "@ra/core";
import { secretOf, type Env } from "../env";

/**
 * Muse models. Spark is always `muse-spark-1.3`, never the cheaper
 * `-contributor` model, which grants training rights over what people say.
 */
export const MUSE_MODELS = {
  spark: "muse-spark-1.3",
} as const;

export function assertAllowedModel(model: string): void {
  if (/contributor/i.test(model)) throw new Error(`refusing Muse model ${model}: contributor models grant training rights`);
}

export interface Turn {
  speaker: "you" | "ra";
  text: string;
}

export interface SparkRequest {
  /** The standing promises (see @ra/prompts developerMessage). */
  developer: string;
  /** Dossier, then stage instructions, then this Ray's turns: most stable first. */
  dossier?: string;
  stage?: StageName;
  instructions?: string;
  turns: Turn[];
  effort?: "minimal" | "low" | "medium" | "high";
  /** 0 by default; a redraft asks for variety so it doesn't repeat the held-back line. */
  temperature?: number;
  /** Ask for JSON; the caller validates and retries once. */
  json?: boolean;
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Let the model search the web when it decides it needs to (live Rays). Sources are not required. */
  webSearch?: boolean;
}

export interface WonderRequest {
  task: string;
  webSearch: boolean;
  schema?:Record<string,unknown>;
  maxOutputTokens?:number;
}

export interface Muse {
  /** Describes what's behind this client, e.g. "stub (no key)". */
  readonly label: string;
  readonly stub: boolean;
  spark(req: SparkRequest & { signal?: AbortSignal }): Promise<{ text: string }>;
  wonder(req: WonderRequest & { signal?: AbortSignal }): Promise<{ text: string; sources: string[] }>;
  /** Spark reading one image (C3 evidence photos). */
  see(req: { image: { bytes: Uint8Array; type: string }; task: string; signal?: AbortSignal }): Promise<string>;
}

/** Stand-in used until the Muse key is in the Secrets Store and the HTTP client is written. */
export class FakeMuse implements Muse {
  readonly stub = true;
  constructor(readonly label = "stub (no key)") {}

  async spark(req: SparkRequest): Promise<{ text: string }> {
    assertAllowedModel(MUSE_MODELS.spark);
    if (req.json) return { text: JSON.stringify({ pass: true, stub: true }) };
    return { text: "Tell me about something this month that annoyed you." };
  }

  async see(): Promise<string> {
    return "";
  }

  async wonder(_req: WonderRequest): Promise<{ text: string; sources: string[] }> {
    return { text: "", sources: [] };
  }
}

/**
 * Muse when its key is set; the stub only when explicitly selected (tests, offline dev).
 * Selecting Muse without a readable key is an error, never a silent stand-in.
 */
export async function createMuse(env: Env): Promise<Muse> {
  if (env.RA_MUSE_PROVIDER === "fake") return new FakeMuse();
  const key = await secretOf(env.MUSE_KEY);
  if (!key) throw new Error("Muse's secret is unavailable");
  return new HttpMuse(key, undefined, env.RA_MUSE_TALK === "wonder" ? "muse-wonder-1.0" : "muse-spark-1.3");
}
