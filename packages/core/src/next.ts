import type { Views } from "./reducer";
import { currentIsland } from "./routes";

// What this person should do next, decided the same way everywhere: Today's
// Next card, the ring's Next card, the Next bar on every screen, Ra's opening
// when they come back, and the governor. It always ends in a Ray, so the path
// never stalls: when nothing else is waiting, Ra is.

export const DAY_MS = 86_400_000;
/** A scouting trip runs over two days (B9). */
export const TRIP_DAYS = 2;

export type NextKind =
  | "ray.continue"
  | "trips.pick"
  | "trip.day"
  | "trip.tell"
  | "reading"
  | "season"
  | "dial.call"
  | "dial.review"
  | "intro"
  | "star"
  | "route"
  | "markers.name"
  | "marker"
  | "landfall"
  | "ray";

export interface NextStep {
  kind: NextKind;
  /** What to do, in a line: the Next card's title. */
  title: string;
  /** Why now, or what it is, in a short line. */
  why: string;
  /** Where it happens. */
  href: string;
  /** The button. */
  cta: string;
  /** Waiting on them, rather than something they could do. */
  urgent: boolean;
}

/** Which day of a chosen trip it is, 1-based; past TRIP_DAYS once it has run. */
export function tripDay(chosenAt: number, now: number): number {
  return 1 + Math.max(0, Math.floor((now - chosenAt) / DAY_MS));
}

/** The trip they're on: chosen, not yet brought back. Newest first. */
export function runningTrip(v: Views) {
  return Object.values(v.trips).filter((t) => t.state === "chosen").sort((a, b) => (b.chosenAt ?? 0) - (a.chosenAt ?? 0))[0] ?? null;
}

/** Trips offered and not yet chosen, waiting to be picked (B8). */
export function waitingTrips(v: Views) {
  if (runningTrip(v)) return [];
  // Once you've picked one of a Ray's trips, the others are set aside, not waiting.
  const all = Object.values(v.trips);
  const picked = new Set(all.filter((t) => t.state !== "offered").map((t) => t.rayId ?? ""));
  const offered = all.filter((t) => t.state === "offered" && !picked.has(t.rayId ?? ""));
  // Only the newest Ray's trips: older ones were made for who you were then.
  const latest = offered.at(-1)?.rayId;
  return offered.filter((t) => t.rayId === latest);
}

const firstSentence = (text: string) => text.split(/(?<=[.!?])\s/)[0]!.trim();

/** Every step worth taking now, most pressing first. Never empty: the last is always a Ray. */
export function nextFor(v: Views, now: number): NextStep[] {
  const steps: NextStep[] = [];
  const add = (s: NextStep) => steps.push(s);
  const rays = Object.values(v.rays);
  const live = v.liveRay ? v.rays[v.liveRay] : undefined;

  // A Ray in progress comes before everything: it waits with the sun held.
  if (live && live.endedAt === null)
    add({ kind: "ray.continue", title: "Continue your Ray", why: live.pausedAt !== null ? "Paused. The sun is holding." : "It's still going.", href: "/ray", cta: "Continue", urgent: true });

  const picking = waitingTrips(v);
  if (picking.length)
    add({ kind: "trips.pick", title: picking.length === 1 ? "A trip is waiting" : "Pick a trip", why: `${picking.length === 1 ? "One trip" : `${picking.length} trips`}, made from what you said. Each takes ${TRIP_DAYS} days.`, href: "/trips", cta: "See the trips", urgent: true });

  const trip = runningTrip(v);
  if (trip) {
    const day = tripDay(trip.chosenAt ?? now, now);
    const title = trip.title ?? firstSentence(trip.action);
    add(
      day <= TRIP_DAYS
        ? { kind: "trip.day", title, why: `Day ${day} of ${TRIP_DAYS}. ${firstSentence(trip.action)}`, href: "/bring-back", cta: "Bring something back", urgent: false }
        : { kind: "trip.day", title, why: "Your trip has run. Bring back what you found, even if it's little.", href: "/bring-back", cta: "Bring it back", urgent: true },
    );
  }

  // Brought back, and no Ray since: Ra wants to hear it.
  const reported = Object.values(v.trips).filter((t) => t.state === "reported" && t.reportedAt !== null).sort((a, b) => b.reportedAt! - a.reportedAt!)[0];
  if (reported && !rays.some((r) => r.startedAt > reported.reportedAt! && r.session !== "markers"))
    add({ kind: "trip.tell", title: "Tell Ra what you found", why: reported.title ?? firstSentence(reported.action), href: "/ray", cta: "Start a Ray", urgent: true });

  const season = v.seasons.findLast((s) => s.rayId === null);
  if (season) add({ kind: "season", title: "Your season review", why: "Three months to look at together.", href: "/ray?session=season", cta: "Start the review", urgent: true });
  const reading = v.readings.findLast((r) => r.rayId === null);
  if (reading) add({ kind: "reading", title: "This week's Reading", why: reading.rings, href: "/ray?session=reading", cta: "Start the Reading", urgent: true });

  const calls = Object.values(v.dial);
  const asked = calls.find((c) => c.claim === "" && c.question);
  if (asked) add({ kind: "dial.call", title: "Make your call", why: asked.question!, href: `/chart/dial?id=${encodeURIComponent(asked.callId)}`, cta: "Make it", urgent: false });
  const due = calls.filter((c) => c.claim !== "" && c.reviewAt <= now).sort((a, b) => a.reviewAt - b.reviewAt)[0];
  if (due) add({ kind: "dial.review", title: "Look again at your call", why: due.question ?? due.claim, href: `/chart/dial/review?id=${encodeURIComponent(due.callId)}`, cta: "Look again", urgent: true });

  const intro = v.intros.filter((i) => i.answer === null).at(-1);
  if (intro) add({ kind: "intro", title: "Someone is steering by a star like yours", why: "Would you like to meet? It takes two yeses.", href: `/intro?id=${encodeURIComponent(intro.introId)}`, cta: "See who", urgent: true });

  // The path itself: star, route, island, markers, landfall.
  const ended = rays.filter((r) => r.endedAt !== null);
  if (!v.star.current) {
    if (ended.length) add({ kind: "star", title: "Find your star", why: "Only you write it. A Ray is where it comes.", href: "/ray", cta: "Start a Ray", urgent: false });
  } else {
    const island = currentIsland(v);
    const landed = island ? v.landfalls.some((l) => l.island === island) : false;
    if (!island || landed)
      add({ kind: "route", title: landed ? "Chart your next island" : "Chart your first island", why: landed ? `You made landfall on ${island}. What's next toward your star?` : "One capability on the way to your star.", href: "/chart/route", cta: "Chart it", urgent: false });
    else {
      const named = v.markers[island]?.markers ?? [];
      const reached = new Set(v.markerAchievements.filter((a) => a.island === island).map((a) => a.marker));
      const open = named.filter((m) => !reached.has(m));
      const q = `island=${encodeURIComponent(island)}`;
      if (!named.length) add({ kind: "markers.name", title: `Name your markers for ${island}`, why: "How you'll know you've arrived, in your words.", href: `/chart/markers?${q}`, cta: "Name them", urgent: false });
      else if (open.length) add({ kind: "marker", title: open[0]!, why: `${island} · ${named.length - open.length} of ${named.length} markers reached.`, href: `/chart/markers?${q}`, cta: "Record it", urgent: false });
      else add({ kind: "landfall", title: `Make landfall on ${island}`, why: "Every marker is reached. Look at it with Ra.", href: `/landfall?${q}`, cta: "Make landfall", urgent: false });
    }
  }

  add(
    ended.length
      ? { kind: "ray", title: "Talk it through with Ra", why: "Whatever's on your mind.", href: "/ray", cta: "Start a Ray", urgent: false }
      : { kind: "ray", title: "Your first Ray", why: "Ra listens, then helps you find your way.", href: "/ray", cta: "Start your first Ray", urgent: false },
  );
  // A live Ray makes every other "Start a Ray" a continue.
  return live && live.endedAt === null ? steps.filter((s, i) => i === 0 || s.href.split("?")[0] !== "/ray") : steps;
}

export type SinceKind = "trips" | "watch" | "ring" | "dial" | "reading" | "season" | "intro" | "landfall" | "today";

export interface SinceItem {
  kind: SinceKind;
  at: number;
  text: string;
  href?: string;
}

/** What happened while they were away, newest first, at most `max` (U3b "Since you were here"). */
export function sinceLastVisit(v: Views, lastSeen: number, now: number, max = 3): SinceItem[] {
  const items: SinceItem[] = [];
  const offered = Object.values(v.trips).filter((t) => t.state === "offered");
  // Trips carry no offered time; a trip from a Ray that ended after the last visit is new.
  const newTrips = offered.filter((t) => {
    const ray = t.rayId ? v.rays[t.rayId] : undefined;
    return !ray || (ray.endedAt ?? ray.startedAt) > lastSeen;
  });
  const tripsAt = Math.max(lastSeen + 1, ...newTrips.map((t) => (t.rayId ? (v.rays[t.rayId]?.endedAt ?? 0) : 0)));
  if (newTrips.length && !runningTrip(v)) items.push({ kind: "trips", at: tripsAt, text: newTrips.length === 1 ? "A trip is ready" : `${newTrips.length} trips are ready`, href: "/trips" });
  for (const line of v.today) if (line.at > lastSeen) items.push({ kind: "today", at: line.at, text: line.text });
  for (const ring of v.rings) if (ring.at > lastSeen) items.push({ kind: "ring", at: ring.at, text: `Your ring: “${ring.text}”`, href: "/rings" });
  for (const r of v.readings) if (r.preparedAt > lastSeen && r.rayId === null) items.push({ kind: "reading", at: r.preparedAt, text: "This week's Reading is ready", href: "/ray?session=reading" });
  for (const i of v.intros) if (i.at > lastSeen && i.answer === null) items.push({ kind: "intro", at: i.at, text: "Someone asked to meet you", href: `/intro?id=${encodeURIComponent(i.introId)}` });
  for (const c of Object.values(v.dial)) if (c.claim !== "" && c.reviewAt > lastSeen && c.reviewAt <= now) items.push({ kind: "dial", at: c.reviewAt, text: "A Dial call came due", href: `/chart/dial/review?id=${encodeURIComponent(c.callId)}` });
  for (const l of v.landfalls) if (l.at > lastSeen) items.push({ kind: "landfall", at: l.at, text: `Landfall on ${l.island}`, href: "/rings" });
  for (const [night, lines] of Object.entries(v.nightLogs)) {
    const at = Date.parse(night);
    if (Number.isFinite(at) && at > lastSeen - DAY_MS && lines.length) items.push({ kind: "watch", at: Math.max(at, lastSeen + 1), text: lines.at(-1)!.slice(6) || lines.at(-1)!, href: "/watch" });
  }
  const seen = new Set<string>();
  return items
    .sort((a, b) => b.at - a.at)
    .filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)))
    .slice(0, max);
}
