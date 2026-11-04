import type { RaEvent } from "./events";

// I2 · "Forgotten means gone. It never comes back." Forgetting a memory
// appends memory.corrected {forget}, and then every copy of the log, in the
// Mind and on each phone, scrubs the words from the events that carried them.
// The events stay (seq has no gaps, so the reducer still runs) but their
// claims are empty, so a replay or an export can't bring the memory back.

/** The memory a forget event erases, or null when `e` isn't one. */
export function forgotten(e: RaEvent): string | null {
  if (e.kind !== "memory.corrected") return null;
  const b = e.body as RaEvent<"memory.corrected">["body"];
  return b.forget ? b.memoryId : null;
}

/** `e` with the forgotten memory's words removed, or null if `e` never held them. */
export function scrub(e: RaEvent, memoryId: string): RaEvent | null {
  if (e.kind === "memory.inferred") {
    const b = e.body as RaEvent<"memory.inferred">["body"];
    if (b.memoryId !== memoryId || (b.claim === "" && b.sources.length === 0 && !b.quotes?.length)) return null;
    return { ...e, body: { memoryId, claim: "", confidence: 0, sources: [] } } as RaEvent;
  }
  if (e.kind === "memory.corrected") {
    const b = e.body as RaEvent<"memory.corrected">["body"];
    if (b.memoryId !== memoryId || b.claim === undefined) return null;
    return { ...e, body: { memoryId } } as RaEvent;
  }
  return null;
}
