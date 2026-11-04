import type { Views, EventBodies } from "@ra/core";
import { isPhoneEditKind,checkMarkers,markerRef } from "@ra/core";
export {markerRef};

export async function currentMarkers(views: Views, island: string) {
  const texts = views.markers[island]?.markers;
  if (!texts?.length) throw new Error("Name the island's markers first.");
  if (texts.some((text) => typeof text !== "string" || !text.trim())) throw new Error("Each marker needs your own words.");
  if (new Set(texts).size !== texts.length) throw new Error("Give each marker distinct wording first.");
  return Promise.all(texts.map(async (text) => ({ markerId: await markerRef(island, text), text })));
}

/** Session and achievement events are written by the server, never replayed from a phone. */
export function assertPhoneEdits(outbox: unknown[]): void {
  for (const value of outbox) {
    const kind = value && typeof value === "object" ? (value as { kind?: unknown }).kind : null;
    if (!isPhoneEditKind(String(kind))) throw new Error("This event must be recorded through its session or action, not sync.");
    if(kind==="markers.named")checkMarkers((value as {body?:unknown}).body);
    if(kind==="person.named"){const name=((value as {body?:{name?:unknown}}).body??{}).name;if(name!==null&&typeof name!=="string")throw new Error("A name is text.");}
  }
}

export async function arrivalMarkers(views: Views, island: string): Promise<EventBodies["landfall.prepared"]["markers"]> {
  const markers = await currentMarkers(views, island);
  return markers.map((marker) => {
    const reached = views.markerAchievements.find((a) => a.island === island && a.markerId === marker.markerId);
    if (!reached) throw new Error("Record how you reached each marker before landfall.");
    return { ...marker, achievementId: reached.achievementId, evidence: reached.evidence };
  });
}

/** A changed marker list requires a fresh review, never quiet goalpost movement. */
export async function validateArrival(views: Views, prepared: EventBodies["landfall.prepared"]): Promise<void> {
  const current = await arrivalMarkers(views, prepared.island);
  if (JSON.stringify(current) !== JSON.stringify(prepared.markers)) throw new Error("Your markers changed. Review the island again before landfall.");
}
