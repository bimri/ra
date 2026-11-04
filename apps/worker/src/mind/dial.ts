import type {DialCallView,DialEvidence} from "@ra/core";
import type {Signal} from "../horizon/HorizonDO";
import {sourceUrls} from "../horizon/sources";
import {verifiedHorizon,horizonFactKey} from "@ra/core";
export function dialSelection(value:unknown):{callId:string;signalIds:string[]} {
  if(!value||typeof value!=="object")throw new Error("Choose the call and its sources.");
  const input=value as {callId?:unknown;signalIds?:unknown};
  if(typeof input.callId!=="string"||!input.callId||input.callId.length>128||!Array.isArray(input.signalIds)||!input.signalIds.length||input.signalIds.length>6||input.signalIds.some(id=>typeof id!=="string"||!id||id.length>200)||new Set(input.signalIds).size!==input.signalIds.length)throw new Error("Choose between one and six distinct sources for this call.");
  return {callId:input.callId,signalIds:[...input.signalIds].sort() as string[]};
}
/** Preserve exact evidence and supplied timing words. Never turn a date in a source into a forecast. */
export async function dialEvidence(call:DialCallView,signalIds:readonly string[],signals:readonly Signal[],now:number):Promise<DialEvidence> {
  if(!call.claim.trim())throw new Error("Make your call before checking this evidence.");
  const items=signalIds.map(id=>{
    const signal=signals.find(signal=>signal.id===id);const sources=sourceUrls(signal?.sources??[]);
    if(!signal||!verifiedHorizon(signal,now)||!sources.length||!Number.isFinite(signal.at)||signal.at>now||signal.at<now-30*86_400_000)throw new Error("Choose source-verified Horizon evidence. Design seeds and unchecked links are not evidence.");
    return {id:signal.id,kind:signal.kind,text:signal.text,sources,at:signal.at,seeded:false,verification:structuredClone(signal.verification),...(signal.timing?{timing:signal.timing}:{}),...(signal.direction?{direction:signal.direction}:{})};
  });
  if(new TextEncoder().encode(JSON.stringify(items)).length>24_000)throw new Error("These sources are too large to keep together. Choose fewer; no source was shortened.");
  // Ignore refresh-generated IDs and read times: an unchanged fact is not a new outcome.
  const facts=items.map(item=>horizonFactKey(item)).sort();
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([2,call.callId,call.reviewAt,facts])));
  const snapshotId=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  return {version:1,snapshotId,forReviewAt:call.reviewAt,checkedAt:now,items};
}
