import { api } from "./device";

// Content-free notifications (A3: "Notifications never show what's inside").
// The Worker's interruption governor is the only thing that sends them, for
// four reasons only; the push carries no payload at all.

function bytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function pushOn(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Ask once, subscribe, and give the Worker where to knock. */
export async function turnOnPush(): Promise<"on" | "blocked" | "unavailable"> {
  if (!pushSupported()) return "unavailable";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "unavailable"; // dev build: no service worker
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const res = await fetch(api("/push/key"), { credentials: "include" });
  if (!res.ok) return "unavailable";
  const { key } = (await res.json()) as { key: string | null };
  if (!key) return "unavailable";
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) });
  const saved = await fetch(api("/push"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()), credentials: "include" });
  return saved.ok ? "on" : "unavailable";
}

export async function turnOffPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch(api("/push"), { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), credentials: "include" }).catch(() => {});
  await sub.unsubscribe();
}
