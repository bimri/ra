// Content-free Web Push (A3: "Notifications never show what's inside"). The
// push has no body at all, so there's nothing to encrypt and nothing to leak;
// the phone's service worker shows only "Ra has something for you."
// Authorised with VAPID (RFC 8292): an ES256 JWT signed by our key.

export interface PushSubscriptionJSON {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

const b64u = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const json64 = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));

/** The VAPID Authorization header for one push service (the endpoint's origin). */
export async function vapidAuth(endpoint: string, publicKey: string, privateJwk: JsonWebKey, subject: string, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", { ...privateJwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = json64({ typ: "JWT", alg: "ES256" });
  const body = json64({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  // WebCrypto's ECDSA signature is already the raw r||s form JWS wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

/** Knock once. Returns "gone" when the subscription has expired (404/410), so it can be dropped. */
export async function knock(sub: PushSubscriptionJSON, publicKey: string, privateJwk: JsonWebKey, subject: string,options:{send?:typeof fetch;signal?:AbortSignal;topic?:string}={}): Promise<"sent" | "gone" | "failed" | "retry" | "unknown"> {
  let authorization:string;try{authorization=await vapidAuth(sub.endpoint,publicKey,privateJwk,subject)}catch{return "failed"}
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000);
  if(signal.aborted)return "retry";
  const res = await (options.send??fetch)(sub.endpoint, {
    method: "POST",
    signal,redirect:"manual",
    headers: { Authorization: authorization, TTL: "86400", Urgency: "normal", "Content-Length": "0",...(options.topic&&/^[A-Za-z0-9_-]{1,32}$/.test(options.topic)?{Topic:options.topic}:{}) },
  }).catch(() => null);
  if (!res) return "unknown";
  // Responses carry no useful user data; release the stream immediately.
  void res.body?.cancel().catch(()=>{});
  if (res.status === 404 || res.status === 410) return "gone";
  if(res.status===429||res.status>=500)return "retry";
  return res.ok ? "sent" : "failed";
}
