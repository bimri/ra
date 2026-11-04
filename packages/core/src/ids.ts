// IDs are made on the device an event comes from, so the outbox can replay
// safely: the Mind drops an ID it has already seen. Format is ULID-like:
// 10 chars of millisecond time + 16 chars of randomness, Crockford base32,
// so IDs from one device sort by creation time.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function makeId(now: number = Date.now()): string {
  let time = "";
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += ALPHABET.charAt(b % 32);
  return time + rand;
}

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}
