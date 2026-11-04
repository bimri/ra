import type { Views } from "@ra/core";

// The interruption governor: the only code allowed to reach you first. Four
// reasons, nothing else, at most once a day, and "you've gone quiet" is asked
// once ever. What it sends never says what; Today holds the rest.

export type Reason = "on-ramp" | "call-due" | "introduction" | "quiet";

const DAY = 86_400_000;
/** "Gone quiet long enough that your heading may have drifted." */
export const QUIET_AFTER = 21 * DAY;

/** May the governor reach you now, for this reason? */
export function mayInterrupt(v: Views, reason: Reason, now: number, quietAsked: boolean): boolean {
  if (reason === "quiet" && quietAsked) return false;
  const last = v.interrupts.at(-1);
  return !last || now - last.at >= DAY;
}
