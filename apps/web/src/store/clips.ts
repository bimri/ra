import { useEffect, useState } from "preact/hooks";
import { makeId } from "@ra/core";
import { store, localSession, checkLocalSession, type QueuedClip } from "./db";
import { api } from "./device";
import { mind } from "./mind";

// Clips that wait (J2): a thought held offline (C2) or a bring-back (C3) is
// kept encrypted on this phone and sent when there's a connection again.
// Muse Transcribe reads it on the server; nothing is transcribed on the phone.

const listeners = new Set<(n: QueuedClip[]) => void>();
let queued: QueuedClip[] = [];

function publish(next: QueuedClip[]): void {
  queued = next;
  for (const fn of listeners) fn(queued);
}

function form(c: Pick<QueuedClip, "fields" | "files">): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(c.fields)) f.set(k, v);
  for (const [k, v] of Object.entries(c.files)) f.set(k, v, k === "photo" && v instanceof File ? v.name : `${k}.wav`);
  return f;
}

/** A refusal isn't a lost connection: the Worker won't take it, so it isn't queued or retried. */
class Refused extends Error {}

async function post<T>(c: Pick<QueuedClip, "path" | "fields" | "files">, owner: string): Promise<T> {
  const res = await fetch(api(c.path), { method: "POST", body: form(c), credentials: "include", cache: "no-store", headers: { "x-ra-account": owner } });
  if (!res.ok) throw new Refused(`refused ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Send now if the phone is online; otherwise keep it encrypted to send later.
 * Returns the Worker's answer, or null when it was queued.
 */
export async function sendOrQueue<T>(c: Omit<QueuedClip, "id" | "at">): Promise<T | null> {
  const session = localSession();
  if (navigator.onLine) {
    try {
      const out = await post<T>(c, session.owner);
      checkLocalSession(session);
      void mind().sync();
      return out;
    } catch (e) {
      if (e instanceof Refused) throw e;
    }
  }
  const item: QueuedClip = { ...c, id: makeId(), at: Date.now() };
  await store.queueClip(item);
  checkLocalSession(session);
  publish([...queued, item]);
  return null;
}

let flushing: ReturnType<typeof localSession> | null = null;

/** Send whatever is waiting, oldest first. A refused clip leaves the queue; a lost connection stops the run. */
export async function flushClips(): Promise<void> {
  let session: ReturnType<typeof localSession> | null = null;
  try {
    session = localSession();
    if (flushing && flushing.owner === session.owner && flushing.epoch === session.epoch) return;
    flushing = session;
    const waiting = (await store.clips().catch(() => [] as QueuedClip[])).sort((a, b) => a.at - b.at);
    checkLocalSession(session);
    publish(waiting);
    if (!navigator.onLine) return;
    for (const c of waiting) {
      try {
        await post(c, session.owner);
      } catch (e) {
        if (!(e instanceof Refused)) break; // offline again
      }
      checkLocalSession(session);
      await store.unqueueClip(c.id).catch(() => {});
      publish(queued.filter((q) => q.id !== c.id));
    }
    void mind().sync();
  } catch {
    /* Locked queues stay encrypted and are sent after unlock. */
  } finally {
    if (flushing === session) flushing = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushClips());
  window.addEventListener("ra-local-ready", () => void flushClips());
  window.addEventListener("ra-vault-closed", () => publish([]));
}

export function useQueuedClips(): QueuedClip[] {
  const [q, setQ] = useState(queued);
  useEffect(() => {
    listeners.add(setQ);
    setQ(queued);
    return () => void listeners.delete(setQ);
  }, []);
  return q;
}
