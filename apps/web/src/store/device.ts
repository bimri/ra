import { makeId } from "@ra/core";
import { vaultAccount } from "../auth/vault";

let cached: string | null = null;

/** This device's ID: written into every event it makes. Kept across visits when storage allows. */
export function deviceId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem("ra.device");
    if (!cached) {
      cached = makeId();
      localStorage.setItem("ra.device", cached);
    }
  } catch {
    cached ??= makeId();
  }
  return cached;
}

let person: string | null = null;

/**
 * Whose Mind this is, in dev, before a passkey: "dev", or another named in the
 * address once (`?as=amani`, the seeded demo mind) and remembered. With a
 * passkey session the Worker ignores it and uses your account.
 */
export function devPerson(): string {
  if (person) return person;
  let as: string | null = null;
  try {
    as = new URLSearchParams(location.search).get("as");
    if (as && /^[a-z0-9-]{1,40}$/.test(as)) localStorage.setItem("ra.as", as);
    person = localStorage.getItem("ra.as") ?? "dev";
  } catch {
    person = as ?? "dev";
  }
  return person;
}

/** `path` with this phone's dev person added, for the Worker's APIs. */
export function api(path: string): string {
  const account = vaultAccount();
  return `${path}${path.includes("?") ? "&" : "?"}person=${encodeURIComponent(devPerson())}${account ? "&account=" + encodeURIComponent(account) : ""}`;
}
