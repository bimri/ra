import { draft, makeId, type EventBodies, type EventDraft, type EventKind } from "@ra/core";
import { MOMENT_LINES } from "@ra/prompts";

// Amani's Mind for the demo, as events. Every line comes from the Ra design
// canvas (App UI v2); the board each comes from is noted beside it. Nothing
// here is invented: where a board leaves a field blank, so does this.
//
// It's anchored to `now` so the screens read true on any day: Ray two ended
// yesterday evening, the Watch ran last night, Ray one was three days before.

const MIN = 60_000;
const SEED_DEVICE = "seed";

export interface Seed {
  events: EventDraft[];
  /** The Horizon field her story belongs to (B6, E1). */
  field: string;
  /** Minutes east of UTC: Nairobi. */
  tz: number;
}

export function amani(now = Date.now(), tz = 180): Seed {
  const events: EventDraft[] = [];
  const add = <K extends EventKind>(kind: K, body: EventBodies[K], at: number) => {
    events.push(draft(kind, body, { id: makeId(at), at, device: SEED_DEVICE }));
  };
  // Local times, `daysAgo` before today. Before the Watch has run tonight, "today" is yesterday.
  const here = new Date(now + tz * MIN);
  const shift = here.getUTCHours() < 3 ? 1 : 0;
  const local = (daysAgo: number, h: number, m: number) =>
    Date.UTC(here.getUTCFullYear(), here.getUTCMonth(), here.getUTCDate() - daysAgo - shift, h, m) - tz * MIN;
  const say = (rayId: string | undefined, speaker: "you" | "ra", text: string, start: number, atMs: number, lasts = 4000) => {
    const utteranceId = makeId(start + atMs);
    add("utterance", { utteranceId, ...(rayId ? { rayId } : {}), speaker, text, startMs: atMs, endMs: atMs + lasts }, start + atMs);
    return utteranceId;
  };

  // ── Ray one: the first Ray, at dusk (U3 "sunset · Ray at dusk") ──────────
  const one = makeId(local(4, 17, 55));
  const oneAt = local(4, 17, 55);
  add("ray.started", { rayId: one, session: "first", minutes: 30, pace: "normal" }, oneAt);
  say(one, "ra", MOMENT_LINES.firstOpening, oneAt, 1000);
  const scared = say(one, "you", "I'm scared I'm training for a job that won't exist.", oneAt, 14_000); // U5 · 0:14
  const code = say(one, "you", "Everyone says learn to code.", oneAt, 60_000); // B5
  const asked = say(one, "you", "What should I learn so I don't get replaced?", oneAt, 90_000); // B7 "You came in asking"
  const lights = say(one, "you", "The lights went off again.", oneAt, 5 * MIN); // B5
  const repair = say(one, "you", "Gran couldn't pay for the repair.", oneAt, 7 * MIN); // B5
  const why = say(one, "you", "I like knowing why it broke.", oneAt, 11 * MIN); // B5
  const stop = say(one, "you", "I didn't want to stop.", oneAt, 23 * MIN + 10_000); // I2 "Ray one · 23:10"
  void scared;

  // B5 · the mirror: the words where your voice lifted. You kept one.
  const mirrorAt = oneAt + 24 * MIN;
  say(one, "ra", MOMENT_LINES.mirror, oneAt, 24 * MIN);
  const mirrors = [
    ["I didn't want to stop", stop],
    ["the lights went off again", lights],
    ["I like knowing why it broke", why],
    ["everyone says learn to code", code],
    ["gran couldn't pay for the repair", repair],
  ] as const;
  let kept = "";
  for (const [text, source] of mirrors) {
    const mirrorId = makeId(mirrorAt);
    if (text === "I like knowing why it broke") kept = mirrorId;
    add("mirror.offered", { mirrorId, rayId: one, text, quotes: [source] }, mirrorAt);
  }
  add("mirror.kept", { mirrorId: kept }, mirrorAt + 20_000);

  // B6 · one thing Ra sees from where you stand.
  add("window.shown", { rayId: one, signals: ["energy-ai/rising-home-solar"] }, oneAt + 25 * MIN);

  // B7 · the question you leave with, in your words.
  const leaving = "Why do the things that keep the lights on break, and could I be the one who knows?";
  say(one, "you", leaving, oneAt, 26 * MIN, 6000);
  add("question.kept", { rayId: one, asked: "What should I learn so I don't get replaced?", leavingWith: leaving }, oneAt + 26 * MIN + 8000);
  void asked;

  // B8 / B9 · three trips; you took the first.
  const tripsAt = oneAt + 27 * MIN;
  say(one, "ra", MOMENT_LINES.trips, oneAt, 27 * MIN);
  const trip = makeId(tripsAt);
  add(
    "trip.offered",
    {
      tripId: trip,
      rayId: one,
      title: "Find out why gran's inverter failed",
      purpose: "Whether energy hardware pulls you the way that evening did.",
      action: "Read the fault codes in her model's manual. Then reproduce the fault in an open-source inverter simulator.",
      cost: "Two hours · no money · Wi-Fi for one download",
      evidence: "A one-minute voice note: what failed, and how you know.",
      whyNow: "Agents write the boilerplate. People who can own a real fault are scarce.",
      sources: ["Manufacturer manual", "Simulator project"],
    },
    tripsAt,
  );
  // B8 shows only a title, what it tests and its cost for these two.
  for (const [title, purpose, cost] of [
    ["Ask the shop that sold it what fails most", "Do you like the people side of repair?", "1 hour · a walk"],
    ["Read one open fault report in an inverter firmware project", "Does code that touches power feel like yours?", "1 hour · Wi-Fi"],
  ] as const) {
    add("trip.offered", { tripId: makeId(tripsAt), rayId: one, title, purpose, action: title, cost, evidence: "", whyNow: "", sources: [] }, tripsAt);
  }
  add("trip.chosen", { tripId: trip }, tripsAt + 40_000);

  // B10 · your first ring, and Ra's goodnight.
  add("ring.added", { ringId: makeId(oneAt + 29 * MIN), rayId: one, title: "Your first ring", text: "Wondered why gran's inverter broke, and couldn't stop." }, oneAt + 29 * MIN);
  say(one, "ra", MOMENT_LINES.ringClosing, oneAt, 29 * MIN + 5000, 6000);
  add("ray.ended", { rayId: one, reason: "sunset" }, oneAt + 30 * MIN);

  // ── The first night (U3 "From the night") ────────────────────────────────
  const night1 = local(3, 2, 10);
  const lose = makeId(night1);
  const loses = makeId(night1);
  const apart = makeId(night1);
  add("memory.inferred", { memoryId: lose, claim: "You lose track of time when you're fixing what keeps the power running.", confidence: 0.6, sources: [stop], quotes: ["I didn't want to stop."] }, night1);
  add("memory.inferred", { memoryId: loses, claim: "Your gran's place loses power often.", confidence: 0.7, sources: [lights], quotes: ["The lights went off again."] }, night1);
  add("memory.inferred", { memoryId: apart, claim: "You learn best by taking things apart.", confidence: 0.5, sources: [why], quotes: ["I like knowing why it broke."] }, night1);
  add("watch.night_log", { night: nightKey(night1, tz), lines: ["02:10 Read your first Ray again.", "02:31 Moved one signal from early to rising."] }, local(3, 2, 31));

  // ── The trip: a capture on day one, the bring-back on day two (I2, C3) ───
  const e07At = local(3, 16, 20);
  const e07 = say(undefined, "you", "The fault code is E07.", e07At, 0, 2000); // I2 "Capture · 28 Oct"
  add("evidence.added", { evidenceId: makeId(e07At), tripId: trip, kind: "note", note: "The fault code is E07." }, e07At);
  const backAt = local(2, 17, 30);
  add("evidence.added", { evidenceId: makeId(backAt), tripId: trip, kind: "photo" }, backAt); // C3 "Photo added"
  add("trip.reported", { tripId: trip, text: "It was a capacitor. The top was bulging, so I looked up why they fail, and it's heat, mostly heat." }, backAt + 41_000); // C3 · 0:41

  // ── Ray two (D1): what you found, your star, your markers, your call ────
  const twoAt = local(1, 18, 0);
  const two = makeId(twoAt);
  add("ray.started", { rayId: two, session: "ray", minutes: 45, pace: "normal" }, twoAt);
  say(two, "ra", MOMENT_LINES.found, twoAt, 1000);
  const found = say(two, "you", "A capacitor. The top was bulging, and I wanted to know why it failed, not just that it failed.", twoAt, 12_000, 9000); // D1 · 0:12
  say(two, "you", "Keep gran's lights on.", twoAt, 14 * MIN); // D2
  add("star.written", { text: "Keep the lights on for families like mine." }, twoAt + 16 * MIN); // D2
  add(
    "markers.named",
    {
      island: "Inverter firmware", // E4
      markers: [
        "I can explain why gran's inverter failed, without notes.",
        "A fix of mine is merged in an open firmware project.",
        "I've helped one other family get their power back.",
      ], // E5
    },
    twoAt + 24 * MIN,
  );
  add(
    "island.charted",
    {
      island: "Inverter firmware",
      inevitable: "More homes run on inverters every year.",
      adjacent: "You already write code. This is code that touches power.",
      yours: "Your voice lifted at “why it broke”.",
    },
    twoAt + 24 * MIN + 1000,
  ); // E4
  const call = makeId(twoAt + 32 * MIN);
  const question = "When will grid-edge energy work hire self-taught engineers?";
  add("dial.asked", { callId: call, question, reviewAt: lookAgain(now, tz) }, twoAt + 32 * MIN); // E6
  add("dial.call", { callId: call, claim: "2028", confidence: 0.6, reviewAt: lookAgain(now, tz) }, twoAt + 33 * MIN); // E6
  add("dial.read", { callId: call, text: "Direction looks solid; timing is the hard part. We look again in April.", from: 2027, to: 2030 }, twoAt + 34 * MIN); // E7
  add("ray.ended", { rayId: two, reason: "sunset" }, twoAt + 45 * MIN);

  // ── Last night (I3) ──────────────────────────────────────────────────────
  const night2 = local(0, 2, 10);
  add(
    "memory.inferred",
    {
      memoryId: lose,
      claim: "You lose track of time when you're fixing what keeps the power running.",
      confidence: 0.8,
      sources: [stop, e07, found],
      quotes: ["I didn't want to stop.", "the fault code is E07", "why it failed, not just that it failed"],
    },
    night2,
  ); // I2
  add(
    "watch.night_log",
    {
      night: nightKey(night2, tz),
      lines: ["02:10 Read Ray two again and updated three memories.", "02:14 Checked 14 sources on your route.", "02:31 Moved one signal from early to rising.", "02:40 Prepared Sunday's Reading."],
    },
    local(0, 2, 40),
  );

  return { events, field: "energy-ai", tz };
}

function nightKey(at: number, tz: number): string {
  return new Date(at + tz * MIN).toISOString().slice(0, 10);
}

/** E7: "Look again · 14 Apr": the next 14 April, in the person's time. */
function lookAgain(now: number, tz: number): number {
  const y = new Date(now + tz * MIN).getUTCFullYear();
  const at = Date.UTC(y, 3, 14, 9) - tz * MIN;
  return at > now ? at : Date.UTC(y + 1, 3, 14, 9) - tz * MIN;
}
