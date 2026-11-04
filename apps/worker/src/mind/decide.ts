import type { Ask, Choose } from "./moments";
import type { Muse } from "../muse";
import { museJudge } from "./museJudge";

/**
 * Spark as the two decision shapes the moments use (`museJudge`). Without
 * Muse (the fake provider) nothing is ever "sure": choices come back as none
 * and questions as 0, so Ra waits for a tap instead of guessing.
 */
export function decisions(muse?: () => Promise<Muse>): { ask: Ask; choose: Choose } {
  if (muse) {
    const { judge, choose } = museJudge(muse);
    return {
      ask: async (state, question, signal) => (await judge(state, { q: question }, signal)).q ?? 0,
      choose: (state, instructions, criteria) => choose(state, instructions, criteria),
    };
  }
  return {
    ask: async () => 0,
    choose: async (_s, _i, criteria) => ({
      choice: "none",
      probabilities: Object.fromEntries(Object.keys(criteria).map((k) => [k, 0])),
    }),
  };
}
