import {draft,isId,type EventDraft} from "@ra/core";
export interface EarFile{operationId:string;generation:string;at:number;text:string;media?:{kind:"audio"|"image";bytes:Uint8Array;type:"audio/wav"|"image/jpeg"|"image/png"}}
export interface EarReceipt{version:1;fingerprint:string;utteranceId:string|null;evidenceId:string|null;tripId:string|null}
interface Deps{
  scope():string;generation():string|null;owner():string;trip():string|null;
  load(id:string):EarReceipt|null;commit(events:EventDraft[],id:string,receipt:EarReceipt):void;
  put(key:string,bytes:Uint8Array,type:string):Promise<unknown>;remove(key:string):Promise<unknown>;
}
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const digest=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest("SHA-256",bytes));
const identifier=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].slice(0,26).map(byte=>"0123456789ABCDEFGHJKMNPQRSTVWXYZ"[byte&31]).join("");
/** Mind-owned, retry-safe filing. Receipts and events commit together; opened media never enters D1. */
export class EarFiles{
  private processing=0;
  private closed=false;private readonly active=new Map<string,{fingerprint:string;scope:string;promise:Promise<EarReceipt>;cancel:()=>void}>();
  constructor(private readonly deps:Deps){}
  async close():Promise<void>{this.closed=true;const work=[...this.active.values()];for(const item of work)item.cancel();await Promise.allSettled(work.map(item=>item.promise))}
  async file(input:EarFile):Promise<Omit<EarReceipt,"fingerprint">>{
    const bytes=input.media?.bytes;let controller:AbortController|null=null,registered=false;
    try{
      if(this.processing>=2)throw new Error("The Ear is busy. Retry this message shortly.");this.processing++;registered=true;
      if(this.closed||!isId(input.operationId)||!/^([a-f0-9]{64})$/.test(input.generation)||!Number.isSafeInteger(input.at)||input.at<0||input.at>Date.now()+60_000||typeof input.text!=="string"||input.text.length>16_000)throw new Error("This Ear capture is invalid.");
      if(input.media&&(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>8*1024*1024||!(input.media.kind==="audio"&&input.media.type==="audio/wav"||input.media.kind==="image"&&["image/jpeg","image/png"].includes(input.media.type))))throw new Error("This Ear media is unavailable.");
      const text=input.text.trim();if(!text&&input.media?.kind!=="image")throw new Error("This thought has no words to keep.");
      const scope=this.deps.scope(),generation=input.generation;
      const current=()=>{if(this.closed||controller?.signal.aborted||this.deps.scope()!==scope||this.deps.generation()!==generation)throw new Error("This Ear link is no longer active.")};current();
      const mediaHash=bytes?await digest(bytes):null;current();
      const fingerprint=await digest(new TextEncoder().encode(JSON.stringify([generation,input.at,input.media?.type??"text",input.media?.kind==="audio"?null:text,mediaHash])));current();
      const publicReceipt=({fingerprint:_,...receipt}:EarReceipt)=>receipt;
      const previous=this.deps.load(input.operationId);if(previous){if(previous.fingerprint!==fingerprint)throw new Error("This Ear message changed after it was kept.");return publicReceipt(previous)}
      const pending=this.active.get(input.operationId);if(pending){if(pending.scope!==scope||pending.fingerprint!==fingerprint)throw new Error("This Ear message conflicts with pending work.");return publicReceipt(await pending.promise)}
      if(this.active.size>=2)throw new Error("The Ear is busy. Retry this message shortly.");
      const childId=await identifier(input.operationId+":evidence");current();
      // Recheck after the final digest await: another identical RPC may already own the operation.
      const found=this.deps.load(input.operationId);if(found){if(found.fingerprint!==fingerprint)throw new Error("This Ear message changed after it was kept.");return publicReceipt(found)}
      const raced=this.active.get(input.operationId);if(raced){if(raced.fingerprint!==fingerprint||raced.scope!==scope)throw new Error("This Ear message conflicts with pending work.");return publicReceipt(await raced.promise)}
      controller=new AbortController();const tripId=this.deps.trip(),kind=input.media?.kind;
      const key=bytes?`${this.deps.owner()}/${kind==="audio"?"voice":"evidence"}/${scope}/${input.operationId}`:null;
      const promise=(async()=>{
        let attempted=false;
        try{
          current();if(key&&bytes){attempted=true;await this.deps.put(key,bytes,input.media!.type);current()}
          const meta={id:input.operationId,device:"ear",at:input.at},events:EventDraft[]=[];
          const receipt:EarReceipt={version:1,fingerprint,utteranceId:kind==="image"?null:input.operationId,evidenceId:kind==="image"?input.operationId:tripId?childId:null,tripId};
          if(kind==="image")events.push(draft("evidence.added",{evidenceId:input.operationId,...(tripId?{tripId}:{}),kind:"photo",r2Key:key!,...(text?{note:text}:{})},meta));
          else{events.push(draft("utterance",{utteranceId:input.operationId,speaker:"you",text,startMs:0,endMs:bytes?Math.max(0,Math.round((bytes.length-44)/32)):0,...(key?{audioKey:key}:{}),via:"ear"},meta));if(tripId)events.push(draft("evidence.added",{evidenceId:childId,tripId,kind:"note",note:text},{...meta,id:childId}))}
          current();this.deps.commit(events,input.operationId,receipt);return receipt;
        }catch(error){if(attempted&&key)await this.deps.remove(key);throw error}
      })();
      const entry={scope,fingerprint,promise,cancel:()=>{controller?.abort();bytes?.fill(0)}};this.active.set(input.operationId,entry);
      try{return publicReceipt(await promise)}finally{if(this.active.get(input.operationId)===entry)this.active.delete(input.operationId)}
    }finally{if(registered)this.processing--;bytes?.fill(0)}
  }
}
