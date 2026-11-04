import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Env } from "../env";
import { newWrappedKey } from "../crypto/keys";

// A passkey is the account: no password, no email (A3). The phone's own
// fingerprint or screen lock unlocks it. Credentials and sessions live in D1;
// the session cookie carries a random token whose hash is all D1 keeps.

const SESSION_DAYS = 30;
const CHALLENGE_MS = 5 * 60_000;
const COOKIE = "ra_session";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** A new account id: lowercase, URL-safe, and usable as the Mind's name. */
function accountId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16))).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 22);
}

function relyingParty(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? url.origin;
  return { rpID: new URL(origin).hostname, origin };
}

async function saveChallenge(env: Env, challenge: string, kind: "register" | "authenticate", account: string | null): Promise<string> {
  const id = accountId();
  await env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO challenges (id, challenge, kind, account_id, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, challenge, kind, account, Date.now() + CHALLENGE_MS)
    .run();
  return id;
}

async function takeChallenge(env: Env, id: string, kind: "register" | "authenticate") {
  const row = await env.DB.prepare("SELECT challenge, account_id, expires_at FROM challenges WHERE id = ? AND kind = ?")
    .bind(id, kind)
    .first<{ challenge: string; account_id: string | null; expires_at: number }>();
  await env.DB.prepare("DELETE FROM challenges WHERE id = ?").bind(id).run();
  if (!row || row.expires_at < Date.now()) throw new AuthError("That took too long. Try again.");
  return row;
}

export class AuthError extends Error {}

/** A signed-in session as an HttpOnly cookie. `credential` is null for a passphrase unlock. */
export async function startSession(env: Env, account: string, credential: string | null): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id, account_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), account, credential, now, now + SESSION_DAYS * 86_400_000)
    .run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

/** The signed-in account for this request, if its session is valid. */
export async function sessionAccount(env: Env, request: Request): Promise<string | null> {
  const token = /(?:^|;\s*)ra_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
  if (!token) return null;
  const row = await env.DB.prepare("SELECT account_id, expires_at FROM sessions WHERE id = ?")
    .bind(await sha256(token))
    .first<{ account_id: string; expires_at: number }>()
    .catch(() => null);
  return row && row.expires_at > Date.now() ? row.account_id : null;
}

export const signOutCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ── registration (A3) ──────────────────────────────────────────────────────
export async function registerOptions(env: Env, request: Request, body: { ageBracket?: string; lang?: string }) {
  const { rpID } = relyingParty(request);
  const id = accountId();
  const options = await generateRegistrationOptions({
    rpName: "Ra",
    rpID,
    userID: new Uint8Array(new TextEncoder().encode(id)) as Uint8Array<ArrayBuffer>,
    userName: "Ra",
    userDisplayName: "Your mind",
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],
  });
  const age = body.ageBracket === "under-16" || body.ageBracket === "16-17" ? body.ageBracket : "adult";
  const lang = /^[a-z]{2}$/.test(body.lang ?? "") ? body.lang! : "en";
  const challengeId = await saveChallenge(env, options.challenge, "register", JSON.stringify({ id, age, lang }));
  return {
    challengeId,
    publicKey: {
      challenge: options.challenge,
      rp: options.rp,
      user: options.user,
      pubKeyCredParams: options.pubKeyCredParams,
      authenticatorSelection: options.authenticatorSelection,
      timeout: options.timeout ?? 60_000,
      attestation: options.attestation,
    },
  };
}

export async function registerVerify(env: Env, request: Request, body: { challengeId: string; credential: RegistrationResponseJSON }) {
  const secret = env.RA_MASTER_KEY;
  if (!secret) throw new Error("RA_MASTER_KEY is not set");
  const { rpID, origin } = relyingParty(request);
  const c = await takeChallenge(env, body.challengeId, "register");
  const pending = JSON.parse(c.account_id ?? "{}") as { id: string; age: string; lang: string };
  const v = await verifyRegistrationResponse({
    response: body.credential,
    expectedChallenge: c.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!v.verified || !v.registrationInfo) throw new AuthError("That passkey couldn't be checked.");
  const cred = v.registrationInfo.credential;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO accounts (id, created_at, age_bracket, wrapped_key, lang) VALUES (?, ?, ?, ?, ?)").bind(
      pending.id,
      now,
      pending.age,
      await newWrappedKey(secret),
      pending.lang,
    ),
    env.DB.prepare(
      "INSERT INTO credentials (id, account_id, public_key, counter, transports, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(cred.id, pending.id, b64url(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), deviceName(request), now, now),
  ]);
  return { accountId: pending.id, cookie: await startSession(env, pending.id, cred.id) };
}

// ── sign-in (J3) ───────────────────────────────────────────────────────────
export async function loginOptions(env: Env, request: Request) {
  const { rpID } = relyingParty(request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
  const challengeId = await saveChallenge(env, options.challenge, "authenticate", null);
  return { challengeId, publicKey: { challenge: options.challenge, rpId: rpID, timeout: options.timeout ?? 60_000, userVerification: "required" } };
}

export async function loginVerify(env: Env, request: Request, body: { challengeId: string; credential: AuthenticationResponseJSON }) {
  const { rpID, origin } = relyingParty(request);
  const c = await takeChallenge(env, body.challengeId, "authenticate");
  const row = await env.DB.prepare("SELECT id, account_id, public_key, counter, transports FROM credentials WHERE id = ?")
    .bind(body.credential.id)
    .first<{ id: string; account_id: string; public_key: string; counter: number; transports: string | null }>();
  if (!row) throw new AuthError("This passkey isn't known here.");
  const v = await verifyAuthenticationResponse({
    response: body.credential,
    expectedChallenge: c.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: row.id,
      publicKey: new Uint8Array(Uint8Array.from(atob(row.public_key.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)).buffer as ArrayBuffer),
      counter: row.counter,
      transports: row.transports ? JSON.parse(row.transports) : undefined,
    },
  });
  if (!v.verified) throw new AuthError("That passkey couldn't be checked.");
  await env.DB.prepare("UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(v.authenticationInfo.newCounter, Date.now(), row.id)
    .run();
  return { accountId: row.account_id, cookie: await startSession(env, row.account_id, row.id) };
}

/** I1 · "Forget everything": the account, its credentials, sessions and wrapped key go from D1. */
export async function eraseAccount(env: Env, account: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account),
    env.DB.prepare("DELETE FROM credentials WHERE account_id = ?").bind(account),
    env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(account),
  ]);
}

function deviceName(request: Request): string {
  const ua = request.headers.get("User-Agent") ?? "";
  return /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "This device";
}
