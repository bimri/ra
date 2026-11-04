import { useEffect, useRef, useState } from "preact/hooks";
import type { SpokenCommand } from "@ra/core";
import { sendOrQueue } from "../../store/clips";
import { api } from "../../store/device";
import { useMind } from "../../store/mind";
import { Sea } from "../../sky/Sea";
import { Icon } from "../../ui/icons";
import { go, navigate } from "../../ui/nav";
import { openMic, type Mic } from "../../voice/mic";
import { playListeningTone } from "../../voice/tone";
import { wav } from "../../voice/wav";

// C2 · Speak: hold the sun to keep a thought, any time, outside a Ray.
// Release to keep, slide down to cancel. A thought is kept with your trip
// when one is under way; "Undo" really undoes, because nothing is kept
// until its few seconds have passed. A short command goes where it asks.

const UNDO_MS = 5000;
const CANCEL_PX = 70;
const GO: Record<SpokenCommand, string> = { ray: "/ray", rings: "/rings", chart: "/chart", today: "/" };

type State =
  | { at: "idle" }
  | { at: "holding" }
  | { at: "reading" }
  | { at: "kept"; text: string; withTrip: boolean; undoable: boolean }
  | { at: "undone"; text: string }
  /** Offline (J2): the clip waits on this phone and is read when it reaches your mind. */
  | { at: "waiting" }
  | { at: "failed"; message: string };

export function SpeakScreen() {
  const { views } = useMind();
  const trip = Object.values(views.trips).some((t) => t.state === "chosen");
  const [state, setState] = useState<State>({ at: "idle" });
  const [cancelling, setCancelling] = useState(false);
  const cancelGesture=useRef(false);
  const mic = useRef<Mic | null>(null);
  const micRequest=useRef<AbortController|null>(null);
  const chunks = useRef<Int16Array[]>([]);
  const startY = useRef(0);
  const pending = useRef<{ clip: Blob; text: string; ms: number; timer: number } | null>(null);

  // Leaving the screen inside the undo window still keeps the thought.
  useEffect(
    () => () => {
      mic.current?.stop();
      micRequest.current?.abort();micRequest.current=null;
      chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[];
      if (pending.current) {
        clearTimeout(pending.current.timer);
        void keep(pending.current.clip, pending.current.text, pending.current.ms);
      }
    },
    [],
  );

  async function keep(clip: Blob, text: string, ms: number): Promise<void> {
    pending.current = null;
    // Sent now, or kept on this phone until it can be: either way it's kept.
    await sendOrQueue({ path: "/capture", fields: { text }, files: { clip }, label: "A thought you kept", ms }).catch(() =>
      setState({ at: "failed", message: "Your mind didn't take that one. Hold and say it again." }),
    );
    setState((s) => (s.at === "kept" ? { ...s, undoable: false } : s));
  }

  async function hold(e: PointerEvent) {
    if (mic.current||micRequest.current) return;
    const controller=new AbortController();micRequest.current=controller;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    setCancelling(false);
    cancelGesture.current=false;
    chunks.current = [];
    try {
      mic.current = await openMic((f) => {if(!controller.signal.aborted)chunks.current.push(f.pcm.slice());f.pcm.fill(0)},controller.signal);
      if(controller.signal.aborted){mic.current.stop();mic.current=null;return}
    } catch {
      if(micRequest.current===controller)micRequest.current=null;
      if(controller.signal.aborted)return;
      setState({ at: "failed", message: "Ra can't hear you: the microphone is off." });
      return;
    }
    playListeningTone();
    setState({ at: "holding" });
  }

  function move(e: PointerEvent) {
    if (micRequest.current) {cancelGesture.current=e.clientY - startY.current > CANCEL_PX;setCancelling(cancelGesture.current)}
  }

  async function release() {
    micRequest.current?.abort();micRequest.current=null;
    if (!mic.current) {chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[];setState({at:"idle"});return}
    mic.current.stop();
    mic.current = null;
    if (cancelGesture.current || chunks.current.length < 15) {
      // Slid away, or too short to be a thought (under 0.3 s).
      setCancelling(false);
      setState({ at: "idle" });
      chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[];
      return;
    }
    const clip = wav(chunks.current);
    const ms = chunks.current.length * 20;
    chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[];
    if (!navigator.onLine) {
      // No one to read it now: it waits here, encrypted, and Muse reads it when it arrives.
      try {
        await sendOrQueue({ path: "/capture", fields: {}, files: { clip }, label: "A thought you kept", ms });
        setState({ at: "waiting" });
      } catch { setState({ at: "failed", message: "The recording could not be saved securely. Keep this screen open and try again." }); }
      return;
    }
    setState({ at: "reading" });
    const form = new FormData();
    form.set("clip", clip, "thought.wav");
    const res = await fetch(api("/transcribe"), { method: "POST", body: form, credentials: "include", cache: "no-store" }).catch(() => null);
    const out = res?.ok ? ((await res.json()) as { text: string; command: SpokenCommand | null }) : null;
    if (!out) return setState({ at: "failed", message: "Ra couldn't read that one. Hold and say it again." });
    if (!out.text) return setState({ at: "idle" });
    if (out.command) return navigate(GO[out.command]);
    const timer = window.setTimeout(() => pending.current && void keep(pending.current.clip, pending.current.text, pending.current.ms), UNDO_MS);
    pending.current = { clip, text: out.text, ms, timer };
    setState({ at: "kept", text: out.text, withTrip: trip, undoable: true });
  }

  function undo() {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const { text } = pending.current;
    pending.current = null;
    setState({ at: "undone", text });
  }

  const text = state.at === "kept" || state.at === "undone" ? state.text : null;

  return (
    <div class="ui">
      <Sea sky="ray" sunSink={0.05} box={444} horizonAt={249} voice={state.at === "holding" ? "listen" : "calm"} scene={{ hz: 0.56 }} />
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
        <header class="spread" style={{ minHeight: "44px", flex: "none" }}>
          <span class="label">{state.at === "holding" ? (cancelling ? "Let go to cancel" : "Holding the sun") : "Speak"}</span>
          <a href="/" onClick={go("/")} class="btn btn-line btn-sm">
            Close
          </a>
        </header>
        <div style={{ marginTop: "30px" }}>
          <p style={{ margin: 0, fontSize: "34px", lineHeight: 1.14, letterSpacing: "-.03em", fontWeight: 400, color: state.at === "undone" ? "var(--faint)" : undefined }}>
            {text ?? (state.at === "waiting" ? <span style={{ color: "var(--faint)" }}>A thought, kept.</span> : state.at === "reading" ? <span style={{ color: "var(--faint)" }}>…</span> : <span style={{ color: "var(--faint)" }}>Hold the sun and say it.</span>)}
          </p>
        </div>
        {state.at === "kept" && (
          <div
            role="status"
            style={{ display: "inline-flex", alignItems: "center", gap: "10px", marginTop: "22px", padding: "12px 16px", borderRadius: "999px", background: "var(--ink)", color: "var(--on-ink)", font: "500 14px 'Inter Tight'", alignSelf: "flex-start", boxShadow: "0 10px 24px -14px rgba(0,0,0,.6)" }}
          >
            <Icon name="check" size={16} /> {state.withTrip ? "Kept with your scouting trip" : "Kept"}
            {state.undoable && (
              <button type="button" onClick={undo} style={{ background: "none", border: "none", color: "inherit", font: "inherit", opacity: 0.6, marginLeft: "6px", textDecoration: "underline", cursor: "pointer", padding: 0 }}>
                Undo
              </button>
            )}
          </div>
        )}
        {state.at === "waiting" && (
          <p class="meta" style={{ margin: "18px 0 0" }}>
            Encrypted on this phone. Sends when you're back online.
          </p>
        )}
        {state.at === "undone" && (
          <p class="meta" style={{ margin: "18px 0 0" }}>
            Not kept.
          </p>
        )}
        {state.at === "failed" && (
          <p class="meta" role="alert" style={{ margin: "18px 0 0", color: "var(--accent)" }}>
            {state.message}
          </p>
        )}
        <div class="label" style={{ marginTop: "28px" }}>
          You can also say
        </div>
        <div class="hstack" style={{ gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
          <span class="pill">“let’s do a Ray”</span>
          <span class="pill">“show me my rings”</span>
          <span class="pill">a thought to keep</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", paddingBottom: "34px", position: "relative" }}>
          <button
            type="button"
            class={`rec${state.at === "holding" ? " live" : ""}`}
            style={{ width: "84px", height: "84px", border: "none", touchAction: "none", opacity: cancelling ? 0.5 : 1 }}
            aria-label="Hold to talk"
            onPointerDown={(e) => void hold(e)}
            onPointerMove={move}
            onPointerUp={() => void release()}
            onPointerCancel={() => {micRequest.current?.abort();micRequest.current=null;mic.current?.stop();mic.current=null;chunks.current.forEach(chunk=>chunk.fill(0));chunks.current=[];setState({at:"idle"})}}
          />
          <span class="label" style={{ color: "var(--text)" }}>
            {state.at === "holding" ? "Release to keep · slide down to cancel" : state.at === "reading" ? "Reading it…" : "Hold to talk"}
          </span>
        </div>
      </div>
    </div>
  );
}
