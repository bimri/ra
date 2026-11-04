import { apply, draft, makeId, type EventBodies, type EventDraft, type EventKind, type Views } from "@ra/core";
import type { PeopleProjection } from "./reconcile";

/** Produce the exact sealed events a Mind will append, without repeating a delivery. */
export function peopleChanges(views: Views, p: PeopleProjection, appliedRevision: number): EventDraft[] {
  if (!Number.isSafeInteger(p.revision) || p.revision <= appliedRevision) return [];
  const current = structuredClone(views);
  const events: EventDraft[] = [];
  function emit<K extends EventKind>(kind: K, body: EventBodies[K]) {
    const event = draft(kind, body, { id: makeId(), at: Date.now(), device: "mind" });
    events.push(event);
    apply(current, { ...event, seq: current.seq + 1 });
  }
  if (p.kind === "intro") {
    if (p.state === "absent") {
      if (current.crew.some((c) => c.introId === p.ref) || current.intros.some((i) => i.introId === p.ref)) emit("crew.left", { introId: p.ref });
    } else {
      if (!current.intros.some((i) => i.introId === p.ref)) emit("intro.proposed", { introId: p.ref, name: p.name, beacon: p.beacon, kind: p.crewKind, why: "A fit through your beacons." });
      if (p.state !== "pending" && current.intros.find((i) => i.introId === p.ref)?.answer !== true) emit("intro.answered", { introId: p.ref, yes: true });
      if (p.state === "crew" && !current.crew.some((c) => c.introId === p.ref)) emit("crew.joined", { introId: p.ref, name: p.name, beacon: p.beacon, kind: p.crewKind });
      const crew = current.crew.find((c) => c.introId === p.ref);
      if (crew && ((crew.contact ?? null) !== p.contact || (crew.sharedContact ?? null) !== p.sharedContact)) emit("crew.contact", { introId: p.ref, received: p.contact, shared: p.sharedContact });
    }
  } else if (p.state === "asked") {
    if (!current.witnessAsks.some((w) => w.requestId === p.ref)) emit("witness.asked", { requestId: p.ref, name: p.name, text: p.text });
  } else if (p.state === "confirmed") {
    const landfall = current.landfalls.find((l) => l.landfallId === p.landfallId);
    if (landfall && !landfall.witnessedBy.includes(p.name)) emit("witness.added", { landfallId: p.landfallId, name: p.name });
  } else if (current.witnessAsks.some((w) => w.requestId === p.ref && w.saw === null)) {
    emit("witness.answered", { requestId: p.ref, saw: p.state === "saw" });
  }
  return events;
}
