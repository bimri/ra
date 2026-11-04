import type { CrewKind, EventBodies, RaEvent, SessionKind, ShareItem, StageName } from "./events";
import { cleanName } from "./events";

// The shared reducer. The phone and the Mind run this same code, so a screen
// computed offline matches the one computed online exactly. It is pure: the
// same events in the same seq order always give the same views.

export interface RayView {
  rayId: string;
  session: SessionKind;
  landfallId?: string;
  markers?: {island:string;base:string[]};
  minutes: number;
  startedAt: number;
  stage: StageName | null;
  /** 0 at the start of a Ray, 1 when the sun has set. */
  sink: number;
  endedAt: number | null;
  utterances: number;
  /** Set while the Ray is paused; the sun holds (B3). */
  pausedAt: number | null;
  /** Total time spent paused, ms. */
  pausedMs: number;
}

export interface StarView {
  current: string | null;
  /** Oldest first. */
  history: { text: string; at: number; why?: string }[];
}

export interface MirrorView {
  mirrorId: string;
  rayId: string;
  text: string;
  quotes: string[];
  state: "offered" | "kept" | "struck";
}

export interface TripView extends Omit<EventBodies["trip.offered"], "tripId"> {
  tripId: string;
  state: "offered" | "chosen" | "reported";
  report: string | null;
  /** When it was brought back (C3). */
  reportedAt: number | null;
  /** Evidence brought back, by evidenceId. */
  evidenceIds: string[];
  /** When you picked it: day one of the trip. */
  chosenAt?: number;
}

export interface MemoryView {
  memoryId: string;
  claim: string;
  confidence: number;
  /** Utterance IDs, so "why do you think that?" can answer with your words. */
  sources: string[];
  /** The exact words, one per source. */
  quotes: string[];
  corrected: boolean;
}

export interface DialCallView {
  callId: string;
  question: string | null;
  /** Your call; "" while Ra has asked and you haven't answered (E6). */
  claim: string;
  reviewAt: number;
  confidence: number | null;
  basis?:import("./dial").DialBasis;
  reads: { text: string; at: number; from: number | null; to: number | null;basis?:import("./dial").DialBasis }[];
  outcomes:{text:string;status:"observed"|"not-yet"|"unclear";at:number;basis:import("./dial").DialBasis}[];
  observations:import("./dial").DialEvidence[];
  /** E8: each time you looked again, oldest first. */
  reviews: { at: number; claim: string; confidence: number; happened: string | null; sources: string[];observationId?:string;superseded?:boolean }[];
  /** Your call as it first was (E8 "You called"). */
  first: { claim: string; confidence: number | null } | null;
}

export interface ReadingView extends Omit<EventBodies["reading.prepared"], "readingId"> {
  readingId: string;
  preparedAt: number;
  /** The Ray it was read in; null while it waits on Today. */
  rayId: string | null;
}

export interface SeasonView extends Omit<EventBodies["season.prepared"], "seasonId"> {
  seasonId: string;
  rayId: string | null;
}

export interface IslandView {
  island: string;
  inevitable: string;
  adjacent: string;
  yours: string;
  at: number;
  proposal?: import("./routes").RouteProposal;
}

export interface Views {
  /** seq of the last event folded in; 0 for an empty mind. */
  seq: number;
  rays: Record<string, RayView>;
  /** The Ray in progress, if any. */
  liveRay: string | null;
  star: StarView;
  /** A2b: what Ra calls you; null until you say (or if you'd rather not). */
  person: { name: string | null };
  mirrors: Record<string, MirrorView>;
  trips: Record<string, TripView>;
  rings: { ringId: string; rayId: string | null; title: string; text: string; at: number }[];
  dial: Record<string, DialCallView>;
  memories: Record<string, MemoryView>;
  /** B7: questions kept at the end of Rays, newest last. */
  questions: { rayId: string; asked: string; leavingWith: string; at: number }[];
  /** E5: markers per island. `first` keeps the first wording, so goalposts never move quietly. */
  markerAchievements: (EventBodies["marker.reached"] & { at: number })[];
  arrivals: (EventBodies["landfall.prepared"] & { at: number; rayId: string | null })[];
  markers: Record<string, { markers: string[]; first: string[]; namedAt: number; changedAt: number | null }>;
  /** E4: islands on your route, in the order they were charted. */
  islands: Record<string, IslandView>;
  /** F1: weekly Readings, oldest first. */
  readings: ReadingView[];
  /** K2: season reviews, oldest first. */
  seasons: SeasonView[];
  /** H1: your beacon; null when it's never been lit. */
  beacon: { name: string; text: string; shines: "star" | "star+island"; lit: boolean } | null;
  /** H2: introductions Ra proposed to you, newest last. */
  intros: { introId: string; name: string; beacon: string; kind: CrewKind; why: string; at: number; answer: boolean | null }[];
  /** H3: your crew. */
  crew: { introId: string; name: string; beacon: string; kind: CrewKind; at: number; contact?: string | null; sharedContact?: string | null }[];
  /** H3: crewmates asking you to witness their landfall. */
  witnessAsks: { requestId: string; name: string; text: string; at: number; saw: boolean | null }[];
  /** G4: your landfalls, with who witnessed each. */
  landfalls: (EventBodies["landfall.made"] & { at: number; witnessedBy: string[] })[];
  /** G5: postcards that are live (revoked ones are gone). */
  shares: { token: string; landfallId: string; items: ShareItem[]; at: number }[];
  /** G3: then-and-now pairs of your own lines, newest last. */
  thenAndNow: { thenId: string; nowId: string; apart: string; at: number }[];
  /** K1: your voyages, newest last. */
  voyages: (EventBodies["voyage.started"] & { at: number; claims: { kind: "marker" | "landfall"; at: number; milestone?: string; markerIndex?: number }[] })[];
  /** Pay it forward: pledges you made. */
  pledges: { amountCents: number; currency: string; at: number; pledgeId?: string }[];
  /** Safety: people you blocked. */
  blocked: string[];
  /** A5: the Ear on WhatsApp. */
  ear: { linked: boolean; discreet: boolean };
  /** When the governor last reached you first, and why. */
  interrupts: { reason: EventBodies["interrupt.sent"]["reason"]; at: number }[];
  /** Lines for Today, newest last. */
  today: { text: string; source: "watch" | "dawn"; at: number }[];
  nightLogs: Record<string, string[]>;
  utterances: number;
  /** I1, U5: thoughts kept outside a Ray, and photos and clips brought back. */
  captures: number;
}

/**
 * Bump when the shape of Views changes. A saved copy with another version is
 * thrown away and rebuilt from the log, which is what the log is for.
 */
export const VIEWS_VERSION = 19;

export function emptyViews(): Views {
  return {
    seq: 0,
    rays: {},
    liveRay: null,
    star: { current: null, history: [] },
    person: { name: null },
    mirrors: {},
    trips: {},
    rings: [],
    dial: {},
    memories: {},
    questions: [],
    markerAchievements: [],
    arrivals: [],
    markers: {},
    islands: {},
    readings: [],
    seasons: [],
    interrupts: [],
    ear: { linked: false, discreet: true },
    beacon: null,
    intros: [],
    crew: [],
    witnessAsks: [],
    landfalls: [],
    shares: [],
    blocked: [],
    voyages: [],
    pledges: [],
    thenAndNow: [],
    today: [],
    nightLogs: {},
    utterances: 0,
    captures: 0,
  };
}

export class OutOfOrder extends Error {
  constructor(expected: number, got: number) {
    super(`expected seq ${expected}, got ${got}`);
    this.name = "OutOfOrder";
  }
}

type Handlers = { [K in keyof EventBodies]: (v: Views, b: EventBodies[K], e: RaEvent<K>) => void };

const on: Handlers = {
  "ray.started"(v, b, e) {
    v.rays[b.rayId] = {
      rayId: b.rayId,
      session: b.session,
      ...(b.landfallId ? { landfallId: b.landfallId } : {}),
      ...(b.markers?{markers:{island:b.markers.island,base:[...b.markers.base]}}:{}),
      minutes: b.minutes,
      startedAt: e.at,
      stage: null,
      sink: 0,
      endedAt: null,
      utterances: 0,
      pausedAt: null,
      pausedMs: 0,
    };
    v.liveRay = b.rayId;
    if (b.landfallId) { const arrival = v.arrivals.find((a) => a.landfallId === b.landfallId); if (arrival) arrival.rayId = b.rayId; }
    // A Reading or a season review is read in the session that opens it.
    if (b.session === "reading") {
      const r = v.readings.findLast((x) => x.rayId === null);
      if (r) r.rayId = b.rayId;
    } else if (b.session === "season") {
      const s = v.seasons.findLast((x) => x.rayId === null);
      if (s) s.rayId = b.rayId;
    }
  },
  "ray.stage"(v, b) {
    const ray = v.rays[b.rayId];
    if (!ray) return;
    ray.stage = b.stage;
    ray.sink = clamp01(b.sink);
  },
  "ray.paused"(v, b, e) {
    const ray = v.rays[b.rayId];
    if (ray && ray.pausedAt === null && ray.endedAt === null) ray.pausedAt = e.at;
  },
  "ray.resumed"(v, b, e) {
    const ray = v.rays[b.rayId];
    if (!ray || ray.pausedAt === null) return;
    ray.pausedMs += Math.max(0, e.at - ray.pausedAt);
    ray.pausedAt = null;
  },
  "ray.ended"(v, b, e) {
    const ray = v.rays[b.rayId];
    if (!ray) return;
    if (ray.pausedAt !== null) {
      ray.pausedMs += Math.max(0, e.at - ray.pausedAt);
      ray.pausedAt = null;
    }
    ray.endedAt = e.at;
    if (b.reason === "sunset") ray.sink = 1;
    if (v.liveRay === b.rayId) v.liveRay = null;
  },
  utterance(v, b) {
    v.utterances += 1;
    if (b.rayId) {
      const ray = v.rays[b.rayId];
      if (ray) ray.utterances += 1;
    } else if (b.speaker === "you") {
      // A thought kept outside a Ray (C2) is a capture.
      v.captures += 1;
    }
  },
  "mirror.offered"(v, b) {
    v.mirrors[b.mirrorId] = { mirrorId: b.mirrorId, rayId: b.rayId, text: b.text, quotes: [...b.quotes], state: "offered" };
  },
  "mirror.kept"(v, b) {
    const m = v.mirrors[b.mirrorId];
    if (m) m.state = "kept";
  },
  "mirror.struck"(v, b) {
    const m = v.mirrors[b.mirrorId];
    if (m) m.state = "struck";
  },
  "person.named"(v, b) {
    v.person.name = cleanName(b.name);
  },
  "star.written"(v, b, e) {
    v.star.current = b.text;
    v.star.history.push({ text: b.text, at: e.at });
  },
  "star.revised"(v, b, e) {
    v.star.current = b.text;
    v.star.history.push(b.why === undefined ? { text: b.text, at: e.at } : { text: b.text, at: e.at, why: b.why });
  },
  "window.shown"() {
    // Horizon signals live in the HorizonDO; the window only records that it was shown.
  },
  "trip.offered"(v, b) {
    const { tripId, ...rest } = b;
    v.trips[tripId] = { tripId, ...rest, sources: [...b.sources], state: "offered", report: null, reportedAt: null, evidenceIds: [] };
  },
  "trip.chosen"(v, b, e) {
    const t = v.trips[b.tripId];
    if (t && t.state === "offered") {
      t.state = "chosen";
      t.chosenAt = e.at;
    }
  },
  "trip.reported"(v, b, e) {
    const t = v.trips[b.tripId];
    if (!t) return;
    t.state = "reported";
    t.report = b.text;
    t.reportedAt = e.at;
  },
  "evidence.added"(v, b) {
    // Photos and clips are captures; a note is the words of a thought already counted.
    if (b.kind !== "note") v.captures += 1;
    if (!b.tripId) return;
    const t = v.trips[b.tripId];
    if (t) t.evidenceIds.push(b.evidenceId);
  },
  "ring.added"(v, b, e) {
    v.rings.push({ ringId: b.ringId, rayId: b.rayId ?? null, title: b.title, text: b.text, at: e.at });
  },
  "question.kept"(v, b, e) {
    v.questions.push({ rayId: b.rayId, asked: b.asked, leavingWith: b.leavingWith, at: e.at });
  },
  "marker.reached"(v, b, e) {
    if (!v.markerAchievements.some((a) => a.achievementId === b.achievementId)) v.markerAchievements.push({ ...b, at: e.at });
  },
  "landfall.prepared"(v, b, e) {
    if (!v.arrivals.some((a) => a.landfallId === b.landfallId)) v.arrivals.push({ ...b, at: e.at, rayId: null });
  },
  "markers.named"(v, b, e) {
    const had = v.markers[b.island];
    v.markers[b.island] = had
      ? { markers: [...b.markers], first: had.first, namedAt: had.namedAt, changedAt: e.at }
      : { markers: [...b.markers], first: [...b.markers], namedAt: e.at, changedAt: null };
  },
  "island.charted"(v, b, e) {
    v.islands[b.island] = { ...b, ...(b.proposal?{proposal:structuredClone(b.proposal)}:{}), at: e.at };
  },
  "dial.asked"(v, b) {
    v.dial[b.callId] = { callId: b.callId, question: b.question, claim: "", reviewAt: b.reviewAt, confidence: null, reads: [], outcomes:[],observations:[],reviews: [], first: null,...(b.basis?{basis:structuredClone(b.basis)}:{}) };
  },
  "dial.call"(v, b) {
    const asked = v.dial[b.callId];
    v.dial[b.callId] = {
      callId: b.callId,
      question: b.question ?? asked?.question ?? null,
      claim: b.claim,
      reviewAt: b.reviewAt,
      confidence: b.confidence ?? null,
      reads: asked?.reads ?? [],
      outcomes:asked?.outcomes??[],...(asked?.basis?{basis:structuredClone(asked.basis)}:{}),
      observations:asked?.observations??[],
      reviews: asked?.reviews ?? [],
      first: asked?.first ?? { claim: b.claim, confidence: b.confidence ?? null },
    };
  },
  "dial.reviewed"(v, b, e) {
    const c = v.dial[b.callId];
    if (!c) return;
    const superseded=b.previousReviewAt!==undefined&&b.previousReviewAt!==c.reviewAt;
    c.reviews.push({ at: e.at, claim: b.claim, confidence: b.confidence, happened: b.happened ?? null, sources: [...(b.sources ?? [])],...(b.observationId?{observationId:b.observationId}:{}),...(superseded?{superseded:true}:{}) });
    if(superseded)return;
    c.claim = b.claim;
    c.confidence = b.confidence;
    c.reviewAt = b.nextReviewAt;
  },
  "reading.prepared"(v, b, e) {
    v.readings.push({ ...b, moved: [...b.moved], calls: [...b.calls], ...(b.horizon?{horizon:structuredClone(b.horizon)}:{}), preparedAt: e.at, rayId: null });
  },
  "dial.observed"(v,b){const call=v.dial[b.callId];if(call&&!call.observations.some(snapshot=>snapshot.snapshotId===b.snapshot.snapshotId))call.observations.push(structuredClone(b.snapshot))},
  "season.prepared"(v, b) {
    v.seasons.push({ ...b, rayId: null });
  },
  "beacon.lit"(v, b) {
    v.beacon = { ...b, lit: true };
  },
  "beacon.dimmed"(v) {
    if (v.beacon) v.beacon.lit = false;
  },
  "intro.proposed"(v, b, e) {
    v.intros.push({ ...b, at: e.at, answer: null });
  },
  "intro.answered"(v, b) {
    const i = v.intros.find((x) => x.introId === b.introId);
    if (i) i.answer = b.yes;
  },
  "crew.contact"(v, b) {
    const crew = v.crew.find((c) => c.introId === b.introId);
    if (crew) { crew.contact = b.received; crew.sharedContact = b.shared; }
  },
  "crew.left"(v, b) {
    v.crew = v.crew.filter((c) => c.introId !== b.introId);
    v.intros = v.intros.filter((i) => i.introId !== b.introId);
  },
  "crew.joined"(v, b, e) {
    if (!v.crew.some((c) => c.introId === b.introId)) v.crew.push({ ...b, at: e.at });
  },
  "witness.asked"(v, b, e) {
    v.witnessAsks.push({ ...b, at: e.at, saw: null });
  },
  "witness.answered"(v, b) {
    const w = v.witnessAsks.find((x) => x.requestId === b.requestId);
    if (w) w.saw = b.saw;
  },
  "witness.added"(v, b) {
    const l = v.landfalls.find((x) => x.landfallId === b.landfallId);
    if (l && !l.witnessedBy.includes(b.name)) l.witnessedBy.push(b.name);
  },
  "landfall.made"(v, b, e) {
    v.landfalls.push({ ...b, markers: b.markers.map((m) => ({ ...m })), witnesses: [...b.witnesses], at: e.at, witnessedBy: [] });
  },
  "share.made"(v, b, e) {
    v.shares.push({ token: b.token, landfallId: b.landfallId, items: [...b.items], at: e.at });
  },
  "share.revoked"(v, b) {
    v.shares = v.shares.filter((s) => s.token !== b.token);
  },
  "then.paired"(v, b, e) {
    v.thenAndNow.push({ ...b, at: e.at });
  },
  "voyage.started"(v, b, e) {
    if (!v.voyages.some(x => x.voyageId === b.voyageId)) v.voyages.push({ ...b, at: b.startedAt ?? e.at, claims: [] });
  },
  "voyage.claimed"(v, b, e) {
    v.voyages.find((x) => x.voyageId === b.voyageId)?.claims.push({ kind: b.kind, at: e.at, ...(b.milestone ? { milestone: b.milestone } : {}), ...(b.markerIndex !== undefined ? { markerIndex: b.markerIndex } : {}) });
  },
  "pledge.made"(v, b, e) {
    if (!b.pledgeId || !v.pledges.some((p) => p.pledgeId === b.pledgeId)) v.pledges.push({ ...b, at: e.at });
  },
  "person.blocked"(v, b) {
    if (!v.blocked.includes(b.name)) v.blocked.push(b.name);

  },
  "ear.linked"(v, b) {
    v.ear = { linked: true, discreet: b.discreet };
  },
  "ear.unlinked"(v) {
    v.ear = { linked: false, discreet: true };
  },
  "interrupt.sent"(v, b, e) {
    v.interrupts.push({ reason: b.reason, at: e.at });
  },
  "dial.read"(v, b, e) {
    v.dial[b.callId]?.reads.push({ text: b.text, at: e.at, from: b.from ?? null, to: b.to ?? null,...(b.basis?{basis:structuredClone(b.basis)}:{}) });
  },
  "dial.outcome"(v,b,e){v.dial[b.callId]?.outcomes.push({text:b.text,status:b.status,at:e.at,basis:structuredClone(b.basis)})},
  "memory.inferred"(v, b) {
    v.memories[b.memoryId] = {
      memoryId: b.memoryId,
      claim: b.claim,
      confidence: clamp01(b.confidence),
      sources: [...b.sources],
      quotes: [...(b.quotes ?? [])],
      corrected: false,
    };
  },
  "memory.corrected"(v, b) {
    if (b.forget) {
      delete v.memories[b.memoryId];
      return;
    }
    const m = v.memories[b.memoryId];
    if (!m) return;
    if (b.claim !== undefined) m.claim = b.claim;
    m.corrected = true;
    // What you said about yourself outranks what Ra inferred.
    m.confidence = 1;
  },
  "watch.night_log"(v, b) {
    v.nightLogs[b.night] = [...b.lines];
  },
  "today.line"(v, b, e) {
    v.today.push({ text: b.text, source: b.source, at: e.at });
  },
};

/**
 * Fold one event into the views, in place. Events must arrive in seq order
 * with no gaps; anything else means the mirror is out of sync and must
 * re-fetch, never guess.
 */
export function apply(views: Views, event: RaEvent): Views {
  if (event.seq !== views.seq + 1) throw new OutOfOrder(views.seq + 1, event.seq);
  const handler = on[event.kind] as (v: Views, b: unknown, e: RaEvent) => void;
  handler(views, event.body, event);
  views.seq = event.seq;
  return views;
}

/** Compute views from scratch, or continue from a saved copy. */
export function project(events: Iterable<RaEvent>, from: Views = emptyViews()): Views {
  const views = structuredClone(from);
  for (const e of events) apply(views, e);
  return views;
}

/**
 * How far the sun has set in a Ray, 0..1: daylight used over the Ray's
 * length, with paused time held back (the sun waits while you think).
 */
export function sunSink(ray: RayView, now: number): number {
  const end = ray.endedAt ?? now;
  const paused = ray.pausedMs + (ray.pausedAt !== null ? Math.max(0, end - ray.pausedAt) : 0);
  const used = Math.max(0, end - ray.startedAt - paused);
  return clamp01(used / (ray.minutes * 60_000));
}

/** Dial calls whose review date has come, oldest first. */
export function dueCalls(views: Views, now: number): DialCallView[] {
  return Object.values(views.dial)
    .filter((c) => c.reviewAt <= now)
    .sort((a, b) => a.reviewAt - b.reviewAt);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
