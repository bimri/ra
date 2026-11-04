import { useEffect, useRef, useState } from "preact/hooks";
import { sendOrQueue } from "../../store/clips";
import { useMind } from "../../store/mind";
import { Icon } from "../../ui/icons";
import { Tip } from "../../ui/Tooltip";
import { go, navigate } from "../../ui/nav";
import { openMic, type Mic } from "../../voice/mic";
import { wav } from "../../voice/wav";

// C3 · Bring back: a scouting trip's evidence. "A one-minute voice note:
// what failed, and how you know", and a photo if it helps. The clip goes to
// your Mind, which keeps it, transcribes it and records the trip as reported.

const ENOUGH_MS = 60_000;

/** On a metered connection, Ra waits for Wi-Fi unless told otherwise (A4). */
function onData(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  return c?.type === "cellular" || c?.saveData === true;
}

export function BringBackScreen() {
  const { views } = useMind();
  const trip = Object.values(views.trips).filter((t) => t.state === "chosen").at(-1);
  const [recording, setRecording] = useState(false);
  const [ms, setMs] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "waiting" | "queued" | "failed">("idle");
  const mic = useRef<Mic | null>(null);
  const micRequest=useRef<AbortController|null>(null);
  const chunks = useRef<Int16Array[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {micRequest.current?.abort();mic.current?.stop();chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[]}, []);

  async function toggle() {
    if (recording) {
      const received=mic.current!==null;
      micRequest.current?.abort();micRequest.current=null;
      mic.current?.stop();
      mic.current = null;
      setRecording(false);
      setClip(received?wav(chunks.current):null);
      chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[];
      return;
    }
    if(micRequest.current)return;
    chunks.current = [];
    const controller=new AbortController();micRequest.current=controller;
    setMs(0);
    setClip(null);
    setRecording(true);
    try{mic.current = await openMic((f) => {
      if(controller.signal.aborted){f.pcm.fill(0);return}
      chunks.current.push(f.pcm.slice());
      f.pcm.fill(0);
      setMs((m) => m + 20);
    },controller.signal)}catch{if(micRequest.current===controller)micRequest.current=null;if(!controller.signal.aborted){setRecording(false);setState("failed")};return}
    if(controller.signal.aborted){mic.current.stop();mic.current=null;return}
  }

  async function send(evenOnData = false) {
    if (!trip || !clip) return;
    if (onData() && !evenOnData) {
      setState("waiting");
      return;
    }
    setState("sending");
    try {
      // Offline, it waits on this phone and goes when you reconnect (J2 "it'll wait").
      const out = await sendOrQueue<{ text: string }>({
        path: "/evidence",
        fields: { tripId: trip.tripId },
        files: { clip, ...(photo ? { photo } : {}) },
        label: "What you brought back",
        ms,
      });
      if (out) {
        setSaid(out.text);
        setState("sent");
      } else setState("queued");
    } catch {
      setState("failed");
    }
  }

  const size = (clip?.size ?? 0) + (photo?.size ?? 0);
  const kb = Math.max(1, Math.round(size / 1024));
  const secs = Math.floor(ms / 1000);
  const ticks = Array.from({ length: 60 }, (_, i) => (
    <i key={i} class={[i < secs ? "done" : "", i === secs && recording ? "now" : "", i % 5 === 0 ? "maj" : ""].join(" ").trim()} />
  ));

  if (!trip) {
    return (
      <div class="ui">
        <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
          <header class="spread" style={{ minHeight: "44px" }}>
            <a href="/" onClick={go("/")} class="label" style={{ color: "var(--text)" }}>
              Bring back
            </a>
          </header>
          <div class="h1" style={{ marginTop: "24px" }}>
            No trip in progress.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <a href="/" onClick={go("/")} class="hstack" style={{ gap: "8px", color: "var(--text)", minHeight: "44px" }}>
            <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
              <Icon name="arrow" size={18} />
            </span>
            <span class="label" style={{ color: "var(--text)" }}>
              Bring back
            </span>
          </a>
          <span class="label">Trip</span>
        </header>
        <div class="label" style={{ marginTop: "18px" }}>
          {trip.title ?? trip.action}
        </div>
        <div style={{ marginTop: "12px" }}>
          <p style={{ margin: 0, fontSize: "28px", lineHeight: 1.14, letterSpacing: "-.03em", fontWeight: 400 }}>
            {said ?? (recording ? "Listening…" : clip ? "Got it. Send it when you're ready." : trip.evidence)}
          </p>
        </div>

        <div class="card" style={{ marginTop: "20px" }}>
          <div class="spread">
            <span class="dot" style={{ fontSize: "34px", lineHeight: 1 }}>
              {Math.floor(secs / 60)}
              <span class={recording ? "blink" : ""}>:</span>
              {String(secs % 60).padStart(2, "0")}
            </span>
            <span class="label">{ms > ENOUGH_MS ? "that's plenty" : "about a minute is plenty"}</span>
          </div>
          <div style={{ marginTop: "10px" }}>
            <div class="ticks" aria-hidden="true">
              {ticks}
            </div>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => setPhoto((e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
        />
        <button type="button" class="row" style={{ marginTop: "14px", background: "none", border: "none", borderTop: "1px solid var(--line)", color: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => fileInput.current?.click()}>
          <span style={{ width: "52px", height: "40px", borderRadius: "8px", flex: "none", background: "var(--surface2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="capture" size={20} />
          </span>
          <div class="grow">
            <div class="title" style={{ fontSize: "15px" }}>
              {photo ? "Photo added" : "Add a photo"}
            </div>
            <div class="meta">{photo ? "Tap to retake" : "Optional"}</div>
          </div>
        </button>
        {clip && state === "queued" && (
          <div class="row">
            <span class="grow meta">Kept on this phone · {kb} KB. It goes when you reconnect.</span>
          </div>
        )}
        {clip && state !== "sent" && state !== "queued" && (
          <div class="row">
            <span class="grow meta">
              {state === "waiting" ? `Waiting for Wi-Fi · ${kb} KB` : state === "failed" ? "Your mind didn't take it. Try again." : `Sends on Wi-Fi · ${kb} KB`}
            </span>
            <button type="button" class="btn btn-line btn-sm" onClick={() => send(true)}>
              Send on data
            </button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div class="spread" style={{ paddingBottom: "30px" }}>
          <Tip text={recording ? "Stop" : "Record"}><button type="button" class={`rec${recording ? " live" : ""}`} style={{ width: "64px", height: "64px", border: "none", cursor: "pointer" }} aria-label={recording ? "Stop" : "Record"} onClick={toggle} /></Tip>
          {state === "sent" || state === "queued" ? (
            <button type="button" class="btn btn-ink" onClick={() => navigate("/")}>
              Done
            </button>
          ) : (
            <button type="button" class="btn btn-ink" disabled={!clip || recording || state === "sending"} onClick={() => send(false)}>
              {state === "sending" ? "Sending…" : "Done"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
