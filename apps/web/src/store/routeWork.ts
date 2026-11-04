import type {RouteJob} from "@ra/core";
import {api} from "./device";
import {localSession,checkLocalSession} from "./db";
export type RouteSession=ReturnType<typeof localSession>;
export async function routeRequest(session:RouteSession,operation:"propose"|"status"|"cancel"|"accept",operationId:string,body:Record<string,unknown>={},signal?:AbortSignal):Promise<RouteJob> {
  checkLocalSession(session);
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000);requestSignal.throwIfAborted();
  const path="/route/"+operation+(operation==="status"?"?operationId="+encodeURIComponent(operationId):"");
  const response=await fetch(api(path),{method:operation==="status"?"GET":"POST",credentials:"include",cache:"no-store",signal:requestSignal,headers:{"content-type":"application/json","x-ra-account":session.owner},...(operation==="status"?{}:{body:JSON.stringify({operationId,...body})})});
  checkLocalSession(session);requestSignal.throwIfAborted();const value=await response.json();checkLocalSession(session);requestSignal.throwIfAborted();
  if(!value||typeof value!=="object")throw new Error("This route result is not supported by this app version.");
  if(!response.ok)throw new Error(typeof value.error==="string"?value.error:"This route request could not complete.");
  if(value.version!==1||value.operationId!==operationId||!["running","ready","failed","interrupted","cancelled","accepted"].includes(value.state))throw new Error("This route result is not supported by this app version.");
  return value as RouteJob;
}
