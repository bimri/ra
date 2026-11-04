import { makeId } from "@ra/core";
import { newWrappedKey } from "../crypto/keys";
import type { Env } from "../env";
import { AuthError, startSession } from "./passkeys";

// A3 / J3 · the passphrase lock, for phones without passkeys. The account is
// the same as with a passkey (no email, no username); the phone remembers
// which account is yours, and the passphrase opens it. Only a salted PBKDF2
// hash is kept. Repeated wrong guesses lock it for a while.

/** Workers caps PBKDF2 at 100,000 iterations. */
const ITERATIONS = 100_000;
const MIN_LENGTH = 10;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassphrase(passphrase: string, salt: Uint8Array, iterations = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** A3 · a new account locked with a passphrase. */
export async function registerPassphrase(env: Env, body: { passphrase?: string; ageBracket?: string; lang?: string }): Promise<{ accountId: string; cookie: string }> {
  const secret = env.RA_MASTER_KEY;
  if (!secret) throw new Error("RA_MASTER_KEY is not set");
  const passphrase = String(body.passphrase ?? "");
  if (passphrase.trim().length < MIN_LENGTH) throw new AuthError(`A passphrase needs at least ${MIN_LENGTH} characters. A few words you'll remember work well.`);
  const age = body.ageBracket === "under-16" || body.ageBracket === "16-17" ? body.ageBracket : "adult";
  const lang = typeof body.lang === "string" && /^[a-z]{2,3}$/.test(body.lang) ? body.lang : "en";
  const id = makeId().toLowerCase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO accounts (id, created_at, age_bracket, wrapped_key, lang) VALUES (?, ?, ?, ?, ?)").bind(id, now, age, await newWrappedKey(secret), lang),
    env.DB.prepare("INSERT INTO passphrases (account_id, salt, hash, iterations, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, b64(salt), await hashPassphrase(passphrase, salt), ITERATIONS, now),
  ]);
  return { accountId: id, cookie: await startSession(env, id, null) };
}

/** J3 · unlock with the passphrase, on the phone that remembers the account. */
export async function loginPassphrase(env: Env, body: { accountId?: string; passphrase?: string }): Promise<{ accountId: string; cookie: string }> {
  const id = String(body.accountId ?? "");
  const row = await env.DB.prepare("SELECT salt, hash, iterations, failures, locked_until FROM passphrases WHERE account_id = ?")
    .bind(id)
    .first<{ salt: string; hash: string; iterations: number; failures: number; locked_until: number }>();
  // The same answer whether the account exists or not.
  if (!row) throw new AuthError("That passphrase didn't open it.");
  if (row.locked_until > Date.now()) throw new AuthError("Too many tries. Wait a few minutes, then try again.");
  const ok = same(await hashPassphrase(String(body.passphrase ?? ""), unb64(row.salt), row.iterations), row.hash);
  if (!ok) {
    const failures = row.failures + 1;
    await env.DB.prepare("UPDATE passphrases SET failures = ?, locked_until = ? WHERE account_id = ?")
      .bind(failures >= MAX_FAILURES ? 0 : failures, failures >= MAX_FAILURES ? Date.now() + LOCK_MS : 0, id)
      .run();
    throw new AuthError("That passphrase didn't open it.");
  }
  await env.DB.prepare("UPDATE passphrases SET failures = 0, locked_until = 0 WHERE account_id = ?").bind(id).run();
  return { accountId: id, cookie: await startSession(env, id, null) };
}
