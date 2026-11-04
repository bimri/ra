import { vaultReady, vaultAccount } from "../auth/vault";
import { useEffect, useState } from "preact/hooks";
import {
  VIEWS_VERSION,
  apply,
  draft,
  emptyViews,
  forgotten,
  makeId,
  isPhoneEditKind,
  checkMarkers,
  project,
  scrub,
  type EventBodies,
  type EventDraft,
  type EventKind,
  type RaEvent,
  type Views,
} from "@ra/core";
import { devPerson, deviceId } from "./device";
import { store, type SavedViews } from "./db";

// The mind mirror: the same reducer the Mind runs, over the events this phone
// has seen, plus anything in the outbox shown straight away. Syncing is one
// plain request (POST /sync {since, outbox}); the live socket is only for Rays.

export interface MindState {
  views: Views;
  /** Events made here and not yet in the Mind (J2 "Waiting to send"). */
  pending: EventDraft[];
  online: boolean;
  syncedAt: number | null;
  syncing: boolean;
}

type Listener = (s: MindState) => void;

/** One line from the log, for screens that show your own words (I2, G2). */
export interface Said {
  utteranceId: string;
  speaker: "you" | "ra";
  text: string;
  rayId: string | null;
  /** From the Ray's start. */
  startMs: number;
  endMs: number;
  at: number;
  /** Words (by position) said with lifted energy. */
  liftWords: number[];
  /** Your voice was kept, so it can be heard again (G2). */
  kept: boolean;
}

/** This phone's copy can't be continued; it has been emptied and must be fetched whole. */
class Resync extends Error {}

class Mirror {
  private events: RaEvent[] = [];
  private confirmed: Views = emptyViews();
  private state: MindState = { views: emptyViews(), pending: [], online: navigator.onLine, syncedAt: null, syncing: false };
  private readonly listeners = new Set<Listener>();
  private loaded: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;

  private generation = 0;
  constructor(private readonly person: string) {
    window.addEventListener("ra-vault-closed", () => {
      this.generation++; this.events = []; this.confirmed = emptyViews(); this.loaded = null; this.inFlight = null;
      this.state = { views: emptyViews(), pending: [], online: navigator.onLine, syncedAt: null, syncing: false };
      for (const fn of this.listeners) fn(this.state);
    });
    window.addEventListener("ra-local-ready", () => void this.sync());
  }

  get current(): MindState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  load(): Promise<void> {
    if (!vaultReady()) return Promise.resolve();
    const generation = this.generation;
    this.loaded ??= (async () => {
      try {
        const [events, saved, pending, syncedAt] = await Promise.all([
          store.allEvents(),
          store.get<SavedViews>("views"),
          store.outbox(),
          store.get<number>("syncedAt"),
        ]);
        if (!vaultReady() || generation !== this.generation) return;
        this.events = events.sort((a, b) => a.seq - b.seq);
        this.confirmed =
          saved && saved.version === VIEWS_VERSION && saved.views.seq <= (this.events.at(-1)?.seq ?? 0)
            ? project(this.events.filter((e) => e.seq > saved.views.seq), saved.views)
            : project(this.events);
        this.publish({ pending, syncedAt: syncedAt ?? null });
      } catch {
        if (!vaultReady() || generation !== this.generation) return;
        // No IndexedDB (private mode, an old WebView): the mirror lives in memory only.
        this.publish({});
      }
    })();
    return this.loaded;
  }

  /** Make an event on this phone: it shows at once, and syncs when it can. */
  async write<K extends EventKind>(kind: K, body: EventBodies[K]): Promise<void> {
    if(kind==="markers.named")checkMarkers(body);
    const generation = this.generation;
    await this.load();
    if (!vaultReady() || generation !== this.generation) throw new Error("Unlock the local copy first.");
    const d = draft(kind, body, { id: makeId(), at: Date.now(), device: deviceId() });
    await store.queue(d);
    if (!vaultReady() || generation !== this.generation) return;
    this.publish({ pending: [...this.state.pending, d] });
    void this.sync();
  }

  /** Your own words, by utterance ID: where a memory comes from (I2). */
  said(ids: string[]): Said[] {
    const want = new Set(ids);
    return this.utterances().filter((u) => want.has(u.utteranceId));
  }

  /** Every line in this copy of the log, yours and Ra's, oldest first. */
  utterances(): Said[] {
    return this.events
      .filter((e): e is RaEvent<"utterance"> => e.kind === "utterance")
      .map((e) => ({
        utteranceId: e.body.utteranceId,
        speaker: e.body.speaker,
        text: e.body.text,
        rayId: e.body.rayId ?? null,
        startMs: e.body.startMs,
        endMs: e.body.endMs,
        at: e.at,
        liftWords: e.body.prosody?.liftWords ?? [],
        kept: e.body.audioKey !== undefined,
      }));
  }

  /** One round with the Mind: send the outbox, take what's new. */
  sync(): Promise<void> {
    if(this.inFlight)return this.inFlight;
    const task = this.doSync().finally(() => {
      if(this.inFlight===task)this.inFlight = null;
    });
    return this.inFlight=task;
  }

  private async doSync(): Promise<void> {
    if (!vaultReady()) return;
    const generation = this.generation;
    await this.load();
    if (!vaultReady() || generation !== this.generation) return;
    const account = vaultAccount()!;
    // Earlier app versions queued landfalls and rings directly. Keep those
    // encrypted drafts for review, without forging achievements or blocking edits.
    const outbox = this.state.pending.filter((d) => isPhoneEditKind(d.kind));
    const since = this.confirmed.seq;
    this.publish({ syncing: true });
    try {
      const res = await fetch(`/sync?person=${encodeURIComponent(this.person)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ra-account": account },
        body: JSON.stringify({ since, outbox }),
      });
      if (!res.ok) throw new Error(`sync ${res.status}`);
      if (!vaultReady() || this.generation !== generation) return;
      const out = (await res.json()) as { events: RaEvent[]; seq: number; duplicates: string[]; origin: string | null };
      const origin = await store.get<string>("origin");
      if (!vaultReady() || this.generation !== generation) return;
      if (since > 0 && out.origin !== (origin ?? out.origin)) {
        // Another log under the same name: this copy belongs to a Mind that's gone. Start over.
        this.confirmed = emptyViews();
        this.events = [];
        await store.reset().catch(() => {});
        throw new Resync("a different mind");
      }
      const fresh = out.events.filter((e) => e.seq > since).sort((a, b) => a.seq - b.seq);
      try {
        for (const e of fresh) apply(this.confirmed, e);
      } catch {
        // A gap: never guess. Take the whole log again next time.
        this.confirmed = emptyViews();
        this.events = [];
        await store.set("views", null);
        throw new Resync("mirror out of step");
      }
      this.events.push(...fresh);
      // I2: a memory forgotten anywhere is scrubbed from this phone's copy too.
      const scrubbed: RaEvent[] = [];
      for (const memoryId of fresh.map(forgotten).filter((m): m is string => m !== null)) {
        this.events = this.events.map((e) => {
          const clean = scrub(e, memoryId);
          if (clean) scrubbed.push(clean);
          return clean ?? e;
        });
      }
      const landed = new Set([...fresh.map((e) => e.id), ...out.duplicates]);
      const sent = outbox.filter((d) => landed.has(d.id)).map((d) => d.id);
      const syncedAt = Date.now();
      await Promise.all([
        store.putEvents([...fresh, ...scrubbed]),
        store.unqueue(sent),
        store.set("views", { views: this.confirmed, version: VIEWS_VERSION } satisfies SavedViews),
        store.set("syncedAt", syncedAt),
        store.set("origin", out.origin),
      ]).catch(() => {});
      if (!vaultReady() || generation !== this.generation) return;
      this.publish({ pending: this.state.pending.filter((d) => !landed.has(d.id)), online: true, syncedAt, syncing: false });
    } catch (e) {
      if (!vaultReady() || generation !== this.generation) return;
      if (e instanceof Resync) {
        // Not offline: this copy was dropped. Take the whole log again now.
        this.publish({ syncing: false });
        setTimeout(() => void this.sync(), 0);
        return;
      }
      this.publish({ online: false, syncing: false });
    }
  }

  /** Views = confirmed events, then the outbox on top in the order it was made. */
  private publish(patch: Partial<MindState>): void {
    const pending = patch.pending ?? this.state.pending;
    let views = this.confirmed;
    if (pending.length) {
      views = structuredClone(this.confirmed);
      for (const d of pending) {
        if (!isPhoneEditKind(d.kind)) continue;
        try {
          apply(views, { ...d, seq: views.seq + 1 });
        } catch {
          // A pending event that no longer applies is shown once it syncs.
        }
      }
    }
    this.state = { ...this.state, ...patch, pending, views };
    for (const fn of this.listeners) fn(this.state);
  }
}

let mirror: Mirror | null = null;

/** This phone's mirror of the person's Mind. */
export function mind(person = devPerson()): Mirror {
  if (!mirror) {
    mirror = new Mirror(person);
    void mirror.sync();
    // Catch up whenever the phone comes back: online again, or the app in front again.
    window.addEventListener("online", () => void mirror?.sync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void mirror?.sync();
    });
  }
  return mirror;
}

export function useMind(): MindState {
  const m = mind();
  const [state, setState] = useState(m.current);
  useEffect(() => m.subscribe(setState), [m]);
  return state;
}
