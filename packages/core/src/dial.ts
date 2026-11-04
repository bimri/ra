import type {RouteSource} from "./routes";
/** Retained evidence, not a generated forecast or a change to the person's call. */
export interface DialEvidence {
  version:1;snapshotId:string;forReviewAt:number;checkedAt:number;
  items:(RouteSource&{timing?:string;direction?:string})[];
}
export interface DialBasis {
  version:1;operationId:string;asOf:number;forReviewAt:number;promptVersion:string;provider:string;
  sources:DialEvidence["items"];evidence:{signalId:string;quote:string}[];uncertainty:string;
  statusEvidence?:string;
}
export type DialTask="question"|"read"|"outcome";
export interface DialJob {
  version:1;operationId:string;kind:DialTask;callId:string|null;
  state:"running"|"completed"|"failed"|"cancelled"|"interrupted";
  problem:string|null;createdAt:number;
}
