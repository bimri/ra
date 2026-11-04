import type {Views,RouteEvidence,RouteSource,RouteResult,RouteProblem} from "@ra/core";
import {ROUTE_TASK,HURTING,chartDeveloperMessage} from "@ra/prompts";
import type {Muse} from "../muse";
import type {Ask} from "./moments";
import type {Signal} from "../horizon/HorizonDO";
import {sourceUrls} from "../horizon/sources";
import {schemaInstruction} from "../muse/messages";
import {taskText} from "../muse/tasks";
import {verifiedHorizon} from "@ra/core";

export class RouteIssue extends Error {constructor(readonly code:RouteProblem){super(code)}}
export interface OwnRouteContext {star:string|null;evidence:RouteEvidence[];islands:string[];markers:Record<string,string[]>;arrived:string[]}
export interface RouteContext {own:OwnRouteContext;circumstances:string;horizon:RouteSource[];omittedEvidence:number;omittedHorizon:number}
const utf8=(text:string)=>new TextEncoder().encode(text).length;
export const routeJson=(value:unknown)=>JSON.stringify(value).replace(/</g,"\\u003c").replace(/>/g,"\\u003e");
/** Keep source evidence, not internal verifier scores/hashes, in model input.
 * The complete verified records remain in context for validation/persistence. */
export function routeModelContext(context:RouteContext) {
  return {...context,horizon:context.horizon.map(({verification,...source})=>({...source,...(verification?{verifiedExcerpts:verification.documents.map(({url,quote,checkedAt,publishedAt})=>({url,quote,checkedAt,publishedAt}))}: {})}))};
}
/** Whitelist before serialization: seq, voyages, crew and ledger fields cannot influence a route. */
export function ownRouteContext(views:Views,evidence:readonly RouteEvidence[]):OwnRouteContext {
  return {star:views.star.current,evidence:evidence.map(({id,quote})=>({id,quote})),islands:Object.keys(views.islands).sort(),markers:Object.fromEntries(Object.keys(views.markers).sort().map(island=>[island,[...views.markers[island]!.markers]])),arrived:views.landfalls.map(arrival=>arrival.island).sort()};
}
export function routeContext(own:OwnRouteContext,circumstances:string,signals:readonly Signal[],now:number):RouteContext {
  if(!own.star?.trim())throw new RouteIssue("no-star");
  if(!own.evidence.length)throw new RouteIssue("no-evidence");
  if(!own.evidence.some(evidence=>evidence.quote.trim().length>=8))throw new RouteIssue("no-evidence");
  const horizon=signals.flatMap(signal=>{const sources=sourceUrls(signal.sources);return verifiedHorizon(signal,now)&&sources.length&&Number.isFinite(signal.at)&&signal.at<=now&&signal.at>=now-30*86_400_000?[{id:signal.id,kind:signal.kind,text:signal.text,sources,at:signal.at,seeded:false,verification:structuredClone(signal.verification)}]:[]});
  if(!horizon.length)throw new RouteIssue("no-horizon");
  horizon.sort((a,b)=>b.at-a.at||(a.id<b.id?-1:a.id>b.id?1:0));
  const context:RouteContext={own:{...own,evidence:[]},circumstances,horizon:[],omittedEvidence:own.evidence.length,omittedHorizon:horizon.length};
  const fits=(value:RouteContext)=>utf8(routeJson(routeModelContext(value)))+utf8(chartDeveloperMessage())+utf8(ROUTE_TASK)+utf8(schemaInstruction(routeSchema(value)))+512<=6400;
  // Start with one whole source and one whole quote; do not let either crowd out all of the other.
  const excerpts=[...own.evidence].reverse().filter(evidence=>evidence.quote.trim().length>=8&&evidence.quote.length<=1000);let paired=false;
  for(const source of horizon){for(const evidence of excerpts){const candidate={...context,own:{...context.own,evidence:[evidence]},horizon:[source],omittedEvidence:own.evidence.length-1,omittedHorizon:horizon.length-1};if(fits(candidate)){Object.assign(context,candidate);paired=true;break}}if(paired)break}
  if(!paired)throw new RouteIssue("context-too-large");
  for(const evidence of excerpts){if(context.own.evidence.some(kept=>kept.id===evidence.id))continue;const candidate={...context,own:{...context.own,evidence:[...context.own.evidence,evidence]},omittedEvidence:context.omittedEvidence-1};if(fits(candidate))Object.assign(context,candidate)}
  for(const source of horizon){if(context.horizon.some(kept=>kept.id===source.id))continue;const candidate={...context,horizon:[...context.horizon,source],omittedHorizon:context.omittedHorizon-1};if(fits(candidate))Object.assign(context,candidate)}
  return context;
}
const textSchema={type:"string"};
export const ROUTE_SCHEMA:Record<string,unknown>={type:"object",additionalProperties:false,required:["kind","question","proposal"],properties:{kind:{type:"string",enum:["clarify","proposal"]},question:{type:["string","null"]},proposal:{type:["object","null"],additionalProperties:false,required:["island","inevitable","adjacent","yours","firstStep","signalIds","evidence"],properties:{island:textSchema,inevitable:textSchema,adjacent:textSchema,yours:textSchema,firstStep:textSchema,signalIds:{type:"array",items:textSchema},evidence:{type:"array",items:{type:"object",additionalProperties:false,required:["id","quote"],properties:{id:textSchema,quote:textSchema}}}}}}};
/** Constrain personal/source namespaces and quote pairs before decoding; still validate the result locally. */
export function routeSchema(context:RouteContext):Record<string,unknown> {
  const schema=structuredClone(ROUTE_SCHEMA) as any;
  if(context.horizon.length)schema.properties.proposal.properties.signalIds={type:"array",minItems:1,maxItems:Math.min(8,context.horizon.length),items:{type:"string",enum:context.horizon.map(source=>source.id)}};
  if(context.own.evidence.length)schema.properties.proposal.properties.evidence={type:"array",minItems:1,maxItems:2,items:{anyOf:context.own.evidence.map(evidence=>({type:"object",additionalProperties:false,required:["id","quote"],properties:{id:{type:"string",enum:[evidence.id]},quote:{type:"string",enum:[evidence.quote]}}}))}};
  const shape=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
  const properties=schema.properties.proposal.properties;
  // Coarse title shape at decode time; readRoute still enforces Unicode word
  // count, novelty and references, and the semantic checks establish capability.
  properties.island={type:"string",minLength:3,maxLength:160,pattern:"^\\S+(?:\\s+\\S+){1,5}$"};
  const proposal={...schema.properties.proposal,type:"object",properties:{evidence:properties.evidence,signalIds:properties.signalIds,island:properties.island,firstStep:properties.firstStep,inevitable:properties.inevitable,adjacent:properties.adjacent,yours:properties.yours}};
  return shape({decision:{anyOf:[
    shape({kind:{type:"string",enum:["clarify"]},question:{type:"string",minLength:8,maxLength:300},proposal:{type:"null"}}),
    shape({kind:{type:"string",enum:["proposal"]},question:{type:"null"},proposal}),
  ]}});
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new RouteIssue("invalid-output");return value as Record<string,unknown>}
function exactKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!(key in value)))throw new RouteIssue("invalid-output")}
function words(value:unknown,max=500):string{if(typeof value!=="string"||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new RouteIssue("invalid-output");return value.trim()}
export function readRoute(text:string,context:RouteContext,operationId:string,now:number):RouteResult {
  if(text.length>16_384)throw new RouteIssue("invalid-output");
  let raw:Record<string,unknown>;try{raw=object(JSON.parse(text))}catch{throw new RouteIssue("invalid-output")}
  if(Object.hasOwn(raw,"decision")){exactKeys(raw,["decision"]);raw=object(raw.decision)}
  exactKeys(raw,["kind","question","proposal"]);
  if(raw.kind==="clarify"){if(raw.proposal!==null)throw new RouteIssue("invalid-output");return {kind:"clarify",question:words(raw.question,300)}}
  if(raw.kind!=="proposal"||raw.question!==null)throw new RouteIssue("invalid-output");
  const p=object(raw.proposal);exactKeys(p,["island","inevitable","adjacent","yours","firstStep","signalIds","evidence"]);
  const island=words(p.island,160),count=island.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length??0;
  if(count<2||count>6||[...context.horizon.map(source=>source.id),...context.own.evidence.map(evidence=>evidence.id)].includes(island)||context.own.islands.some(name=>name.normalize("NFKC").toLowerCase()===island.normalize("NFKC").toLowerCase())||context.own.arrived.includes(island))throw new RouteIssue("invalid-output");
  if(!Array.isArray(p.signalIds)||!p.signalIds.length||p.signalIds.length>8||new Set(p.signalIds).size!==p.signalIds.length)throw new RouteIssue("invalid-output");
  const horizon=p.signalIds.map(id=>{const source=context.horizon.find(source=>source.id===id);if(!source)throw new RouteIssue("invalid-output");return structuredClone(source)});
  if(!Array.isArray(p.evidence)||!p.evidence.length||p.evidence.length>2)throw new RouteIssue("invalid-output");
  const evidence=p.evidence.map(value=>{const pair=object(value);exactKeys(pair,["id","quote"]);const quote=pair.quote,source=context.own.evidence.find(e=>e.id===pair.id);if(typeof quote!=="string"||quote.trim().length<8||quote.length>1000||!source||source.quote!==quote)throw new RouteIssue("invalid-output");return {id:source.id,quote}});
  if(new Set(evidence.map(evidence=>evidence.id)).size!==evidence.length)throw new RouteIssue("invalid-output");
  return {kind:"proposal",proposal:{version:1,proposalId:operationId,island,inevitable:words(p.inevitable),adjacent:words(p.adjacent),yours:words(p.yours),firstStep:words(p.firstStep),circumstances:context.circumstances,evidence,horizon,proposedAt:now}};
}
export async function checkRouteCare(ask:Ask,circumstances:string,evidence:readonly RouteEvidence[],signal:AbortSignal):Promise<void> {
  const hurting=await ask(routeJson({said:circumstances,earlier:evidence.slice(0,8).map(evidence=>evidence.quote)}),HURTING.instructions,signal);
  signal.throwIfAborted();if(!Number.isFinite(hurting)||hurting<0||hurting>1)throw new RouteIssue("provider-error");if(hurting>=HURTING.threshold)throw new RouteIssue("care");
}
export async function proposeRoute(muse:Muse,ask:Ask,context:RouteContext,operationId:string,now:number,signal:AbortSignal):Promise<RouteResult> {
  signal.throwIfAborted();if(muse.stub)throw new RouteIssue("provider-unavailable");
  const resources=await ask(routeJson({circumstances:context.circumstances}),"Has the person explicitly described the time, tools or materials, connection and access available for a first step? Answer no when their text says resources or access are unknown or not yet stated.",signal);
  signal.throwIfAborted();if(!Number.isFinite(resources)||resources<0||resources>1)throw new RouteIssue("provider-error");if(resources<.6)return {kind:"clarify",question:"What time, tools, connection and access can you use for a first step?"};
  let feedback="";
  for(let attempt=0;attempt<2;attempt++){
    const text=await taskText(()=>muse.spark({developer:chartDeveloperMessage(),dossier:routeJson(routeModelContext(context)),instructions:ROUTE_TASK+feedback,turns:[],json:true,schema:routeSchema(context),maxOutputTokens:850,signal}),signal);
    signal.throwIfAborted();let result:RouteResult;
    try{if(text===null)throw new RouteIssue("invalid-output");result=readRoute(text,context,operationId,now)}catch(error){if(!(error instanceof RouteIssue)||attempt)throw error;feedback=" Your previous result did not match the schema or its references. Use exact identifiers and quotes in reference arrays. Name a two-to-six-word capability, not a source identifier or list of tools. Choose one matching decision branch.";continue}
    if(result.kind==="clarify"){
      const score=await ask(routeJson({circumstances:context.circumstances,recordedExperience:context.own.evidence,question:result.question}),"Does this clarification ask for missing circumstances relevant to a safe first step, without seeking unrelated private information, funding, a promised job/income, or the person's mission?",signal);
      signal.throwIfAborted();if(!Number.isFinite(score)||score<0||score>1)throw new RouteIssue("provider-error");
      if(score>=.6)return result;if(attempt)throw new RouteIssue("unreachable");
      feedback=" Your clarification was rejected. Ask only about a missing resource, access constraint or evidence needed for a safe first step. Do not ask for funding, unrelated private information or a mission.";continue;
    }
    const state=routeJson({context:routeModelContext(context),proposal:result.proposal});
    const [specific,reachable,grounded,unsafe,capability]=await Promise.all([
      ask(state,"Is this island and first step specific to the person's recorded experience, rather than a generic course or advice that could suit almost anyone?",signal),
      ask(state,"Can the person start the first step today within one or two hours, using only the explicitly stated tools, time, resources and access? Answer no if any required resource or permission is unknown or unavailable.",signal),
      ask(state,"Are the personal and Horizon claims justified by the supplied exact evidence and cited Horizon, without invented abilities, facts or timing?",signal),
      ask(state,"Does the proposal assign the person's mission, promise jobs/money/success, require unsafe work on live electrical equipment, or depend on a grant, sponsor, employer placement or unavailable permission?",signal),
      ask(routeJson({island:result.proposal.island,firstStep:result.proposal.firstStep}),"Does the island name describe a skill or capability the person can develop, rather than a place, tool, resource inventory, source identifier or job title?",signal),
    ]);
    signal.throwIfAborted();if(![specific,reachable,grounded,unsafe,capability].every(score=>Number.isFinite(score)&&score>=0&&score<=1))throw new RouteIssue("provider-error");
    const failures=[...(specific<.6||capability<.6?["a skill or capability specific to the recorded experience"]:[]),...(reachable<.6?["a first step using only available resources and access"]:[]),...(grounded<.6?["claims justified by the exact personal and Horizon evidence"]:[]),...(unsafe>=.5?["safe work independent of funding and personal success promises"]:[])];
    if(!failures.length)return result;
    if(attempt)throw new RouteIssue("unreachable");
    feedback=" Your previous proposal was rejected. Redraft with "+failures.join("; ")+". Do not claim a capability, resource, fact or permission that was not recorded. If the evidence cannot support a proposal, ask a specific clarification instead.";
  }
  throw new RouteIssue("invalid-output");
}
