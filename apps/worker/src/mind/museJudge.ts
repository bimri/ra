import type { Muse } from "../muse";

/** Yes/no probabilities over a state, the shape d1 gives. */
export type Judge = (state: string, questions: Record<string, string>, signal?: AbortSignal) => Promise<Record<string, number>>;
/** One named option over a state, with a probability for every option, the shape d1 gives. */
export type Chooser = (
  state: string,
  instructions: string,
  criteria: Record<string, string>,
  signal?: AbortSignal,
) => Promise<{ choice: string; probabilities: Record<string, number> }>;

const JUDGE = [
  "You are a careful, literal judge working inside Ra, a voice companion. You never speak to the person.",
  "Read the state and answer exactly what is asked, judging only what the state shows. Don't infer beyond it or give the benefit of the doubt either way.",
  "Probabilities run from 0 (certainly no) to 1 (certainly yes); use the middle only when the state is truly ambiguous.",
].join(" ");

const unit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Muse judge returned an invalid probability");
  return Math.min(1, Math.max(0, value));
};

function parse(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Muse judge returned invalid JSON");
  return value as Record<string, unknown>;
}

/**
 * Spark standing in for d1 when no decision model is running: the same
 * probabilities, asked for through a strict JSON schema. Slower than d1
 * (one Spark call), so callers that run on every turn ask in parallel.
 */
export function museJudge(muse: () => Promise<Muse>): { judge: Judge; choose: Chooser } {
  return {
    judge: async (state, questions, signal) => {
      const keys = Object.keys(questions);
      const schema = { type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "number" }])), required: keys, additionalProperties: false };
      const { text } = await (await muse()).spark({
        developer: JUDGE,
        instructions: `State:\n${state}\n\nFor each key, the probability that the answer is yes:\n${keys.map((k) => `${k}: ${questions[k]}`).join("\n")}`,
        turns: [],
        schema,
        maxOutputTokens: 120 + 24 * keys.length,
        ...(signal ? { signal } : {}),
      });
      const out = parse(text);
      return Object.fromEntries(keys.map((k) => [k, unit(out[k])]));
    },
    choose: async (state, instructions, criteria, signal) => {
      const keys = Object.keys(criteria);
      const schema = {
        type: "object",
        properties: {
          choice: { type: "string", enum: keys },
          probabilities: { type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "number" }])), required: keys, additionalProperties: false },
        },
        required: ["choice", "probabilities"],
        additionalProperties: false,
      };
      const { text } = await (await muse()).spark({
        developer: JUDGE,
        instructions: `State:\n${state}\n\n${instructions}\n\nOptions:\n${keys.map((k) => `${k}: ${criteria[k]}`).join("\n")}\n\nPick the one option that fits best, and give every option the probability that it fits.`,
        turns: [],
        schema,
        maxOutputTokens: 120 + 24 * keys.length,
        ...(signal ? { signal } : {}),
      });
      const out = parse(text);
      if (typeof out.choice !== "string" || !keys.includes(out.choice)) throw new Error("Muse judge returned an invalid choice");
      const given = out.probabilities;
      if (!given || typeof given !== "object" || Array.isArray(given)) throw new Error("Muse judge returned invalid probabilities");
      return { choice: out.choice, probabilities: Object.fromEntries(keys.map((k) => [k, unit((given as Record<string, unknown>)[k])])) };
    },
  };
}
