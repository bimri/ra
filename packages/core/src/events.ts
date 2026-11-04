// The event log is the record. Every screen is a view computed from it by the
// shared reducer (./reducer.ts), on the phone and in the Mind alike.
//
// An event is made on a device with a client ID and no seq. The Mind assigns
// the seq when it appends; seq is the order every view is computed in.
// Later layers add kinds (reading.*, season.*, landfall.*, beacon.*, …)
// without changing the ones here.

/** H3: the four kinds of crewmate matching looks for. */
export type CrewKind = "same-star" | "neighbouring-star" | "ahead" | "behind";
/** G5: what can travel with a landfall postcard. */
export type ShareItem = "markers" | "voice" | "star" | "rings";

/** A sealed weekly snapshot, with sources preserved even after the shared Horizon refreshes. */
export interface ReadingHorizon {
  version: 1;
  field: string | null;
  checkedAt: number;
  available: boolean;
  /** Content fingerprints, independent of a refresh's generated IDs and fetch time. */
  observed: string[];
  changes: { id: string; kind: string; text: string; at: number; sources: string[]; timing?: string; direction?: string;verification?:import("./horizon").HorizonVerification }[];
}

export type SessionKind = "first" | "ray" | "reading" | "season" | "landfall" | "markers";
export type Pace = "normal" | "demo";
export type Speaker = "you" | "ra";

/** Stages of the Ray director. Each has its own instructions file in @ra/prompts. */
export type StageName =
  | "found" // Ray 2 onward: "What did you find?"
  | "open"
  | "story"
  | "energy"
  | "mirror"
  | "window"
  | "question"
  | "trips"
  | "ring"
  | "star" // Ray 2 (D2): you write your star
  | "markers" // Ray 2 (E5): how you'll know you've reached your island
  | "care" // pain came up: care, not treatment
  // F1 · the Reading, weekly
  | "moved" // what moved on your horizon
  | "rings" // what your rings show
  | "putoff" // one question you've been putting off
  | "calls" // calls that are due
  | "close" // the session ends without a ring
  // K2 · the season review (calls and star are shared with the Reading and Ray two)
  | "route" // still pointing at your star?
  | "crew"
  | "arrival" | "arrival-witness" | "arrival-confirm"; // check in with your crew

export interface Prosody {
  /** Mean loudness 0..1 over the utterance. */
  loudness: number;
  /** Moments where your energy lifted above your own baseline, in ms from utterance start. */
  lifts?: number[];
  /** Which words (by position in the text, split on spaces) were said with lifted energy. The mirror (B5) picks from these. */
  liftWords?: number[];
}

export interface EventBodies {
  "ray.started": { rayId: string; session: SessionKind; minutes: number; pace: Pace; landfallId?: string; markers?: {island:string;base:string[]} };
  "ray.stage": { rayId: string; stage: StageName; sink: number };
  "ray.ended": { rayId: string; reason: "sunset" | "person" | "dropped" };
  /** The sun holds while you think (B3). */
  "ray.paused": { rayId: string };
  "ray.resumed": { rayId: string };
  utterance: {
    utteranceId: string;
    rayId?: string;
    speaker: Speaker;
    text: string;
    startMs: number;
    endMs: number;
    prosody?: Prosody;
    /** R2 key for the audio of this line. */
    audioKey?: string;
    /** Version of the prompts that produced a line of Ra's. */
    promptVersion?: string;
    /** Ra's line was cut off by barge-in. */
    cut?: boolean;
    /** Kept from the Ear (WhatsApp) rather than the app. */
    via?: "ear";
    /** Text explicitly reviewed/filed through Pocket; original media never accompanies it. */
    filed?: {captureId:string;filing:"thought"|"view"|"ray"|"evidence";reviewHash:string;tripId?:string};
  };
  "mirror.offered": { mirrorId: string; rayId: string; text: string; quotes: string[] };
  "mirror.kept": { mirrorId: string };
  "mirror.struck": { mirrorId: string };
  /** A2b: what Ra calls you. null when you'd rather not say. */
  "person.named": { name: string | null };
  "star.written": { text: string };
  "star.revised": { text: string; why?: string };
  "window.shown": { rayId: string; signals: string[] };
  "trip.offered": {
    tripId: string;
    rayId?: string;
    /** What you'll do, in a line (B8: "Find out why gran's inverter failed"). */
    title?: string;
    /** What the trip tests (B9 "Tests"). */
    purpose: string;
    action: string;
    cost: string;
    evidence: string;
    whyNow: string;
    sources: string[];
  };
  "trip.chosen": { tripId: string };
  "trip.reported": { tripId: string; text: string; utteranceId?: string };
  "evidence.added": {
    evidenceId: string;
    tripId?: string;
    kind: "photo" | "clip" | "note";
    r2Key?: string;
    note?: string;
  };
  "ring.added": { ringId: string; rayId?: string; title: string; text: string; quotes?: string[] };
  /** B7: the question you came in with, and the one you leave with, in your words. */
  "question.kept": { rayId: string; asked: string; leavingWith: string };
  /** E5: how you'll know you've reached an island, in your own terms. Changes keep the first wording. */
  "marker.reached": { achievementId: string; island: string; markerId: string; marker: string; evidence: string };
  "landfall.prepared": { landfallId: string; island: string; markers: { markerId: string; text: string; achievementId: string; evidence: string }[]; said: string; witnesses: { introId: string; name: string }[] };
  "markers.named": { island: string; markers: string[] };
  /** E4: why an island is on your route. Inevitable (the sky), adjacent (where you stand), yours (your own words). */
  "island.charted": { island: string; inevitable: string; adjacent: string; yours: string; proposal?: import("./routes").RouteProposal };
  /** E6: your call on a question about your horizon ("2028", 60% sure), made before you see Ra's read. */
  /** E6: Ra asks a timing question about your horizon. Your call comes first; Ra's read stays hidden until you make it. */
  "dial.asked": { callId: string; question: string; reviewAt: number;basis?:import("./dial").DialBasis };
  "dial.call": { callId: string; question?: string; claim: string; reviewAt: number; confidence?: number };
  /** E7: Ra's read, as a range of years when it has one ("2027 to 2030"). */
  "dial.read": { callId: string; text: string; from?: number; to?: number;basis?:import("./dial").DialBasis };
  "dial.outcome": {callId:string;text:string;status:"observed"|"not-yet"|"unclear";basis:import("./dial").DialBasis};
  "dial.observed": {callId:string;snapshot:import("./dial").DialEvidence};
  "memory.inferred": {
    memoryId: string;
    claim: string;
    confidence: number;
    /** Utterance IDs of the person's own words it came from. */
    sources: string[];
    /** The exact words, in the same order as sources (I2 "Where this comes from"). */
    quotes?: string[];
  };
  "memory.corrected": { memoryId: string; claim?: string; forget?: boolean };
  "watch.night_log": { night: string; lines: string[] };
  "today.line": { text: string; source: "watch" | "dawn" };
  /** F1: the week, prepared on Saturday night from your own Mind (WeeklyReading). */
  "reading.prepared": {
    readingId: string;
    /** The week it covers, as "2026-10-26". */
    week: string;
    /** Signals on your horizon that moved this week, in their own words. */
    moved: string[];
    /** Absent on legacy Readings. New Readings retain evidence and explicit availability. */
    horizon?: ReadingHorizon;
    /** "This week you brought back one trip…": what your rings show. */
    rings: string;
    /** A clip of yours from the week worth hearing again (F1 "Thursday 0:58"). */
    clip?: { utteranceId: string; label: string; ms: number };
    /** A question you kept and haven't come back to, in your words. */
    putoff: string | null;
    /** Dial calls whose look-again date has come. */
    calls: string[];
  };
  /** K2: three months, prepared by SeasonReview. Its ring is drawn at the end of the review. */
  "season.prepared": {
    seasonId: string;
    /** "Oct–Dec 2026". */
    label: string;
    from: number;
    to: number;
    calls: string;
    crew: string | null;
    /** "one trip a week, one island begun". */
    ring: string;
  };
  /** E8: you looked at a call again; your call now, and when you'll look next. */
  "dial.reviewed": { callId: string; claim: string; confidence: number; nextReviewAt: number; happened?: string; sources?: string[]; observationId?:string;previousReviewAt?:number };
  // ── Layer 3: people. D1 holds only what you made findable; your Mind keeps your side. ──
  /** H1: your beacon, in your words. What shines: your star, or your star and island. */
  "beacon.lit": { name: string; text: string; shines: "star" | "star+island" };
  "beacon.dimmed": Record<string, never>;
  /** H2: Ra proposes someone; you see their beacon, in their words. */
  "intro.proposed": { introId: string; name: string; beacon: string; kind: CrewKind; why: string };
  "intro.answered": { introId: string; yes: boolean };
  /** H3: two yeses. You're crew; talk wherever you like. */
  "crew.joined": { introId: string; name: string; beacon: string; kind: CrewKind };
  /** G4: a crewmate asks you to witness their landfall. */
  "witness.asked": { requestId: string; name: string; text: string };
  "witness.answered": { requestId: string; saw: boolean };
  /** G4: a crewmate saw your landfall. Written after D1 confirms you share a crew. */
  "witness.added": { landfallId: string; name: string };
  /** G4 · Landfall: you say you've arrived, with your evidence against the markers you named. */
  "landfall.made": {
    landfallId: string;
    island: string;
    markers: { text: string; evidence: string }[];
    /** In your words: what it's like now. */
    said: string;
    /** Crewmates asked to witness it. */
    witnesses: string[];
    witnessIntroIds?: string[];
  };
  /** G5: a postcard of a landfall, at a link that can't be guessed; only what you switched on. */
  "share.made": { token: string; landfallId: string; items: ShareItem[] };
  "share.revoked": { token: string };
  /** Safety: someone you never want to meet through Ra. Their name only, as you knew it. */
  "person.blocked": { name: string; reported: boolean };
  // ── Layer 4: voyages. The ledger is its own database; your Mind knows only your side. ──
  /** K1: a route to one island; free, priced where you live, or funded (and Ra always says by whom). */
  "voyage.started": {
    voyageId: string;
    /** Original ledger start, retained when event delivery is retried later. */
    startedAt?: number;
    markerIds?: string[];
    markerTexts?: string[];
    island: string;
    funder: { name: string; mission: string } | null;
    price: { amountCents: number; currency: string } | null;
  };
  /** K1: you shared a signed claim of a marker or landfall with your funder. Nothing else went. */
  "voyage.claimed": { voyageId: string; kind: "marker" | "landfall"; milestone?: string; markerIndex?: number };
  /** Pay it forward: a pledge toward someone else's voyage. */
  "pledge.made": { amountCents: number; currency: string; pledgeId?: string };
  /** G3: you, explaining the same thing months apart. Paired by the Watch from your own lines. */
  "crew.contact": { introId: string; received: string | null; shared: string | null };
  "crew.left": { introId: string };
  "then.paired": { thenId: string; nowId: string; apart: string; night?: string };
  /** A5: the Ear is linked (the WhatsApp ID itself lives only as a keyed hash in D1). */
  "ear.linked": { discreet: boolean };
  "ear.unlinked": Record<string, never>;
  /** The governor reached you first, for one of its four reasons. Never with content. */
  "interrupt.sent": { reason: "on-ramp" | "call-due" | "introduction" | "quiet"; via: ("push" | "ear")[] };
}

export type EventKind = keyof EventBodies;

export const EVENT_KINDS = [
  "ray.started",
  "ray.stage",
  "ray.ended",
  "ray.paused",
  "ray.resumed",
  "utterance",
  "mirror.offered",
  "mirror.kept",
  "mirror.struck",
  "person.named",
  "star.written",
  "star.revised",
  "window.shown",
  "trip.offered",
  "trip.chosen",
  "trip.reported",
  "evidence.added",
  "ring.added",
  "question.kept",
  "marker.reached",
  "landfall.prepared",
  "markers.named",
  "island.charted",
  "dial.asked",
  "dial.call",
  "dial.read",
  "dial.observed",
  "dial.outcome",
  "memory.inferred",
  "memory.corrected",
  "watch.night_log",
  "today.line",
  "reading.prepared",
  "season.prepared",
  "dial.reviewed",
  "interrupt.sent",
  "ear.linked",
  "crew.contact",
  "crew.left",
  "then.paired",
  "voyage.started",
  "voyage.claimed",
  "pledge.made",
  "beacon.lit",
  "beacon.dimmed",
  "intro.proposed",
  "intro.answered",
  "crew.joined",
  "witness.asked",
  "witness.answered",
  "witness.added",
  "landfall.made",
  "share.made",
  "share.revoked",
  "person.blocked",
  "ear.unlinked",
] as const satisfies readonly EventKind[];

// Compile-time check that EVENT_KINDS lists every kind.
type _Missing = Exclude<EventKind, (typeof EVENT_KINDS)[number]>;
const _allKindsListed: _Missing extends never ? true : _Missing = true;
void _allKindsListed;

const KIND_SET: ReadonlySet<string> = new Set(EVENT_KINDS);

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/** Personal edits may queue offline; session, people and earned achievements use checked actions. */
export function isPhoneEditKind(kind: string): boolean {
  return ["dial.call", "dial.reviewed", "memory.corrected", "markers.named", "star.written", "star.revised", "person.named", "trip.chosen"].includes(kind);
}

/** An event as a device makes it: no seq yet. */
export interface EventDraft<K extends EventKind = EventKind> {
  /** Made on the device it came from (see ids.ts). */
  id: string;
  kind: K;
  /** Device clock, ms since epoch. */
  at: number;
  /** Which device wrote it. */
  device: string;
  body: EventBodies[K];
}

/** An event once the Mind has appended it. */
export interface RaEvent<K extends EventKind = EventKind> extends EventDraft<K> {
  seq: number;
}

/** Narrow a union event to one kind. */
export type EventOf<K extends EventKind> = RaEvent<K>;

export function draft<K extends EventKind>(
  kind: K,
  body: EventBodies[K],
  meta: { id: string; at: number; device: string },
): EventDraft<K> {
  return { id: meta.id, kind, at: meta.at, device: meta.device, body };
}

/** A name as Ra keeps it: one line, at most 40 characters; empty means none. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[p{Cc}p{Cf}]/gu, "").replace(/s+/g, " ").trim().slice(0, 40).trim();
  return name || null;
}
