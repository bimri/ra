import {currentIsland,verifiedHorizon,type Views,type StageName,type SignalCard} from "@ra/core";
import type {Turn} from "../muse";
import {sourceUrls as sources} from "../horizon/sources";

const encoder=new TextEncoder();const size=(text:string)=>encoder.encode(text).length;
const literal=(text:string)=>text.replace(/</g,"\\u003c").replace(/>/g,"\\u003e");
const json=(value:unknown)=>literal(JSON.stringify(value));
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const KINDS=["star","island","marker","achievement","question","trip","memory","ring","dial","dialReading","dialReview","dialEvidence","dialOutcome","horizon","reading"] as const;
type Kind=typeof KINDS[number];
type Fact={ref:string;kind:Kind;provenance:string;data:unknown};
type Candidate={priority:number;fact:Fact};
export interface ContextOptions {stage?:StageName;care?:boolean;horizon?:readonly (SignalCard&{at?:number})[];horizonAvailable?:boolean;historyOmitted?:number;maxBytes?:number}
export interface MindContext {text:string;bytes:number;mindSeq:number;references:string[];omitted:Record<Kind,number>}

/** Provider-independent, detached context. Whitelisted facts exclude commercial/relationship state. */
export function compileMindContext(views:Views,options:ContextOptions={}):MindContext {
  const maxBytes=options.maxBytes??6144;if(!Number.isInteger(maxBytes)||maxBytes<512||maxBytes>64000)throw new Error("Invalid context budget.");
  const candidates:Candidate[]=[];let unsourcedHorizon=0;
  const add=(kind:Kind,ref:string,priority:number,provenance:string,data:unknown)=>candidates.push({priority,fact:{ref,kind,provenance,data}});
  if(views.star.current)add("star","star:current",1000,"person-written",{text:views.star.current});
  for(const [id,memory] of Object.entries(views.memories))if(memory.claim) {
    const evidence=memory.sources.flatMap((id,i)=>memory.quotes[i]?[{utteranceId:id,quote:memory.quotes[i]}]:[]);
    add("memory","memory:"+id,memory.corrected?830:530,memory.corrected?"person-corrected":"inference",{claim:memory.claim,confidence:memory.confidence,evidence,unquotedSourceIds:memory.sources.filter((_,i)=>!memory.quotes[i])});
  }
  for(const question of views.questions)add("question","question:"+question.rayId,820,"person-kept",{asked:question.asked,leavingWith:question.leavingWith,at:question.at});
  for(const ring of views.rings)add("ring","ring:"+ring.ringId,300,"reflection",{title:ring.title,text:ring.text,at:ring.at});
  if(!options.care) {
    const islands=Object.values(views.islands).sort((a,b)=>b.at-a.at||compare(a.island,b.island));const current=currentIsland(views);
    for(const island of islands)add("island","island:"+island.island,island.island===current?930:350,"charted-route",{island:island.island,inevitable:island.inevitable,adjacent:island.adjacent,yours:island.yours,at:island.at,...(island.proposal?{firstStep:island.proposal.firstStep,circumstances:island.proposal.circumstances,evidence:island.proposal.evidence,horizon:island.proposal.horizon}:{})});
    for(const [island,value] of Object.entries(views.markers))value.markers.forEach((text,i)=>add("marker",`marker:${island}:${i}`,island===current?900:340,"person-confirmed",{island,index:i,text,...(i===0?{originalMarkers:value.first}:{}),namedAt:value.namedAt,changedAt:value.changedAt}));
    for(const achievement of views.markerAchievements)add("achievement","achievement:"+achievement.achievementId,870,"recorded-evidence",{kind:"marker",island:achievement.island,markerId:achievement.markerId,marker:achievement.marker,evidence:achievement.evidence,at:achievement.at});
    for(const arrival of views.landfalls)add("achievement","arrival:"+arrival.landfallId,860,"person-confirmed",{kind:"arrival",island:arrival.island,said:arrival.said,markers:arrival.markers,at:arrival.at});
    for(const trip of Object.values(views.trips))add("trip","trip:"+trip.tripId,trip.state==="chosen"?880:trip.state==="reported"?810:320,"scouting-record",{state:trip.state,title:trip.title??null,action:trip.action,purpose:trip.purpose,cost:trip.cost,evidence:trip.evidence,report:trip.report,reportedAt:trip.reportedAt,sources:sources(trip.sources??[])});
    for(const call of Object.values(views.dial)) {
      add("dial","dial:"+call.callId,620,"person-call",{question:call.question,claim:call.claim,confidence:call.confidence,reviewAt:call.reviewAt,first:call.first,readingCount:call.reads.length,reviewCount:call.reviews.length});
      if(call.claim)call.reads.forEach((read,i)=>add("dialReading",`dial-reading:${call.callId}:${i}`,240,"prepared-reading",{callId:call.callId,...read}));
      call.reviews.forEach((review,i)=>add("dialReview",`dial-review:${call.callId}:${i}`,610,"person-review",{callId:call.callId,...review}));
      if(call.claim)call.observations.forEach(snapshot=>add("dialEvidence",`dial-evidence:${call.callId}:${snapshot.snapshotId}`,280,"person-selected-sources",{callId:call.callId,...snapshot}));
      if(call.claim)call.outcomes.forEach(outcome=>add("dialOutcome",`dial-outcome:${call.callId}:${outcome.basis.operationId}`,280,"source-backed-reading",{callId:call.callId,...outcome}));
    }
    for(const reading of views.readings)add("reading","reading:"+reading.readingId,200,"prepared-reflection",{week:reading.week,moved:reading.moved,rings:reading.rings,putoff:reading.putoff,calls:reading.calls,preparedAt:reading.preparedAt,horizon:reading.horizon?{field:reading.horizon.field,checkedAt:reading.horizon.checkedAt,available:reading.horizon.available,changes:reading.horizon.changes}:null});
    for(const signal of options.horizon??[]) {
      const cited=sources(signal.sources);if(!signal.seeded&&(!cited.length||!verifiedHorizon(signal,Date.now()))){unsourcedHorizon++;continue}
      add("horizon","horizon:"+signal.id,740,signal.seeded?"seed-reference":"verified-source",{kind:signal.kind,text:signal.text,sources:cited,seeded:signal.seeded===true,at:signal.at??null,timing:signal.timing??null,direction:signal.direction??null,staysHuman:signal.staysHuman??null,...(signal.verification?{sourceEvidence:signal.verification.documents}:{} )});
    }
  }
  const ordered=[...new Map(candidates.map(candidate=>[candidate.fact.ref,candidate])).values()].sort((a,b)=>b.priority-a.priority||compare(b.fact.ref,a.fact.ref));
  const omitted=Object.fromEntries(KINDS.map(kind=>[kind,ordered.filter(c=>c.fact.kind===kind).length])) as Record<Kind,number>;
  const header={version:1,name:views.person?.name??null,stage:options.stage??null,care:options.care===true,horizonAvailable:options.horizonAvailable!==false,historyOmitted:options.historyOmitted??0,unsourcedHorizon};
  // Counting every candidate as omitted gives a safe upper bound for metadata width.
  const base=size(json({...header,records:[],omitted}));let used=base;const selected:string[]=[];const references:string[]=[];
  for(const candidate of ordered) {
    const record=json(candidate.fact);const bytes=size(record)+(selected.length?1:0);
    if(used+bytes>maxBytes)continue;
    selected.push(record);references.push(candidate.fact.ref);used+=bytes;omitted[candidate.fact.kind]--;
  }
  const text=json(header).slice(0,-1)+',"records":['+selected.join(",")+'],"omitted":'+json(omitted)+'}';
  const bytes=size(text);if(bytes>maxBytes)throw new Error("The minimum context does not fit the configured budget.");
  return {text,bytes,mindSeq:views.seq,references,omitted};
}

/** Compatibility for existing callers: the serialized dossier Muse receives. */
export function compileDossier(views:Views,options:ContextOptions={}):string {return compileMindContext(views,options).text}

export interface DraftContext extends MindContext {turns:Turn[];inputBytes:number;maxInputBytes:number;baseInstructionBytes:number;omittedTurns:number}
/** Whole recent turns + whole facts, with a conservative UTF-8 budget shared by both providers. */
export function compileDraftContext(views:Views,input:ContextOptions&{developer:string;instructions:string;turns:readonly Turn[];maxInputBytes?:number}):DraftContext {
  // Spark reads far more than this; 32 KB holds a long spoken thought (a few minutes) and more of the Ray.
  const maxInputBytes=input.maxInputBytes??32000;if(!Number.isInteger(maxInputBytes)||maxInputBytes<2048||maxInputBytes>64000)throw new Error("Invalid draft context budget.");
  const framing=512;const redoReserve=1024;const fixed=size(input.developer)+size(input.instructions)+framing;
  const available=maxInputBytes-fixed-redoReserve-512;
  if(available<1)throw new Error("The stage context is too large. Review one marker or question at a time.");
  const turns:Turn[]=[];let historyBytes=0;
  for(let i=input.turns.length-1;i>=0&&turns.length<12;i--) {
    const turn={speaker:input.turns[i]!.speaker,text:literal(input.turns[i]!.text)};const bytes=size(turn.text)+32;
    const limit=turns.length?Math.min(2600,available):available;
    if(historyBytes+bytes>limit){if(!turns.length)throw new Error("Your latest thought is too large to read at once. Try one shorter thought; nothing was shortened.");break}
    turns.unshift(turn);historyBytes+=bytes;
  }
  const omittedTurns=input.turns.length-turns.length;
  const context=compileMindContext(views,{...input,historyOmitted:omittedTurns,maxBytes:maxInputBytes-fixed-redoReserve-historyBytes});
  return {...context,turns,omittedTurns,inputBytes:fixed+historyBytes+context.bytes,maxInputBytes,baseInstructionBytes:size(input.instructions)};
}
export function assertDraftBudget(context:DraftContext,instructions:string):void {
  if(context.inputBytes-context.baseInstructionBytes+size(instructions)>context.maxInputBytes)throw new Error("The revised context is too large. Review one thought at a time.");
}

/** They asked a question or asked Ra to find something out: the only turns worth a web search. */
export function asksToLookUp(said: string): boolean {
  // Question words alone don't count ("I like knowing why things break"); a question mark or a request does.
  return /\?|\b(look(ing)? (it |that |this )?up|search|google|find (out|me)|check (on|if|what|whether)|research|what (is|are|was|were|does)|how (much|many|do|does|did|can)|is it true|latest|news|price|cost|salary|salaries|statistics|data on)\b/i.test(said);
}

/** A slow/unavailable shared Horizon must not stall a spoken reply. No refresh provider is selected here. */
export async function contextHorizon(load:(()=>Promise<SignalCard[]>)|null,signal:AbortSignal,fallback:SignalCard|null=null,timeoutMs=1000):Promise<Pick<ContextOptions,"horizon"|"horizonAvailable">> {
  signal.throwIfAborted();if(!load)return {horizon:fallback?[fallback]:[],horizonAvailable:!!fallback};
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort)};
    const unavailable=()=>{if(settled)return;settled=true;cleanup();resolve({horizon:fallback?[fallback]:[],horizonAvailable:false})};
    const abort=()=>{if(settled)return;settled=true;cleanup();reject(signal.reason??new DOMException("Cancelled","AbortError"))};
    const timer=setTimeout(unavailable,timeoutMs);signal.addEventListener("abort",abort,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return load()}).then(horizon=>{if(settled)return;settled=true;cleanup();resolve({horizon,horizonAvailable:true})},unavailable);
  });
}
