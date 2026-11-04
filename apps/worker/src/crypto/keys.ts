// Each person gets their own data key, wrapped by a master key held as a
// Worker secret (architecture page, "Identity and privacy"). The wrapped key
// lives in their D1 account row; deleting the row leaves anything encrypted
// with it unreadable, wherever a copy is.

const b64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

/** The master key-encryption key, from the RA_MASTER_KEY secret (32 bytes, base64). */
async function master(secret: string): Promise<CryptoKey> {
  const raw = b64.decode(secret);
  if (raw.length !== 32) throw new Error("RA_MASTER_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-KW", false, ["wrapKey", "unwrapKey"]);
}

/** A fresh 256-bit data key, wrapped for storage. */
export async function newWrappedKey(secret: string): Promise<string> {
  const key = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])) as CryptoKey;
  const wrapped = await crypto.subtle.wrapKey("raw", key, await master(secret), "AES-KW");
  return b64.encode(new Uint8Array(wrapped));
}

/** The raw data key, unwrapped in memory for the Mind's cipher. */
export async function unwrapKey(wrapped: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.unwrapKey("raw", b64.decode(wrapped), await master(secret), "AES-KW", "AES-GCM", true, ["encrypt", "decrypt"]);
  return new Uint8Array((await crypto.subtle.exportKey("raw", key)) as ArrayBuffer);
}

/**
 * A dev Mind (named with ?person=, no account) still encrypts: its key is
 * derived from the master key and its name, so test data is never plain.
 */
export async function devKey(person: string, secret: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", b64.decode(secret), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("ra/dev-mind"), info: new TextEncoder().encode(person) },
    base,
    256,
  );
  return new Uint8Array(bits);
}
