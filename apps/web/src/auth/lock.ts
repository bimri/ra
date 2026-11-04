import { closeVault, vaultReady } from "./vault";
import { useEffect, useState } from "preact/hooks";

// J3 · "Locked after 5 minutes away." Once you have a passkey, Ra locks when
// the phone has been away from it for five minutes, and opens again with the
// same fingerprint or screen lock.

const AWAY_MS = 5 * 60_000;
const ACCOUNT = "ra.account";
let hiddenAt: number | null = null;
let locked = false;
const listeners = new Set<(locked: boolean) => void>();

function set(next: boolean): void {
  locked = next;
  if (next) closeVault();
  for (const fn of listeners) fn(locked);
}

/** Remember that this phone holds a passkey account (set after A3). */
export function rememberAccount(accountId: string): void {
  try {
    localStorage.setItem(ACCOUNT, accountId);
  } catch {
    // fine
  }
}

/** The account this phone holds, for the passphrase unlock (there's no username). */
export function rememberedAccount(): string | null {
  try {
    return localStorage.getItem(ACCOUNT);
  } catch {
    return null;
  }
}

export function hasAccount(): boolean {
  try {
    return localStorage.getItem(ACCOUNT) !== null;
  } catch {
    return false;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS && (hasAccount() || vaultReady())) set(true);
  });
}

export function unlock(): void {
  hiddenAt = null;
  set(false);
}

export function useLocked(): boolean {
  const [v, setV] = useState(locked);
  useEffect(() => {
    listeners.add(setV);
    return () => void listeners.delete(setV);
  }, []);
  return v;
}
