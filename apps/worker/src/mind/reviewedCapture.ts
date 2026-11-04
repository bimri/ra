import { draft,isId,makeId,type EventDraft,type RaEvent,type Views } from "@ra/core";

export type CaptureFiling="thought"|"view"|"ray"|"evidence";
export interface ReviewedCaptureInput {captureId:string;text:string;filing:CaptureFiling;reviewHash:string;tripId?:string;privacyReviewed:true;originalMediaAllowed:false}
export interface ReviewedCaptureReceipt {captureId:string;utteranceId:string;filing:CaptureFiling;reviewHash:string;tripId:string|null}
export class ReviewedCaptureError extends Error {constructor(message:string,readonly status=400){super(message)}}

/** Reject all media/extra fields; the server receives only the person's reviewed words. */
export async function checkReviewedCapture(value:unknown):Promise<ReviewedCaptureInput> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ReviewedCaptureError("Reviewed words are required.");
  const body=value as Record<string,unknown>;
  const allowed=new Set(["captureId","text","filing","reviewHash","tripId","privacyReviewed","originalMediaAllowed"]);
  if(Object.keys(body).some(key=>!allowed.has(key)))throw new ReviewedCaptureError("This endpoint accepts reviewed text only.");
  if(!isId(body.captureId)||typeof body.text!=="string"||!body.text.trim()||body.text.length>4096||typeof body.reviewHash!=="string"||!/^[a-f0-9]{64}$/.test(body.reviewHash))throw new ReviewedCaptureError("The reviewed words or capture reference are invalid.");
  if(body.privacyReviewed!==true||body.originalMediaAllowed!==false||typeof body.filing!=="string"||!["thought","view","ray","evidence"].includes(body.filing))throw new ReviewedCaptureError("Finish privacy review and choose how to file these words.");
  if(body.filing==="evidence" ? typeof body.tripId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(body.tripId) : body.tripId!==undefined)throw new ReviewedCaptureError("Choose a scouting trip for evidence.");
  for(let i=0;i<body.text.length;i++) {
    const c=body.text.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF){const next=body.text.charCodeAt(++i);if(!(next>=0xDC00&&next<=0xDFFF))throw new ReviewedCaptureError("Review the unsupported character before filing.")}
    else if(c>=0xDC00&&c<=0xDFFF)throw new ReviewedCaptureError("Review the unsupported character before filing.");
  }
  const raw=new TextEncoder().encode(body.text);
  const hash=await crypto.subtle.digest("SHA-256",raw).finally(()=>raw.fill(0));
  const digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
  if(digest!==body.reviewHash)throw new ReviewedCaptureError("The words changed after review.",409);
  return body as unknown as ReviewedCaptureInput;
}

/** No awaits between lookup and append in the Mind: retries cannot create another capture. */
export function reviewedCaptureDrafts(input:ReviewedCaptureInput,existing:RaEvent|undefined,views:Views,at:number):{drafts:EventDraft[];receipt:ReviewedCaptureReceipt} {
  const receipt:ReviewedCaptureReceipt={captureId:input.captureId,utteranceId:input.captureId,filing:input.filing,reviewHash:input.reviewHash,tripId:input.tripId??null};
  if(existing) {
    const body=existing.body as Partial<RaEvent<"utterance">["body"]>;
    const filed=body.filed;
    if(existing.kind!=="utterance"||!filed||body.utteranceId!==input.captureId||filed.captureId!==input.captureId||filed.reviewHash!==input.reviewHash||filed.filing!==input.filing||(filed.tripId??null)!==receipt.tripId)throw new ReviewedCaptureError("This capture was already filed differently. Its original filing has been kept.",409);
    return {drafts:[],receipt};
  }
  const trip=input.tripId?views.trips[input.tripId]:undefined;
  if(input.filing==="evidence"&&(!trip||!(["chosen","reported"] as string[]).includes(trip.state)))throw new ReviewedCaptureError("Choose an existing scouting trip before filing this evidence.",409);
  const filed={captureId:input.captureId,filing:input.filing,reviewHash:input.reviewHash,...(input.tripId?{tripId:input.tripId}:{})};
  const drafts:EventDraft[]=[draft("utterance",{utteranceId:input.captureId,speaker:"you",text:input.text,startMs:0,endMs:0,filed},{id:input.captureId,at,device:"pocket-reviewed"})];
  if(trip) {
    drafts.push(draft("evidence.added",{evidenceId:makeId(at),tripId:trip.tripId,kind:"note",note:input.text},{id:makeId(at),at,device:"pocket-reviewed"}));
    if(trip.state==="chosen")drafts.push(draft("trip.reported",{tripId:trip.tripId,text:input.text,utteranceId:input.captureId},{id:makeId(at),at,device:"pocket-reviewed"}));
  }
  return {drafts,receipt};
}
