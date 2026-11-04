import type {DialJob} from "@ra/core";
import {api} from "./device";
import {localSession,checkLocalSession} from "./db";
export const DIAL_PROBLEMS:Record<string,string>={
  "no-horizon":"Choose recent, source-checked Horizon evidence. Design seeds and unchecked links cannot support this reading.",
  "context-too-large":"These sources are too large together. Choose fewer; no source was shortened.",
  "provider-unavailable":"Dial generation is unavailable with the current model configuration.",
  "provider-error":"The reading could not finish. Retry explicitly when the model is available.",
  "invalid-output":"The model returned an invalid reading. Nothing was added to your Dial.",
  "ungrounded":"The proposed reading did not meet the evidence checks. Nothing was added to your Dial.",
  "stale":"Your call, Star or island changed. Start a fresh request.",
  "interrupted":"The request was interrupted. Resuming this screen did not restart it."
};
export async function dialRequest(session:ReturnType<typeof localSession>,action:"generate"|"status"|"cancel",operationId:string,input:Record<string,unknown>={},signal?:AbortSignal):Promise<DialJob>{
  checkLocalSession(session);const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000);deadline.throwIfAborted();
  const response=await fetch(api("/dial/"+action+(action==="status"?"?operationId="+encodeURIComponent(operationId):"")),{method:action==="status"?"GET":"POST",credentials:"include",cache:"no-store",signal:deadline,headers:{"content-type":"application/json","x-ra-account":session.owner},...(action==="status"?{}:{body:JSON.stringify({...input,operationId})})});
  checkLocalSession(session);deadline.throwIfAborted();const value=await response.json();checkLocalSession(session);deadline.throwIfAborted();
  if(!response.ok)throw new Error(typeof value?.error==="string"?value.error:"This Dial request could not complete.");
  if(!value||value.version!==1||value.operationId!==operationId||!["question","read","outcome"].includes(value.kind)||!["running","completed","failed","interrupted","cancelled"].includes(value.state))throw new Error("This Dial result needs a newer app version.");return value;
}
