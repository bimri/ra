// A5 · C4 · the Ear: quick thoughts from WhatsApp. Meta's Cloud API sends
// webhooks here; each message lands in your Mind as a capture. Ra replies in
// a few words or not at all, and only ever "Kept." when discreet.
//
// Linking: the app shows a one-time code; you send it to Ra's number. D1
// keeps a keyed hash of your WhatsApp ID, never the number itself.

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Meta signs each webhook body with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export async function signatureOk(body: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  const got = header.slice(7).toLowerCase();
  // Constant-time compare.
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** The keyed hash D1 keeps instead of a WhatsApp ID. */
export async function waHash(waId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`ra-ear:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(waId.replace(/\D/g, ""))));
}

/** A one-time link code: six characters, no look-alikes (0/O, 1/I). */
export function linkCode(random: Uint8Array = crypto.getRandomValues(new Uint8Array(6))): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...random].map((b) => abc[b % abc.length]).join("");
}

export type EarMessage = {at:number|null} & (
  | { from: string; id: string; kind: "text"; text: string }
  | { from: string; id: string; kind: "audio"; mediaId: string }
  | { from: string; id: string; kind: "image"; mediaId: string; caption: string | null }
  | { from: string; id: string; kind: "other" });

/** The messages in one Cloud API webhook payload; statuses and anything else are ignored. */
export function messagesOf(payload: unknown,phoneId?:string): EarMessage[] {
  const out: EarMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes=(entry as {changes?:unknown[]}|null)?.changes;if(!Array.isArray(changes))continue;
    for (const change of changes) {
      const value=(change as {value?:{messages?:unknown[];metadata?:{phone_number_id?:unknown}}}|null)?.value;if(phoneId&&value?.metadata?.phone_number_id!==phoneId)continue;
      const msgs=value?.messages??[];
      if(!Array.isArray(msgs))continue;
      for (const raw of msgs) {
        const m = raw as { from?: string; id?: string;timestamp?:unknown; type?: string; text?: { body?: string }; audio?: { id?: string }; image?: { id?: string; caption?: string } };
        if (!m||typeof m.from !== "string"||!/^\d{5,20}$/.test(m.from)||typeof m.id !== "string"||!m.id||m.id.length>512) continue;
        const time=typeof m.timestamp==="string"&&/^\d{1,12}$/.test(m.timestamp)?Number(m.timestamp)*1000:NaN;
        const common={from:m.from,id:m.id,at:Number.isSafeInteger(time)&&time>0&&time<=Date.now()+60_000?time:null};
        if (m.type === "text" && typeof m.text?.body === "string") out.push({ ...common, kind: "text", text: m.text.body });
        else if (m.type === "audio" && typeof m.audio?.id==="string"&&m.audio.id.length<=512) out.push({ ...common, kind: "audio", mediaId: m.audio.id });
        else if (m.type === "image" && typeof m.image?.id==="string"&&m.image.id.length<=512) out.push({ ...common, kind: "image", mediaId: m.image.id, caption: typeof m.image.caption==="string"?m.image.caption:null });
        else out.push({ ...common, kind: "other" });
        if(out.length>128)throw new Error("Too many Ear messages in one delivery.");
      }
    }
  }
  return out;
}

/** What Ra says back: a few words, never the content (discreet or not, it never quotes you). */
export const EAR_REPLIES = {
  linked: "Linked. Send me a thought any time.",
  kept: "Kept.",
  unheard: "I couldn't hear that one. Try again?",
  notLinked: "Open Ra and tap Connect to link this chat.",
} as const;
