import { vaultReady } from "../auth/vault";
import { RaySocket, rayUrl } from "../voice/raySocket";
import { deviceId } from "./device";
import { mind } from "./mind";

// End pressed with no connection: the Mind never heard it, so the Ray would
// stay live (Today saying "Continue your Ray") until it expired. The end
// waits here and is sent the moment the phone is back: rejoin, end, let go.

const KEY = "ra.endOwed";

export function owe(rayId: string): void {
  try {
    localStorage.setItem(KEY, rayId);
  } catch {
    // storage off: the Mind closes it when its wait runs out
  }
}

let sending = false;

export function sendOwedEnd(): void {
  let rayId: string | null = null;
  try {
    rayId = localStorage.getItem(KEY);
  } catch {
    return;
  }
  if (!rayId || sending || !navigator.onLine || !vaultReady()) return;
  const views = mind().current.views;
  // Already over (the Mind's own wait ran out, or another phone ended it): nothing owed.
  if (views.liveRay !== rayId || views.rays[rayId]?.endedAt !== null) {
    if (views.seq > 0) localStorage.removeItem(KEY);
    return;
  }
  sending = true;
  const done = () => {
    sending = false;
    socket.close();
    void mind().sync();
  };
  const socket: RaySocket = new RaySocket(rayUrl(), {
    message: (m) => {
      if (m.t === "ready") socket.send({ t: "end" });
      if (m.t === "ended") {
        localStorage.removeItem(KEY);
        done();
      }
    },
    status: (s) => {
      if (s === "closed" || s === "error" || s === "refused") sending = false;
    },
    raAudio: () => {},
  });
  socket.open({ t: "hello", device: deviceId(), minutes: views.rays[rayId]?.minutes ?? 30 });
  window.setTimeout(() => sending && done(), 15_000);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", sendOwedEnd);
  window.addEventListener("ra-local-ready", sendOwedEnd);
}
