import { FRAME_RA, RA_AUDIO_RATE, makeId } from "@ra/core";
import { restrain } from "@ra/prompts";
import type {Thought} from "./speechGate";

/** Content-free turn diagnostics: fixed fields and error messages only, never what was said. */
export function diag(at:string,fields:Record<string,string|number|boolean|null>={}):void{
  const entry={ra:"diag",at,time:new Date().toISOString().slice(11,23),...fields};console.log(JSON.stringify(entry));
  // Kept in memory only (lost on restart): turn callbacks run outside traced events, so logs alone miss them.
  recentDiagnostics.push(entry);if(recentDiagnostics.length>60)recentDiagnostics.shift();
}
export const recentDiagnostics:Record<string,unknown>[]=[];
/**
 * The same thought: same utterance, same context, nearly the same words. Partials arrive bare ("hello how are you") and
 * the final adds case and punctuation ("Hello, how are you?"), so words are compared, not characters. The final often
 * also fixes a word or drops a filler; up to one changed word in ten keeps the reply already drafted and checked during
 * the pause (redrafting there cost a whole turn, 5 s or more). A different sentence still redrafts.
 */
export const words=(text:string)=>text.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}']+/gu," ").trim();
/** Word-level edit distance (insertions, deletions, substitutions). */
export function wordEdits(a:string,b:string):number{
  const x=words(a).split(" ").filter(Boolean),y=words(b).split(" ").filter(Boolean);
  let prev=Array.from({length:y.length+1},(_,j)=>j);
  for(let i=1;i<=x.length;i++){const row=[i];for(let j=1;j<=y.length;j++)row[j]=Math.min(prev[j]!+1,row[j-1]!+1,prev[j-1]!+(x[i-1]===y[j-1]?0:1));prev=row}
  return prev[y.length]!;
}
export const sameThought=(a:Thought,b:Thought)=>{
  if(a.id!==b.id||a.basis!==b.basis)return false;
  const n=Math.max(words(a.text).split(" ").filter(Boolean).length,words(b.text).split(" ").filter(Boolean).length);
  return wordEdits(a.text,b.text)<=Math.floor(n/10);
};
const why=(e:unknown)=>e instanceof Error?`${e.name}: ${e.message}`.slice(0,200):"unknown";

/** Ra's voice goes to the phone in 40 ms frames. */
export const RA_FRAME_SAMPLES = (RA_AUDIO_RATE * 40) / 1000; // 960
/** The end of a line still being checked stays on the Worker until the check passes, so no line is ever heard whole unchecked. */
export const HELD_TAIL_FRAMES = 15; // 600 ms

export interface SpokenLine {
  lineId: string;
  text: string;
  /** You cut in before Ra finished. */
  cut: boolean;
  /** Length of the audio sent, in ms; 0 when there was no voice. */
  audioMs: number;
}

/** How one reply is made, prepared fresh for each turn. */
export interface TurnPlan {
  /** Draft Ra's reply (Spark, or its stand-in). `redo` is the draft that was held back, and why. */
  draft(redo?: { line: string; broke: string[] }): Promise<string>;
  /** The promise check: which promises, if any, this line would break. */
  review(line: string): Promise<{ pass: boolean; broke: string[] }>;
  /** Said when a line fails the check twice. */
  fallback: string;
}

export interface TurnDeps {
  /** Prepare this turn's reply: read what they said, pick the stance (listening, or care). */
  plan(signal: AbortSignal,thought?:Thought): Promise<TurnPlan>;
  /** Nothing is shown, spoken or logged until confirmed speech has had two seconds of quiet. */
  quiet?(signal:AbortSignal):Promise<void>;
  /**
   * Start saying a draft before its check answers, cutting it if the check fails. Off: a cut mid-sentence broke
   * the talk worse than waiting for the check did (3 Nov phone Ray).
   */
  speakEarly?: boolean;
  /** Ra's voice for a line, or null when no voice is ready (the line is then shown, not spoken). */
  speak(text: string, lineId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> | null;
  sendLine(lineId: string, text: string): void;
  sendAudio(kind: typeof FRAME_RA, pcm: Int16Array): void;
  sendAudioEnd(lineId: string): void;
  /** Record the line in the log once it has been said (or cut). */
  logLine(line: SpokenLine): void;
  /** The check held back a line Ra had started: the phone drops what it has queued of it. */
  cutLine?(lineId: string): void;
  error(message: string): void;
}

/** A first draft, with its promise check already running. */
interface Drafted {
  plan: TurnPlan;
  text: string;
  verdict: Promise<{ pass: boolean; broke: string[] }>;
}

interface Turn {
  controller: AbortController;
  speaking: boolean;
  cut: boolean;
}

/**
 * Whose turn it is in a Ray. When you finish a thought Ra drafts a reply; if
 * you start talking again before Ra speaks, the draft is thrown away; if you
 * cut in while Ra speaks, the voice stops and the line is logged as cut.
 * Only one Ra line is ever in flight.
 *
 * SpeechGate can prepare a checked draft at 0.8 s; only an identical final
 * transcript/context may reuse it. Voice waits for the separate quiet gate.
 */
export class Turns {
  private current: Turn | null = null;
  private prepared:{turn:Turn;thought:Thought;drafted:Promise<Drafted|null>}|null=null;
  /** A reply was held back because you started talking; owed if that turns out to be nothing. */
  private owed = false;

  constructor(private readonly deps: TurnDeps) {}

  get raIsSpeaking(): boolean {
    return this.current?.speaking ?? false;
  }

  /** You started talking. A draft Ra hasn't started saying is thrown away. */
  youSpeak(): void {
    if (this.current && !this.current.speaking) {
      this.cancel();
      this.owed = true;
    }
  }

  /** What sounded like you talking held no words. If it cost Ra its reply, Ra replies after all. */
  youDropped(): void {
    if (!this.owed || this.current) return;
    void this.youDone();
  }

  /**
   * You finished a thought: Ra drafts a reply, checks it against the promises (redrafting once with the reasons,
   * then falling back to a safe line) and says it, unless you speak first. With `speakEarly`, Ra starts saying the
   * draft while its check runs and stops it if the check fails.
   */
  async youDone(thought?:Thought): Promise<void> {
    const prepared=this.prepared&&thought&&sameThought(this.prepared.thought,thought)?this.prepared:null;
    if(!prepared)this.cancel();
    this.owed = false;
    const turn=prepared?.turn??this.begin();
    const drafted=await (prepared?.drafted??this.draft(turn,thought,true));
    diag("youDone",{prepared:!!prepared,drafted:drafted!==null,current:this.current===turn,aborted:turn.controller.signal.aborted});
    if(prepared&&drafted===null&&!turn.controller.signal.aborted)this.deps.error("Ra couldn't draft a reply. Try again when it is available.");
    if(this.current!==turn||!drafted){this.finish(turn);return}
    this.prepared=null;await (this.deps.speakEarly?this.speakChecked(turn,drafted):this.speakAfterCheck(turn,drafted));
  }

  /** Say the draft once its check passes; otherwise a checked redraft, or the safe line. */
  private async speakAfterCheck(turn: Turn, drafted: Drafted): Promise<void> {
    let verdict: { pass: boolean; broke: string[] };
    try { verdict = await drafted.verdict; } catch (e) { diag("check.failed", { error: why(e) }); verdict = { pass: false, broke: [] }; }
    if (this.current !== turn || turn.controller.signal.aborted) { this.finish(turn); return; }
    if (verdict.pass) { await this.speakLine(turn, drafted.text); return; }
    await this.sayRedraft(turn, drafted, verdict.broke);
  }

  async speculate(thought:Thought):Promise<void>{
    if(this.prepared&&sameThought(this.prepared.thought,thought)){await this.prepared.drafted;return}
    this.cancel();const turn=this.begin();this.prepared={turn,thought:{...thought},drafted:this.draft(turn,thought,false)};
    await this.prepared.drafted;
  }

  /** Plan and write the first draft, and start its promise check without waiting for it. */
  private async draft(turn:Turn,thought:Thought|undefined,report:boolean):Promise<Drafted|null>{
    try {
      const plan = await this.deps.plan(turn.controller.signal,thought);
      turn.controller.signal.throwIfAborted();
      const text = restrain(await plan.draft());
      turn.controller.signal.throwIfAborted();
      const verdict = plan.review(text);
      verdict.catch(() => {});
      return { plan, text, verdict };
    } catch (e) {
      diag("draft.failed",{report,aborted:turn.controller.signal.aborted,error:why(e)});
      if (report&&!turn.controller.signal.aborted) this.deps.error("Ra couldn't draft a reply. Try again when it is available.");
      return null;
    }
  }

  /** Say the first draft as soon as it is ready; stop it if its check fails, and say a checked redraft instead. */
  private async speakChecked(turn: Turn, drafted: Drafted): Promise<void> {
    const line = new AbortController();
    const stopLine = () => line.abort();
    turn.controller.signal.addEventListener("abort", stopLine, { once: true });
    let held = false;
    const checked = drafted.verdict.then(
      (v) => v,
      (e) => { diag("check.failed", { error: why(e) }); return { pass: false, broke: [] as string[] }; },
    );
    const holdBack = checked.then((v) => { if (!v.pass && !line.signal.aborted) { held = true; line.abort(); } });
    const passed = checked.then((v) => v.pass);
    const lineId = await this.speakLine(turn, drafted.text, { signal: line.signal, keepTurn: true, cut: () => held, check: passed });
    if (held && lineId) this.deps.cutLine?.(lineId);
    turn.controller.signal.removeEventListener("abort", stopLine);
    if (this.current !== turn || turn.controller.signal.aborted) { this.finish(turn); return; }
    const verdict = await checked;
    await holdBack;
    if (verdict.pass || !held) { this.finish(turn); return; }
    await this.sayRedraft(turn, drafted, verdict.broke);
  }

  /** The check held the draft back: redraft with its reasons and check that before saying it, else the safe line. */
  private async sayRedraft(turn: Turn, drafted: Drafted, broke: string[]): Promise<void> {
    let text: string;
    try {
      text = restrain(await drafted.plan.draft({ line: drafted.text, broke }));
      turn.controller.signal.throwIfAborted();
      if (!(await drafted.plan.review(text)).pass) text = drafted.plan.fallback;
      turn.controller.signal.throwIfAborted();
    } catch (e) {
      diag("redraft.failed", { aborted: turn.controller.signal.aborted, error: why(e) });
      if (turn.controller.signal.aborted || this.current !== turn) { this.finish(turn); return; }
      text = drafted.plan.fallback;
    }
    await this.speakLine(turn, text);
  }

  /** Ra says a fixed line, such as a Ray's opening. */
  async say(text: string): Promise<void> {
    this.cancel();
    await this.speakLine(this.begin(), text);
  }

  /** You cut in while Ra was speaking. */
  bargeIn(): void {
    if (!this.current?.speaking) return;
    this.current.cut = true;
    this.cancel();
  }

  cancel(): void {
    this.current?.controller.abort();
    this.current = null;
    this.prepared=null;
    this.owed=false;
  }

  private begin(): Turn {
    const turn: Turn = { controller: new AbortController(), speaking: false, cut: false };
    this.current = turn;
    return turn;
  }

  private finish(turn: Turn): void {
    if (this.current === turn) this.current = null;
    if(this.prepared?.turn===turn)this.prepared=null;
  }

  /**
   * Say one line. `signal` stops just this line (the check holding it back); the turn's own signal stops everything.
   * With `check`, the line is still being checked: its words show only once it passes, and its last frames wait for it.
   * Returns the line's id once it has been sent, or null when it never started.
   */
  private async speakLine(turn: Turn, text: string, opts: { signal?: AbortSignal; keepTurn?: boolean; cut?: () => boolean; check?: Promise<boolean> } = {}): Promise<string | null> {
    if(this.deps.quiet){try{await this.deps.quiet(turn.controller.signal)}catch(e){diag("quiet.failed",{error:why(e)});this.finish(turn);return null}}
    const signal = opts.signal ?? turn.controller.signal;
    if(this.current!==turn||signal.aborted){diag("speak.skipped",{current:this.current===turn,aborted:signal.aborted});if(!opts.keepTurn||turn.controller.signal.aborted)this.finish(turn);return null}
    turn.speaking = true;
    const lineId = makeId();
    // A line being checked starts with no words on screen; the same lineId brings them once it passes.
    this.deps.sendLine(lineId, opts.check ? "" : text);
    opts.check?.then((pass) => { if (pass && !signal.aborted) this.deps.sendLine(lineId, text); });
    let samples = 0;
    try {
      const stream = await this.deps.speak(text, lineId, signal);
      if (stream) samples = await this.pump(stream, signal, opts.check);
    } catch (e) {
      diag("voice.failed",{aborted:signal.aborted,error:why(e)});
      if (!signal.aborted) this.deps.error("Ra's voice could not play. The written line is still available.");
    }
    // Whether the check held it back is known before the line is logged, even if there was no voice to wait on.
    if (opts.check && !signal.aborted) await opts.check;
    const audioMs = Math.round((samples / RA_AUDIO_RATE) * 1000);
    const held = opts.cut?.() ?? false;
    diag("spoke",{audioMs,...(held?{held:true}:{})});
    this.deps.sendAudioEnd(lineId);
    // A held-back line is not something Ra said: it stays out of the log, the drafter's context and Playback.
    if (!held) this.deps.logLine({ lineId, text, cut: turn.cut, audioMs });
    turn.speaking = false;
    if (!opts.keepTurn) this.finish(turn);
    return lineId;
  }

  /**
   * Forward the voice to the phone in whole frames as it arrives; returns samples sent. With `check`, the last
   * HELD_TAIL_FRAMES wait for it to pass and are dropped if it doesn't.
   */
  private async pump(stream: ReadableStream<Uint8Array>, signal: AbortSignal, check?: Promise<boolean>): Promise<number> {
    const reader = stream.getReader();
    const frameBytes = RA_FRAME_SAMPLES * 2;
    let pending = new Uint8Array(0);
    let sent = 0;
    let passed = false;
    void check?.then((pass) => { passed = pass; });
    const tail: Int16Array[] = [];
    const send = (pcm: Int16Array) => {
      this.deps.sendAudio(FRAME_RA, pcm);
      sent += pcm.length;
    };
    const flush = (bytes: Uint8Array) => {
      const pcm = new Int16Array(bytes.length / 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true);
      if (!check || passed) { while (tail.length) send(tail.shift()!); send(pcm); return; }
      tail.push(pcm);
      if (tail.length > HELD_TAIL_FRAMES) send(tail.shift()!);
    };
    try {
      for (;;) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending);
        merged.set(value, pending.length);
        let at = 0;
        while (merged.length - at >= frameBytes) {
          if (signal.aborted) break;
          flush(merged.subarray(at, at + frameBytes));
          at += frameBytes;
        }
        pending = merged.slice(at);
      }
      if (!signal.aborted && pending.length >= 2) flush(pending.subarray(0, pending.length - (pending.length % 2)));
      if (check && tail.length && !signal.aborted) {
        const aborted = new Promise<false>((r) => signal.addEventListener("abort", () => r(false), { once: true }));
        if ((await Promise.race([check, aborted])) && !signal.aborted) while (tail.length) send(tail.shift()!);
      }
      tail.forEach((pcm) => pcm.fill(0));
    } finally {
      await reader.cancel().catch(() => {});
    }
    return sent;
  }
}
