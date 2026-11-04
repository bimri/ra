import { AUDIO_RATE } from "@ra/core";
import { ASR_MODEL, MUSE_LANGUAGES, connect, type AsrSocket } from "./muse";

const CHUNK = AUDIO_RATE / 10; // 100 ms of 16 kHz audio per message

/** Sample rate from a WAV's fmt chunk, or null if it isn't a WAV. */
function rateOf(file: Uint8Array): number | null {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tag = (at: number) => String.fromCharCode(...file.subarray(at, at + 4));
  if (file.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  for (let at = 12; at + 8 <= file.length; ) {
    const size = v.getUint32(at + 4, true);
    if (tag(at) === "fmt " && size >= 16) return v.getUint32(at + 12, true);
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Linear resample to 16 kHz; clips are short, so this stays cheap. */
function to16k(pcm: Int16Array, rate: number): Int16Array {
  if (rate === AUDIO_RATE) return pcm;
  const out = new Int16Array(Math.floor((pcm.length * AUDIO_RATE) / rate));
  for (let i = 0; i < out.length; i++) {
    const at = (i * rate) / AUDIO_RATE, lo = Math.floor(at), hi = Math.min(pcm.length - 1, lo + 1);
    out[i] = Math.round(pcm[lo]! + (pcm[hi]! - pcm[lo]!) * (at - lo));
  }
  return out;
}

/**
 * One clip outside a live Ray (walkie, captures, bring back, the Ear), through Muse Transcribe's
 * realtime socket: authorize, stream the clip, end the stream, and join the finished turns in order.
 * Rejects on any provider error; never echoes provider bodies.
 */
export async function museClip(
  key: string,
  pcm: Int16Array,
  rate: number,
  language = "auto",
  dial: (signal: AbortSignal) => Promise<AsrSocket> = connect,
): Promise<string> {
  if (language !== "auto" && !MUSE_LANGUAGES[language]) language = "auto";
  const audio = to16k(pcm, rate);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const ws = await dial(controller.signal);
  return new Promise<string>((resolve, reject) => {
    const turns = new Map<number, string>();
    let latest = "", acknowledged = false, settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(1000); } catch {}
      if (error) reject(error);
      else resolve(([...turns.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.trim()).filter(Boolean).join(" ") || latest).trim());
    };
    controller.signal.addEventListener("abort", () => finish(new Error("Clip transcription timed out")), { once: true });
    ws.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string" || event.data.length > 64_000) return;
      let value: Record<string, unknown>;
      try { value = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
      if (value.type === "error") return finish(new Error("Clip transcription failed"));
      if (!acknowledged) {
        if (typeof value.sessionId !== "string") return finish(new Error("Clip transcription was not acknowledged"));
        acknowledged = true;
        for (let at = 0; at < audio.length; at += CHUNK) {
          const part = audio.subarray(at, at + CHUNK), bytes = new ArrayBuffer(part.length * 2), view = new DataView(bytes);
          for (let i = 0; i < part.length; i++) view.setInt16(i * 2, part[i]!, true);
          ws.send(bytes);
        }
        ws.send(JSON.stringify({ type: "endStream" }));
        return;
      }
      if (typeof value.transcript !== "string") return;
      if (value.type === "speechComplete" && typeof value.turnId === "number") turns.set(value.turnId, value.transcript);
      else if (value.type === "transcript") latest = value.transcript;
    });
    ws.addEventListener("error", () => finish(new Error("Clip transcription failed")));
    ws.addEventListener("close", () => finish(acknowledged ? undefined : new Error("Clip transcription closed early")));
    ws.send(JSON.stringify({ authorization: { accessToken: "Bearer " + key }, audioEncoding: "PCM_16KHZ", model: ASR_MODEL, mode: "ENDPOINTING", partialMode: "CUMULATIVE", ...(language !== "auto" ? { languageBias: [MUSE_LANGUAGES[language]] } : {}) }));
  });
}

export { rateOf };
