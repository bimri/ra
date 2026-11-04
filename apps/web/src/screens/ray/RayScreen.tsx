import { Icon } from "../../ui/icons";
import { Tip } from "../../ui/Tooltip";
import { ArrivalReview } from "./ArrivalReview";
import {SpokenMarkers} from "./SpokenMarkers";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { nextFor, type MindMessage, type SessionKind, type SignalCard, type StageName, type TripCard, type Word } from "@ra/core";
import { Sea } from "../../sky/Sea";
import { openMic, type Mic } from "../../voice/mic";
import { BargeIn } from "../../voice/pause";
import { RaPlayer } from "../../voice/player";
import { RaySocket, rayUrl, type SocketStatus } from "../../voice/raySocket";
import { deviceId } from "../../store/device";
import { emphasis } from "./emphasis";
import { mind, useMind } from "../../store/mind";
import { owe } from "../../store/rayEnd";
import { go, navigate } from "../../ui/nav";
import { Care, Mirror, Question, ReadingAgenda, Ring, SeasonAgenda, Star, Trips, Window, type MirrorItem } from "./Moments";
import { prefs, type DataMode } from "../onboarding/FirstLight";
import { playListeningTone } from "../../voice/tone";

/**
 * J1 · Walkie: on mobile data (or by choice in A4), one small clip per
 * thought instead of a live stream. Hold to speak, release to send.
 */
function walkieMode(): boolean {
  const mode = prefs.get<DataMode>("dataMode", "automatic");
  if (mode === "walkie") return true;
  if (mode === "live") return false;
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  return c?.type === "cellular" || c?.saveData === true;
}

/** `?pace=demo` (remembered; `?pace=normal` undoes it): the whole arc in about 8 minutes, for testing and the demo video. */
function demoPace(): boolean {
  const asked = new URLSearchParams(location.search).get("pace");
  if (asked === "demo" || asked === "normal") prefs.set("pace", asked);
  return prefs.get<string>("pace", "normal") === "demo";
}

// U4 · Ray, you're talking, and the Ray's arc around it (B1–B10, D1, D2).
// Layout and classes follow the boards; the words you say come back over the
// live socket from your Mind, and Ra answers in its voice. While Ra speaks
// your mic isn't sent (so Ra never hears itself); talking clearly over Ra
// cuts in, stops its voice at once and hands the turn back to you. The Mind's
// director moves the stages as the sun sets; each moment shows here.

const RAY_MINUTES = 30;
const SCALE_MINUTES = 45;
const BARS = 64;
/** Room above the card for the sun, so your words never run over it (U4: the sun rises ~370 px above the bottom). */
const SUN_ROOM = 150;

/** The header's second half, by stage (from the boards). */
const STAGE_LABEL: Partial<Record<StageName, string>> = {
  mirror: "the mirror",
  question: "your question",
  trips: "scouting trips",
  star: "your star",
  markers: "markers",
};

/** What the voice card says you can say, by stage. */
const SAY: Partial<Record<StageName, string>> = {
  mirror: "say “that’s the real one”",
  question: "say “that’s it”",
  trips: "say “the first one” · “change the second”",
  star: "say your star, or “not yet”",
};

/** A moment whose stage has opened but whose card is still being made. */
const PREPARING: Partial<Record<StageName, string>> = {
  window: "Ra is reading your horizon…",
  question: "Ra is putting your question into words…",
};

/** Your mic's RMS (0..1) as a bar height (0..1): about -52 dB is silence, -8 dB is the top. */
function barLevel(rms: number): number {
  return Math.max(0, Math.min(1, (Math.log10(rms + 1e-4) + 2.6) / 2.2));
}

/** F1, K2, E5: what you can say through a whole session, when its stage has no line of its own. */
const SESSION_SAY: Partial<Record<SessionKind, string>> = {
  reading: "say “skip this part”",
  season: "say “skip this part”",
  markers: "say “that’s all of them”",
};

const SESSION_LABEL: Record<SessionKind, string> = {
  first: "Ray one",
  ray: "Ray",
  reading: "The Reading",
  season: "Season review",
  landfall: "Landfall",
  markers: "Naming markers",
};

type Phase = "ready" | "listening" | "paused" | "ended";

interface Line {
  id: string;
  words: Word[];
  final: boolean;
}

export function RayScreen() {
  const [phase, setPhase] = useState<Phase>("ready");
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [raLine, setRaLine] = useState<string | null>(null);
  const raLineId = useRef<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [stage, setStage] = useState<{ name: StageName; sink: number }>({ name: "open", sink: 0 });
  const [providers, setProviders] = useState<Extract<MindMessage, { t: "ready" }>["providers"] | null>(null);
  // Until the Mind says (ready), the best guess from your mind: a first Ray only if you've never had one.
  const [session, setSession] = useState<SessionKind>(() => {
    const s = new URLSearchParams(location.search).get("session");
    if (s === "reading" || s === "season" || s === "landfall" || s === "markers") return s;
    return Object.values(mind().current.views.rays).some((r) => r.endedAt !== null) ? "ray" : "first";
  });
  /** No microphone (denied, missing): the Ray runs typed. */
  const [noMic, setNoMic] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const [talkMs, setTalkMs] = useState(0);
  const [raSpeaking, setRaSpeaking] = useState(false);
  const raBuf = useRef<number[]>(new Array(BARS).fill(0));
  const [raLevels, setRaLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  /** U4 "Type instead", B3 "Type": a thought typed instead of said. */
  const [typing, setTyping] = useState(false);
  /** When the dock last switched between Ra speaking and listening: Say it again and Pause share a spot (B4, U4). */
  const dockSwitchedAt = useRef(0);
  useEffect(() => {
    dockSwitchedAt.current = Date.now();
  }, [raSpeaking]);
  /** A tap meant for the key that was just there is not a pause. */
  const settled = () => Date.now() - dockSwitchedAt.current > 600;
  const [typed, setTyped] = useState("");
  const [walkie] = useState(walkieMode);
  const holding = useRef(false);
  const [clip, setClip] = useState<{ ms: number; bytes: number } | null>(null);
  const [sessionRayId,setSessionRayId] = useState<string | null>(null);
  const [arrivalUnresolved,setArrivalUnresolved] = useState(false);
  const [markerSnapshot,setMarkerSnapshot]=useState<Extract<MindMessage,{t:"markers"}>|null>(null);
  const [minutes, setMinutes] = useState(RAY_MINUTES);
  const [pausedMs, setPausedMs] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  // The moments, as the Mind sends them.
  const [mirror, setMirror] = useState<MirrorItem[]>([]);
  const [signal, setSignal] = useState<SignalCard | null>(null);
  const [question, setQuestion] = useState<{ asked: string; leavingWith: string; kept: boolean } | null>(null);
  const [trips, setTrips] = useState<{ trips: TripCard[]; chosen: string | null } | null>(null);
  const [star, setStar] = useState<{ candidates: string[]; written: string | null; proposed: string | null } | null>(null);
  /** J4: what they said when care began; "Keep talking" puts the card away while care lasts. */
  const [care, setCare] = useState<{ said: string; shown: boolean } | null>(null);
  const [ring, setRing] = useState<{ title: string; text: string; closing: string } | null>(null);
  // Read inside socket handlers, which keep the first render's state.
  const ringShown = useRef(false);

  // D1: Ray two opens on what you brought back from your trip.
  const { views } = useMind();
  const brought = Object.values(views.trips).filter((t) => t.state === "reported").at(-1);
  const spoken = prefs.get<string[]>("langs", [prefs.get("lang", "en")]);
  // F1 / K2: opened from Today as /ray?session=reading (or season).
  const asked = (() => {
    const s = new URLSearchParams(location.search).get("session");
    return s === "reading" || s === "season" || s === "landfall" || s === "markers" ? s : undefined;
  })();
  const arrivalId = new URLSearchParams(location.search).get("landfall");
  const markersIsland=new URLSearchParams(location.search).get("island");
  // E3: "What do you make of it?" opens the Ray on that signal.
  const signalText = new URLSearchParams(location.search).get("signal");
  const arrival = views.arrivals.find((a) => a.landfallId === (arrivalId ?? views.rays[views.liveRay ?? ""]?.landfallId));
  const liveRay = views.liveRay;
  const reading = session === "reading" ? (views.readings.find((r) => r.rayId === liveRay) ?? views.readings.at(-1) ?? null) : null;
  const season = session === "season" ? (views.seasons.find((s) => s.rayId === liveRay) ?? views.seasons.at(-1) ?? null) : null;

  const socket = useRef<RaySocket | null>(null);
  const mic = useRef<Mic | null>(null);
  const sending = useRef(false);
  const levelBuf = useRef<number[]>(new Array(BARS).fill(0));
  const player = useRef<RaPlayer | null>(null);
  const bargeIn = useRef(new BargeIn());

  // One clock tick a second for the light left; levels repaint at ~30 fps.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    let raf = 0;
    let last = 0;
    const paint = (ts: number) => {
      if (ts - last > 33) {
        last = ts;
        setLevels([...levelBuf.current]);
        const speaking = player.current?.playing ?? false;
        setRaSpeaking((was) => (was === speaking ? was : speaking));
        if (speaking && player.current) {
          raBuf.current.push(player.current.level());
          if (raBuf.current.length > BARS) raBuf.current.shift();
          setRaLevels([...raBuf.current]);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      clearInterval(t);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Leaving the screen isn't ending the Ray: it waits (sun held) and Today offers to continue it.
  useEffect(() => () => (over.current ? stopAll() : leave()), []);

  /** The person is in this Ray, so a dropped socket comes back by itself. */
  const wanted = useRef(false);
  /** The Ray is over (End, or the sun set): nothing reconnects. */
  const over = useRef(false);
  const retries = useRef(0);
  const retryTimer = useRef<number | undefined>(undefined);

  const hello = (): Extract<Parameters<RaySocket["open"]>[0], { t: "hello" }> => ({
    t: "hello",
    device: deviceId(),
    minutes: RAY_MINUTES,
    tz: -new Date().getTimezoneOffset(),
    ...(asked ? { session: asked } : {}),
    ...(arrivalId ? { landfallId: arrivalId } : {}),
    ...(asked === "markers" && markersIsland ? { markersIsland } : {}),
    ...(signalText ? { signal: signalText.slice(0, 400) } : {}),
    ...(demoPace() ? { pace: "demo" as const } : {}),
    langs: prefs.get<string[]>("langs", [prefs.get("lang", "en")]),
  });

  /** Back after a drop (a lock screen, a tunnel): rejoin the same Ray, soon, then less often. */
  function reconnect(now = false) {
    if (!wanted.current || over.current || retryTimer.current !== undefined) return;
    const ms = now ? 0 : Math.min(10_000, 1000 * 2 ** retries.current++);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = undefined;
      if (wanted.current && !over.current && socket.current && !socket.current.isOpen) socket.current.open(hello());
    }, ms);
  }

  function onStatus(s: SocketStatus) {
    setStatus(s);
    if (s === "open") retries.current = 0;
    if (s === "closed" || s === "error") reconnect();
    // The Mind said why it can't open this; rejoining would only repeat it.
    if (s === "refused") wanted.current = false;
  }

  useEffect(() => {
    const back = () => {
      setOnline(navigator.onLine);
      if (document.visibilityState !== "visible") return;
      // A phone may suspend audio while hidden; a call or a revoked permission ends the mic.
      mic.current?.resume();
      void player.current?.unlock();
      if (mic.current && !mic.current.alive()) {
        mic.current.stop();
        mic.current = null;
        if (wanted.current && !over.current) void start();
      }
      if (socket.current?.isOpen) return;
      window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
      reconnect(true);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("online", back);
    const off = () => setOnline(false);
    window.addEventListener("offline", off);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("online", back);
      window.removeEventListener("offline", off);
    };
  }, []);

  function onMessage(m: MindMessage) {
    switch (m.t) {
      case "ready":
        setSessionRayId(m.rayId);
        void mind().sync();
        setProviders(m.providers);
        setSession(m.session);
        setMinutes(m.minutes);
        setStartedAt(m.startedAt);
        setPausedMs(m.pausedMs);
        // B3: you paused before you left; the sun held and waits for you to carry on.
        if (m.paused) {
          sending.current = false;
          setPausedAt(Date.now());
          setPhase("paused");
        }
        return;
      case "landfall.review":
        setArrivalUnresolved(m.unresolved);
        return;
      case "markers":setMarkerSnapshot(m);return;
      case "mirror":
        setMirror(m.items.map((i) => ({ ...i, state: "offered" as const })));
        return;
      case "mirror.state":
        setMirror((prev) => prev.map((i) => (i.mirrorId === m.mirrorId ? { ...i, state: m.state } : i)));
        return;
      case "window":
        setSignal(m.signal);
        return;
      case "question":
        setQuestion({ asked: m.asked, leavingWith: m.leavingWith, kept: m.kept });
        return;
      case "trips":
        setTrips({ trips: m.trips, chosen: m.chosen });
        return;
      case "star":
        setStar((prev) => ({
          candidates: m.candidates.length ? m.candidates : (prev?.candidates ?? []),
          written: m.written,
          proposed: m.proposed === undefined ? (prev?.proposed ?? null) : m.proposed,
        }));
        return;
      case "care":
        setCare(m.on ? { said: m.said, shown: true } : null);
        return;
      case "ring":
        ringShown.current = true;
        setRing({ title: m.title, text: m.text, closing: m.closing });
        // So the Next card under the ring knows the trip you just picked.
        void mind().sync();
        return;
      case "ended":
        over.current = true;
        stopAll();
        setEndedAt(Date.now());
        setPhase("ended");
        void mind().sync();
        // No ring (a Reading, a landfall, markers, a Ray with nothing said): a short ending with what's next, never a silent jump home.
        if (!ringShown.current) showEnding();
        return;
      case "stage":
        setStage({ name: m.name, sink: m.sink });
        return;
      case "ra.cut":
        // The check held back the line Ra had started: stop it, and keep neither its words nor its replay; a checked line follows.
        player.current?.stop();
        player.current?.beginLine();
        setRaLine(null);
        return;
      case "ra.line":
        // A line still being checked arrives with no words; the same lineId brings them once it passes.
        if (m.lineId !== raLineId.current) player.current?.beginLine();
        raLineId.current = m.lineId;
        setRaLine(m.text || null);
        return;
      case "words.partial":
      case "words.final":
        setLines((prev) => {
          const final = m.t === "words.final";
          const i = prev.findIndex((l) => l.id === m.utteranceId);
          const line = { id: m.utteranceId, words: m.words, final };
          if (i === -1) return [...prev, line].slice(-3);
          const next = [...prev];
          next[i] = line;
          return next;
        });
        return;
      case "words.drop":
        setLines((prev) => prev.filter((l) => l.id !== m.utteranceId));
        return;
      case "error":
        setProblem(m.message);
        return;
      default:
        return;
    }
  }

  async function start() {
    setProblem(null);
    // Ra's voice first, inside the tap: browsers only let audio start from a gesture, and the mic's
    // permission prompt below can outlast it, which left Ra silent on a first Ray.
    if (!player.current) {
      player.current = new RaPlayer();
      void player.current.unlock();
    }
    // Then the mic: no Ray starts on a phone that can't hear you.
    if (!mic.current) {
      try {
        mic.current = await openMic((f) => {
          try {
          const buf = levelBuf.current;
          buf.push(f.level);
          if (buf.length > BARS) buf.shift();
          if (!sending.current) return;
          if (walkie && !holding.current) return; // walkie: only while the sun is held
          if (player.current?.playing) {
            if (!bargeIn.current.push(f.level)) return; // Ra has the turn
            player.current.stop();
            socket.current?.send({ t: "barge_in" });
          } else {
            bargeIn.current.reset();
          }
          if (f.speaking) setTalkMs((ms) => ms + 20);
          const sent=socket.current?.sendAudio(f)??0;
          if(walkie&&sent)setClip(c=>({ms:(c?.ms??0)+20,bytes:(c?.bytes??0)+sent}));
          } finally {f.pcm.fill(0)}
        });
      } catch {
        // No microphone: the Ray goes on, typed. Nothing is lost by not speaking.
        setNoMic(true);
        setTyping(true);
      }
    }
    await player.current.unlock();
    if (!socket.current) {
      socket.current = new RaySocket(rayUrl(), {
        message: onMessage,
        status: onStatus,
        raAudio: (pcm) => player.current?.push(pcm),
      });
    }
    wanted.current = true;
    if (!socket.current.isOpen) {
      socket.current.open(hello());
      setStartedAt((s) => s ?? Date.now());
    }
    sending.current = true;
    if (phase !== "listening") playListeningTone(); // A4: the only sound Ra makes
    if (phase === "paused") {
      socket.current.send({ t: "resume" });
      if (pausedAt !== null) setPausedMs((ms) => ms + (Date.now() - pausedAt));
      setPausedAt(null);
    }
    setPhase("listening");
  }

  function pause() {
    sending.current = false;
    if (player.current?.playing) {
      player.current.stop();
      socket.current?.send({ t: "barge_in" });
    }
    socket.current?.send({ t: "pause" });
    setPausedAt(Date.now());
    setPhase("paused");
  }

  // A Ray you just asked for begins at once: the tap that brought you here still counts as a gesture,
  // so the mic and Ra's voice can open. Without one (a reload, a link), the sun waits for your tap.
  useEffect(() => {
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (phase === "ready" && activation?.isActive) void start();
    // Once, on arrival.
  }, []);

  /** Walkie: hold the sun to speak… */
  function hold() {
    if (!walkie || phase !== "listening") return;
    holding.current = true;
    setClip({ ms: 0, bytes: 0 });
  }

  /** …release to send the clip as one thought. */
  function release() {
    if (!walkie || !holding.current) return;
    holding.current = false;
    socket.current?.send({ t: "done" });
  }

  /** Type instead: send what you typed as one thought; a paused Ray picks up again. */
  async function sendTyped() {
    const text = typed.trim();
    if (!text) return;
    if (player.current?.playing) {
      player.current.stop();
      socket.current?.send({ t: "barge_in" });
    }
    if (phase !== "listening") await start();
    socket.current?.send({ t: "typed", text });
    setTyped("");
    setTyping(false);
  }

  /** Done talking: this thought is finished now. */
  function done() {
    socket.current?.send({ t: "done" });
  }

  /** Let go of the mic, Ra's voice and the socket. */
  function letGo() {
    wanted.current = false;
    window.clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    sending.current = false;
    mic.current?.stop();
    mic.current = null;
    socket.current?.close();
    socket.current = null;
    player.current?.close();
    player.current = null;
  }

  /** The Ray is over: tell the Mind, then let go. */
  function stopAll() {
    over.current = true;
    socket.current?.send({ t: "end" });
    letGo();
  }

  /** Off this screen without ending: the Mind holds the sun until the phone comes back. */
  function leave() {
    letGo();
  }

  /**
   * End (the boards link it to Today). Ending early still closes the Ray: the
   * Mind keeps a ring from what you said and owes your trips, and answers
   * with the ring, which shows here. Nothing said yet: straight home.
   */
  function end() {
    if (over.current) return goodnight();
    over.current = true;
    sending.current = false;
    mic.current?.stop();
    mic.current = null;
    player.current?.stop();
    setEndedAt(Date.now());
    setPhase("ended");
    if (socket.current?.isOpen) socket.current.send({ t: "end" });
    else if (sessionRayId ?? views.liveRay) owe((sessionRayId ?? views.liveRay)!);
    // The Mind answers with "ring" and "ended"; if it can't, don't keep them waiting.
    window.setTimeout(() => {
      if (!ringShown.current) showEnding();
    }, 4000);
  }

  /** The Ray ended without a ring: the same last screen, with what's next. */
  function showEnding() {
    ringShown.current = true;
    letGo();
    void mind().sync();
    setRing({ title: "Everything you said is kept", text: "", closing: "" });
  }

  /** Goodnight: sync what the Ray wrote, go home. */
  function goodnight() {
    letGo();
    void mind().sync();
    navigate("/");
  }

  /** B10b: straight on to what's next (the trip, the Chart…), the Ray's words already kept. */
  function onward(href: string) {
    letGo();
    void mind().sync();
    navigate(href);
  }

  // The light: the Ray's daylight, held while paused (B3), stopped once the Ray has ended.
  const clock = endedAt ?? pausedAt ?? now;
  const elapsedMin = startedAt ? Math.max(0, clock - startedAt - pausedMs) / 60000 : 0;
  const leftSec = Math.max(0, Math.round(minutes * 60 - elapsedMin * 60));
  const mm = String(Math.floor(leftSec / 60)).padStart(2, "0");
  const ss = String(leftSec % 60).padStart(2, "0");
  const sink = Math.max(stage.sink, Math.min(1, elapsedMin / minutes));

  const state =
    phase === "listening"
      ? status !== "open"
        ? status === "closed" || status === "error" ? "reconnecting" : status
        : raSpeaking
          ? "Ra speaking"
          : (STAGE_LABEL[stage.name] ?? (walkie ? "walkie" : "listening"))
      : phase;
  const headLabel =
    session === "reading"
      ? `The Reading · ${new Date().toLocaleDateString("en-GB", { weekday: "long" })}`
      : session === "season" && season
        ? `Season · ${season.label}`
        : `${SESSION_LABEL[session]} · ${state}`;
  // B3 "Paused · 23 min": how far into the Ray you paused.
  const pausedFor = Math.max(1, Math.round(elapsedMin));

  // Which moment is on screen: only the one for the stage the Ray is in.
  const moment =
    care?.shown
      ? "care"
      : stage.name === "mirror" && mirror.length
      ? "mirror"
      : stage.name === "window" && signal
        ? "window"
        : stage.name === "question" && question
          ? "question"
          : stage.name === "trips" && trips?.trips.length
            ? "trips"
            : stage.name === "star" && star
              ? "star"
              : null;
  const preparing = !moment && phase === "listening" ? PREPARING[stage.name] : undefined;

  const ticks = useMemo(() => {
    const done = Math.floor(elapsedMin);
    return Array.from({ length: SCALE_MINUTES }, (_, i) => {
      const cls = [i < done ? "done" : "", i === done ? "now" : "", i % 5 === 0 ? "maj" : ""].join(" ").trim();
      return <i key={i} class={cls} />;
    });
  }, [Math.floor(elapsedMin)]);

  const talk = `${Math.floor(talkMs / 60000)}:${String(Math.floor(talkMs / 1000) % 60).padStart(2, "0")}`;
  const live = phase === "listening";

  // B10: when the sun is down, the ring is the whole screen, with the one thing to do next (B10b).
  if (ring) {
    const after = nextFor(views, Date.now()).find((s) => s.kind !== "ray.continue" && s.kind !== "ray");
    return (
      <Ring
        session={SESSION_LABEL[session]}
        {...ring}
        next={after ?? null}
        onNext={onward}
        onGoodnight={goodnight}
      />
    );
  }

  const send = (m: Parameters<RaySocket["send"]>[0]) => socket.current?.send(m);

  return (
    <div class="ui ray">
      <Sea sky="ray" sunSink={sink} voice={raSpeaking ? "speak" : phase === "listening" ? "listen" : "calm"} />

      <div class="pg" style={{ position: "absolute", inset: 0, padding: "22px 20px 0", display: "flex", flexDirection: "column" }}>
        <header class="spread" style={{ minHeight: "44px" }}>
          <span class="label">{headLabel}</span>
          <div class="hstack" style={{ gap: "8px" }}>
            {/* J6: when you talk in two languages, both show; Ra follows your switches. */}
            {spoken.length > 1 &&
              spoken.map((l) => (
                <span key={l} class="pill" style={{ height: "24px", fontSize: "11px" }}>
                  {l.toUpperCase()}
                </span>
              ))}
            {phase === "listening" && !raSpeaking && !walkie && (
              <Tip text="Type instead"><button type="button" class="key" aria-label="Type instead" aria-pressed={typing} onClick={() => setTyping((t) => !t)} style={{ width: "40px", height: "40px" }}>
                <Icon name="keyboard" size={18} />
              </button></Tip>
            )}
            {phase !== "ended" && phase !== "ready" && (
              // Off this screen without ending: the sun holds, and Today offers to continue.
              <Tip text="Leave for now. The Ray waits."><button type="button" class="btn btn-line btn-sm" onClick={() => { leave(); navigate("/"); }}>
                Later
              </button></Tip>
            )}
            <button type="button" class="btn btn-line btn-sm" onClick={end} disabled={phase === "ended"}>
              End
            </button>
          </div>
        </header>

        {moment === "mirror" && (
          <Mirror
            line="These came up when your voice lifted. Which ones are really yours?"
            items={mirror}
            onKeep={(id, keep) => send({ t: keep ? "mirror.keep" : "mirror.strike", mirrorId: id })}
          />
        )}
        {moment === "window" && signal && (
          <Window line="That's one thing I see from where you stand. What do you make of it?" signal={signal} />
        )}
        {moment === "question" && question && (
          <Question {...question} onKeep={() => send({ t: "question.keep", text: question.leavingWith })} />
        )}
        {moment === "trips" && trips && (
          <Trips
            trips={trips.trips}
            chosen={trips.chosen}
            onChoose={(id) => send({ t: "trip.choose", tripId: id })}
            onChange={(id) => send({ t: "trip.change", tripId: id })}
          />
        )}
        {moment === "star" && star && (
          <Star {...star} onKeep={(text) => send({ t: "star.keep", text })} onNotYet={() => send({ t: "star.notyet" })} />
        )}
        {moment === "care" && care && <Care said={care.said} line={raLine} onKeepTalking={() => setCare({ ...care, shown: false })} onEnd={end} />}

        {!moment && session === "landfall" && arrival && <ArrivalReview key={arrival.landfallId} arrival={arrival} stage={stage.name} rayId={sessionRayId} live={status === "open"} unresolved={arrivalUnresolved} crew={views.crew} send={send} onDone={stopAll} />}
        {!moment&&!care&&session==="markers"&&markerSnapshot&&<SpokenMarkers key={markerSnapshot.island} snapshot={markerSnapshot} onEnd={stopAll}/>}
        {!moment && reading && <ReadingAgenda reading={reading} stage={stage.name} onPlay={(id) => navigate(`/playback?id=${encodeURIComponent(id)}`)} />}
        {!moment && season && <SeasonAgenda season={season} stage={stage.name} />}

        {!moment && !reading && !season && session !== "landfall" && session!=="markers" && (
        <div style={{ marginTop: "22px" }}>
          <div class="dot glow" style={{ fontSize: "64px", lineHeight: 0.9 }}>
            {mm}
            <span class={live ? "blink" : ""}>:</span>
            {ss}
          </div>
          <div style={{ marginTop: "12px", maxWidth: "300px" }}>
            <div class="ticks" aria-hidden="true">
              {ticks}
            </div>
            <div class="spread mono" style={{ marginTop: "5px", fontSize: "8.5px", color: "var(--faint)" }}>
              <span>0</span>
              <span>15</span>
              <span>30</span>
              <span>45 min</span>
            </div>
          </div>
          <div class="label" style={{ marginTop: "9px" }}>
            {phase === "paused" ? "of light · held while you think" : "of light left · the sun sets as the Ray ends"}
          </div>
        </div>
        )}

        {preparing && (
          <p class="meta" role="status" style={{ margin: "16px 0 0" }}>
            {preparing}
          </p>
        )}

        {!moment && stage.name === "found" && brought && (
          <div class="card glass" style={{ marginTop: "18px" }}>
            <div class="spread">
              <span class="label" style={{ color: "var(--text)" }}>What you brought back</span>
              <span class="label">
                {brought.evidenceIds.length} {brought.evidenceIds.length === 1 ? "piece" : "pieces"}
              </span>
            </div>
            {brought.report && (
              <p style={{ margin: "10px 0 0", fontSize: "15px", lineHeight: 1.35 }}>
                “{brought.report}”
              </p>
            )}
          </div>
        )}

        {!moment && raLine && (
          <div class="hair" style={{ marginTop: "20px", paddingTop: "16px" }}>
            <div class="hstack" style={{ gap: "10px", alignItems: "flex-start" }}>
              <span
                style={{
                  flex: "none",
                  width: "7px",
                  height: "7px",
                  marginTop: "9px",
                  borderRadius: "50%",
                  background: "var(--sig)",
                  boxShadow: "0 0 10px var(--sig)",
                }}
              />
              <p class="serif" style={{ margin: 0, fontSize: "21px", lineHeight: 1.25, fontStyle: "italic", color: "var(--muted)" }}>
                {raLine}
              </p>
            </div>
          </div>
        )}

        {/* Care and the star keep their own buttons at the foot of the screen. */}
        {moment === "care" || moment === "star" ? null : moment ? <div style={{ flex: 1 }} /> : <Words lines={lines} />}
        <div style={{ flex: "none", height: moment ? "12px" : `${SUN_ROOM}px` }} />

        {problem && (
          <p class="meta" role="alert" style={{ margin: "0 0 12px", color: "var(--accent)" }}>
            {problem}
          </p>
        )}
        {!online && phase !== "ended" && (
          // Offline: the Ray holds. A thought or a trip can still be kept, and goes when you're back.
          <div class="card" role="status" style={{ marginBottom: "12px" }}>
            <div class="title">You're offline. The Ray waits, sun held.</div>
            <div class="hstack" style={{ gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
              <a href="/speak" onClick={go("/speak")} class="btn btn-line btn-sm">Keep a thought</a>
              <a href="/bring-back" onClick={go("/bring-back")} class="btn btn-line btn-sm">Bring something back</a>
            </div>
          </div>
        )}
        {noMic && phase !== "ended" && (
          <p class="meta" style={{ margin: "0 0 12px" }}>
            No microphone, so type to Ra. You can allow it later in your phone's settings.
          </p>
        )}

        {typing ? (
          <div class="card glass" style={{ marginBottom: "24px", flex: "none" }}>
            <div class="spread">
              <span class="label" style={{ color: "var(--text)" }}>Type instead</span>
              <span class="label">Ra reads it like you said it</span>
            </div>
            <textarea class="field" rows={3} maxlength={2000} aria-label="What you want to say" placeholder="Say it in writing…" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} style={{ marginTop: "12px" }} />
            <div class="spread" style={{ marginTop: "12px" }}>
              <button type="button" class="btn btn-line btn-sm" onClick={() => { setTyping(false); setTyped(""); }}>
                Cancel
              </button>
              <button type="button" class="btn btn-ink btn-sm" onClick={() => void sendTyped()} disabled={!typed.trim()}>
                Send
              </button>
            </div>
          </div>
        ) : phase === "paused" ? (
          // B3: the sun waits for you.
          <div class="card glass" style={{ marginBottom: "24px", flex: "none", textAlign: "center" }}>
            <div class="label" style={{ color: "var(--text)" }}>
              Paused · {pausedFor} min
            </div>
            <div class="meta" style={{ margin: "6px 0 16px" }}>
              The sun waits for you.
            </div>
            <div class="spread">
              <button type="button" class="btn btn-line btn-sm" onClick={end}>
                End here
              </button>
              <button
                type="button"
                class="key"
                aria-label="Resume"
                style={{ width: "68px", height: "68px", background: "var(--ink)", color: "var(--on-ink)" }}
                onClick={start}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </button>
              <button type="button" class="btn btn-line btn-sm" onClick={() => setTyping(true)}>
                Type
              </button>
            </div>
          </div>
        ) : (
        live && walkie && !raSpeaking ? (
          // J1 · Walkie: hold the sun to speak, release to send one clip.
          <div class="card glass" style={{ marginBottom: "24px", flex: "none", textAlign: "center" }}>
            <div class="spread">
              <span class="label" style={{ color: "var(--text)" }}>
                Walkie · {navigator.onLine ? "mobile data" : "offline"}
              </span>
              <span class="label">one clip at a time</span>
            </div>
            <div style={{ margin: "18px 0 10px", display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                class="rec"
                style={{ width: "88px", height: "88px", border: "none", padding: 0, cursor: "pointer", touchAction: "none" }}
                aria-label="Hold to speak"
                onPointerDown={hold}
                onPointerUp={release}
                onPointerLeave={release}
                onPointerCancel={release}
              />
            </div>
            <div class="meta">
              {clip && clip.ms > 0 && !holding.current
                ? `Sent · one clip · ${Math.floor(clip.ms / 60000)}:${String(Math.floor(clip.ms / 1000) % 60).padStart(2, "0")} · ${Math.max(1, Math.round(clip.bytes / 1024))} KB`
                : "Hold to speak · release to send"}
            </div>
          </div>
        ) : (
        <div class="card glass" style={{ marginBottom: "24px", flex: "none" }}>
          <div class="spread">
            <span class="label" style={{ color: "var(--text)" }}>
              {!raSpeaking && (
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: live ? "var(--sig)" : "var(--faint)",
                    marginRight: "6px",
                    verticalAlign: "1px",
                    boxShadow: live ? "0 0 8px var(--sig)" : "none",
                  }}
                />
              )}
              {raSpeaking ? "Ra is speaking" : `You · ${talk}`}
            </span>
            <span class="label" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, textAlign: "right" }}>
              {raSpeaking
                ? "talk and it stops"
                : live && walkie
                  ? "Walkie · one clip at a time"
                  : live
                    ? ((moment ? SAY[stage.name] : undefined) ?? SESSION_SAY[session] ?? "Ra is listening")
                    : phase === "ended"
                      ? "Ray ended"
                      : "Tap to begin"}
            </span>
          </div>
          <div style={{ margin: "14px 0 16px" }}>
            {/* U4: your voice in ink; B4: Ra's in the signal colour. */}
            <div class={`stripes${raSpeaking ? " sig" : ""}${live ? " live" : ""}`} style={{ height: "40px", alignItems: "center" }} aria-hidden="true">
              {(raSpeaking ? raLevels : levels).map((l, i) => {
                // Loudness on a log scale: a quiet room sits low, ordinary speech fills the middle, a shout the top.
                const k = raSpeaking ? Math.min(1, l * 1.6) : barLevel(l);
                return <i key={i} style={{ height: `${Math.round(3 + 37 * k)}px`, opacity: 0.35 + 0.65 * k }} />;
              })}
            </div>
          </div>
          {raSpeaking ? (
            // B4: say it again, the sun waiting for you, pause.
            <div class="spread">
              <button type="button" class="key" aria-label="Say it again" onClick={() => player.current?.replay()} disabled={!player.current?.canReplay}>
                <Icon name="arrow" size={20} />
              </button>
              <span class="rec" style={{ width: "68px", height: "68px", opacity: 0.55 }} role="img" aria-label="Microphone ready" />
              <button type="button" class="key" aria-label="Pause" onClick={pause}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 6v12M15 6v12" />
                </svg>
              </button>
            </div>
          ) : (
            <div class="spread">
              <button type="button" class="key" aria-label="Pause" onClick={() => settled() && pause()} disabled={!live}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M9 6v12M15 6v12" />
                </svg>
              </button>
              {live && !walkie ? (
                // U4: while Ra listens, the sun is a sign, not a switch.
                <span class="rec live" style={{ width: "68px", height: "68px" }} role="img" aria-label="Listening" />
              ) : (
                <button
                  type="button"
                  class={`rec${live ? " live" : ""}`}
                  style={{ width: "68px", height: "68px", border: "none", padding: 0, cursor: "pointer" }}
                  aria-label={live ? "Hold to speak" : "Start talking"}
                  onClick={live ? undefined : start}
                  onPointerDown={hold}
                  onPointerUp={release}
                  onPointerLeave={release}
                  disabled={phase === "ended"}
                />
              )}
              <button type="button" class="key" aria-label="Done talking" onClick={done} disabled={!live}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </button>
            </div>
          )}
        </div>
        )
        )}

        {import.meta.env.DEV && providers && (
          <p class="mono" style={{ margin: "-12px 0 12px", fontSize: "9.5px", color: "var(--faint)", letterSpacing: ".04em" }}>
            words: {providers.transcriber === "fake" ? "stub transcriber" : providers.transcriber} · muse: {providers.muse} · voice:{" "}
            {providers.voice} · check: {providers.check}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Your words, set by how you said them. Weight and the signal colour are
 * measured against the rest of the line, not a fixed level, so a loud room
 * doesn't turn every word into a lift. The block keeps to the space it has:
 * when there's more than fits, the newest words stay and the oldest fade out
 * at the top.
 */
function Words({ lines }: { lines: Line[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  });

  const current = lines.at(-1);
  const earlier = lines.slice(0, -1);
  const fade = overflowing ? "linear-gradient(to bottom, transparent, #000 48px)" : "none";
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", marginTop: "16px" }}>
      <div
        ref={box}
        style={{
          flex: "0 1 auto",
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          maskImage: fade,
          WebkitMaskImage: fade,
        }}
      >
        {earlier.map((l) => (
          <p key={l.id} style={{ margin: "0 0 8px", fontSize: "17px", lineHeight: 1.25, letterSpacing: "-.02em", color: "var(--faint)" }}>
            {l.words.map((w) => w.text).join(" ")}
          </p>
        ))}
        {current && (
          <p style={{ margin: 0, fontSize: "27px", lineHeight: 1.12, letterSpacing: "-.03em", fontWeight: 400 }}>
            {emphasis(current.words).map((e, i) => (
              <span key={i} class={e.lift ? "accent" : ""} style={{ fontWeight: e.weight }}>
                {current.words[i]!.text}{" "}
              </span>
            ))}
            {!current.final && <span style={{ color: "var(--faint)" }}>…</span>}
          </p>
        )}
      </div>
    </div>
  );
}
