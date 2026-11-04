// Signed claims (K1): how a funder learns that someone arrived. A claim says
// only "a marker was reached" or "landfall", on which voyage, when; it's
// signed with Ra's Ed25519 key so a funder can check it with the public key
// alone, and it's made only when the person agrees to share it.

export interface LegacyClaim {
  v: 1;
  voyage: string;
  kind: "marker" | "landfall";
  island: string;
  at: number;
}

export type Claim = LegacyClaim | { v: 2; voyage: string; milestone: string; kind: "marker" | "landfall"; at: number };

/** Reject unsigned extra fields, unsupported versions, and malformed receipts. */
export function validClaim(value: unknown): value is Claim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  const fields = c.v === 1 ? ["v", "voyage", "kind", "island", "at"] : c.v === 2 ? ["v", "voyage", "milestone", "kind", "at"] : [];
  return fields.length > 0 && Object.keys(c).length === fields.length && fields.every(k => Object.hasOwn(c, k))
    && typeof c.voyage === "string" && c.voyage.length > 0 && c.voyage.length <= 200
    && (c.kind === "marker" || c.kind === "landfall") && Number.isSafeInteger(c.at) && Number(c.at) >= 0
    && (c.v === 1 ? typeof c.island === "string" : /^[a-f0-9]{64}$/.test(c.voyage as string) && typeof c.milestone === "string" && /^[a-f0-9]{64}$/.test(c.milestone));
}

const b64u = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

/** The exact bytes signed: the claim's fields in a fixed order. */
export function claimBytes(c: Claim): Uint8Array {
  if (!validClaim(c)) throw new Error("Invalid claim");
  return new TextEncoder().encode(JSON.stringify(c.v === 1
    ? { v: c.v, voyage: c.voyage, kind: c.kind, island: c.island, at: c.at }
    : { v: c.v, voyage: c.voyage, milestone: c.milestone, kind: c.kind, at: c.at }));
}

export async function signClaim(c: Claim, privateJwk: JsonWebKey): Promise<string> {
  // Node exports alg=Ed25519; some workerd versions accept only EdDSA.
  // The actual curve is mandatory. Omit only those two equivalent JOSE labels.
  if (privateJwk.kty !== "OKP" || privateJwk.crv !== "Ed25519" || privateJwk.alg !== undefined && privateJwk.alg !== "Ed25519" && privateJwk.alg !== "EdDSA") throw new Error("An Ed25519 signing key is required");
  const compatible = {...privateJwk}; delete compatible.alg;
  const key = await crypto.subtle.importKey("jwk", compatible, { name: "Ed25519" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("Ed25519", key, claimBytes(c)));
}

export async function verifyClaim(c: Claim, signature: string, publicKey: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", unb64u(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, unb64u(signature), claimBytes(c));
  } catch {
    return false;
  }
}

/** The public half of a private JWK, as funders fetch it (raw, base64url). */
export const publicOf = (privateJwk: JsonWebKey) => privateJwk.x ?? "";

/** Funders are paid out partly up front, the rest split across markers and landfall. */
export function tranches(amount: number, upfront: number, markers: number): { upfront: number; perMarker: number; landfall: number } {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(upfront) || upfront < 0 || upfront > 1 || !Number.isSafeInteger(markers) || markers < 0 || markers >= Number.MAX_SAFE_INTEGER) throw new Error("Explicit voyage terms are required");
  const first = Math.round(amount * upfront);
  const rest = amount - first;
  const perMarker = markers > 0 ? Math.floor(rest / (markers + 1)) : 0;
  return { upfront: first, perMarker, landfall: rest - perMarker * markers };
}
