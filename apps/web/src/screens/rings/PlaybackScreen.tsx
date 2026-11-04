import { useEffect, useRef, useState } from "preact/hooks";
import { bars } from "../../voice/bars";
import { mind, useMind } from "../../store/mind";
import { BackHeader } from "../../ui/BackHeader";
import { Icon } from "../../ui/icons";
import { Tip } from "../../ui/Tooltip";
import { go } from "../../ui/nav";
import {openRecording,type KeptRecording} from "../../voice/recording";

// G2 · Playback: hear yourself from then. Your words as you said them, the
// lifted ones in the accent, over the evening sea. Your voice is kept sealed
// and opened only for you.

const BARS = 56;
const ORDINAL = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

export function PlaybackScreen() {
  const { views } = useMind();
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const line = mind().said([id])[0];
  const pair = views.thenAndNow.find((p) => p.thenId === id || p.nowId === id);
  const audio = useRef<HTMLAudioElement | null>(null);
  const recording=useRef<KeptRecording|null>(null);
  const [levels, setLevels] = useState<number[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [problem,setProblem]=useState<string|null>(null),[attempt,setAttempt]=useState(0);

  useEffect(() => {
    setPlaying(false);setT(0);setLevels(null);setProblem(null);setState("loading");
    if (!line?.kept) {
      setState("missing");
      return;
    }
    const controller=new AbortController();let active=true,owned:KeptRecording|null=null;
    void(async()=>{try{owned=await openRecording(id,controller.signal);if(!active){owned.close();return}recording.current=owned;const a=owned.audio;audio.current=a;
      a.ontimeupdate=()=>{if(active&&!owned!.closed)setT(a.currentTime)};a.onplay=()=>{if(active&&!owned!.closed)setPlaying(true)};a.onpause=a.onended=()=>{if(active&&!owned!.closed)setPlaying(false)};a.onerror=()=>{if(active){setState("missing");setPlaying(false);owned?.close()}};
      setState("ready");const shape=await bars(owned.bytes).catch(()=>null);if(active)setLevels(shape);
    }catch{if(active)setState("missing")}})();
    return () => {
      active=false;controller.abort();owned?.close();if(recording.current===owned){recording.current=null;audio.current=null}
    };
  }, [id, line?.kept,attempt]);

  const rays = Object.values(views.rays).sort((a, b) => a.startedAt - b.startedAt);
  const n = line?.rayId ? rays.findIndex((r) => r.rayId === line.rayId) : -1;
  const when = line ? new Date(line.at) : null;
  const title = when ? `${when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${n >= 0 ? ` · Ray ${ORDINAL[n] ?? n + 1}` : ""}` : "Playback";
  const duration = line ? Math.max(0.1, (line.endMs - line.startMs) / 1000) : 0.1;
  const done = Math.min(1, t / duration);
  const lifted = new Set(line?.liftWords ?? []);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    const owned=recording.current;if(!owned||owned.closed)return;setProblem(null);
    if (a.paused) void a.play().then(()=>{if(owned.closed)a.pause()}).catch(()=>{if(!owned.closed&&recording.current===owned){setPlaying(false);setProblem("Your voice could not play. Try again.")}});
    else a.pause();
  };
  const back5 = () => {
    if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - 5);
  };

  return (
    <div class="ui">
      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
        <BackHeader to="/rings" title={title} purpose="A Ray of yours, played back in your own voice." />
        <div style={{ marginTop: "26px" }}>
          <p style={{ margin: 0, fontSize: "34px", lineHeight: 1.14, letterSpacing: "-.03em", fontWeight: 400 }}>
            {line
              ? line.text.split(/\s+/).map((w, i, all) => (
                  // G2: lifted words in the signal colour; once playing, words still to come are faint.
                  <span key={i} class={lifted.has(i) ? "accent" : undefined} style={done > 0 && i / all.length >= done ? { color: "var(--faint)" } : undefined}>
                    {w}{" "}
                  </span>
                ))
              : "This line isn't in your mind any more."}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {line && (
          <div class="card" style={{ marginBottom: pair ? "12px" : "30px" }}>
            <div class="spread">
              <span class="label" style={{ color: "var(--text)" }}>
                You · {when!.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
              </span>
              <span class="mono" style={{ fontSize: "12px" }}>
                {clock(t)} / {clock(duration)}
              </span>
            </div>
            <div style={{ margin: "14px 0 16px", position: "relative" }}>
              <div class="stripes" style={{ height: "40px", alignItems: "center" }}>
                {(levels ?? Array.from({ length: BARS }, () => 0.15)).map((l, i) => {
                  const played = (i + 0.5) / BARS <= done;
                  return <i key={i} style={{ height: `${Math.max(3, Math.round(l * 40))}px`, opacity: played ? 1 : 0.45 + l * 0.5, background: played ? "var(--accent)" : undefined }} />;
                })}
              </div>
              {state === "ready" && (
                <span style={{ position: "absolute", left: `${done * 100}%`, top: "-6px", bottom: "-6px", width: "2px", borderRadius: "1px", background: "var(--sig)", boxShadow: "0 0 10px var(--sig)" }} />
              )}
            </div>
            {state === "missing" ? (
              <p class="meta" style={{ margin: 0 }}>
                {line.kept?"This recording is unavailable. Your words are still here.":"Your voice from then wasn't kept, only your words."}
                {line.kept&&<button class="btn btn-line btn-sm" onClick={()=>setAttempt(value=>value+1)}>Try loading again</button>}
              </p>
            ) : (
              <div class="spread">
                <Tip text="Back 5 seconds"><button type="button" class="key" aria-label="Back 5 seconds" onClick={back5} disabled={state !== "ready"}>
                  <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
                    <Icon name="arrow" size={18} />
                  </span>
                </button></Tip>
                <Tip text={playing ? "Pause" : "Play"}><button type="button" class="key" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={state !== "ready"} style={{ width: "64px", height: "64px", background: "var(--ink)", color: "var(--on-ink)" }}>
                  <Icon name={playing ? "pause" : "play"} size={20} />
                </button></Tip>
                {pair ? (
                  <Tip text="Then and now"><a href={`/then?id=${encodeURIComponent(id)}`} onClick={go(`/then?id=${encodeURIComponent(id)}`)} class="key" aria-label="Then and now">
                    <Icon name="arrow" size={18} />
                  </a></Tip>
                ) : (
                  <span style={{ width: "52px" }} />
                )}
              </div>
            )}
            {problem&&<p class="meta" role="alert">{problem}</p>}
          </div>
        )}
        {pair && (
          // G2 → G3: this line has a then-and-now pair.
          <a href={`/then?id=${encodeURIComponent(id)}`} onClick={go(`/then?id=${encodeURIComponent(id)}`)} class="btn btn-line" style={{ marginBottom: "30px" }}>
            Then and now <Icon name="arrow" size={18} />
          </a>
        )}
      </div>
    </div>
  );
}
