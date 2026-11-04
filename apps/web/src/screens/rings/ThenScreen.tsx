import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { mind, useMind, type Said } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";
import { bars } from "../../voice/bars";
import {openRecording,type KeptRecording} from "../../voice/recording";
import {RecordingSequence} from "../../voice/sequence";

// G3 · Then and now: you, explaining the same thing months apart, side by
// side and back to back. The Watch finds the pair in your own lines; the
// difference is the one the ear hears.

const BARS = 48;
const month = (at: number) => new Date(at).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** One of the two lines: its month, length, shape and words. Loads its own voice. */
function Then({ line, now, playing, onAudio }: { line: Said; now: boolean; playing: boolean; onAudio(a: HTMLAudioElement | null): void }) {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [levels, setLevels] = useState<number[] | null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let recording:KeptRecording|null=null;
    let active = true;
    onAudio(null);
    setState(line.kept ? "loading" : "missing");
    setLevels(null);
    if (line.kept) void (async () => {
      try {
        recording=await openRecording(line.utteranceId,controller.signal);if(!active){recording.close();return}
        setState("ready");onAudio(recording.audio);
        const shape = await bars(recording.bytes, BARS).catch(() => null);
        if (active) setLevels(shape);
      } catch { if (active) { setState("missing"); onAudio(null); } }
    })();
    return () => {
      active = false;
      controller.abort();
      recording?.close();
      onAudio(null);
    };
  }, [line.utteranceId, line.kept, onAudio,attempt]);

  return (
    <div class="card" style={{ marginTop: now ? "10px" : "18px", ...(now ? { boxShadow: "inset 0 0 0 1.5px var(--sig),0 0 0 5px color-mix(in srgb,var(--sig) 10%,transparent)" } : {}) }}>
      <div class="spread">
        <span class="label" style={now ? { color: "var(--sig)" } : undefined}>
          {month(line.at)}
        </span>
        <span class="mono" style={{ fontSize: "12px" }}>
          {clock(line.endMs - line.startMs)}
        </span>
      </div>
      <div class="stripes" style={{ height: "34px", margin: "12px 0", alignItems: "center" }}>
        {(levels ?? Array.from({ length: BARS }, () => 0.2)).map((l, i) => (
          <i key={i} style={{ height: `${Math.max(3, Math.round(l * 34))}px`, opacity: playing ? 1 : 0.35 + l * 0.6, ...(now ? { background: "var(--sig)" } : {}) }} />
        ))}
      </div>
      {state !== "ready" && <p class="meta" role="status">{state === "loading" ? "Loading your voice…" : "This recording is unavailable."}</p>}
      {state==="missing"&&line.kept&&<button class="btn btn-line btn-sm" onClick={()=>setAttempt(value=>value+1)}>Try loading again</button>}
      <p style={{ margin: 0, ...(now ? { fontSize: "20px", lineHeight: 1.25, letterSpacing: "-.02em" } : { fontSize: "17px", lineHeight: 1.3, color: "var(--muted)" }) }}>{line.text.split(/\s+/).map((word,index)=><span key={index} class={line.liftWords.includes(index)?"accent":undefined}>{word}{" "}</span>)}</p>
    </div>
  );
}

export function ThenScreen() {
  const { views } = useMind();
  const id = new URLSearchParams(location.search).get("id");
  const pair = id?views.thenAndNow.find((p) => p.nowId === id || p.thenId === id):views.thenAndNow.at(-1);
  const [then, now] = pair ? [mind().said([pair.thenId])[0], mind().said([pair.nowId])[0]] : [undefined, undefined];
  const [ready, setReady] = useState({ then: false, now: false });
  const [problem, setProblem] = useState<string | null>(null);
  const [playing, setPlaying] = useState<"then" | "now" | null>(null);
  const player=useRef<RecordingSequence|null>(null);player.current??=new RecordingSequence({stage:setPlaying,problem:setProblem});
  const onThen = useCallback((a: HTMLAudioElement | null) => { player.current?.attach("then",a);setReady((r) => ({ ...r, then: !!a })); }, []);
  const onNow = useCallback((a: HTMLAudioElement | null) => { player.current?.attach("now",a);setReady((r) => ({ ...r, now: !!a })); }, []);

  useEffect(() => () => {
    player.current?.close();
  }, []);

  useEffect(() => { player.current?.stop(); setProblem(null); }, [pair?.thenId, pair?.nowId]);

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <BackHeader to="/rings" title="Then and now" purpose="Something you said then, beside how you say it now." />
        {!pair || !then || !now ? (
          <p class="meta" style={{ margin: "18px 0 0" }}>
            {id?"This pair is no longer available in your Mind. Return to Rings to choose a recording.":pair?"One of this pair’s lines is no longer available. Return to Rings to choose another recording.":"No pair yet. The Watch finds one over time."}
          </p>
        ) : (
          <>
            <p class="serif" style={{ margin: "18px 0 0", fontSize: "22px", fontStyle: "italic", lineHeight: 1.25, color: "var(--muted)" }}>
              The same thing, {pair.apart}.
            </p>
            <Then key={then.utteranceId} line={then} now={false} playing={playing === "then"} onAudio={onThen} />
            <Then key={now.utteranceId} line={now} now playing={playing === "now"} onAudio={onNow} />
            <div style={{ flex: 1, minHeight: "18px" }} />
            <div style={{ paddingBottom: "30px" }}>
              {problem && <p class="meta" role="alert">{problem}</p>}
              <button type="button" class="btn btn-ink" style={{ width: "100%" }} disabled={!ready.then || !ready.now || playing !== null} onClick={()=>player.current?.play()}>
                <Icon name="play" size={18} /> {then.kept && now.kept ? "Play both, back to back" : "Your voice from then wasn't kept"}
              </button>
              {playing&&<button class="btn btn-line" style={{width:"100%",marginTop:"8px"}} onClick={()=>player.current?.stop()}>Stop playback</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
