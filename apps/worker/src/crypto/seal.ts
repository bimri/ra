import { gcm } from "@noble/ciphers/aes.js";

// Sealing text in the Mind's own SQLite: event bodies, utterance text, views,
// moments, memories. AES-256-GCM with a random 96-bit nonce per value. It's
// synchronous (audited @noble/ciphers), so the Mind's writes stay inside one
// synchronous transaction: all of a batch or none of it.

const PREFIX = "enc1:";
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

export interface Cipher {
  seal(text: string): string;
  /** Seals bytes (voice clips, photos): nonce, then ciphertext. */
  sealBytes(bytes: Uint8Array): Uint8Array;
  openBytes(sealed: Uint8Array): Uint8Array;
  /** Opens sealed text; text written before sealing existed passes through as it is. */
  open(stored: string): string;
}

export function cipher(key: Uint8Array): Cipher {
  if (key.length !== 32) throw new Error("data key must be 32 bytes");
  return {
    seal(text) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const sealed = gcm(key, nonce).encrypt(enc.encode(text));
      const out = new Uint8Array(12 + sealed.length);
      out.set(nonce);
      out.set(sealed, 12);
      return PREFIX + b64.encode(out);
    },
    sealBytes(bytes) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const sealed = gcm(key, nonce).encrypt(bytes);
      const out = new Uint8Array(12 + sealed.length);
      out.set(nonce);
      out.set(sealed, 12);
      return out;
    },
    openBytes(sealed) {
      return gcm(key, sealed.subarray(0, 12)).decrypt(sealed.subarray(12));
    },
    open(stored) {
      if (!stored.startsWith(PREFIX)) return stored;
      const bytes = b64.decode(stored.slice(PREFIX.length));
      return dec.decode(gcm(key, bytes.subarray(0, 12)).decrypt(bytes.subarray(12)));
    },
  };
}

export const isSealed = (stored: string) => stored.startsWith(PREFIX);
