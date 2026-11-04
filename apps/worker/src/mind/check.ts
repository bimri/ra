import { CARE_CHECK, HURTING, LINE_CHECKS, MEMORY_CHECKS, RA_TERMS, type CheckQuestion } from "@ra/prompts";
import type { Muse } from "../muse";
import { museJudge, type Judge } from "./museJudge";

export interface Verdict {
  pass: boolean;
  /** The promises the line would break, in words Ra's redraft is told. */
  broke: string[];
  /** P(yes) per question, for the log and for tuning thresholds. */
  scores: Record<string, number>;
  /** Which questions held the line back, by name (content-free, for diagnostics). */
  failed?: string[];
}

/**
 * The promise check, run on every line before Ra says it (layer 2 of four on
 * the architecture page). It also reads what the person said, so Ra switches
 * to care when they're hurting.
 */
export interface PromiseChecker {
  readonly label: string;
  /**
   * Did they say they're hurting? Decides the care stance for Ra's reply.
   * `earlier` is what they said just before, oldest first, for context.
   */
  hurting(said: string, earlier: string[], signal?: AbortSignal): Promise<{ hurting: boolean; score: number }>;
  check(said: string, line: string, care: boolean, signal?: AbortSignal): Promise<Verdict>;
  /** May Ra keep this memory? Only what they did, said or care about; never a verdict on them (I2). */
  memory(claim: string, signal?: AbortSignal): Promise<Verdict>;
}

/** The checks over a judge that gives yes/no probabilities (Spark, through `museJudge`). */
export class JudgeChecker implements PromiseChecker {
  constructor(readonly label: string, private readonly judge: Judge) {}

  async hurting(said: string, earlier: string[], signal?: AbortSignal): Promise<{ hurting: boolean; score: number }> {
    const before = earlier.length ? `Earlier they said: ${earlier.map((t) => `"${t}"`).join(" ")}\n` : "";
    const p = await this.judge(`${before}The person said: "${said}"`, { hurting: HURTING.instructions }, signal);
    const score = p.hurting ?? 0;
    return { hurting: score >= HURTING.threshold, score };
  }

  async check(said: string, line: string, care: boolean, signal?: AbortSignal): Promise<Verdict> {
    const asked: Record<string, CheckQuestion> = { ...LINE_CHECKS, ...(care ? { care: CARE_CHECK } : {}) };
    const questions = (sees: "exchange" | "line") =>
      Object.fromEntries(
        Object.entries(asked)
          .filter(([, q]) => (q.sees ?? "exchange") === sees)
          .map(([k, q]) => [k, q.instructions]),
      );
    // Two reads in parallel: the exchange, and Ra's line on its own.
    const [inExchange, alone] = await Promise.all([
      this.judge(`${RA_TERMS}\nThe person said: "${said}"\nRa's reply: "${line}"`, questions("exchange"), signal),
      this.judge(`Ra's reply: "${line}"`, questions("line"), signal),
    ]);
    const scores = { ...inExchange, ...alone };
    const broke: string[] = [];
    const failedKeys: string[] = [];
    for (const [k, q] of Object.entries(asked)) {
      const p = scores[k] ?? 0;
      // The care question must be a yes; every other question must be a no.
      const failed = k === "care" ? p < q.threshold : p >= q.threshold;
      if (failed) { broke.push(q.broke); failedKeys.push(k); }
    }
    return { pass: broke.length === 0, broke, scores, failed: failedKeys };
  }

  async memory(claim: string, signal?: AbortSignal): Promise<Verdict> {
    const scores = await this.judge(
      `A note Ra keeps about the person: "${claim}"`,
      Object.fromEntries(Object.entries(MEMORY_CHECKS).map(([k, q]) => [k, q.instructions])),
      signal,
    );
    const broke = Object.entries(MEMORY_CHECKS)
      .filter(([k, q]) => (scores[k] ?? 0) >= q.threshold)
      .map(([, q]) => q.broke);
    return { pass: broke.length === 0, broke, scores };
  }
}

/** No checker configured: every line passes, and the screen says lines are unchecked. */
export class NoChecker implements PromiseChecker {
  readonly label = "none (lines unchecked)";
  async hurting(): Promise<{ hurting: boolean; score: number }> {
    return { hurting: false, score: 0 };
  }
  async check(): Promise<Verdict> {
    return { pass: true, broke: [], scores: {} };
  }
  async memory(): Promise<Verdict> {
    return { pass: true, broke: [], scores: {} };
  }
}

/** Spark judges when Muse is available; without it (the fake provider) lines go unchecked and the screen says so. */
export function createChecker(muse?: () => Promise<Muse>): PromiseChecker {
  return muse ? new JudgeChecker("muse spark (checking)", museJudge(muse).judge) : new NoChecker();
}
