import { makeId,verifiedHorizon, type SignalCard, type TripCard } from "@ra/core";
import { TRIP_TASK } from "@ra/prompts";
import type { Muse } from "../muse";
import { type Ask } from "../mind/moments";
import {tripSchema,tripResults,taskText} from "../muse/tasks";
import {sourceUrls} from "../horizon/sources";

export interface TripContext {
  /** What the person said in this Ray, oldest first. */
  yours: string[];
  /** Mirror quotes they kept: the threads that are really theirs. */
  kept: string[];
  /** The Horizon for their field; trips may cite only these sources. */
  signals: SignalCard[];
  star?:string|null;
  circumstances?:string;
}

/** What every kept trip must be, asked of each draft by the decision model. */
const FILTER = {
  specific:
    "Is this trip built from this person's own story, so that it would not suit just anyone? Answer no for generic advice like 'take an online course'.",
  doable: "Can the person start this trip today, alone, with little or no money, in an hour or two?",
  // What is missing, not what is "explicitly supported": the literal version set aside every trip in a real Ray,
  // even after she named her phone, a multimeter, the inverter and a free hour.
  missing:"Does this trip need anything the person has not said they have or can reach? Count as available: things they said they have and ordinary use of them (a phone calls, messages and takes photos), light internet use on the phone they are talking to Ra on right now, time they said they have, the place they live, and people they mentioned. Count as missing: buying anything, paid services, travel elsewhere, tools or equipment they never mentioned, large downloads, and permission from a stranger.",
  safe: "Does this trip promise a job, money or success, or tell the person what their mission is?",
} as const;

/**
 * TripDesign: Wonder drafts several trips from the person's own words and
 * their horizon; the decision model keeps the ones that are specific to them,
 * doable today and within the promises; the best three are offered.
 */
export async function designTrips(muse: Muse, ask: Ask, ctx: TripContext, want = 3,signal?:AbortSignal): Promise<TripCard[]> {
  const signals=ctx.signals.filter(signal=>verifiedHorizon(signal,Date.now()));
  const sources = sourceUrls(signals.flatMap((s) => s.sources));
  const task = [
    TRIP_TASK,
    "Use only explicitly recorded resources. Unknown equipment, travel, permissions or large downloads are unavailable. They are online on their phone now (that is how they talk to Ra), so light internet use counts as available. Without Horizon citations, whyNow must refer only to their own story; do not assert outside trends.",
    ctx.star?"Their person-written Star: "+JSON.stringify(ctx.star):"They have not written a Star; do not invent one.",
    ctx.circumstances?"Their stated circumstances: "+JSON.stringify(ctx.circumstances):"No separate resource statement is recorded. Use only what their story explicitly establishes.",
    "",
    `What they said: ${ctx.yours.slice(-16).map((l) => `"${l}"`).join(" ")}`,
    ctx.kept.length ? `Phrases they kept as really theirs: ${ctx.kept.map((k) => `"${k}"`).join(", ")}` : "",
    signals.length ? `Their horizon: ${signals.map((s) => `${s.kind}: ${s.text}; source excerpts: ${JSON.stringify(s.verification!.documents)}`).join(" | ")}` : "",
    sources.length ? `Sources you may cite: ${sources.join("; ")}` : "There are no sources to cite; leave sources empty.",
  ]
    .filter(Boolean)
    .join("\n");

  const design = async (brief: string): Promise<TripCard[]> => {
    const drafts: TripCard[] = [];
    for (let attempt = 0; attempt < 2 && drafts.length < want; attempt++) {
      const text=await taskText(()=>muse.wonder({ task: brief, webSearch: false,schema:tripSchema(sources),maxOutputTokens:2048,...(signal?{signal}:{}) }),signal);
      const read=text===null?[]:readTrips(text,sources);
      // Content-free: whether Wonder answered, and how many cards survived the contract.
      console.log(JSON.stringify({ra:"diag",at:"trips.draft",attempt,answered:text!==null,bytes:text?.length??0,cards:read.length}));
      for(const trip of read)if(!drafts.some(old=>old.title===trip.title&&old.action===trip.action))drafts.push(trip);
    }
    return drafts;
  };
  const score = (drafts: TripCard[]) =>
    Promise.all(
      drafts.map(async (trip) => {
        signal?.throwIfAborted();const state = JSON.stringify({ownWords:ctx.yours.slice(-8),circumstances:ctx.circumstances??null,star:ctx.star??null,trip});
        const [specific, doable, unsafe,missing] = await Promise.all([
          ask(state, FILTER.specific,signal),
          ask(state, FILTER.doable,signal),
          ask(state, FILTER.safe,signal),
          ask(state,FILTER.missing,signal),
        ]);
        signal?.throwIfAborted();
        const why = [specific < 0.5 && "it would suit anyone, not them", doable < 0.5 && "it can't start today, alone, in an hour or two, for little or no money", unsafe >= 0.5 && "it promises an outcome or names their mission", missing >= 0.5 && "it needs tools, access, money or connection they never said they have"].filter((r): r is string => !!r);
        // Content-free: each judge's score, so a set-aside trip shows which question did it.
        console.log(JSON.stringify({ra:"diag",at:"trips.judged",specific:+specific.toFixed(2),doable:+doable.toFixed(2),unsafe:+unsafe.toFixed(2),missing:+missing.toFixed(2)}));
        return { trip, why, keep: why.length === 0, score: specific + doable * 0.5 };
      }),
    );
  let scored = await score(await design(task));
  console.log(JSON.stringify({ra:"diag",at:"trips.scored",drafts:scored.length,kept:scored.filter((s)=>s.keep).length,why:[...new Set(scored.flatMap((s)=>s.why.map((w)=>w.split(" ")[1])))]}));
  // Every draft set aside: one more design, told why, before Ra gives up on trips for now.
  if (!scored.some((s) => s.keep) && scored.length) {
    const reasons = [...new Set(scored.flatMap((s) => s.why))].join("; ");
    scored = await score(await design(`${task}

Earlier drafts were set aside because ${reasons}. Design new ones that use only what their own words establish they have: their hands, their own phone, what they already open or use, people they already know.`));
  }
  return scored
    .filter((s) => s.keep)
    .sort((a, b) => b.score - a.score)
    .slice(0, want)
    .map((s) => s.trip);
}

/** Reject incomplete cards and any invented source; removing a citation would leave an unsupported claim. */
export function readTrips(text: string, allowedSources: string[]): TripCard[] {
  return tripResults(text,new Set(sourceUrls(allowedSources))).map(trip=>({...trip,tripId:makeId()}));
}
