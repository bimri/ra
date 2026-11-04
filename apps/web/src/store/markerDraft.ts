import {checkMarkers} from "@ra/core";
import {store,localSession,checkLocalSession} from "./db";
export interface MarkerDraft{version:1;island:string;base:string[];words:string[]}
const key=(island:string)=>"markers.draft:"+island;
export async function loadMarkerDraft(island:string):Promise<MarkerDraft|null>{
  const value=await store.get<MarkerDraft|null>(key(island));
  if(!value)return null;
  if(value.version!==1||value.island!==island||!Array.isArray(value.base)||value.base.length>12||!Array.isArray(value.words)||value.words.length>12||[...value.base,...value.words].some(word=>typeof word!=="string"||word.length>500))throw new Error("This saved marker draft needs review before continuing.");
  return value;
}
export async function saveMarkerDraft(value:MarkerDraft){const scope=localSession();await store.set(key(value.island),value);checkLocalSession(scope)}
export async function clearMarkerDraft(island:string){await store.set(key(island),null)}
/** Explicit person-selected wording only; no model extraction or speech-triggered saving. */
export function addMarkerWord(draft:MarkerDraft,text:string):MarkerDraft{
  const checked=checkMarkers({island:draft.island,markers:[...draft.words.filter(word=>word.trim()),text]});
  return {...draft,words:checked.markers};
}
