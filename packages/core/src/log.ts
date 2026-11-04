import { isEventKind, type EventDraft, type RaEvent } from "./events";
import { isId } from "./ids";

/**
 * Where events are kept. The Mind backs this with its SQLite table, the phone
 * with IndexedDB, tests with memory. The log logic below is shared by all.
 */
export interface EventStore {
  lastSeq(): number;
  has(id: string): boolean;
  insert(event: RaEvent): void;
  since(seq: number, limit?: number): RaEvent[];
}

export class InvalidEvent extends Error {
  constructor(
    message: string,
    readonly id: unknown,
  ) {
    super(message);
    this.name = "InvalidEvent";
  }
}

export function validateDraft(d: unknown): asserts d is EventDraft {
  if (typeof d !== "object" || d === null) throw new InvalidEvent("event is not an object", undefined);
  const e = d as Record<string, unknown>;
  if (!isId(e.id)) throw new InvalidEvent("id must be a device-made ID", e.id);
  if (!isEventKind(e.kind)) throw new InvalidEvent(`unknown kind ${String(e.kind)}`, e.id);
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) throw new InvalidEvent("at must be a time", e.id);
  if (typeof e.device !== "string" || e.device.length === 0) throw new InvalidEvent("device is required", e.id);
  if (typeof e.body !== "object" || e.body === null) throw new InvalidEvent("body must be an object", e.id);
  if ("seq" in e && e.seq !== undefined) throw new InvalidEvent("seq is assigned by the Mind, not the device", e.id);
}

export interface AppendResult {
  /** Events newly written, with their seq. */
  appended: RaEvent[];
  /** IDs already in the log; replays from an outbox land here. */
  duplicates: string[];
  lastSeq: number;
}

/** Append-only. Nothing in the log is ever changed or removed through this class. */
export class EventLog {
  constructor(private readonly store: EventStore) {}

  get lastSeq(): number {
    return this.store.lastSeq();
  }

  /**
   * Validate every draft first, then assign seqs in order. Either the whole
   * batch is valid or nothing is written.
   */
  append(drafts: readonly unknown[]): AppendResult {
    for (const d of drafts) validateDraft(d);
    const appended: RaEvent[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();
    let seq = this.store.lastSeq();
    for (const d of drafts as EventDraft[]) {
      if (seen.has(d.id) || this.store.has(d.id)) {
        duplicates.push(d.id);
        continue;
      }
      seen.add(d.id);
      seq += 1;
      const event: RaEvent = { id: d.id, seq, kind: d.kind, at: d.at, device: d.device, body: d.body };
      this.store.insert(event);
      appended.push(event);
    }
    return { appended, duplicates, lastSeq: seq };
  }

  since(seq: number, limit?: number): RaEvent[] {
    return this.store.since(seq, limit);
  }
}

export class MemoryEventStore implements EventStore {
  private readonly events: RaEvent[] = [];
  private readonly ids = new Set<string>();

  lastSeq(): number {
    return this.events.at(-1)?.seq ?? 0;
  }
  has(id: string): boolean {
    return this.ids.has(id);
  }
  insert(event: RaEvent): void {
    if (event.seq !== this.lastSeq() + 1) throw new Error(`seq ${event.seq} is not next after ${this.lastSeq()}`);
    this.events.push(event);
    this.ids.add(event.id);
  }
  since(seq: number, limit = Infinity): RaEvent[] {
    const out: RaEvent[] = [];
    for (const e of this.events) {
      if (e.seq > seq) out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }
}
