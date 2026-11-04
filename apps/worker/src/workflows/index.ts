import { readVerifiedHorizon,type HorizonRead } from "./horizon";
import {decisions} from "../mind/decide";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";
import { createMuse } from "../muse";
import { logLine } from "./watch";
import { FIELDS,type Field } from "../horizon/HorizonDO";
import { thenGap } from "./then";
import { matchFor } from "../people/routes";

// The slow work, done by Wonder: durable, retried step by step, fine to take
// minutes. Nothing a person waits on runs here.

/**
 * A Ray reaches ~35%: Wonder drafts trips from the person's own words and
 * horizon, the decision model keeps the three that only fit them, and the
 * Mind offers them when the Ray reaches its trips. If they're late, Ra says
 * "I'll have your trips by tonight" and offers them when they land.
 */
export class TripDesign extends WorkflowEntrypoint<Env, { person: string; rayId: string }> {
  override async run(event: WorkflowEvent<{ person: string; rayId: string }>, step: WorkflowStep) {
    const { person, rayId } = event.payload;
    const mind = this.env.MIND.getByName(person);
    const trips = await step.do(
      "design sealed trips v2",
      // A second, corrected design can follow a first that was all set aside.
      { retries: { limit: 2, delay: "5 seconds", backoff: "linear" }, timeout: "8 minutes" },
      () => mind.designTripsSealed(rayId),
    );
    const offered = await step.do("offer sealed trips v2", () => mind.offerTripsSealed(rayId, trips));
    return { rayId, offered };
  }
}

/** Weekly per field, or on first need: Wonder with web search reads the field. */
export class HorizonRefresh extends WorkflowEntrypoint<Env, { field: string;operationId?:string }> {
  protected async readChanges(field:Field,_operationId:string):Promise<HorizonRead>{
    if(this.env.RA_MUSE_PROVIDER==="fake")throw new Error("Horizon verifier unavailable");
    const muse=await createMuse(this.env);
    return readVerifiedHorizon(muse,field,{ask:decisions(async()=>muse).ask});
  }
  override async run(event: WorkflowEvent<{ field: string;operationId?:string }>, step: WorkflowStep) {
    const field = FIELDS.find((f) => f.id === event.payload.field);
    if (!field) throw new Error("Unknown Horizon field");
    const operationId=event.payload.operationId,mind=this.env.HORIZON.getByName(field.id);
    // Old queued runs have no reservation fence; never let them overwrite v2.
    if(!operationId)return {field:field.id,written:0,skipped:true};
    try{
      const started=await step.do("begin verified refresh v2",()=>mind.beginRefresh(operationId));if(!started)return {field:field.id,written:0,skipped:true};
      const read=await step.do("verify public source evidence v2",{timeout:"10 minutes",retries:{limit:1,delay:"30 seconds"}},()=>this.readChanges(field,operationId));
      if(read.proposed&&!read.signals.length)throw new Error("Horizon evidence unavailable");
      const written=await step.do("commit verified snapshot v2",()=>mind.finishRefresh(operationId,read.signals));return {field:field.id,written:written??0,stale:written===null};
    }catch{await mind.failRefresh(operationId);return {field:field.id,written:0,unavailable:true}}
  }
}

const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number, one: string, many: string) => `${COUNT[n] ?? n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The Watch (I3). Your Mind's alarm, about 2 AM your time: it reads the day
 * again, audits Ra's lines against the promises (what slipped is kept as a
 * test case, in your own Mind), updates memories with their quotes, and
 * finishes trips that were late. It almost never needs you: "Woke you for:
 * nothing" is the usual answer.
 */
export class NightWatch extends WorkflowEntrypoint<Env, { person: string; night: string }> {
  override async run(event: WorkflowEvent<{ person: string; night: string }>, step: WorkflowStep) {
    const { person, night } = event.payload;
    const mind = this.env.MIND.getByName(person);
    const day = await step.do("read sealed day v2", () => mind.watchSnapshot(night));
    if(!day)return {night,skipped:true};
    const log: string[] = [];
    const at = () => Date.now();

    const audit = await step.do("audit sealed day v2", () => mind.auditWatch(night,day.sealed));
    if (audit.checked > 0) {
      log.push(
        logLine(
          audit.at,
          day.tz,
          audit.slipped
            ? `Checked ${count(audit.checked, "line", "lines")} of mine against my promises. ${capital(count(audit.slipped, "slipped", "slipped"))}; kept to learn from.`
            : `Checked ${count(audit.checked, "line", "lines")} of mine against my promises. All kept.`,
        ),
      );
    }

    const memories = await step.do(
      "update sealed memories v2",
      { retries: { limit: 1, delay: "5 seconds" }, timeout: "3 minutes" },
      () => mind.inferWatch(night,day.sealed),
    );
    if (day.saidCount > 0) {
      log.push(logLine(memories.at, day.tz, `Read the day again and ${memories.count ? `updated ${count(memories.count, "memory", "memories")}` : "found nothing new to remember"}.`));
    }

    // G3: embed your lines (bge-m3), then look for you explaining the same thing months apart.
    const then = await step.do("hear yourself again", { retries: { limit: 1, delay: "5 seconds" }, timeout: "2 minutes" }, async () => {
      try {
        let embedded=0;try{embedded=(await mind.embedForWatch(night,day.sealed)).embedded}catch{/* Pairing existing vectors and other nightly work remain independent. */}
        const pair = await mind.pairThen(thenGap(this.env), night,day.sealed);
        return { embedded, pair: pair ? { thenId: pair.thenId, nowId: pair.nowId } : null, at: at() };
      } catch {
        return { embedded: 0, pair: null, at: at() };
      }
    });
    if (then.pair) log.push(logLine(then.at, day.tz, "Found you explaining the same thing, months apart."));

    let finished = 0;
    let missed = 0;
    for (const rayId of day.raysWithoutTrips) {
      // A trip that won't design tonight mustn't sink the night: the rest is still written, and the trips stay owed for tomorrow.
      const offered = await step
        .do(`finish trips for ${rayId}`, { retries: { limit: 2, delay: "30 seconds" }, timeout: "3 minutes" }, async () => mind.finishWatchTrips(rayId))
        .catch(() => ({ n: 0, at: at() }));
      if (offered.n) finished = offered.at;
      else missed = offered.at;
    }
    if (finished) log.push(logLine(finished, day.tz, "Finished the trips I promised you."));
    if (missed) log.push(logLine(missed, day.tz, "Your trips need another night. I'll keep at them."));

    // The line Today opens on: trips you were promised, else (from the Mind) the next step on your path.
    const todayLine = finished ? "Your trips are ready." : missed ? "Your trips need one more night." : undefined;
    await step.do("write sealed night v2", () => mind.recordWatchSealed({ night, snapshot:day.sealed, memories: memories.sealed, lines: log, ...(todayLine ? { todayLine } : {}) }));
    return { night, memories: memories.count, checked: audit.checked, slipped: audit.slipped };
  }
}

/**
 * F1 · the Reading, prepared on Saturday night: what moved on your horizon,
 * what your week shows, a question you've put off, calls that are due. All of
 * it from your own Mind and your field's Horizon; Ra reads it with you when
 * you open it from Today.
 */
export class WeeklyReading extends WorkflowEntrypoint<Env, { person: string }> {
  override async run(event: WorkflowEvent<{ person: string }>, step: WorkflowStep) {
    const mind = this.env.MIND.getByName(event.payload.person);
    const prepared = await step.do("read sealed week v2", () => mind.prepareReadingSealed());
    const readingId = await step.do("leave sealed reading v2", () => mind.writeReadingSealed(prepared));
    return { readingId };
  }
}

/** K2 · the season review: three months of your record, and the ring it draws. */
export class SeasonReview extends WorkflowEntrypoint<Env, { person: string; from: number; to: number }> {
  override async run(event: WorkflowEvent<{ person: string; from: number; to: number }>, step: WorkflowStep) {
    const { person, from, to } = event.payload;
    const mind = this.env.MIND.getByName(person);
    const prepared = await step.do("read sealed season v2", () => mind.prepareSeasonSealed(from,to));
    const seasonId = await step.do("leave sealed season v2", () => mind.writeSeasonSealed(prepared));
    return { seasonId };
  }
}

/**
 * H1–H2 · a beacon was lit or changed: look for one crewmate among the other
 * beacons (never minds) and propose them. One introduction at a time.
 */
export class BeaconMatch extends WorkflowEntrypoint<Env, { account: string }> {
  override async run(event: WorkflowEvent<{ account: string }>, step: WorkflowStep) {
    const match = await step.do("look along the horizon for crew", () => matchFor(this.env, event.payload.account));
    return { match };
  }
}
