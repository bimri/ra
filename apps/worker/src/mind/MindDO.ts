import { arrivalMarkers, assertPhoneEdits, currentMarkers, markerRef, validateArrival } from "./arrival";
import { checkReviewedCapture,reviewedCaptureDrafts,type ReviewedCaptureReceipt } from "./reviewedCapture";
import { peopleChanges } from "../people/projection";
import type { PeopleProjection } from "../people/reconcile";
import { compileDraftContext, assertDraftBudget, contextHorizon, asksToLookUp } from "./context";
import {openWork,sealWork,type WatchDay} from "./work";
import {RouteJobs,RouteActionError,type SavedRouteJob} from "./routeJobs";
import {ownRouteContext,RouteIssue} from "./routes";
import {dialSelection,dialEvidence} from "./dial";
import { DurableObject } from "cloudflare:workers";
import {
  AUDIO_RATE,
  currentIsland,
  EventLog,
  FRAME_MIC,
  FRAME_SAMPLES,
  decodeWireAudio,
  draft,
  encodeWireAudio,
  AUDIO_CODEC,
  rms,
  emptyViews,
  forgotten,
  makeId,
  parsePhoneMessage,
  project,
  scrub,
  sunSink,
  type EventBodies,
  type EventDraft,
  type EventKind,
  type MindMessage,
  type PhoneMessage,
  type Prosody,
  type RaEvent,
  type SignalCard,
  type StageName,
  type TripCard,
  type Views,
  VIEWS_VERSION,
  nextFor,
} from "@ra/core";
import {
  CARE,
  MOMENT_LINES,
  OPENINGS,
  openingFor,
  ringClosingFor,
  PROMPT_VERSION,
  SAFE_LINES,
  spokenInstructions,
  spokenRepair,
  DEMO_MINUTES,
  developerMessage,
  type StageDef,
} from "@ra/prompts";
import { FIELDS, type Signal } from "../horizon/HorizonDO";
import type { TripContext } from "../workflows/trips";
import { decisions } from "./decide";
import { liftedWords, mirrorQuotes, scriptFor, stageIndexAt, withoutRaEchoes } from "./director";
import { chooseWindow, chosenQuote, draftQuestion, keptQuestion, ringLine, spokenStar, tripReply } from "./moments";
import { designTrips } from "../workflows/trips";
import { nextNightAt, nightOf, inferMemories, type Memory } from "../workflows/watch";
import { nextReadingAt, partLine, seasonOf, prepareReading, prepareSeason, type Line } from "../workflows/rhythm";
import { mayInterrupt, QUIET_AFTER, type Reason } from "./governor";
import {GovernorDelivery,type GovernorOperation} from "./governorDelivery";
import {DialJobs,DialActionError,type SavedDialJob} from "./dialJobs";
import {DialIssue} from "./dialModel";
import { apart, pairThenAndNow, thenGap, THEN_GAP_DAYS } from "../workflows/then";
import { embed,validEmbedding,EMBED_TEXT_BYTES,EMBED_BATCH_BYTES } from "../embeddings";
import { knock, type PushSubscriptionJSON } from "../push/vapid";
import type { Env } from "../env";
import { createMuse, type Muse } from "../muse";
import { createTranscriber, type Transcriber, type TranscriberSession } from "../transcribe";
import { createVoice, type Voice } from "../voice";
import { migrate } from "./schema";
import { wav } from "../transcribe/wav";
import { SqlEventStore } from "./sqlStore";
import { devKey, unwrapKey } from "../crypto/keys";
import { cipher, type Cipher } from "../crypto/seal";
import { createChecker, type PromiseChecker } from "./check";
import { Turns } from "./turns";
import {SpeechGate} from "./speechGate";
import {diag,recentDiagnostics} from "./turns";
import { askChart, ChartAskProblem, type ChartAnswer } from "./chartAsk";
import {operationalTrace} from "./diagnostics";
import type {ExportEvidence} from "./export";
import {exportWorkflowArchives,type WorkflowArchive} from "./workflowArchive";
import type {EarProjection} from "../ear/reconcile";
import {EarFiles,type EarFile,type EarReceipt} from "./ear";

/** Content-free operational counters; private examples remain sealed in their Mind. */
function trace(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(operationalTrace(entry)));
}
const round = (n: number) => Math.round(n * 100) / 100;
const roundAll = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));

/** Saved views are keyed by shape version, so a changed shape is rebuilt rather than misread. */
const VIEWS_NAME = `mind@v${VIEWS_VERSION}`;

/** How often the director looks at the sun while a Ray is live. */
const TICK_MS = 5_000;
/** Close code for a session the Mind can't open as asked: the phone shows why and doesn't rejoin. */
export const REFUSED = 4400;
/** The goodnight gets this long before the Ray ends anyway. */
const CLOSING_MS = 20_000;
/** How long a Ray whose phone dropped waits, sun held, for it to come back. */
const REJOIN_MS = 30 * 60_000;
/** A failed live transcriber is replaced no sooner than this. */
const ASR_RETRY_MS = 3_000;
async function thenAwait<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{let abort:(()=>void)|undefined;const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort()});try{return await Promise.race([pending,cancelled])}finally{if(abort)signal.removeEventListener("abort",abort)}}

/** Events the Mind writes itself carry this as their device. */
const MIND_DEVICE = "mind";

interface SocketState {
  device: string;
  rayId: string | null;
  audio?:typeof AUDIO_CODEC;
}

/**
 * Your Mind: one single-threaded room per person with its own SQLite store.
 * It holds the live Ray socket, the event log, the views and (later) the
 * nightly alarm for the Watch. Deleting you means deleting this room.
 */
/** G5: what a landfall postcard carries. Only the parts switched on are present. */
export interface Postcard {
  name: string | null;
  island: string;
  at: number;
  note: string;
  said: string;
  markers?: { text: string; evidence: string }[];
  witnessedBy?: string[];
  star?: string | null;
  rings?: number;
}

export class MindDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private routeWork:RouteJobs|null=null;
  private earFiles:EarFiles|null=null;
  private governorWork:GovernorDelivery|null=null;
  private dialWork:DialJobs|null=null;
  private embeddingBatch:Promise<{scanned:number;embedded:number}>|null=null;
  private embeddingRun:{night:string;controller:AbortController;promise:Promise<{embedded:number;batches:number}>}|null=null;
  private log!: EventLog;
  private events!: SqlEventStore;
  /** Seals what this Mind stores with the person's data key; set once the key is unwrapped. */
  private cipher!: Cipher;
  private views: Views = emptyViews();
  private readonly sessions = new Map<WebSocket, TranscriberSession>();
  private readonly turns = new Map<WebSocket, Turns>();
  private readonly foreground = new Map<string,AbortController>();
  private readonly speechGates=new Map<WebSocket,SpeechGate>();
  private contextVersion=0;
  private providers: Promise<{ muse: Muse; voice: Voice }> | null = null;
  private transcriber: Transcriber;
  private readonly checker: PromiseChecker;
  private readonly decide: ReturnType<typeof decisions>;
  /** Rays where care is on: the arc stops while someone is hurting (J4). */
  /** J4: Rays holding for care, kept in meta so a restart of this Mind never lets the arc run on mid-care. */
  private readonly careHold = {
    has: (rayId: string) => this.metaValue(`care:${rayId}`) !== null,
    said: (rayId: string) => this.metaValue(`care:${rayId}`),
    add: (rayId: string, said = "") => this.setMeta(`care:${rayId}`, said),
    delete: (rayId: string) => void this.sql.exec("DELETE FROM meta WHERE key = ?", `care:${rayId}`),
  };
  /** A stage change in progress, so two ticks never enter the same moment twice. */
  private entering: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.transcriber = createTranscriber(env);
    // Spark judges unless the fake provider is selected (lazily: the key is read on first use).
    const judgeMuse = env.RA_MUSE_PROVIDER === "fake" ? undefined : () => this.getProviders().then((p) => p.muse);
    this.checker = createChecker(judgeMuse);
    this.decide = decisions(judgeMuse);
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql);
      this.cipher = cipher(await this.dataKey());
      this.events = new SqlEventStore(this.sql, this.cipher);
      this.log = new EventLog(this.events);
      this.views = this.loadViews();
      // J6: listen in the languages this person talks in.
      this.transcriber = createTranscriber(env, this.listeningIn());
    });
  }

  // ── HTTP into the Mind ──────────────────────────────────────────────────
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ray") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      const person = url.searchParams.get("person");
      if (person) this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('person', ?)", person);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ device: "unknown", rayId: null } satisfies SocketState);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  // ── RPC ─────────────────────────────────────────────────────────────────
  /** POST /sync: take the phone's outbox, return what it hasn't seen. */
  async sync(since: number, outbox: unknown[]): Promise<{ events: RaEvent[]; seq: number; duplicates: string[]; origin: string | null }> {
    assertPhoneEdits(outbox);
    const { duplicates } = this.append(outbox);
    // The first event's ID names this Mind's log: a phone holding another (a Mind forgotten and begun again) starts over.
    const origin = this.log.since(0, 1)[0]?.id ?? null;
    return { events: this.log.since(since), seq: this.log.lastSeq, duplicates, origin };
  }

  async getViews(): Promise<Views> {
    return this.views;
  }

  /** The Horizon field this person's story belongs to, once Ra has read it (the window, or trip design). */
  async field(): Promise<string | null> {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'field'").toArray()[0]?.value ?? null;
  }

  /**
   * C3 · Bring back: keep the clip (and a photo) sealed in R2, and record the
   * trip as reported in the person's own words.
   */
  async bringBack(input: { tripId: string; text: string; clip?: Uint8Array; photo?: { bytes: Uint8Array; type: string } }): Promise<{ text: string }> {
    const trip = this.views.trips[input.tripId];
    if (!trip) throw new Error("no such trip");
    const person = this.person() ?? this.ctx.id.name ?? "unknown";
    const drafts: EventDraft[] = [];
    // C3: Spark reads the photo, so the evidence says what it shows. An unreadable photo is still kept.
    let photoNote: string | undefined;
    if (input.photo) {
      try {
        const { muse } = await this.getProviders();
        photoNote = (await muse.see({ image: input.photo, task: `This photo is evidence brought back from a scouting trip: "${trip.title ?? trip.action}". Write out any important visible text, then say in one plain sentence what it shows. Don't judge or praise it.`, signal: AbortSignal.timeout(45_000) })).trim().slice(0, 4000) || undefined;
      } catch { photoNote = undefined; }
    }
    for (const [kind, bytes, type] of [
      ["clip", input.clip, "audio/wav"],
      ["photo", input.photo?.bytes, input.photo?.type ?? "image/jpeg"],
    ] as const) {
      if (!bytes) continue;
      const evidenceId = makeId();
      const r2Key = `${person}/evidence/${evidenceId}`;
      await this.env.FILES.put(r2Key, this.cipher.sealBytes(bytes), { customMetadata: { type, sealed: "1" } });
      drafts.push(this.draft("evidence.added", { evidenceId, tripId: input.tripId, kind, r2Key, ...(kind === "photo" && photoNote ? { note: photoNote } : {}) }));
    }
    drafts.push(this.draft("trip.reported", { tripId: input.tripId, text: input.text }));
    this.append(drafts);
    return { text: input.text };
  }

  /**
   * C2 · Speak: a thought held and released outside a Ray. Kept in your words
   * and voice, and with your scouting trip when one is under way.
   */
  /** Ask the Chart (E1): Spark reads the person's Chart records and quotes them exactly. */
  async chartAnswer(question: string): Promise<ChartAnswer> {
    const { muse } = await this.getProviders();
    if (muse.stub) throw new ChartAskProblem("Asking your Chart needs Muse.");
    return askChart(muse, this.views, question, AbortSignal.timeout(60_000));
  }

  async capture(input: { text: string; pcm?: Int16Array; via?: "ear" }): Promise<{ utteranceId: string; tripId: string | null }> {
    const utteranceId = makeId();
    const trip = Object.values(this.views.trips).filter((t) => t.state === "chosen").at(-1) ?? null;
    const audioKey = input.pcm ? this.keepVoice(utteranceId, input.pcm) : undefined;
    const endMs = input.pcm ? Math.round((input.pcm.length / AUDIO_RATE) * 1000) : 0;
    this.append([
      this.draft("utterance", { utteranceId, speaker: "you", text: input.text, startMs: 0, endMs, ...(audioKey ? { audioKey } : {}), ...(input.via ? { via: input.via } : {}) }),
      ...(trip ? [this.draft("evidence.added", { evidenceId: makeId(), tripId: trip.tripId, kind: "note" as const, note: input.text })] : []),
    ]);
    return { utteranceId, tripId: trip?.tripId ?? null };
  }

  async fileReviewedCapture(value:unknown):Promise<ReviewedCaptureReceipt> {
    const input=await checkReviewedCapture(value);
    if(this.sql.exec<{value:string}>("SELECT value FROM meta WHERE key = 'people-erased'").toArray()[0]?.value==="1")throw new Error("This Mind has been erased.");
    const prepared=reviewedCaptureDrafts(input,this.events.byId(input.captureId),this.views,Date.now());
    if(prepared.drafts.length)this.append(prepared.drafts);
    return prepared.receipt;
  }

  /** GET /export: everything Ra holds, opened, as events (I1 "Take it all with you"). */
  async exportAll(): Promise<{ events: RaEvent[]; views: Views; workflowArchives:WorkflowArchive[] }> {
    const owner=this.person()??this.ctx.id.name;
    if(!owner)throw new Error("A Mind must have an owner.");
    const workflowArchives=exportWorkflowArchives(this.sql.exec<{key:string;value:string}>("SELECT key,value FROM meta WHERE key GLOB 'legacy-workflow/*' ORDER BY key"),this.cipher,owner);
    return { events: this.log.since(0, Number.MAX_SAFE_INTEGER), views: this.views,workflowArchives };
  }
  async exportEvidence(eventId:string):Promise<ExportEvidence|null> {
    const event=this.events.byId(eventId);if(event?.kind!=="evidence.added")return null;
    const body=event.body as EventBodies["evidence.added"];const owner=this.person()??this.ctx.id.name;
    if(!owner||!body.r2Key||!body.r2Key.startsWith(owner+"/evidence/"))return null;
    const object=await this.env.FILES.get(body.r2Key);if(!object)return null;
    const sealed=new Uint8Array(await object.arrayBuffer());
    try{return {evidenceId:body.evidenceId,type:object.customMetadata?.type??"application/octet-stream",bytes:this.cipher.openBytes(sealed)}}finally{sealed.fill(0)}
  }

  /** DELETE /me: this Mind, gone. Its R2 folder is removed by the Worker; its key with the D1 row. */
  async erase(): Promise<void> {
    this.embeddingRun?.controller.abort();this.embeddingRun=null;
    this.dialWork?.close();this.dialWork=null;
    this.governorWork?.close();this.governorWork=null;
    this.routeWork?.close();
    for(const controller of this.foreground.values())controller.abort();this.foreground.clear();
    this.setMeta("people-erased","1");
    for(const turn of this.turns.values())turn.cancel();this.turns.clear();
    for(const gate of this.speechGates.values())gate.close();this.speechGates.clear();
    for(const session of this.sessions.values())session.cancel?session.cancel():session.close();this.sessions.clear();
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "forgotten");
    await this.earFiles?.close();this.earFiles=null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // This object may live on: start it again as an empty Mind, not one with no tables.
    migrate(this.sql);
    this.setMeta("people-erased", "1");
    this.events = new SqlEventStore(this.sql, this.cipher);
    this.log = new EventLog(this.events);
    this.views = emptyViews();
  }

  // ── the live socket ─────────────────────────────────────────────────────
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      this.onAudio(ws, message);
      return;
    }
    const msg = parsePhoneMessage(message);
    if (!msg) {
      this.send(ws, { t: "error", message: "unknown message" });
      return;
    }
    await this.onMessage(ws, msg);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.dropTurns(ws);
    this.closeSession(ws,true);
    const state = this.socketState(ws);
    if (state.rayId && this.views.liveRay === state.rayId && this.ctx.getWebSockets().every((other) => other === ws)) {
      this.foreground.get(state.rayId)?.abort();
      // A dropped phone usually comes back (a lock screen, a tunnel, the app in the background): the sun holds and the Ray waits.
      if (this.views.rays[state.rayId]?.pausedAt === null) {
        this.write("ray.paused", { rayId: state.rayId });
        this.setMeta(`dropped:${state.rayId}`, "1");
      }
      this.sql.exec("INSERT OR REPLACE INTO schedule (name, due_at) VALUES (?, ?)", `rejoin:${state.rayId}`, Date.now() + REJOIN_MS);
      await this.nextAlarm();
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.dropTurns(ws);
    this.closeSession(ws,true);
  }

  private async onMessage(ws: WebSocket, msg: PhoneMessage): Promise<void> {
    switch (msg.t) {
      case "hello": {
        const scope=this.workScope();
        const { muse, voice } = await this.getProviders();
        this.checkWorkScope(scope);
        let rayId = this.views.liveRay;
        // A Ray left waiting longer than it holds closes now, keeping what it can, and a new one starts.
        const waited = rayId ? this.views.rays[rayId] : undefined;
        if (rayId && waited?.pausedAt != null && Date.now() - waited.pausedAt > REJOIN_MS && this.ctx.getWebSockets().every((other) => other === ws)) {
          this.finishEarly(rayId, "dropped", false);
          rayId = this.views.liveRay;
        }
        const fresh = !rayId;
        const arrival = msg.session === "landfall" ? this.views.arrivals.find((a) => a.landfallId === msg.landfallId) : null;
        const markerIsland=msg.session==="markers"&&typeof msg.markersIsland==="string"?msg.markersIsland:null;
        if(msg.session==="markers"&&(!markerIsland||!(Object.hasOwn(this.views.islands,markerIsland)||Object.hasOwn(this.views.markers,markerIsland)))){this.refuse(ws,"Open an existing island before naming its markers.");return}
        if(msg.session==="markers"&&rayId&&(this.views.rays[rayId]?.session!=="markers"||this.views.rays[rayId]?.markers?.island!==markerIsland)){this.refuse(ws,"Finish the current session before opening these markers.");return}
        if (msg.session === "landfall" && (!arrival || this.views.landfalls.some((l) => l.landfallId === arrival.landfallId))) return this.refuse(ws, "Prepare a landfall before opening this session.");
        if (msg.session === "landfall" && rayId && this.views.rays[rayId]?.landfallId !== arrival?.landfallId) return this.refuse(ws, "Finish the current session before opening landfall.");
        if (!rayId) {
          rayId = makeId();
          // A prepared Reading (F1) or season review (K2) opens when asked for; otherwise a Ray.
          const waiting =
            msg.session === "reading" ? this.views.readings.some((r) => r.rayId === null) : msg.session === "season" ? this.views.seasons.some((s) => s.rayId === null) : false;
          // A first Ray that dropped before sunset, with no trips yet, opens as a first Ray again (not "What did you find?").
          const firstAgain = Object.values(this.views.rays).every((r) => r.session === "first" && r.sink < 1) && Object.keys(this.views.trips).length === 0;
          const session = markerIsland ? "markers" : arrival ? "landfall" : waiting ? msg.session! : firstAgain ? "first" : "ray";
          // At demo pace a whole Ray fits in about 8 minutes of video.
          const minutes = msg.pace === "demo" ? DEMO_MINUTES : Math.min(45, Math.max(20, Math.round(msg.minutes) || 30));
          const first = scriptFor(session, { hasStar: this.views.star.current !== null })[0]!;
          this.append([
            this.draft("ray.started", { rayId, session, minutes, pace: msg.pace ?? "normal", ...(arrival ? { landfallId:arrival.landfallId } : {}),...(markerIsland?{markers:{island:markerIsland,base:[...(this.views.markers[markerIsland]?.markers??[])]}}:{}) }),
            this.draft("ray.stage", { rayId, stage: first.name, sink: 0 }),
          ]);
        }
        const audio=Array.isArray(msg.audio)&&msg.audio.includes(AUDIO_CODEC)?AUDIO_CODEC:undefined;
        ws.serializeAttachment({ device: String(msg.device).slice(0, 64), rayId,...(audio?{audio}:{}) } satisfies SocketState);
        if (typeof msg.tz === "number" && Math.abs(msg.tz) <= 14 * 60) this.setMeta("tz", String(Math.round(msg.tz)));
        // J6: the languages you talk in. One is passed to the transcriber; more than one and it listens for any.
        if (Array.isArray(msg.langs)) {
          const langs = msg.langs.filter((l): l is string => typeof l === "string" && /^[a-z]{2,3}$/.test(l)).slice(0, 4);
          if (langs.length) {
            this.setMeta("langs", langs.join(","));
            this.transcriber = createTranscriber(this.env, this.listeningIn());
          }
        }
        // Back after a drop: the Ray picks up where it was. A Ray they paused themselves stays paused.
        this.sql.exec("DELETE FROM schedule WHERE name = ?", `rejoin:${rayId}`);
        if (this.metaValue(`dropped:${rayId}`)) {
          this.sql.exec("DELETE FROM meta WHERE key = ?", `dropped:${rayId}`);
          if (this.views.rays[rayId]?.pausedAt !== null) this.write("ray.resumed", { rayId });
        }
        const ray = this.views.rays[rayId]!;
        this.send(ws, {
          t: "ready",
          rayId,
          session: ray.session,
          minutes: ray.minutes,
          startedAt: ray.startedAt,
          pausedMs: ray.pausedMs,
          paused: ray.pausedAt !== null,
          ...(audio?{audio}:{}),
          providers: { transcriber: this.transcriber.name, muse: muse.label, voice: voice.label, check: this.checker.label },
        });
        this.send(ws, { t: "stage", name: ray.stage ?? "open", sink: ray.sink });
        if(ray.session==="markers")this.sendMarkers(ws,rayId);
        const turns = this.turnsFor(ws, rayId, muse, voice);
        if (fresh) {
          // Ra opens the Ray, aloud.
          void turns.say(openingFor(ray.stage ?? "open", { name: this.views.person?.name, trip: this.carriedTrip(), signal: typeof msg.signal === "string" ? msg.signal.replace(/s+/g, " ").trim().slice(0, 400) || null : null }) ?? this.partFor(rayId, ray.stage ?? "open") ?? OPENINGS.open!);
        } else {
          // Joining a Ray in progress: show Ra's last line without saying it again, and the moment on screen.
          const last = this.rayTurns(rayId).filter((t) => t.speaker === "ra").at(-1);
          if (last) this.send(ws, { t: "ra.line", lineId: makeId(), text: last.text });
          this.resendMoment(ws, rayId);
          // J4: care holds across a reload; the support lines come back with it.
          if (this.careHold.has(rayId)) this.send(ws, { t: "care", on: true, said: this.careHold.said(rayId) ?? "" });
        }
        // The sun moves even while nobody speaks: the director checks the clock every few seconds.
        await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
        return;
      }
      case "landfall.review": {
        const { rayId } = this.socketState(ws);
        if (!rayId || this.views.rays[rayId]?.session !== "landfall") return;
        const unresolved = msg.resolved !== true;
        this.saveMoment(rayId,"arrival-review",{ unresolved });
        this.broadcast({ t:"landfall.review",unresolved });
        if (unresolved) void this.say(rayId,"What does not match between the evidence and how you see it now?");
        return;
      }
      case "landfall.next": {
        const { rayId } = this.socketState(ws);
        if (rayId && this.views.rays[rayId]?.session === "landfall" && !this.careHold.has(rayId) && !(this.arrivalReviews.get(rayId) ?? 0) && !this.loadMoment<{ unresolved:boolean }>(rayId,"arrival-review")?.unresolved) await this.completeMoment(rayId);
        return;
      }
      case "end": {
        const { rayId } = this.socketState(ws);
        if(rayId)this.foreground.get(rayId)?.abort();
        this.dropTurns(ws);
        this.closeSession(ws,true);
        if (rayId) this.finishEarly(rayId, "person", true);
        ws.close(1000, "ray ended");
        return;
      }
      case "pause": {
        // Flush what was heard so far, and hold the sun while they think (B3).
        this.dropTurns(ws);
        this.closeSession(ws);
        const { rayId } = this.socketState(ws);
        if (rayId && this.views.rays[rayId]?.pausedAt === null) this.write("ray.paused", { rayId });
        return;
      }
      case "resume": {
        const { rayId } = this.socketState(ws);
        if (rayId && this.views.rays[rayId]?.pausedAt !== null) this.write("ray.resumed", { rayId });
        return;
      }
      case "done":
        // "Done talking": this thought is finished now.
        this.closeSession(ws);
        return;
      case "barge_in":
        // The phone has already stopped Ra's voice; stop making it, and log the line as cut.
        diag("bargeIn",{speaking:this.turns.get(ws)?.raIsSpeaking??false});
        this.turns.get(ws)?.bargeIn();
        return;
      case "vad":
        return;
      case "mirror.keep":
      case "mirror.strike": {
        const kept = msg.t === "mirror.keep";
        this.write(kept ? "mirror.kept" : "mirror.struck", { mirrorId: msg.mirrorId });
        this.broadcast({ t: "mirror.state", mirrorId: msg.mirrorId, state: kept ? "kept" : "struck" });
        const { rayId } = this.socketState(ws);
        if (kept && rayId && this.stageOf(rayId)?.kind === "mirror") await this.completeMoment(rayId);
        return;
      }
      case "question.keep": {
        const { rayId } = this.socketState(ws);
        if (rayId) await this.keepQuestion(rayId, msg.text);
        return;
      }
      case "typed": {
        // U4 "Type instead": logged as your words, shown like a final transcript, answered like speech.
        const { rayId } = this.socketState(ws);
        const text = typeof msg.text === "string" ? msg.text.replace(/\s+/g, " ").trim().slice(0, 2000) : "";
        const ray = rayId ? this.views.rays[rayId] : undefined;
        if (!rayId || !ray || !text || this.views.liveRay !== rayId || ray.endedAt !== null) return;
        if (ray.pausedAt !== null) this.write("ray.resumed", { rayId });
        const utteranceId = makeId();
        const at = Math.max(0, Date.now() - ray.startedAt);
        const words = text.split(" ").map((w, i) => ({ text: w, startMs: i * 250, endMs: i * 250 + 200, loudness: 0.5, approximate: true as const }));
        const [event] = this.append([this.draft("utterance", { utteranceId, rayId, speaker: "you", text, startMs: at, endMs: at + words.length * 250 })]).appended;
        this.send(ws, { t: "words.final", utteranceId, words, text, seq: event?.seq ?? this.log.lastSeq });
        if (ray.session === "markers") this.sendMarkers(ws, rayId);
        const gate = this.speechGate(ws, rayId);
        gate.voice();
        gate.partial({ id: utteranceId, text, basis: this.contextVersion });
        const accepted = gate.final({ id: utteranceId, text, basis: this.contextVersion });
        diag("typed", { accepted, stage: this.stageOf(rayId)?.kind ?? null });
        if (accepted) this.ctx.waitUntil(this.afterYouSpoke(ws, rayId, text, utteranceId).catch(() => {}));
        return;
      }
      case "star.keep":
      case "star.notyet": {
        const { rayId } = this.socketState(ws);
        if (rayId) await this.answerStar(rayId, msg.t === "star.keep" ? msg.text : null);
        return;
      }
      case "trip.choose":
      case "trip.change": {
        const { rayId } = this.socketState(ws);
        if (rayId) await this.onTrip(rayId, msg.tripId, msg.t === "trip.change");
        return;
      }
    }
  }

  private onAudio(ws: WebSocket, buf: ArrayBuffer): void {
    const frame = decodeWireAudio(buf,this.socketState(ws).audio===AUDIO_CODEC);
    if (!frame || frame.kind !== FRAME_MIC || frame.pcm.length!==FRAME_SAMPLES) {frame?.pcm.fill(0);return;}
    const { rayId } = this.socketState(ws);
    if (!rayId||this.views.liveRay!==rayId||this.views.rays[rayId]?.endedAt!==null) {frame.pcm.fill(0);return;} // audio before hello or after end
    if(frame.speaking){this.speechGate(ws,rayId).voice();this.turns.get(ws)?.youSpeak()}
    if(!this.sessions.has(ws)&&(this.asrRetryAt.get(ws)??0)>Date.now()){frame.pcm.fill(0);return}
    const session = this.sessions.get(ws) ?? this.openSession(ws, rayId);
    session.push(frame);
  }

  /** When a socket whose transcriber failed may open a new one. */
  private readonly asrRetryAt = new Map<WebSocket, number>();

  private openSession(ws: WebSocket, rayId: string): TranscriberSession {
    // The transcriber counts from its first frame; utterances count from the Ray's start,
    // like Ra's lines, so a rejoin or a wake from hibernation doesn't reset the clock.
    const offset = Math.max(0, Date.now() - (this.views.rays[rayId]?.startedAt ?? Date.now()));
    const session = this.transcriber.open(
      {
        partial: (utteranceId, words) => {
          if(this.views.liveRay!==rayId||this.views.rays[rayId]?.endedAt!==null)return;
          if(!words.length)this.turns.get(ws)?.youSpeak();
          this.speechGate(ws,rayId).partial({id:utteranceId,text:words.map(word=>word.text).join(" "),basis:this.contextVersion});
          this.send(ws, { t: "words.partial", utteranceId, words });
        },
        final: (utteranceId, words, text, span) => {
          if(this.views.liveRay!==rayId||this.views.rays[rayId]?.endedAt!==null){span.pcm?.fill(0);return}
          const audioKey = span.pcm ? this.keepVoice(utteranceId, span.pcm) : undefined;
          const [event] = this.append([
            this.draft("utterance", {
              utteranceId,
              rayId,
              speaker: "you",
              text,
              startMs: offset + span.startMs,
              endMs: offset + span.endMs,
              ...(audioKey ? { audioKey } : {}),
              // Where their voice lifted above their own level: the mirror picks from these.
              prosody: liftedWords(words),
            }),
          ]).appended;
          this.send(ws, { t: "words.final", utteranceId, words, text, seq: event?.seq ?? this.log.lastSeq });
          if(this.views.rays[rayId]?.session==="markers")this.sendMarkers(ws,rayId);
          const accepted=span.respond!==false&&this.speechGate(ws,rayId).final({id:utteranceId,text,basis:this.contextVersion});
          diag("final",{respond:span.respond!==false,accepted,stage:this.stageOf(rayId)?.kind??null});
          if(accepted)this.ctx.waitUntil(this.afterYouSpoke(ws,rayId,text,utteranceId).catch(e=>{diag("afterYouSpoke.failed",{error:e instanceof Error?e.message.slice(0,200):"unknown"});throw e}));
        },
        drop: (utteranceId) => {
          this.send(ws, { t: "words.drop", utteranceId });
          this.speechGates.get(ws)?.drop(utteranceId);
          // A cough or a click isn't a turn: if it held back Ra's reply, Ra replies now.
          this.turns.get(ws)?.youDropped();
        },
        // A failed transcriber is replaced on the next frame after a short wait: kept, it took every later frame and
        // dropped it, so nothing you said was heard again until you paused and resumed (3 Nov phone Rays).
        error: (message) => {
          diag("asr.failed",{reason:message.slice(0,80)});
          // After open() returns: a session can fail while it is still opening.
          queueMicrotask(()=>{if(this.sessions.get(ws)===session)this.sessions.delete(ws)});
          this.asrRetryAt.set(ws,Date.now()+ASR_RETRY_MS);
          this.dropTurns(ws);
        },
      },
      makeId,
    );
    this.sessions.set(ws, session);
    return session;
  }

  // ── the director ────────────────────────────────────────────────────────
  /** While a Ray is live, the director looks at the sun every few seconds. */
  override async alarm(): Promise<void> {
    const rayId = this.views.liveRay;
    if (rayId && this.ctx.getWebSockets().length > 0) await this.advance(rayId);
    await this.runDue();
    await this.nextAlarm();
  }

  /** One alarm for everything: the director's tick while a Ray is live, else the earliest scheduled job. */
  private async nextAlarm(): Promise<void> {
    const due = this.sql.exec<{ due: number | null }>("SELECT MIN(due_at) AS due FROM schedule").one().due;
    const tick = this.views.liveRay && this.ctx.getWebSockets().length > 0 ? Date.now() + TICK_MS : null;
    const next = [due, tick].filter((n): n is number => n !== null).sort((a, b) => a - b)[0];
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }

  /** Scheduled jobs whose time has come. Today there is one: the Watch. */
  private async runDue(): Promise<void> {
    const due = this.sql.exec<{ name: string }>("SELECT name FROM schedule WHERE due_at <= ?", Date.now()).toArray();
    for (const { name } of due) {
      this.sql.exec("DELETE FROM schedule WHERE name = ?", name);
      if (name === "watch") await this.startWatch();
      else if (name === "reading" || name === "season") await this.startRhythm(name);
      else if (name.startsWith("dial:")) await this.interrupt("call-due");
      else if (name === "quiet") await this.interrupt("quiet");
      else if(name==="governor-retry")await this.governor().run();
      else if (name.startsWith("rejoin:") && this.ctx.getWebSockets().length === 0) this.finishEarly(name.slice("rejoin:".length), "dropped", false);
    }
  }

  /**
   * After a Ray ends, the Watch reads the day at about 2 AM the person's time.
   * From the first Ray on, the rhythm runs too: a Reading prepared every
   * Saturday night (F1), a season review at each quarter's end (K2).
   */
  private async scheduleWatch(): Promise<void> {
    const now = Date.now();
    this.scheduleOnce("watch", nextNightAt(now, this.tz()));
    this.scheduleOnce("reading", nextReadingAt(now, this.tz()));
    this.scheduleOnce("season", seasonOf(now).to);
    await this.nextAlarm();
  }

  private scheduleOnce(name: string, at: number): void {
    const exists = this.sql.exec("SELECT 1 FROM schedule WHERE name = ?", name).toArray().length > 0;
    if (!exists) this.sql.exec("INSERT INTO schedule (name, due_at) VALUES (?, ?)", name, at);
  }

  /** WeeklyReading and SeasonReview prepare from your Mind; the next one is scheduled straight away. */
  private async startRhythm(kind: "reading" | "season"): Promise<void> {
    const person = this.person() ?? this.ctx.id.name;
    if (!person) return;
    const now = Date.now();
    try {
      if (kind === "reading") {
        await this.env.WEEKLY_READING.create({ params: { person } });
        this.scheduleOnce("reading", nextReadingAt(now + 60_000, this.tz()));
      } else {
        // The season that just ended.
        const { from, to } = seasonOf(now - 86_400_000);
        await this.env.SEASON_REVIEW.create({ params: { person, from, to } });
        this.scheduleOnce("season", seasonOf(now).to);
      }
    } catch (e) {
      trace({ at: kind, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** WeeklyReading / SeasonReview: what they read, opened. */
  async rhythmContext(): Promise<{ views: Views; lines: Line[]; field: string | null; tz: number }> {
    const lines: Line[] = this.log
      .since(0, Number.MAX_SAFE_INTEGER)
      .filter((e): e is RaEvent<"utterance"> => e.kind === "utterance")
      .map((e) => ({
        utteranceId: e.body.utteranceId,
        speaker: e.body.speaker,
        text: e.body.text,
        at: e.at,
        ms: e.body.endMs - e.body.startMs,
        kept: e.body.audioKey !== undefined,
      }));
    return { views: this.views, lines, field: await this.field(), tz: this.tz() };
  }

  async writeReading(r: Omit<EventBodies["reading.prepared"], "readingId">): Promise<string> {
    const previous=this.views.readings.find(reading=>reading.week===r.week);
    if(previous)return previous.readingId;
    const readingId = makeId();
    this.write("reading.prepared", { readingId, ...r });
    return readingId;
  }

  async writeSeason(s: Omit<EventBodies["season.prepared"], "seasonId">): Promise<string> {
    const previous=this.views.seasons.find(season=>season.from===s.from&&season.to===s.to);if(previous)return previous.seasonId;
    const seasonId = makeId();
    this.write("season.prepared", { seasonId, ...s });
    return seasonId;
  }

  private routeOwn(){
    const evidence=this.sql.exec<{id:string;text:string}>("SELECT id, text FROM utterances WHERE speaker = 'you' ORDER BY seq DESC LIMIT 16").toArray().reverse().map(row=>({id:row.id,quote:this.cipher.open(row.text)}));
    return ownRouteContext(this.views,evidence);
  }
  private routeJobs():RouteJobs {
    return this.routeWork??=new RouteJobs({
      load:id=>this.loadMoment<SavedRouteJob>("chart-routes",id),save:job=>this.saveMoment("chart-routes",job.operationId,job),
      own:()=>this.routeOwn(),scope:()=>this.workScope(),
      horizon:async()=>{const field=await this.field();return field?this.signalsFor(field):[]},
      providers:async()=>{if(this.env.RA_MUSE_PROVIDER==="fake")throw new RouteIssue("provider-unavailable");return {muse:(await this.getProviders()).muse,ask:this.decide.ask}},
      waitUntil:task=>this.ctx.waitUntil(task),
      commit:(proposal,job)=>this.append([this.draft("island.charted",{island:proposal.island,inevitable:proposal.inevitable,adjacent:proposal.adjacent,yours:proposal.yours,proposal})],()=>this.saveMoment("chart-routes",job.operationId,job)),
    });
  }
  private async routeAction(action:()=>import("@ra/core").RouteJob|Promise<import("@ra/core").RouteJob>){
    try{this.workScope();return {ok:true as const,job:await action()}}
    catch(error){return {ok:false as const,status:error instanceof RouteActionError?error.status:409,error:error instanceof RouteActionError?error.message:"This route request is unavailable. Unlock the current Mind and try again."}}
  }
  async proposeRoute(operationId:string,circumstances:string,retry=false){return this.routeAction(()=>this.routeJobs().start(operationId,circumstances,retry))}
  async routeStatus(operationId:string){return this.routeAction(()=>this.routeJobs().get(operationId))}
  async cancelRoute(operationId:string){return this.routeAction(()=>this.routeJobs().cancel(operationId))}
  async acceptRoute(operationId:string){return this.routeAction(()=>this.routeJobs().accept(operationId))}

  async checkDialEvidence(value:unknown):Promise<{ok:true;snapshot:import("@ra/core").DialEvidence;unchanged:boolean}|{ok:false;error:string}> {
    try{
      const scope=this.workScope(),input=dialSelection(value),call=this.views.dial[input.callId];
      if(!call||!call.claim.trim())return {ok:false,error:"Make your call before checking this evidence."};
      const reviewAt=call.reviewAt,field=await this.field();if(!field)return {ok:false,error:"Your Horizon is not available yet."};
      let signals:Signal[];try{signals=await this.signalsFor(field)}catch{return {ok:false,error:"The Horizon check is unavailable. Your call is unchanged."}}
      this.checkWorkScope(scope);const snapshot=await dialEvidence(structuredClone(call),input.signalIds,signals,Date.now());this.checkWorkScope(scope);
      const current=this.views.dial[input.callId];if(!current?.claim.trim()||current.reviewAt!==reviewAt)return {ok:false,error:"Your call changed during the check. Review it before trying again."};
      const existing=current.observations.find(previous=>previous.snapshotId===snapshot.snapshotId);if(existing)return {ok:true,snapshot:existing,unchanged:true};
      this.write("dial.observed",{callId:input.callId,snapshot});return {ok:true,snapshot,unchanged:false};
    }catch(error){return {ok:false,error:error instanceof Error&&["Choose","Make","These"].some(prefix=>error.message.startsWith(prefix))?error.message:"This evidence check is no longer available. Unlock the current Mind and try again."}}
  }

  private dialJobs():DialJobs{
    return this.dialWork??=new DialJobs({scope:()=>this.workScope(),
      own:input=>{const call=input.callId?this.views.dial[input.callId]:null;return {star:this.views.star.current,island:currentIsland(this.views),waiting:Object.values(this.views.dial).find(call=>!call.claim)?.callId??null,call:call?{callId:call.callId,question:call.question??"",claim:call.claim,confidence:call.confidence,reviewAt:call.reviewAt}:null}},
      existing:(input,own)=>{const call=input.callId?this.views.dial[input.callId]:null;return !!call&&(input.kind==="read"?call.reads.some(read=>read.basis?.forReviewAt===own.call?.reviewAt):input.kind==="outcome"?call.outcomes.some(outcome=>outcome.basis.forReviewAt===own.call?.reviewAt):false)},
      load:id=>this.loadMoment<SavedDialJob>("dial-jobs",id),save:job=>this.saveMoment("dial-jobs",job.operationId,job),
      horizon:async()=>{const field=await this.field();return field?this.signalsFor(field):[]},
      providers:async()=>{if(this.env.RA_MUSE_PROVIDER==="fake")throw new DialIssue("provider-unavailable");return {muse:(await this.getProviders()).muse,ask:this.decide.ask}},waitUntil:task=>this.ctx.waitUntil(task),
      commit:(job,result,basis)=>{const callId=job.callId!,event=job.kind==="question"?this.draft("dial.asked",{callId,question:result.question!,reviewAt:basis.forReviewAt,basis}):job.kind==="read"?this.draft("dial.read",{callId,text:result.text!,...(result.from!==null?{from:result.from!,to:result.to!}:{}),basis}):this.draft("dial.outcome",{callId,text:result.text!,status:result.status!,basis});this.append([event],()=>this.saveMoment("dial-jobs",job.operationId,job))}
    });
  }
  async dialAction(action:"generate"|"status"|"cancel",id:string,input?:unknown,retry=false){
    try{this.workScope();return {ok:true as const,job:action==="generate"?this.dialJobs().start(id,input,retry):action==="cancel"?this.dialJobs().cancel(id):this.dialJobs().get(id)}}catch(error){return {ok:false as const,status:error instanceof DialActionError?error.status:409,error:error instanceof DialActionError?error.message:"This Dial request is unavailable. Unlock the current Mind and try again."}}
  }

  /** No opened Mind content is returned to a durable workflow step. */
  async prepareReadingSealed():Promise<string> {
    const scope=this.workScope();const ctx=await this.rhythmContext();const views=structuredClone(ctx.views);
    const field=FIELDS.find(field=>field.id===ctx.field);let available=!!field;
    const signals=field?await this.signalsFor(field.id).catch(()=>{available=false;return []}):[];
    const prepared=await prepareReading(views,ctx.lines,signals,Date.now(),ctx.tz,{field:field?.id??null,horizonAvailable:available});
    this.checkWorkScope(scope);return sealWork(this.cipher,scope+":reading",prepared);
  }
  async writeReadingSealed(sealed:string):Promise<string> {
    const scope=this.workScope();return this.writeReading(openWork(this.cipher,scope+":reading",sealed));
  }
  async prepareSeasonSealed(from:number,to:number):Promise<string> {
    const scope=this.workScope();return sealWork(this.cipher,scope+":season",prepareSeason(this.views,from,to));
  }
  async writeSeasonSealed(sealed:string):Promise<string> {
    const scope=this.workScope();return this.writeSeason(openWork(this.cipher,scope+":season",sealed));
  }

  /** Dev: prepare a Reading or a season review now. */
  async rhythmNow(kind: "reading" | "season"): Promise<void> {
    await this.startRhythm(kind);
  }

  private async startWatch(): Promise<void> {
    const person = this.person() ?? this.ctx.id.name;
    if (!person) return;
    const w = await this.env.NIGHT_WATCH.create({ params: { person, night: nightOf(Date.now(), this.tz()) } }).catch((e: unknown) => {
      trace({ at: "watch", error: e instanceof Error ? e.message : String(e) });
      return null;
    });
    if (w) trace({ at: "watch", workflow: w.id });
  }

  /** Dev: load a seeded mind (Amani's, from the canvas) into an empty Mind. */
  async seed(input: { events: EventDraft[]; field: string; tz: number }): Promise<{ seq: number }> {
    if (this.env.RA_ENV !== "dev") throw new Error("seeding is development-only");
    if (this.log.lastSeq > 0) throw new Error("this Mind already has a story");
    this.sql.exec("DELETE FROM meta WHERE key = 'people-erased'");
    this.append(input.events);
    this.setMeta("field", input.field);
    this.setMeta("tz", String(input.tz));
    // The seeded nights already read these; the next Watch starts after them.
    this.setMeta("watchedTo", String(this.log.lastSeq));
    this.sql.exec("DELETE FROM schedule WHERE name = 'watch'");
    await this.nextAlarm();
    return { seq: this.log.lastSeq };
  }

  /** J6: "auto" when you talk in more than one language, so the transcriber follows your switches. */
  listeningIn(): string {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'langs'").toArray()[0];
    const langs = row?.value.split(",").filter(Boolean) ?? [];
    return langs.length > 1 ? "auto" : (langs[0] ?? this.env.RA_LANGUAGE ?? "en");
  }

  // ── the governor ────────────────────────────────────────────────────────
  /**
   * The only code allowed to reach you first: four reasons, at most once a
   * day, "gone quiet" asked once ever. It knocks with a content-free push;
   * what it's about waits on Today.
   */
  private async interrupt(reason: Reason): Promise<boolean> {
    if(this.metaValue("people-erased"))return false;
    return this.governor().run(reason);
  }

  /** Try opted-in phones in turn, stopping at the first accepted or ambiguous knock. */
  private governor():GovernorDelivery{
    const persist=(operation:GovernorOperation,nextAt:number|null)=>{
      this.ctx.storage.transactionSync(()=>{this.saveMoment("governor","delivery",{...operation,nextAt});this.sql.exec("DELETE FROM schedule WHERE name = 'governor-retry'");if(nextAt!==null)this.sql.exec("INSERT INTO schedule(name,due_at) VALUES ('governor-retry',?)",nextAt)});
      if(nextAt!==null)this.ctx.waitUntil(this.nextAlarm());
    };
    return this.governorWork??=new GovernorDelivery({
      now:()=>Date.now(),allowed:(reason,now)=>!this.metaValue("people-erased")&&mayInterrupt(this.views,reason,now,!!this.metaValue("quietAsked")),
      targets:()=>this.env.RA_VAPID_PUBLIC&&this.env.RA_VAPID_PRIVATE?this.sql.exec<{endpoint:string}>("SELECT endpoint FROM push ORDER BY at DESC LIMIT 32").toArray().map(row=>row.endpoint):[],
      load:()=>this.loadMoment<GovernorOperation>("governor","delivery"),persist,
      finish:(operation,sent,quietConsumed)=>{this.append(sent?[this.draft("interrupt.sent",{reason:operation.reason,via:["push"]})]:[],()=>{persist(operation,null);if(quietConsumed)this.setMeta("quietAsked","1")})},
      send:async(endpoint,topic,signal)=>{
        const row=this.sql.exec<{json:string}>("SELECT json FROM push WHERE endpoint = ?",endpoint).toArray()[0];if(!row)return "gone";
        let sub:PushSubscriptionJSON,jwk:JsonWebKey;try{sub=JSON.parse(this.cipher.open(row.json));jwk=JSON.parse(this.env.RA_VAPID_PRIVATE??"")}catch{return "failed"}
        const result=await knock(sub,this.env.RA_VAPID_PUBLIC!,jwk,"mailto:hello@ra.invalid",{signal,topic});
        if(result==="gone"&&!signal.aborted)this.sql.exec("DELETE FROM push WHERE endpoint = ? AND json = ?",endpoint,row.json);return result;
      }
    });
  }

  /** POST /push: a phone that wants content-free notifications. */
  async addPush(sub: PushSubscriptionJSON): Promise<void> {
    if (!/^https:\/\//.test(sub.endpoint)) throw new Error("not a push endpoint");
    this.sql.exec("INSERT OR REPLACE INTO push (endpoint, json, at) VALUES (?, ?, ?)", sub.endpoint, this.cipher.seal(JSON.stringify(sub)), Date.now());
  }

  async removePush(endpoint: string): Promise<void> {
    this.sql.exec("DELETE FROM push WHERE endpoint = ?", endpoint);
  }

  /** E8 and "gone quiet": the governor's dates, kept in step with the log. */
  private scheduleGovernor(): void {
    for (const c of Object.values(this.views.dial)) {
      if (c.claim === "") continue;
      this.sql.exec("INSERT OR REPLACE INTO schedule (name, due_at) VALUES (?, ?)", `dial:${c.callId}`, c.reviewAt);
    }
    const last = this.sql.exec<{ at: number | null }>("SELECT MAX(at) AS at FROM events WHERE kind IN ('ray.started', 'utterance', 'evidence.added')").one().at;
    if (last !== null && !this.sql.exec("SELECT 1 FROM meta WHERE key = 'quietAsked'").toArray().length) {
      this.sql.exec("INSERT OR REPLACE INTO schedule (name, due_at) VALUES ('quiet', ?)", last + QUIET_AFTER);
    }
  }

  // ── people (Layer 3) ────────────────────────────────────────────────────
  // D1 holds beacons, introductions and crews; your Mind hears about them as events.

  /** H1: what a beacon can shine: your star, your next island, how many landfalls. */
  async beaconContext(): Promise<{ star: string | null; island: string | null; landfalls: number }> {
    return {
      star: this.views.star.current,
      island: currentIsland(this.views),
      landfalls: this.views.landfalls.length,
    };
  }

  async beaconLit(b: EventBodies["beacon.lit"]): Promise<void> {
    if (!this.sql.exec("SELECT 1 FROM meta WHERE key = 'people-erased'").toArray().length) this.write("beacon.lit", b);
  }

  async beaconDimmed(): Promise<void> {
    if (this.views.beacon?.lit) this.write("beacon.dimmed", {});
  }

  /** H2: someone to meet. One of the governor's four reasons to reach you first. */
  async introProposed(b: EventBodies["intro.proposed"]): Promise<void> {
    if (this.views.intros.some((i) => i.introId === b.introId && i.answer === null)) return;
    this.write("intro.proposed", b);
    await this.interrupt("introduction");
  }

  async introAnswered(introId: string, yes: boolean): Promise<void> {
    this.write("intro.answered", { introId, yes });
  }

  /** Apply a D1 projection once; older deliveries cannot resurrect a removed relationship. */
  async peopleProjection(p: PeopleProjection): Promise<void> {
    const notify = this.ctx.storage.transactionSync(() => {
      if (this.sql.exec("SELECT 1 FROM meta WHERE key = 'people-erased'").toArray().length) return false;
      const key = "people:" + p.kind + ":" + p.ref;
      const applied = Number(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? 0);
      if (p.revision <= applied) return false;
      const changes = peopleChanges(this.views, p, applied);
      const alert = p.kind === "intro" && p.state === "pending" && changes.some((e) => e.kind === "intro.proposed");
      if (changes.length) this.append(changes);
      this.setMeta(key, String(p.revision));
      return alert;
    });
    if (notify) this.ctx.waitUntil(this.interrupt("introduction").catch(() => {}));
  }

  async ownsLandfall(landfallId: string): Promise<boolean> {
    return this.views.landfalls.some((l) => l.landfallId === landfallId);
  }

  async crewLeft(introId: string): Promise<void> {
    if (this.views.crew.some((c) => c.introId === introId) || this.views.intros.some((i) => i.introId === introId)) this.write("crew.left", { introId });
  }

  async crewJoined(b: EventBodies["crew.joined"]): Promise<void> {
    if (!this.views.crew.some((c) => c.introId === b.introId)) this.write("crew.joined", b);
  }

  async witnessAsked(b: EventBodies["witness.asked"]): Promise<void> {
    this.write("witness.asked", b);
  }

  async witnessAnswered(requestId: string, saw: boolean): Promise<void> {
    if (this.views.witnessAsks.some((w) => w.requestId === requestId && w.saw === null)) this.write("witness.answered", { requestId, saw });
  }

  async witnessAdded(landfallId: string, name: string): Promise<void> {
    this.write("witness.added", { landfallId, name });
  }

  /**
   * G5: what a postcard carries, opened, and only what was switched on. The
   * voice is your longest kept line from the month before the landfall.
   */
  async shareSnapshot(landfallId: string, items: string[], note: string): Promise<{ card: Postcard; clip: Uint8Array | null } | null> {
    const l = this.views.landfalls.find((x) => x.landfallId === landfallId);
    if (!l) return null;
    const card: Postcard = { name: this.views.beacon?.name ?? null, island: l.island, at: l.at, note, said: l.said };
    if (items.includes("markers")) Object.assign(card, { markers: l.markers, witnessedBy: l.witnessedBy });
    if (items.includes("star")) card.star = this.views.star.current;
    if (items.includes("rings")) card.rings = this.views.rings.length;
    let clip: Uint8Array | null = null;
    if (items.includes("voice")) {
      const best = this.log
        .since(0, Number.MAX_SAFE_INTEGER)
        .filter((e): e is RaEvent<"utterance"> => e.kind === "utterance")
        .filter((e) => e.body.speaker === "you" && !!e.body.audioKey && e.at <= l.at && e.at >= l.at - 30 * 86_400_000)
        .sort((a, b) => b.body.endMs - b.body.startMs - (a.body.endMs - a.body.startMs))[0];
      if (best) clip = await this.voice(best.body.utteranceId);
    }
    return { card, clip };
  }

  async shareMade(b: EventBodies["share.made"]): Promise<void> {
    this.write("share.made", b);
  }

  async shareRevoked(token: string): Promise<void> {
    this.write("share.revoked", { token });
  }

  async personBlocked(name: string, reported: boolean): Promise<void> {
    this.write("person.blocked", { name, reported });
  }

  // ── then and now (G3) ───────────────────────────────────────────────────
  /** Your lines the Watch hasn't embedded yet, recent and historical batches. Only yours: Ra's lines are never compared. */
  async unembedded(limit = 32,throughSeq=Number.MAX_SAFE_INTEGER): Promise<{ utteranceId: string; at: number; text: string;audioKey:string }[]> {
    this.workScope();if(!Number.isInteger(limit)||limit<1||limit>32)throw new Error("Invalid embedding batch size.");
    type Row={id:string;at:number;text:string;audio_key:string};
    const query="SELECT u.id,e.at,u.text,u.audio_key FROM utterances u JOIN events e ON e.seq=u.seq LEFT JOIN vecs v ON v.utterance_id=u.id LEFT JOIN embedding_work w ON w.utterance_id=u.id WHERE u.speaker='you' AND u.audio_key IS NOT NULL AND u.audio_key!='' AND u.seq<=? AND v.utterance_id IS NULL AND COALESCE(w.skipped,0)=0 AND COALESCE(w.retry_at,0)<=? ORDER BY e.at ";
    const recent=this.sql.exec<Row>(query+"DESC,u.seq DESC LIMIT ?",throughSeq,Date.now(),Math.ceil(limit/2)).toArray();
    const old=this.sql.exec<Row>(query+"ASC,u.seq ASC LIMIT ?",throughSeq,Date.now(),Math.floor(limit/2)).toArray();
    // Interleave both ends so a byte budget cannot starve historical work.
    const ordered:Row[]=[];for(let i=0;i<Math.max(recent.length,old.length);i++){if(recent[i])ordered.push(recent[i]!);if(old[i])ordered.push(old[i]!)}
    return [...new Map(ordered.map(row=>[row.id,row])).values()].map(row=>({utteranceId:row.id,at:row.at,text:this.cipher.open(row.text),audioKey:row.audio_key}));
  }

  /** Embed your lines not yet embedded (bge-m3), here in the Mind, where Workers AI is reachable. Returns how many. */
  async embedNew(): Promise<number> {
    return (await this.embedThenBatch()).embedded;
  }
  private embedThenBatch(throughSeq=Number.MAX_SAFE_INTEGER,signal?:AbortSignal):Promise<{scanned:number;embedded:number}>{
    if(this.embeddingBatch)return this.embeddingBatch;
    const task=(async()=>{
      const scope=this.workScope(),deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(15_000)]):AbortSignal.timeout(15_000),candidates=await this.unembedded(32,throughSeq);this.checkWorkScope(scope);deadline.throwIfAborted();
      const owner=this.person()??this.ctx.id.name!,selected:typeof candidates=[];let bytes=0;
      this.ctx.storage.transactionSync(()=>{for(const line of candidates){const size=new TextEncoder().encode(line.text).length;if(line.text.trim().split(/\s+/).length<5||size>EMBED_TEXT_BYTES||!line.audioKey.startsWith(owner+"/voice/")){this.sql.exec("INSERT INTO embedding_work(utterance_id,skipped) VALUES (?,1) ON CONFLICT(utterance_id) DO UPDATE SET skipped=1",line.utteranceId);continue}if(bytes+size>EMBED_BATCH_BYTES)continue;bytes+=size;selected.push(line);this.sql.exec("INSERT INTO embedding_work(utterance_id,attempts,retry_at) VALUES (?,1,?) ON CONFLICT(utterance_id) DO UPDATE SET attempts=attempts+1,retry_at=?+MIN(604800000,3600000*(1 << MIN(attempts,8)))",line.utteranceId,Date.now()+3600000,Date.now())}});
      const playable:typeof selected=[];let next=0;
      await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{while(next<selected.length){deadline.throwIfAborted();const line=selected[next++]!;const object=await thenAwait(this.env.FILES.head(line.audioKey),deadline);this.checkWorkScope(scope);if(object)playable.push(line)}}));
      deadline.throwIfAborted();if(!playable.length)return {scanned:candidates.length,embedded:0};
      const vectors=await embed(this.env,playable.map(line=>line.text),deadline);this.checkWorkScope(scope);deadline.throwIfAborted();
      const rows=playable.flatMap((line,i)=>vectors[i]?[{utteranceId:line.utteranceId,at:line.at,vec:vectors[i]!}]:[]);
      return {scanned:candidates.length,embedded:await this.storeVecs(rows)};
    })();this.embeddingBatch=task;void task.finally(()=>{if(this.embeddingBatch===task)this.embeddingBatch=null}).catch(()=>{});return task;
  }
  async embedForWatch(night:string,sealed:string):Promise<{embedded:number;batches:number}>{
    if(this.embeddingRun)return this.embeddingRun.night===night?this.embeddingRun.promise:{embedded:0,batches:0};
    const scope=this.workScope(),day=openWork<WatchDay>(this.cipher,scope+":watch:"+night,sealed),controller=new AbortController();
    const promise=(async()=>{let progress=this.loadMoment<{scope:string;batches:number;embedded:number}>("then-embeddings",night)??{scope,batches:0,embedded:0};if(progress.scope!==scope)throw new Error("This embedding night belongs to an earlier Mind.");
      while(progress.batches<4){this.checkWorkScope(scope);controller.signal.throwIfAborted();progress={...progress,batches:progress.batches+1};this.saveMoment("then-embeddings",night,progress);
        try{const result=await this.embedThenBatch(day.throughSeq,controller.signal);this.checkWorkScope(scope);progress={...progress,embedded:progress.embedded+result.embedded};this.saveMoment("then-embeddings",night,progress);if(!result.scanned)break}catch{this.checkWorkScope(scope);controller.signal.throwIfAborted()}
      }
      return {embedded:progress.embedded,batches:progress.batches};
    })();const run={night,controller,promise};this.embeddingRun=run;void promise.finally(()=>{if(this.embeddingRun===run)this.embeddingRun=null}).catch(()=>{});return promise;
  }
  async storeVecs(rows: { utteranceId: string; at: number; vec: number[] }[]): Promise<number> {
    this.workScope();
    let stored=0;this.ctx.storage.transactionSync(()=>{for(const row of rows){if(!validEmbedding(row.vec))continue;const own=this.sql.exec<{at:number}>("SELECT e.at FROM utterances u JOIN events e ON e.seq=u.seq WHERE u.id=? AND u.speaker='you' AND u.audio_key IS NOT NULL",row.utteranceId).toArray()[0];if(!own||own.at!==row.at)continue;this.sql.exec("INSERT OR IGNORE INTO vecs(utterance_id,at,vec) VALUES (?,?,?)",row.utteranceId,row.at,this.cipher.seal(JSON.stringify(row.vec)));this.sql.exec("DELETE FROM embedding_work WHERE utterance_id=?",row.utteranceId);stored++}});return stored;
  }

  /** Pair one of today's lines with the same topic from long enough ago, if there is one. */
  async pairThen(gapDays = THEN_GAP_DAYS, night = new Date().toISOString().slice(0, 10),sealed?:string): Promise<{ thenId: string; nowId: string } | null> {
    const scope=this.workScope();if(!/^\d{4}-\d{2}-\d{2}$/.test(night)||new Date(night+"T00:00:00Z").toISOString().slice(0,10)!==night)throw new Error("Invalid pairing night.");
    gapDays=thenGap({RA_ENV:this.env.RA_ENV,RA_THEN_GAP_DAYS:String(gapDays)});
    const completed = this.log.since(0, Number.MAX_SAFE_INTEGER).filter((e): e is RaEvent<"then.paired"> => e.kind === "then.paired").find((e) => e.body.night === night);
    if (completed?.kind === "then.paired") return { thenId: completed.body.thenId, nowId: completed.body.nowId };
    const nightKey = `then:${night}`;
    if (this.sql.exec("SELECT 1 FROM meta WHERE key = ?", nightKey).toArray().length) return null;
    let selection=this.loadMoment<{at:number;throughSeq:number}>("then-selection",night);if(!selection){const day=sealed?openWork<WatchDay>(this.cipher,scope+":watch:"+night,sealed):null;selection={at:day?.at??(night===nightOf(Date.now(),this.tz())?Date.now():Date.parse(night+"T02:00:00Z")-this.tz()*60_000),throughSeq:day?.throughSeq??this.log.lastSeq};this.saveMoment("then-selection",night,selection)}
    const playable = new Map(this.log.since(0, Number.MAX_SAFE_INTEGER).filter((e): e is RaEvent<"utterance"> => e.kind === "utterance").filter(e=>e.seq<=selection!.throughSeq&&e.body.speaker==="you"&&!!e.body.audioKey).map(e=>[e.body.utteranceId,e.body.audioKey!]));
    const lines = this.sql
      .exec<{ utterance_id: string; at: number; vec: string }>("SELECT utterance_id, at, vec FROM vecs")
      .toArray()
      .filter((r) => playable.has(r.utterance_id))
      .flatMap(r=>{try{const vec:unknown=JSON.parse(this.cipher.open(r.vec));if(validEmbedding(vec))return [{utteranceId:r.utterance_id,at:r.at,vec}]}catch{}this.sql.exec("DELETE FROM vecs WHERE utterance_id=?",r.utterance_id);return []});
    const paired = new Set(this.views.thenAndNow.flatMap((p) => [p.thenId, p.nowId]));
    const deadline=AbortSignal.timeout(15_000),owner=this.person()??this.ctx.id.name!;let p:ReturnType<typeof pairThenAndNow>=null;
    for(let attempt=0;attempt<8;attempt++){p=pairThenAndNow(lines,selection.at,gapDays,paired);if(!p)break;const ids=[p.then.utteranceId,p.now.utteranceId],kept=await Promise.all(ids.map(async id=>{const key=playable.get(id)!;return key.startsWith(owner+"/voice/")?!!await thenAwait(this.env.FILES.head(key),deadline):false}));this.checkWorkScope(scope);if(kept.every(Boolean))break;ids.forEach((id,i)=>{if(!kept[i])paired.add(id)});p=null}
    return this.ctx.storage.transactionSync(() => {
      const existing=this.log.since(0,Number.MAX_SAFE_INTEGER).filter((e):e is RaEvent<"then.paired">=>e.kind==="then.paired").find(e=>e.body.night===night);if(existing)return {thenId:existing.body.thenId,nowId:existing.body.nowId};
      if(this.metaValue(nightKey))return null;
      if (p) this.write("then.paired", { thenId: p.then.utteranceId, nowId: p.now.utteranceId, apart: apart(p.then.at, p.now.at), night });
      this.setMeta(nightKey, "1");
      return p?{thenId:p.then.utteranceId,nowId:p.now.utteranceId}:null;
    });
  }

  async reachMarker(input: { island: string; markerId: string; evidence: string }): Promise<{ achievementId: string }> {
    const markers = await currentMarkers(this.views,input.island);
    const marker = markers.find((m) => m.markerId === input.markerId);
    if (!marker || !this.views.markers[input.island]?.markers.includes(marker.text)) throw new Error("That marker is no longer on this island.");
    const evidence = input.evidence?.trim();
    if (!evidence || evidence.length > 2000) throw new Error("Say how you know you reached this marker.");
    const existing = this.views.markerAchievements.find((a) => a.island === input.island && a.markerId === marker.markerId);
    if (existing) {
      if (existing.evidence !== evidence) throw new Error("This marker already has recorded evidence.");
      return { achievementId: existing.achievementId };
    }
    const achievementId = makeId();
    this.write("marker.reached",{ achievementId,island:input.island,markerId:marker.markerId,marker:marker.text,evidence });
    return { achievementId };
  }

  async markersFor(island: string) { return currentMarkers(this.views,island); }

  async prepareLandfall(input: { island: string; said: string; witnesses: string[] }): Promise<{ landfallId: string }> {
    if (this.views.landfalls.some((l) => l.island === input.island)) throw new Error("This island already has a landfall.");
    const markers = await arrivalMarkers(this.views,input.island);
    if (this.views.landfalls.some((l) => l.island === input.island)) throw new Error("This island already has a landfall.");
    const words = input.said.trim();
    if (words.length > 2000) throw new Error("Keep the preparation within 2000 characters.");
    const witnesses = this.views.crew.filter((c) => input.witnesses.includes(c.introId)).map((c) => ({ introId:c.introId,name:c.name }));
    const previous = this.views.arrivals.findLast((a) => a.island === input.island && JSON.stringify(a.markers) === JSON.stringify(markers) && a.said === input.said.trim() && JSON.stringify(a.witnesses) === JSON.stringify(witnesses));
    if (previous) return { landfallId:previous.landfallId };
    const landfallId = makeId();
    this.write("landfall.prepared",{ landfallId,island:input.island,markers,said:words,witnesses });
    return { landfallId };
  }

  private arrivalFor(rayId: string) {
    const id = this.views.rays[rayId]?.landfallId;
    return this.views.arrivals.find((a) => a.landfallId === id);
  }

  async confirmArrival(landfallId: string, rayId: string, said: string, witnessIds?: string[]): Promise<{ landfallId: string }> {
    const existing = this.views.landfalls.find((l) => l.landfallId === landfallId);
    if (existing) return { landfallId };
    const prepared = this.arrivalFor(rayId);
    if (!prepared || prepared.landfallId !== landfallId) throw new Error("Open your prepared landfall session first.");
    await validateArrival(this.views,prepared);
    if (this.views.liveRay !== rayId || this.views.rays[rayId]?.stage !== "arrival-confirm" || this.careHold.has(rayId) || (this.arrivalReviews.get(rayId) ?? 0) > 0) throw new Error("Finish the landfall review before confirming.");
    if (this.loadMoment<{ unresolved: boolean }>(rayId,"arrival-review")?.unresolved) throw new Error("Look again at what does not match before confirming.");
    const words = said.trim();
    if (!words || words.length > 2000) throw new Error("Say what arrival means in your own words.");
    const witnesses = this.views.crew.filter((c) => (witnessIds ?? prepared.witnesses.map((w) => w.introId)).includes(c.introId));
    this.ctx.storage.transactionSync(() => {
      if (this.views.landfalls.some((l) => l.landfallId === landfallId)) return;
      if (this.views.landfalls.some((l) => l.island === prepared.island)) throw new Error("This island already has a landfall.");
      if (JSON.stringify(this.views.markers[prepared.island]?.markers) !== JSON.stringify(prepared.markers.map((m) => m.text))) throw new Error("Your markers changed. Review the island again before landfall.");
      this.append([
        this.draft("landfall.made",{ landfallId,island:prepared.island,markers:prepared.markers.map((m) => ({ text:m.text,evidence:m.evidence })),said:words,witnesses:witnesses.map((w) => w.name),witnessIntroIds:witnesses.map((w) => w.introId) }),
        this.draft("ring.added",{ ringId:makeId(),rayId,title:"Landfall",text:words }),
        this.draft("ray.ended",{ rayId,reason:"person" }),
      ]);
    });
    // The phone's landfall session ends with it, as any Ray does.
    this.broadcast({ t: "ended" });
    this.careHold.delete(rayId);
    return { landfallId };
  }

  async pendingArrivals() {
    return this.views.landfalls.filter((l) => !this.sql.exec("SELECT 1 FROM meta WHERE key = ?","arrival-delivered:"+l.landfallId).toArray().length).slice(0,32).map((l) => ({ landfallId:l.landfallId,island:l.island,at:l.at,witnesses:l.witnessIntroIds ?? this.views.arrivals.find((a) => a.landfallId === l.landfallId)?.witnesses.map((w) => w.introId) ?? [] }));
  }
  async arrivalDelivered(id: string): Promise<void> { this.setMeta("arrival-delivered:"+id,"1"); }

  // ── voyages (Layer 4) ───────────────────────────────────────────────────
  /** K1: what a voyage is to: your star, your next island and its markers, and any voyage already open. */
  async voyageContext(): Promise<{ star: string | null; island: string | null; markers: number; markerIds: string[]; open: string | null }> {
    const scope = this.workScope(), views = this.views;
    const island = currentIsland(this.views);
    const open = this.views.voyages.find((v) => v.island === island && !this.views.landfalls.some((l) => l.island === v.island && l.at >= v.at));
    const named=island&&this.views.markers[island];
    const markerIds = named ? (await currentMarkers(this.views,island!)).map(m => m.markerId) : [];
    this.checkWorkScope(scope); if (views !== this.views) throw new Error("Voyage context changed; try again.");
    return { star: this.views.star.current, island, markers: named?named.markers.length:0, markerIds, open: open?.voyageId ?? null };
  }

  async voyageStarted(b: EventBodies["voyage.started"]): Promise<void> {
    const scope = this.workScope();
    let markerTexts = b.markerTexts;
    if (b.markerIds && !markerTexts) {
      const words = [...new Set(this.log.since(0,Number.MAX_SAFE_INTEGER).filter((e): e is RaEvent<"markers.named"> => e.kind === "markers.named").filter((e) => e.body.island === b.island).flatMap((e) => e.body.markers))];
      const lookup = new Map(await Promise.all(words.map(async (text) => [await markerRef(b.island,text),text] as const)));
      markerTexts = b.markerIds.map((id) => lookup.get(id) ?? "A marker from when this voyage began");
    }
    this.checkWorkScope(scope);
    if (!this.views.voyages.some((v) => v.voyageId === b.voyageId)) this.write("voyage.started", { ...b,...(markerTexts ? { markerTexts } : {}) });
  }

  async voyageAchievement(voyageId: string, markerIndex?: number): Promise<{ ref: string; at: number } | null> {
    this.workScope();
    const voyage = this.views.voyages.find((v) => v.voyageId === voyageId);
    if (!voyage) return null;
    const landfall = this.views.landfalls.find((l) => l.island === voyage.island && l.at >= voyage.at);
    if (markerIndex !== undefined && voyage.markerIds) {
      const id = voyage.markerIds[markerIndex];
      const achievement = this.views.markerAchievements.find((a) => a.markerId === id && a.island === voyage.island && a.at >= voyage.at);
      return achievement ? { ref:achievement.achievementId,at:achievement.at } : null;
    }
    if (!landfall) return null;
    if (markerIndex !== undefined) {
      if (!Number.isInteger(markerIndex) || markerIndex < 0 || !landfall.markers[markerIndex]?.evidence.trim()) return null;
      return { ref: landfall.landfallId + ":marker:" + markerIndex, at: landfall.at };
    }
    return { ref: landfall.landfallId, at: landfall.at };
  }

  async voyageClaimed(voyageId: string, kind: "marker" | "landfall", milestone?: string, markerIndex?: number): Promise<void> {
    this.workScope();
    const voyage = this.views.voyages.find(v => v.voyageId === voyageId);
    if (!voyage) throw new Error("No such voyage");
    if (!voyage.claims.some((c) => milestone ? c.milestone === milestone : c.kind === kind)) this.write("voyage.claimed", { voyageId, kind, ...(milestone ? { milestone } : {}), ...(markerIndex !== undefined ? { markerIndex } : {}) });
  }

  async pledged(amountCents: number, currency: string, pledgeId?: string): Promise<void> {
    this.workScope();
    const existing = pledgeId && this.views.pledges.find(p => p.pledgeId === pledgeId);
    if (existing && (existing.amountCents !== amountCents || existing.currency !== currency)) throw new Error("Pledge terms conflict");
    if (!pledgeId || !this.views.pledges.some((p) => p.pledgeId === pledgeId)) this.write("pledge.made", { amountCents, currency, ...(pledgeId ? { pledgeId } : {}) });
  }

  // ── the Ear ─────────────────────────────────────────────────────────────
  async earProjection(p:EarProjection):Promise<void>{
    this.ctx.storage.transactionSync(()=>{
      if(this.metaValue("people-erased")||!Number.isSafeInteger(p.revision)||p.revision<=Number(this.metaValue("ear-revision")??0))return;
      if(p.generation){if(!this.views.ear.linked||this.views.ear.discreet!==p.discreet||this.metaValue("ear-generation")!==p.generation)this.write("ear.linked",{discreet:p.discreet})}
      else if(this.views.ear.linked)this.write("ear.unlinked",{});
      this.setMeta("ear-generation",p.generation??"");this.setMeta("ear-revision",String(p.revision));
    });
  }
  async fileEar(input:EarFile):Promise<Omit<EarReceipt,"fingerprint">>{
    this.workScope();
    this.earFiles??=new EarFiles({scope:()=>this.workScope(),generation:()=>this.views.ear.linked?this.metaValue("ear-generation"):null,owner:()=>this.person()??this.ctx.id.name!,trip:()=>Object.values(this.views.trips).filter(trip=>trip.state==="chosen").at(-1)?.tripId??null,
      load:id=>this.loadMoment<EarReceipt>("ear-receipts",id),commit:(events,id,receipt)=>{this.append(events,()=>this.saveMoment("ear-receipts",id,receipt))},
      put:(key,bytes,type)=>this.env.FILES.put(key,this.cipher.sealBytes(bytes),{customMetadata:{type,sealed:"1"}}),remove:key=>this.env.FILES.delete(key)});
    return this.earFiles.file(input);
  }

  /** Dev: run the Watch now instead of at 2 AM. */
  async watchNow(): Promise<void> {
    await this.startWatch();
  }

  /** The hour where the person is, from the offset their phone sends with every Ray. */
  private localHour(): number {
    return new Date(Date.now() + this.tz() * 60_000).getUTCHours();
  }

  private tz(): number {
    return Number(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'tz'").toArray()[0]?.value ?? 0);
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  /** The script for this Ray. A star written during the Ray doesn't reshuffle its stages. */
  private script(rayId: string): StageDef[] {
    const ray = this.views.rays[rayId]!;
    const starBefore = this.views.star.history.some((h) => h.at < ray.startedAt);
    return scriptFor(ray.session, { hasStar: starBefore });
  }

  private stageOf(rayId: string): StageDef | undefined {
    const ray = this.views.rays[rayId];
    return ray ? this.script(rayId).find((s) => s.name === ray.stage) : undefined;
  }

  /** Moments finished early, waiting to move on once the stage being entered is open. */
  private readonly early = new Set<string>();

  /**
   * Move to the stage the sun has reached, or the next one when a moment is
   * done early; never back. A paused Ray, or care, holds the arc.
   */
  private async advance(rayId: string, early = false): Promise<void> {
    if (this.entering) {
      if (early) this.early.add(rayId);
      return this.entering;
    }
    const ray = this.views.rays[rayId];
    if (!ray || ray.endedAt !== null || ray.pausedAt !== null || this.careHold.has(rayId)) return;
    const script = this.script(rayId);
    const sink = sunSink(ray, Date.now());
    if (ray.session !== "landfall"&&ray.session!=="markers") this.maybeDesignTrips(rayId, sink);
    const cur = Math.max(0, script.findIndex((s) => s.name === ray.stage));
    if (ray.session === "landfall" && !early) return;
    const target = ray.session === "landfall" ? Math.min(script.length - 1,cur + 1) : Math.min(script.length - 1, Math.max(early ? cur + 1 : cur, stageIndexAt(script, sink)));
    if (target === cur) return;
    this.entering = this.enterStage(rayId, script[target]!, sink).finally(() => {
      this.entering = null;
    });
    await this.entering;
    if (this.early.delete(rayId)) await this.advance(rayId, true);
  }

  private completeMoment(rayId: string): Promise<void> {
    return this.advance(rayId, true);
  }

  private async enterStage(rayId: string, def: StageDef, sink: number): Promise<void> {
    this.write("ray.stage", { rayId, stage: def.name, sink });
    this.broadcast({ t: "stage", name: def.name, sink });
    trace({ at: "stage", stage: def.name, sink: round(sink) });
    const script = this.script(rayId);
    if (script[script.findIndex((s) => s.name === def.name) + 1]?.kind === "question") this.draftQuestionEarly(rayId);
    try {
      switch (def.kind) {
        case "talk": {
          if (this.views.rays[rayId]?.session === "landfall") { void this.say(rayId,def.name === "arrival-witness" ? "Would you like any of your crew to witness this landfall? It is your choice." : OPENINGS.arrival!); return; }
          // A Reading or season part says what was prepared for it; an empty part is skipped.
          if (!this.rhythmic(rayId)) return;
          const line = this.partFor(rayId, def.name);
          if (line === null) this.early.add(rayId);
          else void this.say(rayId, line);
          return;
        }
        case "landfall": {
          void this.say(rayId,"Does the evidence match how you see yourself now? Only you can say whether you have arrived.");
          return;
        }
        case "close": {
          void this.sayThenEnd(rayId, this.partFor(rayId, def.name) ?? ringClosingFor(this.views.person?.name, this.localHour()));
          return;
        }
        case "mirror":
          return this.openMirror(rayId);
        case "window":
          return await this.openWindow(rayId);
        case "question":
          return await this.openQuestion(rayId);
        case "trips":
          return this.openTrips(rayId);
        case "star":
          return this.openStar(rayId);
        case "ring":
          return this.closeWithRing(rayId);
      }
    } catch (e) {
      // A moment that can't open is skipped; the Ray goes on.
      trace({ at: "stage", stage: def.name, error: e instanceof Error ? e.message : String(e) });
      this.early.add(rayId);
    }
  }

  /** B5: the person's own phrases from where their voice lifted. */
  private openMirror(rayId: string): void {
    const quotes = mirrorQuotes(this.youLines(rayId), 5, this.raLines(rayId));
    if (quotes.length < 2) {
      this.early.add(rayId);
      return;
    }
    const items = quotes.map((q) => ({ mirrorId: makeId(), text: q.text, utteranceId: q.utteranceId }));
    this.append(items.map((i) => this.draft("mirror.offered", { mirrorId: i.mirrorId, rayId, text: i.text, quotes: [i.utteranceId] })));
    this.broadcast({ t: "mirror", items: items.map(({ mirrorId, text }) => ({ mirrorId, text })) });
    void this.say(rayId, MOMENT_LINES.mirror);
  }

  /** B6: one signal from where they stand, with its sources. */
  private async openWindow(rayId: string): Promise<void> {
    const pick = await chooseWindow(this.decide.choose, FIELDS, (id) => this.signalsFor(id), this.yours(rayId));
    if (!pick) {
      void this.say(rayId, MOMENT_LINES.noWindow);
      this.early.add(rayId);
      return;
    }
    this.write("window.shown", { rayId, signals: [pick.signal.id] });
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('field', ?)", pick.field.id);
    this.saveMoment(rayId, "window", pick.signal);
    this.broadcast({ t: "window", signal: pick.signal });
    void this.say(rayId, MOMENT_LINES.window);
  }

  /** B7: the question they came with, and the one they leave with. */
  private async openQuestion(rayId: string): Promise<void> {
    const scope=this.workScope(),controller=new AbortController();this.foreground.get(rayId)?.abort();this.foreground.set(rayId,controller);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)]);
    try{
      const {muse}=await this.getProviders();signal.throwIfAborted();this.checkWorkScope(scope);
      // Usually drafted while the stage before ran; a draft that failed or never started is written now.
      const early=this.questionDrafts.get(rayId);this.questionDrafts.delete(rayId);
      const ready=early?await Promise.race([early.catch(()=>null),new Promise<never>((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}))]):null;
      signal.throwIfAborted();this.checkWorkScope(scope);
      diag("question",{early:!!early,ready:!!ready});
      const q=ready??await draftQuestion(muse,this.rayTurns(rayId),signal);signal.throwIfAborted();this.checkWorkScope(scope);
      if(this.views.liveRay!==rayId||this.views.rays[rayId]?.stage!=="question"||this.careHold.has(rayId))return;
      if(!q){this.early.add(rayId);return}
      this.saveMoment(rayId,"question",q);this.broadcast({t:"question",...q,kept:false});void this.say(rayId,MOMENT_LINES.question);
    }catch(error){if(!signal.aborted)throw error}
    finally{if(this.foreground.get(rayId)===controller)this.foreground.delete(rayId)}
  }

  /** B7, drafted while the stage before the question runs, so it's on screen as its stage opens. */
  private readonly questionDrafts = new Map<string, Promise<{ asked: string; leavingWith: string } | null>>();

  private draftQuestionEarly(rayId: string): void {
    if (this.questionDrafts.has(rayId)) return;
    const draft = (async () => {
      const { muse } = await this.getProviders();
      return draftQuestion(muse, this.rayTurns(rayId), AbortSignal.timeout(30_000));
    })();
    draft.catch(() => {});
    this.questionDrafts.set(rayId, draft);
  }

  private async keepQuestion(rayId: string, leavingWith: string): Promise<void> {
    const q = this.loadMoment<{ asked: string; leavingWith: string }>(rayId, "question");
    if (!q || !leavingWith.trim()) return;
    this.write("question.kept", { rayId, asked: q.asked, leavingWith: leavingWith.trim() });
    this.broadcast({ t: "question", asked: q.asked, leavingWith: leavingWith.trim(), kept: true });
    this.dropMoment(rayId, "question");
    if (this.stageOf(rayId)?.kind === "question") await this.completeMoment(rayId);
  }

  /** B8: three trips, designed in the background since the Ray passed ~35%. */
  private openTrips(rayId: string): void {
    const trips = this.tripsFor(rayId);
    if (trips.length === 0) {
      // Late: the Watch finishes them, and they appear on Today. A promise, so it's kept.
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')", `tripsOwed:${rayId}`);
      void this.say(rayId, MOMENT_LINES.tripsLate);
      this.early.add(rayId);
      return;
    }
    this.broadcast({ t: "trips", trips, chosen: this.chosenTrip(rayId) });
    void this.say(rayId, MOMENT_LINES.trips);
  }

  private async onTrip(rayId: string, tripId: string, change: boolean): Promise<void> {
    if (change) {
      if(this.views.trips[tripId]?.rayId!==rayId)return;
      const scope=this.workScope(),controller=new AbortController();this.foreground.get(rayId)?.abort();this.foreground.set(rayId,controller);
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60_000)]);
      try{
      // B9 "Change it": Ra redraws that one trip.
      const hidden = this.loadMoment<string[]>(rayId, "trips-hidden") ?? [];
      this.saveMoment(rayId, "trips-hidden", [...hidden, tripId]);
      const { muse } = await this.getProviders();
      signal.throwIfAborted();this.checkWorkScope(scope);
      const [fresh] = await designTrips(muse, this.decide.ask, await this.tripContext(rayId), 1,signal);
      signal.throwIfAborted();this.checkWorkScope(scope);if(this.views.liveRay!==rayId||this.careHold.has(rayId))return;
      if (fresh) await this.offerTrips(rayId, [fresh]);
      this.broadcast({ t: "trips", trips: this.tripsFor(rayId), chosen: this.chosenTrip(rayId) });
      }catch(error){if(!signal.aborted)throw error}
      finally{if(this.foreground.get(rayId)===controller)this.foreground.delete(rayId)}
      return;
    }
    if (!this.views.trips[tripId]) return;
    this.write("trip.chosen", { tripId });
    this.broadcast({ t: "trips", trips: this.tripsFor(rayId), chosen: tripId });
    if (this.stageOf(rayId)?.kind === "trips") await this.completeMoment(rayId);
  }

  /** Start designing trips once the Ray is about a third done, so they're ready by the trips stage. */
  private maybeDesignTrips(rayId: string, sink: number): void {
    if (sink < 0.35 || this.loadMoment(rayId, "trip-design") || this.tripsFor(rayId).length > 0) return;
    const person = this.person();
    if (!person) return;
    this.saveMoment(rayId, "trip-design", { at: Date.now() });
    this.ctx.waitUntil(
      this.env.TRIP_DESIGN.create({ params: { person, rayId } }).then(
        (w) => trace({ at: "trips", workflow: w.id }),
        (e: unknown) => trace({ at: "trips", error: e instanceof Error ? e.message : String(e) }),
      ),
    );
  }

  /** D2: phrases that were really theirs, to help them write their star. */
  private openStar(rayId: string): void {
    this.broadcast({ t: "star", candidates: this.starCandidates(), written: this.views.star.current });
    void this.say(rayId, this.views.rays[rayId]?.session === "season" ? MOMENT_LINES.starMoved : MOMENT_LINES.star);
  }

  private starCandidates(): string[] {
    return Object.values(this.views.mirrors)
      .filter((m) => m.state === "kept")
      .map((m) => m.text)
      .slice(-5);
  }

  /** D2: "That's my star" keeps it, in their words; "Not yet" (J5) is a normal path. */
  private async answerStar(rayId: string, text: string | null): Promise<void> {
    const star = text?.trim();
    if (star) {
      this.write(this.views.star.current ? "star.revised" : "star.written", { text: star });
      this.broadcast({ t: "star", candidates: [], written: star, proposed: null });
      void this.say(rayId, "It's yours. Change it whenever it stops being true.");
    } else {
      void this.say(rayId, "That's fine. Your curiosity is the compass.");
    }
    if (this.stageOf(rayId)?.kind === "star") await this.completeMoment(rayId);
  }

  /** B10: the sun is down. A ring in their own words, Ra's goodnight, and the Ray ends. */
  /** F1 / K2: a Reading or season review, rather than a Ray. */
  private rhythmic(rayId: string): boolean {
    const s = this.views.rays[rayId]?.session;
    return s === "reading" || s === "season";
  }

  private partFor(rayId: string, stage: StageName): string | null {
    return partLine(
      stage,
      this.views.readings.find((r) => r.rayId === rayId) ?? null,
      this.views.seasons.find((s) => s.rayId === rayId) ?? null,
    );
  }

  /**
   * A Ray that ends before sunset (End, or a phone that never came back)
   * still keeps what it can, so the rest of the app has something to show:
   * a ring in their own words, the trips it owes (the Watch finishes them
   * tonight, and they wait on Today), and the field their story is closest to
   * (the Chart's horizon). A Ray where nothing was said just ends.
   */
  private finishEarly(rayId: string, reason: "person" | "dropped", tell: boolean): void {
    const ray = this.views.rays[rayId];
    if (!ray || ray.endedAt !== null || this.views.liveRay !== rayId) return;
    this.sql.exec("DELETE FROM schedule WHERE name = ?", `rejoin:${rayId}`);
    const lines = this.youLines(rayId);
    if ((ray.session === "first" || ray.session === "ray") && lines.length > 0) {
      if (!this.views.rings.some((r) => r.rayId === rayId)) {
        const mine = Object.values(this.views.mirrors).filter((m) => m.rayId === rayId);
        const text = ringLine(
          mine.filter((m) => m.state === "kept").map((m) => m.text),
          [...mine.filter((m) => m.state === "offered").map((m) => m.text), ...mirrorQuotes(lines, 1, this.raLines(rayId)).map((q) => q.text)],
          lines.at(-1)?.text,
        );
        const ringId = makeId();
        const title = ray.session === "first" ? "Your first ring" : "A ring";
        this.write("ring.added", { ringId, rayId, title, text });
        if (tell) this.broadcast({ t: "ring", ringId, title, text, closing: ringClosingFor(this.views.person?.name, this.localHour()) });
      }
      if (this.tripsFor(rayId).length === 0) {
        this.setMeta(`tripsOwed:${rayId}`, "1");
        // Ended before trips were started: design them now, not at 2 AM. A Ray that already started them leaves that run be.
        this.maybeDesignTrips(rayId, 1);
      }
      if (!this.metaValue("field")) {
        this.ctx.waitUntil(
          chooseWindow(this.decide.choose, FIELDS, (id) => this.signalsFor(id), lines.map((l) => l.text))
            .then((pick) => { if (pick && !this.metaValue("field")) this.setMeta("field", pick.field.id); })
            .catch((e: unknown) => trace({ at: "field", error: e instanceof Error ? e.message : String(e) })),
        );
      }
    }
    this.write("ray.ended", { rayId, reason });
    trace({ at: "ended", reason, early: true, said: lines.length });
    if (tell) this.broadcast({ t: "ended" });
  }

  private closeWithRing(rayId: string): void {
    const ray = this.views.rays[rayId]!;
    const mine = Object.values(this.views.mirrors).filter((m) => m.rayId === rayId);
    const season = ray.session === "season" ? this.views.seasons.find((s) => s.rayId === rayId) : undefined;
    // K2: the season's ring is what the season was, from the record.
    const text = season
      ? season.ring
      : ringLine(
          mine.filter((m) => m.state === "kept").map((m) => m.text),
          mine.filter((m) => m.state === "offered").map((m) => m.text),
          this.yours(rayId).at(-1),
        );
    const ringId = makeId();
    const title = season ? `Season · ${season.label}` : ray.session === "first" ? "Your first ring" : "A ring";
    this.write("ring.added", { ringId, rayId, title, text });
    this.broadcast({ t: "ring", ringId, title, text, closing: ringClosingFor(this.views.person?.name, this.localHour()) });
    void this.sayThenEnd(rayId, ringClosingFor(this.views.person?.name, this.localHour()));
  }

  /**
   * The closing line, then the Ray ends, whatever the voice does: a line that fails or hangs
   * used to leave the Ray live at sunset, with "Continue your Ray" on Today forever.
   */
  /**
   * A session that can't open says why and closes with REFUSED, so the phone stops rejoining
   * (it used to look like listening while the Mind dropped every word, or retried forever).
   */
  private refuse(ws: WebSocket, message: string): void {
    this.send(ws, { t: "error", message });
    try {
      ws.close(REFUSED, message.slice(0, 120));
    } catch {
      // already closed
    }
  }

  private async sayThenEnd(rayId: string, line: string): Promise<void> {
    try {
      await Promise.race([this.say(rayId, line), new Promise((resolve) => setTimeout(resolve, CLOSING_MS))]);
    } catch {
      // The ring is already kept; the goodnight is a courtesy.
    } finally {
      if (this.views.liveRay === rayId) {
        this.write("ray.ended", { rayId, reason: "sunset" });
        this.broadcast({ t: "ended" });
      }
      this.careHold.delete(rayId);
    }
  }

  /**
   * After each thought: let the sun move first; then the words go to the
   * talk, or to the moment on screen. Hurt always comes first: if they're
   * hurting, Ra answers with care whatever the stage.
   */
  private readonly arrivalReviews = new Map<string,number>();

  private async afterYouSpoke(ws: WebSocket, rayId: string, text: string,utteranceId:string): Promise<void> {
    const gate=this.speechGates.get(ws);const current=()=>this.speechGates.get(ws)===gate&&this.views.liveRay===rayId&&this.views.rays[rayId]?.endedAt===null;
    if(this.views.liveRay!==rayId||this.views.rays[rayId]?.endedAt!==null||this.views.rays[rayId]?.pausedAt!==null)return;
    if (this.views.rays[rayId]?.session === "landfall") {
      this.arrivalReviews.set(rayId,(this.arrivalReviews.get(rayId) ?? 0)+1);
      try {
        const hurt = await this.checker.hurting(text,this.yours(rayId).slice(-9,-1));
        if(!current())return;
        if (hurt.hurting) {
          const was = this.careHold.has(rayId);
          this.careHold.add(rayId, text);
          this.saveMoment(rayId,"arrival-review",{ unresolved:true });
          this.broadcast({ t:"landfall.review",unresolved:true });
          // J4: the phone shows who they can reach, here as in any Ray.
          if (!was) this.broadcast({ t: "care", on: true, said: text });
        }
        else {const mismatch=await this.decide.ask(text,"Does this person explicitly say that they have not arrived, are not ready, or that their evidence does not match a marker? Do not infer this from ordinary uncertainty.");if(!current())return;if(mismatch>=.6){
          this.saveMoment(rayId,"arrival-review",{ unresolved:true });
          this.broadcast({ t:"landfall.review",unresolved:true });
          await this.say(rayId,"What does not match between the evidence and how you see it now?");
          return;
        }}
      } catch {
        if(!current())return;
        this.saveMoment(rayId,"arrival-review",{ unresolved:true });
        this.broadcast({ t:"landfall.review",unresolved:true });
        this.send(ws,{ t:"error",message:"The spoken review was interrupted. Look again together before confirming arrival." });
        return;
      } finally { this.arrivalReviews.set(rayId,Math.max(0,(this.arrivalReviews.get(rayId) ?? 1)-1)); }
    }
    const before = this.views.rays[rayId]?.stage;
    await this.advance(rayId);
    if(!current())return;
    if(this.views.liveRay!==rayId||this.views.rays[rayId]?.endedAt!==null||this.views.rays[rayId]?.pausedAt!==null)return;
    diag("afterYouSpoke",{current:current(),stageChanged:this.views.rays[rayId]?.stage!==before,kind:this.stageOf(rayId)?.kind??null,paused:this.views.rays[rayId]?.pausedAt!==null});
    if (this.views.rays[rayId]?.stage !== before) return; // a new moment opened; Ra speaks that
    const def = this.stageOf(rayId);
    const talk = !def || def.kind === "talk" || def.kind === "window" || def.kind === "ring" || def.kind === "close" || def.kind === "landfall";
    if (!talk) {
      // The care check and the moment's reading run side by side; a moment is only answered once hurt is ruled out.
      const yours = this.yours(rayId);
      const [hurt, step] = await Promise.all([
        this.checker.hurting(text, yours.slice(-9, -1)),
        this.readMoment(rayId, def, text).catch(() => null),
      ]);
      if(!current())return;
      diag("moment",{kind:def.kind,hurting:hurt.hurting,answered:step!==null});
      if (!hurt.hurting && step) return step();
      // Not an answer to the moment (a question, a "no", a thought): Ra replies in the moment's own instructions.
    }
    if (def?.kind === "ring") return;
    const turns=await this.ensureTurns(ws,rayId);if(current())await turns.youDone({id:utteranceId,text,basis:this.contextVersion});
  }

  /** What their words do to the moment on screen, as the step to take; null when they aren't an answer to it. */
  private async readMoment(rayId: string, def: StageDef, text: string): Promise<(() => Promise<void>) | null> {
    switch (def.kind) {
      case "mirror": {
        const open = Object.values(this.views.mirrors).filter((m) => m.rayId === rayId && m.state === "offered");
        const id = await chosenQuote(this.decide.choose, text, open);
        trace({ at: "moment", stage: "mirror", said: text, kept: id });
        if (!id) return null;
        return () => {
          this.write("mirror.kept", { mirrorId: id });
          this.broadcast({ t: "mirror.state", mirrorId: id, state: "kept" });
          return this.completeMoment(rayId);
        };
      }
      case "question": {
        const q = this.loadMoment<{ asked: string; leavingWith: string }>(rayId, "question");
        if (!q) return null;
        const leaving = await keptQuestion(this.decide.choose, q.leavingWith, text);
        trace({ at: "moment", stage: "question", said: text, kept: leaving });
        return leaving ? () => this.keepQuestion(rayId, leaving) : null;
      }
      case "trips": {
        const pick = await tripReply(this.decide.choose, this.decide.ask, text, this.tripsFor(rayId));
        trace({ at: "moment", stage: "trips", said: text, pick });
        return pick ? () => this.onTrip(rayId, pick.tripId, pick.change) : null;
      }
      case "star": {
        const read = await spokenStar(this.decide.choose, text);
        trace({ at: "moment", stage: "star", said: text, star: read });
        if (read === "not-yet") return () => this.answerStar(rayId, null);
        // What they said is offered back; it becomes their star only when they say "that's my star".
        if (read) return async () => {
          this.saveMoment(rayId, "star-proposed", read.star);
          this.broadcast({ t: "star", candidates: this.starCandidates(), written: this.views.star.current, proposed: read.star });
        };
        return null;
      }
      default:
        return null;
    }
  }

  /** Put the moment on screen again for a phone that rejoins mid-Ray. */
  /** The trip they went on since the last Ray, in their words: what Ray two asks about (D1). */
  private carriedTrip(): string | null {
    const trip = Object.values(this.views.trips).filter((t) => t.state !== "offered").sort((a, b) => (a.chosenAt ?? 0) - (b.chosenAt ?? 0)).at(-1);
    return trip ? (trip.title ?? trip.action) : null;
  }

  private resendMoment(ws: WebSocket, rayId: string): void {
    if (this.views.rays[rayId]?.session === "landfall") this.send(ws,{ t:"landfall.review",unresolved:this.loadMoment<{ unresolved:boolean }>(rayId,"arrival-review")?.unresolved ?? false });
    const def = this.stageOf(rayId);
    if (!def) return;
    if (def.kind === "mirror") {
      const items = Object.values(this.views.mirrors).filter((m) => m.rayId === rayId);
      this.send(ws, { t: "mirror", items: items.map((m) => ({ mirrorId: m.mirrorId, text: m.text })) });
      for (const m of items) if (m.state !== "offered") this.send(ws, { t: "mirror.state", mirrorId: m.mirrorId, state: m.state });
    } else if (def.kind === "window") {
      const card = this.loadMoment<SignalCard>(rayId, "window");
      if (card) this.send(ws, { t: "window", signal: card });
    } else if (def.kind === "question") {
      const q = this.loadMoment<{ asked: string; leavingWith: string }>(rayId, "question");
      if (q) this.send(ws, { t: "question", ...q, kept: false });
    } else if (def.kind === "trips") {
      this.send(ws, { t: "trips", trips: this.tripsFor(rayId), chosen: this.chosenTrip(rayId) });
    } else if (def.kind === "star") {
      // The star they just said comes back with it, waiting for "that's my star".
      const proposed = this.views.star.current ? null : this.loadMoment<string>(rayId, "star-proposed");
      this.send(ws, { t: "star", candidates: this.starCandidates(), written: this.views.star.current, ...(proposed ? { proposed } : {}) });
    } else if (def.kind === "ring") {
      const ring = this.views.rings.findLast((r) => r.rayId === rayId);
      if (ring) this.send(ws, { t: "ring", ringId: ring.ringId, title: ring.title, text: ring.text, closing: ringClosingFor(this.views.person?.name, this.localHour()) });
    }
  }

  /** Whole transcripts only. Bounded display never silently shortens a marker or commits one. */
  private sendMarkers(ws:WebSocket,rayId:string):void {
    const markers=this.views.rays[rayId]?.markers;if(!markers)return;
    const lines=this.youLines(rayId),selected:typeof lines=[];let bytes=0;
    for(const line of [...lines].reverse()){const size=new TextEncoder().encode(line.text).length;if(selected.length>=24||bytes+size>24_000)break;selected.unshift(line);bytes+=size}
    this.send(ws,{t:"markers",island:markers.island,base:markers.base,statements:selected.map(line=>({id:line.utteranceId,text:line.text})),omitted:lines.length-selected.length});
  }

  // ── Workflow RPC ────────────────────────────────────────────────────────
  /**
   * NightWatch reads the day: everything said since the last Watch, Ra's
   * lines with what they answered (for the audit), Rays that ended without
   * trips, and what Ra already believes.
   */
  async recordAudit(night: string, index: number, value: { said: string; line: string; broke: string[] }): Promise<void> {
    this.sql.exec("INSERT OR IGNORE INTO audit_cases (id, body) VALUES (?, ?)", `${night}:${index}`, this.cipher.seal(JSON.stringify(value)));
  }

  private watchContext(): WatchDay {
    const from = Number(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'watchedTo'").toArray()[0]?.value ?? 0);
    const rows = this.sql
      .exec<{ id: string; speaker: string; text: string; ray_id: string | null }>(
        "SELECT id, speaker, text, ray_id FROM utterances WHERE seq > ? ORDER BY seq",
        from,
      )
      .toArray()
      .map((r) => ({ ...r, text: this.cipher.open(r.text) }));
    const exchanges: { said: string; line: string }[] = [];
    rows.forEach((r, i) => {
      const before = rows.slice(0, i).reverse().find((p) => p.speaker === "you" && p.ray_id === r.ray_id);
      if (r.speaker === "ra" && before) exchanges.push({ said: before.text, line: r.text });
    });
    // Only trips Ra promised ("I'll have your trips by tonight") and hasn't offered since.
    const owed = this.sql
      .exec<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'tripsOwed:%'")
      .toArray()
      .map((r) => r.key.slice("tripsOwed:".length));
    return {
      throughSeq:this.log.lastSeq,
      at:Date.now(),
      said: rows.filter((r) => r.speaker === "you").map((r) => ({ utteranceId: r.id, text: r.text })),
      exchanges,
      raysWithoutTrips: owed.filter((id) => !Object.values(this.views.trips).some((t) => t.rayId === id)),
      memories: Object.values(this.views.memories).map((m) => m.claim),
      tz: this.tz(),
    };
  }

  async watchSnapshot(night:string):Promise<{sealed:string;tz:number;saidCount:number;raysWithoutTrips:string[]}|null> {
    const scope=this.workScope();if(!/^\d{4}-\d{2}-\d{2}$/.test(night))throw new Error("Invalid Watch night.");
    if(this.metaValue("watch-complete:"+night))return null;
    const key="watch-snapshot:"+night;let sealed=this.metaValue(key);
    if(!sealed){sealed=sealWork(this.cipher,scope+":watch:"+night,this.watchContext());this.setMeta(key,sealed)}
    const day=openWork<WatchDay>(this.cipher,scope+":watch:"+night,sealed);
    return {sealed,tz:day.tz,saidCount:day.said.length,raysWithoutTrips:day.raysWithoutTrips};
  }
  async auditWatch(night:string,sealed:string):Promise<{checked:number;slipped:number;at:number}> {
    const scope=this.workScope(),day=openWork<WatchDay>(this.cipher,scope+":watch:"+night,sealed);let slipped=0;
    for(const [index,exchange] of day.exchanges.entries()) {
      const verdict=await this.checker.check(exchange.said,exchange.line,false);this.checkWorkScope(scope);
      if(!verdict.pass){await this.recordAudit(night,index,{...exchange,broke:verdict.broke});slipped++}
    }
    return {checked:day.exchanges.length,slipped,at:Date.now()};
  }
  async inferWatch(night:string,snapshot:string):Promise<{sealed:string;count:number;at:number}> {
    const scope=this.workScope(),purpose=scope+":memories:"+night;const cached=this.metaValue("watch-memories:"+night);
    if(cached){const value=openWork<{list:Memory[];at:number}>(this.cipher,purpose,cached);return {sealed:cached,count:value.list.length,at:value.at}}
    const day=openWork<WatchDay>(this.cipher,scope+":watch:"+night,snapshot);
    const {muse}=await this.getProviders();this.checkWorkScope(scope);
    const inferred=await inferMemories(muse,day.said,day.memories);this.checkWorkScope(scope);
    const verdicts=await Promise.all(inferred.map(memory=>this.checker.memory(memory.claim)));this.checkWorkScope(scope);
    const list=inferred.filter((_,i)=>verdicts[i]!.pass),at=Date.now(),sealed=sealWork(this.cipher,purpose,{list,at});
    // Concurrent workflows use the first finished batch, so retries retain stable memory identities.
    const previous=this.metaValue("watch-memories:"+night);if(previous){const saved=openWork<{list:Memory[];at:number}>(this.cipher,purpose,previous);return {sealed:previous,count:saved.list.length,at:saved.at}}
    this.setMeta("watch-memories:"+night,sealed);return {sealed,count:list.length,at};
  }
  async recordWatchSealed(input:{night:string;snapshot:string;memories:string;lines:string[];todayLine?:string}):Promise<void> {
    const scope=this.workScope();if(this.metaValue("watch-complete:"+input.night))return;
    const day=openWork<WatchDay>(this.cipher,scope+":watch:"+input.night,input.snapshot);
    const {list}=openWork<{list:Memory[]}>(this.cipher,scope+":memories:"+input.night,input.memories);
    const drafts: EventDraft[] = list.map((m) => this.draft("memory.inferred", m));
    drafts.push(this.draft("watch.night_log", { night: input.night, lines: input.lines }));
    if (input.todayLine) drafts.push(this.draft("today.line", { text: input.todayLine, source: "watch" }));
    else {
      // Dawn: something new for the morning, from the path itself (never a Ray prompt for its own sake).
      const step = nextFor(this.views, Date.now()).find((s) => s.kind !== "ray" && s.kind !== "ray.continue");
      const last = this.views.today.at(-1)?.text;
      if (step && step.title !== last) drafts.push(this.draft("today.line", { text: step.title, source: "dawn" }));
    }
    this.append(drafts,()=>{
      this.setMeta("watchedTo",String(Math.max(Number(this.metaValue("watchedTo")??0),day.throughSeq)));
      this.setMeta("watch-complete:"+input.night,"1");
      this.sql.exec("DELETE FROM meta WHERE key IN (?, ?)","watch-snapshot:"+input.night,"watch-memories:"+input.night);
    });
  }

  async designTripsSealed(rayId:string):Promise<string> {
    const scope=this.workScope();const context=await this.tripContext(rayId);
    const {muse}=await this.getProviders();this.checkWorkScope(scope);
    const trips=await designTrips(muse,this.decide.ask,context);
    this.checkWorkScope(scope);return sealWork(this.cipher,scope+":trips:"+rayId,trips);
  }
  async offerTripsSealed(rayId:string,sealed:string):Promise<number> {
    const scope=this.workScope();const trips=openWork<TripCard[]>(this.cipher,scope+":trips:"+rayId,sealed);
    if(Object.values(this.views.trips).some(trip=>trip.rayId===rayId))return 0;
    return this.offerTrips(rayId,trips);
  }
  async finishWatchTrips(rayId:string):Promise<{n:number;at:number}> {
    const sealed=await this.designTripsSealed(rayId);return {n:await this.offerTripsSealed(rayId,sealed),at:Date.now()};
  }

  /** TripDesign reads the Ray: what they said, what they kept, and their horizon. */
  async tripContext(rayId: string): Promise<TripContext> {
    const yours = this.yours(rayId);
    const kept = Object.values(this.views.mirrors)
      .filter((m) => m.state === "kept")
      .map((m) => m.text);
    const window = this.loadMoment<SignalCard>(rayId, "window");
    let signals: SignalCard[] = [];
    const pick = window ? null : await chooseWindow(this.decide.choose, FIELDS, (id) => this.signalsFor(id), yours).catch(() => null);
    const fieldId = window ? window.id.split("/")[0] : pick?.field.id;
    if (fieldId) {
      signals = await this.signalsFor(fieldId);
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('field', ?)", fieldId);
    }
    const island=currentIsland(this.views);
    return { yours, kept, signals,star:this.views.star.current,...(island&&this.views.islands[island]?.proposal?{circumstances:this.views.islands[island]!.proposal!.circumstances}:{}) };
  }

  /** TripDesign hands back its trips; if the Ray is already at its trips, they appear at once. */
  async offerTrips(rayId: string, trips: TripCard[]): Promise<number> {
    if (trips.length === 0) return 0;
    this.sql.exec("DELETE FROM meta WHERE key = ?", `tripsOwed:${rayId}`);
    this.append(
      trips.map((t) =>
        this.draft("trip.offered", {
          tripId: t.tripId,
          rayId,
          title: t.title,
          purpose: t.tests,
          action: t.action,
          cost: t.cost,
          evidence: t.bringBack,
          whyNow: t.whyNow,
          sources: t.sources,
        }),
      ),
    );
    if (this.views.liveRay === rayId && this.stageOf(rayId)?.kind === "trips") {
      this.broadcast({ t: "trips", trips: this.tripsFor(rayId), chosen: this.chosenTrip(rayId) });
    }
    return trips.length;
  }

  // ── director helpers ────────────────────────────────────────────────────
  private async say(rayId: string, text: string): Promise<void> {
    const ws = this.ctx.getWebSockets().find((w) => this.socketState(w).rayId === rayId);
    if (!ws) return;
    await (await this.ensureTurns(ws, rayId)).say(text);
  }

  private broadcast(msg: MindMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  private yours(rayId: string): string[] {
    return this.youLines(rayId).map((l) => l.text);
  }

  /** What the person said in this Ray. A line that is Ra's own voice, heard back by the mic, is not theirs. */
  private youLines(rayId: string): { utteranceId: string; text: string; prosody: Prosody | null }[] {
    const said = this.sql
      .exec<{ id: string; text: string; prosody: string | null }>(
        "SELECT id, text, prosody FROM utterances WHERE ray_id = ? AND speaker = 'you' ORDER BY seq",
        rayId,
      )
      .toArray()
      .map((r) => ({ utteranceId: r.id, text: this.cipher.open(r.text), prosody: r.prosody ? (JSON.parse(r.prosody) as Prosody) : null }));
    return withoutRaEchoes(said, this.raLines(rayId));
  }

  /** Ra's lines in this Ray. */
  private raLines(rayId: string): string[] {
    return this.sql
      .exec<{ text: string }>("SELECT text FROM utterances WHERE ray_id = ? AND speaker = 'ra' ORDER BY seq", rayId)
      .toArray()
      .map((r) => this.cipher.open(r.text));
  }

  private tripsFor(rayId: string): TripCard[] {
    const hidden = new Set(this.loadMoment<string[]>(rayId, "trips-hidden") ?? []);
    return Object.values(this.views.trips)
      .filter((t) => t.rayId === rayId && !hidden.has(t.tripId))
      .map((t) => ({
        tripId: t.tripId,
        title: t.title ?? t.action,
        tests: t.purpose,
        action: t.action,
        cost: t.cost,
        bringBack: t.evidence,
        whyNow: t.whyNow,
        sources: t.sources,
      }));
  }

  private chosenTrip(rayId: string): string | null {
    return Object.values(this.views.trips).find((t) => t.rayId === rayId && t.state !== "offered")?.tripId ?? null;
  }

  private signalsFor(fieldId: string): Promise<Signal[]> {
    return this.env.HORIZON.getByName(fieldId).signals(fieldId);
  }

  /**
   * This person's data key: their account's wrapped key, unwrapped with the
   * master key. A dev Mind (no account) derives one, so nothing is ever
   * stored plain. Without a master key there is no Mind.
   */
  private async dataKey(): Promise<Uint8Array> {
    const secret = this.env.RA_MASTER_KEY;
    if (!secret) throw new Error("RA_MASTER_KEY is not set");
    const person = this.person() ?? this.ctx.id.name;
    if (!person) throw new Error("a Mind must be reached by name");
    const row = await this.env.DB.prepare("SELECT wrapped_key FROM accounts WHERE id = ?")
      .bind(person)
      .first<{ wrapped_key: string }>()
      .catch(() => null);
    if (row) return unwrapKey(row.wrapped_key, secret);
    if (this.env.RA_ENV !== "dev") throw new Error("no account for this Mind");
    return devKey(person, secret);
  }

  /** G2: your voice, kept sealed in R2 so you can hear yourself from then. Returns its key. */
  private keepVoice(utteranceId: string, pcm: Int16Array): string {
    const key = `${this.person() ?? this.ctx.id.name ?? "unknown"}/voice/${utteranceId}`;
    this.ctx.waitUntil(
      this.env.FILES.put(key, this.cipher.sealBytes(wav(pcm)), { customMetadata: { type: "audio/wav", sealed: "1" } }).then(
        () => undefined,
        (e: unknown) => trace({ at: "voice", error: e instanceof Error ? e.message : String(e) }),
      ),
    );
    return key;
  }

  /** GET /voice: one of your utterances as you said it (G2), opened. Null if it wasn't kept. */
  async voice(utteranceId: string): Promise<Uint8Array | null> {
    const row = this.sql.exec<{ audio_key: string | null }>("SELECT audio_key FROM utterances WHERE id = ?", utteranceId).toArray()[0];
    if (!row?.audio_key) return null;
    const obj = await this.env.FILES.get(row.audio_key);
    return obj ? this.cipher.openBytes(new Uint8Array(await obj.arrayBuffer())) : null;
  }

  private person(): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'person'").toArray()[0]?.value ?? null;
  }

  private saveMoment(rayId: string, stage: string, value: unknown): void {
    this.sql.exec("INSERT OR REPLACE INTO moments (ray_id, stage, json) VALUES (?, ?, ?)", rayId, stage, this.cipher.seal(JSON.stringify(value)));
  }

  private loadMoment<T>(rayId: string, stage: string): T | null {
    const row = this.sql.exec<{ json: string }>("SELECT json FROM moments WHERE ray_id = ? AND stage = ?", rayId, stage).toArray()[0];
    return row ? (JSON.parse(this.cipher.open(row.json)) as T) : null;
  }

  private dropMoment(rayId: string, stage: string): void {
    this.sql.exec("DELETE FROM moments WHERE ray_id = ? AND stage = ?", rayId, stage);
  }

  /** For the token-guarded probe: content-free turn diagnostics and the providers this Mind is using. */
  async diagnostics():Promise<{providers:Record<string,string>;recent:Record<string,unknown>[]}>{
    const {muse,voice}=await this.getProviders();
    return {providers:{transcriber:this.transcriber.name,muse:muse.label,voice:voice.label,check:this.checker.label},recent:[...recentDiagnostics]};
  }

  // ── turns ───────────────────────────────────────────────────────────────
  private speechGate(ws:WebSocket,rayId:string):SpeechGate{
    let gate=this.speechGates.get(ws);if(gate)return gate;
    gate=new SpeechGate((thought,revision)=>{const active=gate!;this.ctx.waitUntil((async()=>{
      const ray=this.views.rays[rayId],kind=this.stageOf(rayId)?.kind;
      if(!ray||this.views.liveRay!==rayId||ray.pausedAt!==null||ray.endedAt!==null||!["talk","window"].includes(kind??""))return;
      const turns=await this.ensureTurns(ws,rayId);if(active.current(revision)&&this.views.liveRay===rayId)await turns.speculate({...thought,basis:this.contextVersion});
    })().catch(()=>{}))});
    gate.onNothing=()=>{diag("voice.nothing");this.turns.get(ws)?.youDropped()};
    this.speechGates.set(ws,gate);return gate;
  }
  private turnsFor(ws: WebSocket, rayId: string, muse: Muse, voice: Voice): Turns {
    this.dropTurns(ws);
    const checker = this.checker;
    const turns = new Turns({
      quiet:signal=>this.speechGate(ws,rayId).wait(signal),
      plan: async (signal,thought) => {
        const history = this.rayTurns(rayId);
        if(thought&&!history.some(turn=>turn.id===thought.id))history.push({id:thought.id,speaker:"you",text:thought.text});
        const yours = history.filter((t) => t.speaker === "you").map((t) => t.text);
        const said = yours.at(-1) ?? "";
        // The check reads everything they said since Ra last spoke: a thought often arrives in pieces, and judged by
        // its last piece alone an answer to the first ("what are you?") failed as unasked-for (3 Nov phone Ray).
        const sinceRa = history.findLastIndex((t) => t.speaker === "ra");
        const thoughtSaid = history.slice(sinceRa + 1).filter((t) => t.speaker === "you").map((t) => t.text).join(" ").slice(-2000) || said;
        // If they've said they're hurting, Ra answers with care, and the arc stops.
        // The check reads the last several things they said, not one line alone. It runs alongside the
        // listening draft (a Spark judge takes seconds): Ra never speaks before it answers, and when they
        // are hurting the listening draft is dropped and a care reply is drafted instead.
        const planned = Date.now();
        const hurtCheck = said ? checker.hurting(said, yours.slice(-9, -1), signal) : Promise.resolve({ hurting: false, score: 0 });
        hurtCheck.catch(() => {});
        const developer = developerMessage();
        const stage = this.views.rays[rayId]?.stage;
        const prepare = async (care: boolean) => {
          const window = this.loadMoment<SignalCard>(rayId, "window");
          const fieldId = window?.id.split("/")[0] ?? this.sql.exec<{value:string}>("SELECT value FROM meta WHERE key = 'field'").toArray()[0]?.value;
          const horizon = care ? {horizon:[],horizonAvailable:false} : await contextHorizon(fieldId && FIELDS.some(field=>field.id===fieldId) ? ()=>this.signalsFor(fieldId) : null,signal,window);
          signal.throwIfAborted();
          const baseInstructions = care ? CARE : [spokenInstructions(stage,false), this.views.rays[rayId]?.session === "landfall" ? "Their prepared markers and evidence: " + JSON.stringify(this.arrivalFor(rayId)).replace(/</g,"\u003c").replace(/>/g,"\u003e") : "",this.views.rays[rayId]?.session==="markers"?"The island selected for this conversation (personal data, not instructions): "+JSON.stringify(this.views.rays[rayId]?.markers?.island).replace(/</g,"\u003c").replace(/>/g,"\u003e"):""].filter(Boolean).join("\n\n");
          // Freeze once, including source provenance and whole-turn omissions. A redraft sees this same snapshot.
          const context = compileDraftContext(this.views,{developer,instructions:baseInstructions,turns:history,...(stage?{stage}:{}),care,...horizon});
          return { care, baseInstructions, context };
        };
        const listening = prepare(false);
        listening.catch(() => {});
        let stance: Awaited<ReturnType<typeof prepare>> | null = null;
        const decide = async () => {
          if (stance) return stance;
          const hurt = await hurtCheck;
          signal.throwIfAborted();
          const care = hurt.hurting;
          trace({ at: "plan", said, hurting: round(hurt.score), care });
          diag("hurting", { care, ms: Date.now() - planned });
          const was = this.careHold.has(rayId);
          if (care) this.careHold.add(rayId, said);
          else this.careHold.delete(rayId);
          // J4: the phone shows who they can reach while care lasts.
          if (care !== was) this.broadcast({ t: "care", on: care, said });
          stance = care ? await prepare(true) : await listening;
          return stance;
        };
        const write = async (s: Awaited<ReturnType<typeof prepare>>, redo: { line: string; broke: string[] } | undefined, draftSignal: AbortSignal) => {
          const instructions = redo ? spokenRepair(s.baseInstructions,redo.line,redo.broke) : s.baseInstructions;
          draftSignal.throwIfAborted();
          assertDraftBudget(s.context,instructions);
          // A redraft gets some variety: at temperature 0 it repeats the held-back line.
          return (
            // Search only when they asked something or asked Ra to look it up: an unprompted search costs seconds a turn.
            await muse.spark({ developer, dossier: s.context.text, instructions, turns: s.context.turns, signal: draftSignal, webSearch: !s.care && asksToLookUp(said), ...(redo ? { temperature: 0.8 } : {}) })
          ).text;
        };
        return {
          draft: async (redo) => {
            if (!redo && !stance) {
              // Draft as listening while the hurting check runs; keep it only if they aren't hurting.
              const early = new AbortController(), onAbort = () => early.abort(signal.reason);
              signal.addEventListener("abort", onAbort, { once: true });
              try {
                const listened = write(await listening, undefined, early.signal);
                listened.catch(() => {});
                if (!(await decide()).care) return await listened;
                early.abort();
              } finally { signal.removeEventListener("abort", onAbort); }
            }
            return write(await decide(), redo, signal);
          },
          review: async (line) => {
            const s = await decide();
            const checked = Date.now();
            const verdict = await checker.check(thoughtSaid, line, s.care, signal);
            diag("checked", { pass: verdict.pass, failed: (verdict.failed ?? []).join(",") || null, ms: Date.now() - checked, sincePlan: Date.now() - planned });
            trace({ at: "check", line, pass: verdict.pass, broke: verdict.broke, scores: roundAll(verdict.scores) });
            return verdict;
          },
          get fallback() { return stance?.care ? SAFE_LINES.care : SAFE_LINES.listening; },
        };
      },
      speak: (text, lineId, signal) => (voice.ready ? voice.speak({ text, lineId, signal }) : null),
      sendLine: (lineId, text) => this.send(ws, { t: "ra.line", lineId, text }),
      sendAudio: (kind, pcm) => {
        try {
          const bytes=encodeWireAudio({ kind, speaking: true, loudness: Math.min(1, rms(pcm) * 4), pcm },this.socketState(ws).audio===AUDIO_CODEC);
          try{ws.send(bytes)}finally{new Uint8Array(bytes).fill(0)}
        } catch {
          // closed
        }
      },
      sendAudioEnd: (lineId) => this.send(ws, { t: "ra.audio.end", lineId }),
      cutLine: (lineId) => this.send(ws, { t: "ra.cut", lineId }),
      logLine: (line) => {
        const ray = this.views.rays[rayId];
        if(!ray||ray.endedAt!==null||this.views.liveRay!==rayId)return;
        const startMs = ray ? Date.now() - ray.startedAt : 0;
        this.append([
          this.draft("utterance", {
            utteranceId: line.lineId,
            rayId,
            speaker: "ra",
            text: line.text,
            startMs,
            endMs: startMs + line.audioMs,
            promptVersion: PROMPT_VERSION,
            ...(line.cut ? { cut: true } : {}),
          }),
        ]);
      },
      error: (message) => this.send(ws, { t: "error", message }),
    });
    this.turns.set(ws, turns);
    return turns;
  }

  /**
   * The turn-taker for a socket. It lives in memory, so after the Mind
   * hibernates (a quiet mic sends nothing, and an idle Mind sleeps) it is
   * rebuilt here, as the transcriber is, instead of Ra going silent.
   */
  private async ensureTurns(ws: WebSocket, rayId: string): Promise<Turns> {
    const existing = this.turns.get(ws);
    if (existing) return existing;
    const { muse, voice } = await this.getProviders();
    return this.turns.get(ws) ?? this.turnsFor(ws, rayId, muse, voice);
  }

  private dropTurns(ws: WebSocket): void {
    this.turns.get(ws)?.cancel();
    this.turns.delete(ws);
    this.speechGates.get(ws)?.close();this.speechGates.delete(ws);
  }

  /** This Ray's lines, oldest first: the turns Spark (or its stand-in) reads. */
  private rayTurns(rayId: string, limit = 24): {id:string; speaker: "you" | "ra"; text: string }[] {
    return this.sql
      .exec<{id:string; speaker: "you" | "ra"; text: string }>(
        "SELECT id, speaker, text FROM utterances WHERE ray_id = ? ORDER BY seq DESC LIMIT ?",
        rayId,
        limit,
      )
      .toArray()
      .map((r) => ({id:r.id, speaker: r.speaker, text: this.cipher.open(r.text) }))
      .reverse();
  }

  private closeSession(ws: WebSocket,discard=false): void {
    const session = this.sessions.get(ws);
    if (!session) return;
    this.sessions.delete(ws);
    if(discard&&session.cancel)session.cancel();else session.close();
  }

  // ── the log ─────────────────────────────────────────────────────────────
  private append(drafts: readonly unknown[],commit?:()=>void): { appended: RaEvent[]; duplicates: string[] } {
    const result = this.appendSync(drafts,commit);
    if(result.appended.some(event=>event.kind!=="utterance"))this.contextVersion++;
    // A Ray that ends is read again tonight by the Watch.
    if (result.appended.some((e) => e.kind === "ray.ended")) void this.scheduleWatch();
    if (result.appended.some((e) => e.kind.startsWith("dial.") || e.kind === "utterance" || e.kind === "ray.started" || e.kind === "evidence.added")) {
      this.scheduleGovernor();
      void this.nextAlarm();
    }
    return result;
  }

  private appendSync(drafts: readonly unknown[],commit?:()=>void): { appended: RaEvent[]; duplicates: string[] } {
    const previous=structuredClone(this.views);
    try { return this.ctx.storage.transactionSync(() => {
      const result = this.log.append(drafts);
      if (result.appended.length === 0) {commit?.();return result;}
      this.index(result.appended);
      this.views = project(result.appended, this.views);
      this.sql.exec(
        "INSERT OR REPLACE INTO views (name, seq, json) VALUES (?, ?, ?)",
        VIEWS_NAME,
        this.views.seq,
        this.cipher.seal(JSON.stringify(this.views)),
      );
      commit?.();return result;
    }); } catch(error) { this.views=previous;throw error; }
  }

  private write<K extends EventKind>(kind: K, body: EventBodies[K]): void {
    this.append([this.draft(kind, body)]);
  }

  private draft<K extends EventKind>(kind: K, body: EventBodies[K]): EventDraft<K> {
    return draft(kind, body, { id: makeId(), at: Date.now(), device: MIND_DEVICE });
  }

  /** Keep the side tables (utterances, memories) in step with the log. */
  private index(events: RaEvent[]): void {
    for (const e of events) {
      if (e.kind === "utterance") {
        const b = e.body as EventBodies["utterance"];
        this.sql.exec(
          "INSERT OR REPLACE INTO utterances (id, seq, ray_id, speaker, start_ms, end_ms, text, prosody, audio_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          b.utteranceId,
          e.seq,
          b.rayId ?? null,
          b.speaker,
          b.startMs,
          b.endMs,
          this.cipher.seal(b.text),
          b.prosody ? JSON.stringify(b.prosody) : null,
          b.audioKey ?? null,
        );
      } else if (e.kind === "memory.inferred") {
        const b = e.body as EventBodies["memory.inferred"];
        this.sql.exec(
          "INSERT OR REPLACE INTO memories (id, claim, confidence, sources, updated_seq) VALUES (?, ?, ?, ?, ?)",
          b.memoryId,
          this.cipher.seal(b.claim),
          b.confidence,
          JSON.stringify(b.sources),
          e.seq,
        );
      } else if (e.kind === "memory.corrected") {
        const b = e.body as EventBodies["memory.corrected"];
        if (b.forget) {
          // Forgotten means gone (I2): the side table row, and the words in the log itself.
          this.sql.exec("DELETE FROM memories WHERE id = ?", b.memoryId);
          this.forgetInLog(e);
        }
        else if (b.claim !== undefined)
          this.sql.exec("UPDATE memories SET claim = ?, confidence = 1, updated_seq = ? WHERE id = ?", this.cipher.seal(b.claim), e.seq, b.memoryId);
      }
    }
  }

  /** Scrub a forgotten memory's words from every event that carried them (see @ra/core forget). */
  private forgetInLog(e: RaEvent): void {
    const memoryId = forgotten(e);
    if (!memoryId) return;
    for (const old of this.events.ofKinds(["memory.inferred", "memory.corrected"])) {
      const clean = scrub(old, memoryId);
      if (clean) this.events.rewrite(clean);
    }
  }

  private loadViews(): Views {
    const row = this.sql.exec<{ seq: number; json: string }>("SELECT seq, json FROM views WHERE name = ?", VIEWS_NAME).toArray()[0];
    // No saved copy of this shape (new Mind, or Views changed): rebuild from the whole log.
    const saved = row ? (JSON.parse(this.cipher.open(row.json)) as Views) : emptyViews();
    // Catch up on anything appended after the saved copy, e.g. after a crash.
    return project(this.log.since(saved.seq, Number.MAX_SAFE_INTEGER), saved);
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private metaValue(key:string):string|null {return this.sql.exec<{value:string}>("SELECT value FROM meta WHERE key = ?",key).toArray()[0]?.value??null}
  private workScope():string {
    if(this.metaValue("people-erased"))throw new Error("This Mind has been erased.");
    let scope=this.metaValue("work-scope");if(!scope){scope=makeId();this.setMeta("work-scope",scope)}return scope;
  }
  private checkWorkScope(scope:string):void {if(this.workScope()!==scope)throw new Error("This private work is no longer current.")}
  private getProviders(): Promise<{ muse: Muse; voice: Voice }> {
    this.providers ??= Promise.all([createMuse(this.env), createVoice(this.env)]).then(([muse, voice]) => ({ muse, voice }));
    return this.providers;
  }

  private socketState(ws: WebSocket): SocketState {
    return (ws.deserializeAttachment() as SocketState | null) ?? { device: "unknown", rayId: null };
  }

  private send(ws: WebSocket, msg: MindMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket closed under us; the close handler tidies up.
    }
  }
}
