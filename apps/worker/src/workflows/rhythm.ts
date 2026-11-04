import type { EventBodies, ReadingView, SeasonView, StageName, Views } from "@ra/core";
import { MOMENT_LINES } from "@ra/prompts";
import {readingHorizon,type ReadingSignal} from "./readingHorizon";

// The weekly Reading (F1) and the season review (K2): prepared from your own
// Mind, with no model. What they say is what your record shows, in your words.

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const n = (k: number, one: string, many: string) => `${COUNT[k] ?? k} ${k === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const local = (at: number, tz: number) => new Date(at + tz * 60_000);

/** When the Reading is prepared: Saturday 21:00 your time, the next one after `now`. */
export function nextReadingAt(now: number, tz: number): number {
  const d = local(now, tz);
  const ahead = (6 - d.getUTCDay() + 7) % 7;
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ahead, 21) - tz * 60_000;
  return at > now ? at : at + WEEK;
}

/** The season (a calendar quarter, K2 "Oct–Dec 2026") that `at` falls in. Its review is at its end. */
export function seasonOf(at: number): { from: number; to: number } {
  const d = new Date(at);
  const q = Math.floor(d.getUTCMonth() / 3) * 3;
  return { from: Date.UTC(d.getUTCFullYear(), q, 1), to: Date.UTC(d.getUTCFullYear(), q + 3, 1) };
}

export interface Line {
  utteranceId: string;
  speaker: "you" | "ra";
  text: string;
  at: number;
  ms: number;
  kept: boolean;
}

/** F1, from the last week of your Mind. */
export async function prepareReading(v: Views, lines: Line[], signals: ReadingSignal[], now: number, tz: number,options:{field?:string|null;horizonAvailable?:boolean}={}): Promise<Omit<EventBodies["reading.prepared"], "readingId">> {
  const since = now - WEEK;
  // Rays only: a Reading or a season review isn't a Ray of its own.
  const rays = Object.values(v.rays).filter((r) => r.startedAt >= since && (r.session === "first" || r.session === "ray")).length;
  const back = Object.values(v.trips).filter((t) => t.reportedAt !== null && t.reportedAt >= since).length;
  const mine = lines.filter((l) => l.speaker === "you" && l.at >= since);
  const thoughts = mine.filter((l) => !Object.values(v.rays).some((r) => r.startedAt <= l.at && (r.endedAt ?? Infinity) >= l.at)).length;
  // Your longest kept line of the week, to hear again (F1 "Thursday 0:58").
  const kept = mine.filter((l) => l.kept).sort((a, b) => b.ms - a.ms)[0];

  const parts: string[] = [];
  if (rays) parts.push(`had ${n(rays, "Ray", "Rays")}`);
  if (back) parts.push(`brought back ${n(back, "trip", "trips")}`);
  if (thoughts) parts.push(`kept ${n(thoughts, "thought", "thoughts")}`);
  const rings = parts.length ? `This week you ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}.` : "A quiet week. That counts too.";

  // The question you came away with, waiting at least five days.
  const putoff = [...v.questions].reverse().find((q) => now - q.at >= 5 * DAY)?.leavingWith ?? null;
  const calls = Object.values(v.dial)
    .filter((c) => c.claim !== "" && c.reviewAt <= now + WEEK)
    .map((c) => c.question ?? c.claim);
  const weekStart=local(now,tz);weekStart.setUTCDate(weekStart.getUTCDate()-(weekStart.getUTCDay()+6)%7);
  const horizon=await readingHorizon(v.readings,signals,now,options.field??null,options.horizonAvailable??true);

  return {
    week: weekStart.toISOString().slice(0, 10),
    moved: horizon.changes.map(change=>change.text),horizon,
    rings,
    ...(kept
      ? {
          clip: {
            utteranceId: kept.utteranceId,
            label: local(kept.at, tz).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
            ms: kept.ms,
          },
        }
      : {}),
    putoff,
    calls,
  };
}

/** K2, from three months of your Mind. */
export function prepareSeason(v: Views, from: number, to: number): Omit<EventBodies["season.prepared"], "seasonId"> {
  const a = new Date(from);
  const b = new Date(to - 1);
  const label = `${MONTHS[a.getUTCMonth()]}–${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  const weeks = Math.max(1, Math.round((to - from) / WEEK));
  const trips = Object.values(v.trips).filter((t) => t.state === "reported").length;
  const islands = Object.values(v.markers).filter((m) => m.namedAt >= from && m.namedAt < to).length;
  const due = Object.values(v.dial).filter((c) => c.claim !== "");
  const next = due.map((c) => c.reviewAt).filter((t) => t > to).sort((x, y) => x - y)[0];
  const calls = due.length
    ? `${cap(n(due.length, "call", "calls"))} on your Dial.${next ? ` One review in ${MONTHS[new Date(next).getUTCMonth()]}.` : ""} ${due.some((c) => c.reviewAt <= to) ? "One is due now." : "Nothing due yet."}`
    : "No calls on your Dial yet.";
  const pace = trips / weeks >= 0.75 ? "one trip a week" : trips ? n(trips, "trip", "trips") : "no trips yet";
  const ring = `This season's ring: ${pace}${islands ? `, ${n(islands, "island", "islands")} begun` : ""}.`;
  return { label, from, to, calls, crew: null, ring };
}

/** What Ra says as a Reading or season part opens. Null: the part has nothing in it and is skipped. */
export function partLine(stage: StageName, reading: ReadingView | null, season: SeasonView | null): string | null {
  if (reading) {
    switch (stage) {
      case "moved":
        if(reading.horizon&&!reading.horizon.available)return "I couldn't check your horizon this week.";
        return reading.moved.length
          ? `What moved on your horizon this week: ${reading.moved[0]}${reading.moved.length > 1 ? ` And ${n(reading.moved.length - 1, "more", "more")}.` : ""}`
          : reading.horizon?"No new sourced changes on your horizon this week.":"Nothing on your horizon moved this week.";
      case "rings":
        return reading.rings;
      case "putoff":
        return reading.putoff ? `One question you've been putting off: ${reading.putoff}` : null;
      case "calls":
        return reading.calls.length ? `${n(reading.calls.length, "call is", "calls are")} due: ${reading.calls[0]}` : null;
      case "close":
        return MOMENT_LINES.ringClosing;
      default:
        return null;
    }
  }
  if (season) {
    switch (stage) {
      case "route":
        return MOMENT_LINES.seasonOpen;
      case "calls":
        return season.calls;
      case "crew":
        return season.crew;
      default:
        return null;
    }
  }
  return null;
}
