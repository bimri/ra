import {isId,canRetryRoute,type RouteJob,type RouteProposal} from "@ra/core";
import type {Muse} from "../muse";
import type {Ask} from "./moments";
import type {Signal} from "../horizon/HorizonDO";
import {RouteIssue,routeContext,proposeRoute,routeJson,checkRouteCare,type OwnRouteContext} from "./routes";

export interface SavedRouteJob extends RouteJob {input:string;scope:string;fingerprint:string;own:OwnRouteContext|null}
export class RouteActionError extends Error {constructor(message:string,readonly status=409){super(message)}}
interface Deps {
  load(id:string):SavedRouteJob|null;save(job:SavedRouteJob):void;
  own():OwnRouteContext;scope():string;horizon():Promise<Signal[]>;
  providers():Promise<{muse:Muse;ask:Ask}>;waitUntil(task:Promise<unknown>):void;
  commit(proposal:RouteProposal,job:SavedRouteJob):void;now?():number;
}
const digest=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const publicJob=(job:SavedRouteJob):RouteJob=>structuredClone({version:job.version,operationId:job.operationId,state:job.state,createdAt:job.createdAt,expiresAt:job.expiresAt,result:job.result,problem:job.problem,acceptedIsland:job.acceptedIsland});
/** Explicit work only: GET/reconnection never starts inference. All persistence is sealed by the Mind adapter. */
export class RouteJobs {
  private readonly active=new Map<string,AbortController>();
  constructor(private readonly deps:Deps){}
  private now(){return this.deps.now?.()??Date.now()}
  private read(id:string):SavedRouteJob {
    if(!isId(id))throw new RouteActionError("Invalid route request.",400);
    const job=this.deps.load(id);if(!job)throw new RouteActionError("This route request is no longer available.",404);
    if(job.scope!==this.deps.scope())throw new RouteActionError("This route request belongs to an earlier Mind.");
    if(job.state==="running"&&!this.active.has(id)){job.state="interrupted";job.problem="interrupted";this.deps.save(job)}
    return job;
  }
  get(id:string):RouteJob {return publicJob(this.read(id))}
  async start(id:string,input:string,retry=false):Promise<RouteJob> {
    if(!isId(id)||typeof input!=="string"||!input.trim()||input.length>1000)throw new RouteActionError("Describe your available time, tools and access in up to 1,000 characters.",400);
    input=input.trim();const scope=this.deps.scope();let previous=this.deps.load(id);
    if(previous){previous=this.read(id);if(previous.input!==input)throw new RouteActionError("Use a new request for changed circumstances.");if(!retry||!["failed","interrupted"].includes(previous.state))return publicJob(previous);if(!canRetryRoute(previous))throw new RouteActionError("Start a fresh request after changing your Star, evidence or circumstances.")}
    if(this.active.size)throw new RouteActionError("A route is already being considered. Cancel it before starting another.");
    const own=previous?.own??this.deps.own();const fingerprint=previous?.fingerprint??await digest(routeJson(own));
    if(scope!==this.deps.scope())throw new RouteActionError("The Mind changed before this request started.");
    // Another request may have started while the fingerprint was being computed.
    const current=this.deps.load(id);if(current&&current!==previous){if(current.input!==input)throw new RouteActionError("Use a new request for changed circumstances.");if(!retry||!["failed","interrupted"].includes(current.state))return this.get(id)}
    if(this.active.size)throw new RouteActionError("A route is already being considered. Cancel it before starting another.");
    const now=this.now();const job:SavedRouteJob={version:1,operationId:id,state:"running",createdAt:now,expiresAt:now+86_400_000,result:null,problem:null,acceptedIsland:null,input,scope,fingerprint,own:structuredClone(own)};
    const controller=new AbortController();this.active.set(id,controller);this.deps.save(job);
    this.deps.waitUntil(this.run(job,controller));return publicJob(job);
  }
  private current(job:SavedRouteJob,controller:AbortController):boolean {
    try{return !controller.signal.aborted&&this.active.get(job.operationId)===controller&&this.deps.scope()===job.scope&&this.deps.load(job.operationId)?.state==="running"}catch{return false}
  }
  private async run(job:SavedRouteJob,controller:AbortController):Promise<void> {
    const timer=setTimeout(()=>{
      if(this.active.get(job.operationId)!==controller)return;
      this.active.delete(job.operationId);controller.abort(new Error("Route request timed out"));
      try{if(this.deps.scope()===job.scope&&this.deps.load(job.operationId)?.state==="running")this.deps.save({...job,state:"failed",problem:"provider-error"})}catch{}
    },120_000);
    try{
      const {muse,ask}=await this.deps.providers();controller.signal.throwIfAborted();if(muse.stub)throw new RouteIssue("provider-unavailable");
      await checkRouteCare(ask,job.input,[...job.own!.evidence].reverse(),controller.signal);controller.signal.throwIfAborted();
      const signals=await this.deps.horizon();controller.signal.throwIfAborted();
      const context=routeContext(job.own!,job.input,signals,this.now());
      const result=await proposeRoute(muse,ask,context,job.operationId,this.now(),controller.signal);
      if(this.current(job,controller))this.deps.save({...job,state:"ready",result});
    }catch(error){
      // Provider text/errors never enter a persisted response, diagnostic log or UI.
      let valid=false;try{valid=this.active.get(job.operationId)===controller&&this.deps.scope()===job.scope&&this.deps.load(job.operationId)?.state==="running"}catch{}
      if(valid)this.deps.save({...job,state:"failed",problem:error instanceof RouteIssue?error.code:"provider-error"});
    }finally{clearTimeout(timer);if(this.active.get(job.operationId)===controller)this.active.delete(job.operationId)}
  }
  cancel(id:string):RouteJob {
    const job=this.read(id);if(job.state==="accepted")return publicJob(job);
    this.active.get(id)?.abort();this.active.delete(id);
    const cancelled:SavedRouteJob={...job,state:"cancelled",result:null,own:null,problem:null};this.deps.save(cancelled);return publicJob(cancelled);
  }
  async accept(id:string):Promise<RouteJob> {
    const job=this.read(id);if(job.state==="accepted")return publicJob(job);
    if(job.state!=="ready"||job.result?.kind!=="proposal")throw new RouteActionError("Review a complete proposal before charting an island.");
    const own=routeJson(this.deps.own());const fingerprint=await digest(own);
    const current=this.read(id);if(current.state==="accepted")return publicJob(current);
    if(current.state!=="ready")throw new RouteActionError("This proposal is no longer ready.");
    if(fingerprint!==job.fingerprint||own!==routeJson(this.deps.own())||this.now()>job.expiresAt){this.deps.save({...job,state:"failed",problem:"stale"});throw new RouteActionError("Your route context changed or the proposal expired. Request a fresh proposal.")}
    const accepted:SavedRouteJob={...job,state:"accepted",acceptedIsland:job.result.proposal.island,own:null};
    this.deps.commit(job.result.proposal,accepted);return publicJob(accepted);
  }
  /** Erasure aborts in-flight work before storage is removed; late completions cannot repopulate it. */
  close():void {for(const controller of this.active.values())controller.abort();this.active.clear()}
}
