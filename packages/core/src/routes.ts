/** A proposal is never an arrival, a mission, or a financial commitment. */
export interface RouteEvidence {id:string;quote:string}
/** Latest charted island; marker-only legacy islands remain selectable without rewriting the log. */
export function currentIsland(views:Pick<import("./reducer").Views,"islands"|"markers">):string|null {
  const candidates=[...Object.values(views.islands).map(island=>({name:island.island,at:island.at})),...Object.entries(views.markers).filter(([name])=>!views.islands[name]).map(([name,markers])=>({name,at:markers.namedAt}))];
  return candidates.sort((a,b)=>b.at-a.at||(a.name<b.name?-1:a.name>b.name?1:0))[0]?.name??null;
}
export interface RouteSource {id:string;kind?:import("./socket").SignalCard["kind"];text:string;sources:string[];at:number;seeded:boolean;verification?:import("./horizon").HorizonVerification}
export interface RouteProposal {
  version:1;proposalId:string;island:string;inevitable:string;adjacent:string;yours:string;
  firstStep:string;circumstances:string;evidence:RouteEvidence[];horizon:RouteSource[];proposedAt:number;
}
export type RouteResult={kind:"clarify";question:string}|{kind:"proposal";proposal:RouteProposal};
export type RouteProblem="no-star"|"no-evidence"|"no-horizon"|"provider-unavailable"|"invalid-output"|"unreachable"|"context-too-large"|"provider-error"|"interrupted"|"stale"|"care";
export interface RouteJob {
  version:1;operationId:string;state:"running"|"ready"|"failed"|"interrupted"|"cancelled"|"accepted";
  createdAt:number;expiresAt:number;result:RouteResult|null;problem:RouteProblem|null;acceptedIsland:string|null;
}
export function canRetryRoute(job:RouteJob):boolean {return job.state==="interrupted"||job.state==="failed"&&["provider-error","provider-unavailable","invalid-output","unreachable","no-horizon"].includes(job.problem??"")}
export const ROUTE_PROBLEMS:Record<RouteProblem,string>={
  "care":"A route can wait. Is there someone you trust you could reach for support?",
  "no-star":"Write your Star first. A route cannot choose your mission for you.",
  "no-evidence":"Bring back a concrete experience first, so the next island starts from where you are.",
  "no-horizon":"A recent, source-checked Horizon is needed. Design seeds and unchecked links cannot establish a route.",
  "provider-unavailable":"Route design is unavailable with the current model configuration.",
  "invalid-output":"The model did not produce a proposal with verified references. Nothing was charted.",
  "unreachable":"The proposed step did not meet the checks for your evidence and available resources. Nothing was charted.",
  "context-too-large":"There is too much material to review at once. Use a shorter account of what you can reach.",
  "provider-error":"The model request failed. Your current Chart is unchanged; retry when ready.",
  "interrupted":"The request was interrupted. Choose Retry to continue; reopening does not start model work.",
  "stale":"Your route context changed or this proposal expired. Request a fresh proposal before charting it.",
};
