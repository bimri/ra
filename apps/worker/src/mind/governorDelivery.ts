import {makeId} from "@ra/core";
import type {Reason} from "./governor";
export type DeliveryResult="sent"|"gone"|"retry"|"failed"|"unknown";
export interface GovernorOperation{version:1;id:string;reason:Reason;at:number;lastAttemptAt?:number;state:"pending"|"sent"|"unknown"|"failed";nextAt:number|null;targets:{id:string;attempts:number;state:"pending"|"attempting"|DeliveryResult}[]}
interface Deps{
  now():number;allowed(reason:Reason,now:number):boolean;targets():string[];
  load():GovernorOperation|null;persist(operation:GovernorOperation,nextAt:number|null):void;
  // Atomically save the final receipt and any event / quiet-once marker.
  finish(operation:GovernorOperation,sent:boolean,quietConsumed:boolean):void;
  send(target:string,topic:string,signal:AbortSignal):Promise<DeliveryResult>;
}
const DAY=86_400_000;
/** One durable daily reservation. Ambiguous transport is never automatically resent. */
export class GovernorDelivery{
  private flight:Promise<boolean>|null=null;private closed=false;private readonly controller=new AbortController();
  constructor(private readonly deps:Deps){}
  close(){this.closed=true;this.controller.abort()}
  run(reason?:Reason):Promise<boolean>{
    if(this.closed)return Promise.resolve(false);if(this.flight)return this.flight;
    this.flight=this.deliver(reason).finally(()=>{this.flight=null});return this.flight;
  }
  private async deliver(reason?:Reason):Promise<boolean>{
    const now=this.deps.now();let operation=this.deps.load();
    if(operation&&now-Math.max(operation.at,operation.lastAttemptAt??operation.at)<DAY){
      if(operation.state!=="pending"||operation.nextAt!==null&&operation.nextAt>now)return false;
      // The process ended after dispatch began. A lost response is not proof of
      // non-delivery; preserve the budget and quiet-once rule without a sent event.
      if(operation.targets.some(target=>target.state==="attempting")){operation.state="unknown";operation.nextAt=null;this.deps.finish(operation,false,operation.reason==="quiet");return false}
    }else{
      if(!reason||!this.deps.allowed(reason,now))return false;
      const targets=[...new Set(this.deps.targets())].slice(0,32);if(!targets.length)return false;
      operation={version:1,id:makeId(),reason,at:now,state:"pending",nextAt:null,targets:targets.map(id=>({id,attempts:0,state:"pending"}))};
    }
    const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(30_000)]);
    for(const target of operation.targets){
      if(this.closed)return false;
      if(target.state!=="pending"||target.attempts>=3)continue;
      if(signal.aborted)break;
      target.attempts++;target.state="attempting";
      operation.lastAttemptAt=this.deps.now();
      // A durable watchdog survives a process ending during a network request.
      this.deps.persist(operation,this.deps.now()+60_000);
      let result:DeliveryResult;try{result=await this.deps.send(target.id,operation.id,signal)}catch{result="unknown"}
      if(this.closed)return false;
      target.state=result;
      if(result==="sent"||result==="unknown"){
        operation.state=result;operation.nextAt=null;this.deps.finish(operation,result==="sent",operation.reason==="quiet");return result==="sent";
      }
      if(result==="retry"&&target.attempts<3)target.state="pending";
      this.deps.persist(operation,this.deps.now()+60_000);
    }
    if(this.closed)return false;
    const pending=operation.targets.filter(target=>target.state==="pending"&&target.attempts<3);
    operation.nextAt=pending.length?this.deps.now()+(pending.some(target=>target.attempts>=2)?300_000:60_000):null;
    if(operation.nextAt===null){operation.state="failed";this.deps.finish(operation,false,false)}else this.deps.persist(operation,operation.nextAt);
    return false;
  }
}
