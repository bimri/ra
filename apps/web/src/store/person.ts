import { cleanName } from "@ra/core";
import { vaultReady } from "../auth/vault";
import { mind } from "./mind";

// A2b: the name Ra calls you. First light asks before your lock exists, so it
// waits here (on this phone only) until your mind opens, is written into it
// as person.named, and the waiting copy is removed.

const KEY = "ra.name.waiting";

/** Keep the name you gave in first light until your mind can hold it. null: you'd rather not say. */
export function giveName(value: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cleanName(value)));
  } catch {
    // storage off: written straight away below, or asked again in Your mind
  }
  void flushName();
}

/** Change it later (Your mind). */
export async function rename(value: string | null): Promise<void> {
  await mind().write("person.named", { name: cleanName(value) });
}

export async function flushName(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return;
  }
  if (raw === null || !vaultReady()) return;
  try {
    await mind().write("person.named", { name: cleanName(JSON.parse(raw)) });
    localStorage.removeItem(KEY);
  } catch {
    // Locked again before it was written: it waits for the next unlock.
  }
}

if (typeof window !== "undefined") window.addEventListener("ra-local-ready", () => void flushName());
