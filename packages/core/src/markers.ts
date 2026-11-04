import type {EventBodies} from "./events";
/** Stable across reordering and identical on the phone and server. */
export async function markerRef(island:string,marker:string):Promise<string> {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([island,marker])));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
/** Personal wording, bounded and distinct. No model may invent or silently fill a marker. */
export function checkMarkers(value:unknown):EventBodies["markers.named"] {
  if(!value||typeof value!=="object")throw new Error("Name the island and its markers in your own words.");
  const body=value as {island?:unknown;markers?:unknown};
  if(typeof body.island!=="string"||!body.island.trim()||body.island.length>200)throw new Error("Choose an island first.");
  if(!Array.isArray(body.markers)||body.markers.length<1||body.markers.length>12)throw new Error("Keep between one and twelve markers.");
  if(body.markers.some(word=>typeof word!=="string"||!word.trim()||word.length>500))throw new Error("Each marker needs your own words, up to 500 characters.");
  const markers=(body.markers as string[]).map(word=>word.trim());
  const identities=markers.map(word=>word.normalize("NFKC").toLowerCase().replace(/\s+/g," "));
  if(new Set(identities).size!==identities.length)throw new Error("Give each marker distinct wording.");
  return {island:body.island.trim(),markers};
}
