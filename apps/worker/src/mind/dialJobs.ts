import {isId,type DialJob,type DialTask,type DialBasis} from "@ra/core";
import type {Muse} from "../muse";
import {PROMPT_VERSION} from "@ra/prompts";
import type {Ask} from "./moments";
import type {Signal} from "../horizon/HorizonDO";
import {DialIssue,dialContext,dialJson,generateDial,type DialOwn,type DialContext,type DialResult} from "./dialModel";
export interface DialInput{kind:DialTask;callId:string|null;signalIds:string[]}
export interface SavedDialJob extends DialJob{input:DialInput;own:DialOwn;scope:string;context:DialContext|null}
interface Deps{
  scope():string;own(input:DialInput):DialOwn;existing(input:DialInput,own:DialOwn):boolean;
  load(id:string):SavedDialJob|null;save(job:SavedDialJob):void;
  horizon():Promise<Signal[]>;providers():Promise<{muse:Muse;ask:Ask}>;
  commit(job:SavedDialJob,result:DialResult,basis:DialBasis):void;waitUntil(task:Promise<unknown>):void;now?():number;
}
export class DialActionError extends Error{constructor(message:string,readonly status=409){super(message)}}
const publicJob=(job:SavedDialJob):DialJob=>structuredClone({version:1,operationId:job.operationId,kind:job.kind,callId:job.callId,state:job.state,problem:job.problem,createdAt:job.createdAt});
export function dialInput(value:unknown):DialInput{
  if(!value||typeof value!=="object")throw new DialActionError("Choose a Dial action and its sources.",400);
  const input=value as Record<string,unknown>;
  if(!["question","read","outcome"].includes(String(input.kind))||!Array.isArray(input.signalIds)||!input.signalIds.length||input.signalIds.length>6||input.signalIds.some(id=>typeof id!=="string"||!id||id.length>200)||new Set(input.signalIds).size!==input.signalIds.length||input.kind!=="question"&&!isId(input.callId)||input.kind==="question"&&input.callId!=null)throw new DialActionError("Choose one to six sources and a valid Dial action.",400);
  return {kind:input.kind as DialTask,callId:input.kind==="question"?null:input.callId as string,signalIds:[...input.signalIds].sort() as string[]};
}
/** Explicit requests only; status/reconnection never starts or retries model work. */
export class DialJobs{
  private readonly active=new Map<string,AbortController>();private closed=false;
  constructor(private readonly deps:Deps){}
  private now(){return this.deps.now?.()??Date.now()}
  private read(id:string){
    if(!isId(id))throw new DialActionError("Invalid Dial request.",400);const job=this.deps.load(id);
    if(!job)throw new DialActionError("This Dial request is no longer available.",404);
    if(job.scope!==this.deps.scope())throw new DialActionError("This request belongs to an earlier Mind.");
    if(job.state==="running"&&!this.active.has(id)){job.state="interrupted";job.problem="interrupted";this.deps.save(job)}return job;
  }
  get(id:string){return publicJob(this.read(id))}
  start(id:string,value:unknown,retry=false):DialJob{
    if(this.closed||!isId(id))throw new DialActionError("This Dial request is unavailable.");const input=dialInput(value),scope=this.deps.scope();let old=this.deps.load(id);
    if(old){old=this.read(id);if(dialJson(input)!==dialJson(old.input))throw new DialActionError("Use a new request when changing the call or sources.");if(!retry||!["failed","interrupted"].includes(old.state))return publicJob(old)}
    if(this.active.size)throw new DialActionError("A Dial reading is already in progress. Cancel it before starting another.");
    const own=this.deps.own(input),now=this.now();
    if(old&&(now-old.createdAt>86_400_000||dialJson(old.own)!==dialJson(own)))throw new DialActionError("Your Dial context changed. Start a new request.");
    if(input.kind==="question"&&(!own.island||!own.star||own.waiting))throw new DialActionError(own.waiting?"Make your existing call first.":"Write your Star and chart an island before asking a timing question.");
    if(input.kind!=="question"&&(!own.call?.claim.trim()||!own.call.question))throw new DialActionError("Make your call before requesting Ra’s reading.");
    if(input.kind==="outcome"&&own.call!.reviewAt>now)throw new DialActionError("This call is not due to look at again yet.");
    const job:SavedDialJob={version:1,operationId:id,kind:input.kind,callId:input.callId,state:"running",problem:null,createdAt:old?.createdAt??now,input,own:structuredClone(own),scope,context:old?.context??null};
    if(this.deps.existing(input,own)){job.state="completed";this.deps.save(job);return publicJob(job)}
    const controller=new AbortController();this.active.set(id,controller);this.deps.save(job);this.deps.waitUntil(this.run(job,controller));return publicJob(job);
  }
  private current(job:SavedDialJob,controller:AbortController){try{return !this.closed&&!controller.signal.aborted&&this.active.get(job.operationId)===controller&&this.deps.scope()===job.scope&&this.deps.load(job.operationId)?.state==="running"}catch{return false}}
  private async run(job:SavedDialJob,controller:AbortController){
    const timer=setTimeout(()=>{if(!this.current(job,controller))return;this.deps.save({...job,state:"failed",problem:"provider-error"});this.active.delete(job.operationId);controller.abort()},120_000);
    try{
      if(!job.context){const horizon=await this.deps.horizon();controller.signal.throwIfAborted();if(!this.current(job,controller))return;job.context=dialContext(job.kind,job.own,job.input.signalIds,horizon,this.now());this.deps.save(job)}
      if(dialJson(this.deps.own(job.input))!==dialJson(job.own))throw new DialIssue("stale");
      const {muse,ask}=await this.deps.providers();controller.signal.throwIfAborted();if(muse.stub)throw new DialIssue("provider-unavailable");
      const result=await generateDial(muse,ask,job.context,controller.signal);if(!this.current(job,controller))return;
      if(dialJson(this.deps.own(job.input))!==dialJson(job.own))throw new DialIssue("stale");
      const reviewAt=job.own.call?.reviewAt??this.now()+182*86_400_000;
      const basis:DialBasis={version:1,operationId:job.operationId,asOf:job.context.asOf,forReviewAt:reviewAt,promptVersion:PROMPT_VERSION,provider:muse.label,sources:structuredClone(job.context.sources),evidence:result.evidence,uncertainty:result.uncertainty,...(result.statusEvidence?{statusEvidence:result.statusEvidence}:{})};
      const completed:SavedDialJob={...job,state:"completed",callId:job.callId??job.operationId};this.deps.commit(completed,result,basis);
    }catch(error){if(this.current(job,controller))this.deps.save({...job,state:"failed",problem:error instanceof DialIssue?error.message:"provider-error"})}
    finally{clearTimeout(timer);if(this.active.get(job.operationId)===controller)this.active.delete(job.operationId)}
  }
  cancel(id:string){const job=this.read(id);if(job.state==="running"){this.active.get(id)?.abort();this.active.delete(id);job.state="cancelled";job.problem=null;this.deps.save(job)}return publicJob(job)}
  close(){this.closed=true;for(const controller of this.active.values())controller.abort();this.active.clear()}
}
