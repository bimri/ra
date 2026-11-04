import {verifiedHorizon,horizonFactKey,type ReadingHorizon,type ReadingView,type HorizonVerification} from "@ra/core";
import {sourceUrls} from "../horizon/sources";

export interface ReadingSignal {id?:string;kind?:string;text:string;at:number;seeded?:boolean;sources?:string[];timing?:string;direction?:string;verification?:HorizonVerification}
const WEEK=7*86_400_000;
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
/** Refresh time and random IDs never turn an unchanged source into new news. */
export async function readingHorizon(readings:readonly ReadingView[],signals:readonly ReadingSignal[],now:number,field:string|null,available:boolean):Promise<ReadingHorizon> {
  const previous=[...readings].reverse().find(reading=>reading.horizon?.available&&reading.horizon.field===field&&reading.horizon.checkedAt<=now)?.horizon;
  const usable=signals.filter(signal=>verifiedHorizon(signal,now));
  const snapshot:ReadingHorizon={version:1,field,checkedAt:now,available:available&&usable.length>0,observed:[],changes:[]};
  if(!snapshot.available)return snapshot;
  const seen=new Set(previous?.observed??[]);const current=new Set<string>();
  for(const signal of usable) {
    if(signal.seeded||!signal.text.trim()||!signal.kind||!["risen","rising","early","stays-human","on-ramp"].includes(signal.kind)||!Number.isFinite(signal.at)||signal.at>now)continue;
    const sources=sourceUrls(signal.sources??[]);if(!sources.length)continue;
    const content=horizonFactKey(signal);
    const key=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(content)));
    const legacyKey=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([signal.kind,signal.text,sources,signal.timing??null,signal.direction??null]))));
    if(current.has(key))continue;current.add(key);snapshot.observed.push(key);
    if(signal.at<now-WEEK||seen.has(key)||seen.has(legacyKey))continue;
    snapshot.changes.push({id:signal.id??key,kind:signal.kind,text:signal.text,at:signal.at,sources,verification:structuredClone(signal.verification),...(signal.timing?{timing:signal.timing}:{}),...(signal.direction?{direction:signal.direction}:{})});
  }
  snapshot.observed.sort();snapshot.changes.sort((a,b)=>b.at-a.at||(a.id<b.id?-1:a.id>b.id?1:0));
  return snapshot;
}
