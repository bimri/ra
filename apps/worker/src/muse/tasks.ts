/** Small, explicit task contracts. Schema decoding is followed by independent local checks. */
const string=(maxLength=800)=>({type:"string",minLength:1,maxLength});
const object=(properties:Record<string,unknown>)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const array=(items:unknown,maxItems:number,minItems=0)=>({type:"array",items,minItems,maxItems});
export const QUESTION_SCHEMA=object({asked:string(),leavingWith:string()});
export const MEMORY_SCHEMA=object({memories:array(object({claim:string(500),confidence:{type:"number",minimum:0,maximum:1},quotes:array({...string(2000),minLength:8},3,1)}),3)});
const tripFields=["title","tests","action","cost","bringBack","whyNow"] as const;
export const tripSchema=(sources:readonly string[])=>object({trips:array(object({...Object.fromEntries(tripFields.map(key=>[key,string()])),sources:array(sources.length?{type:"string",enum:[...sources]}:{type:"string"},sources.length?8:0)}),4)});
export const HORIZON_SCHEMA=object({signals:array(object({kind:{type:"string",enum:["risen","rising","early","stays-human","on-ramp"]},text:string(1200),evidence:array(object({url:string(2048),quote:{...string(800),minLength:12}}),2,1),timing:{anyOf:[string(300),{type:"null"}]}}),12)});
export function taskJson(text:string):Record<string,unknown>|null{
  if(new TextEncoder().encode(text).length>64_000)return null;
  try{const value:unknown=JSON.parse(text);return record(value)?value:null}catch{return null}
}
/** Malformed provider JSON may be retried once by the task. Rate limits and cancellation are not format retries. */
export async function taskText(run:()=>Promise<{text:string}>,signal?:AbortSignal):Promise<string|null>{
  signal?.throwIfAborted();try{const out=await run();signal?.throwIfAborted();return out.text}catch(error){signal?.throwIfAborted();if(error instanceof SyntaxError)return null;throw error}
}
export function record(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
export function exact(value:Record<string,unknown>,keys:readonly string[]):boolean{return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))}
export function words(value:unknown,max=800,min=1):value is string{return typeof value==="string"&&value.trim().length>=min&&value.length<=max}
export function questionResult(text:string):{asked:string;leavingWith:string}|null{
  const value=taskJson(text);return value&&exact(value,["asked","leavingWith"])&&words(value.asked)&&words(value.leavingWith)?{asked:value.asked.trim(),leavingWith:value.leavingWith.trim()}:null;
}
export function memoryResult(text:string):{memories:{claim:string;confidence:number;quotes:string[]}[]}|null{
  const value=taskJson(text);if(!value||!exact(value,["memories"])||!Array.isArray(value.memories)||value.memories.length>3)return null;
  for(const item of value.memories)if(!record(item)||!exact(item,["claim","confidence","quotes"])||!words(item.claim,500)||typeof item.confidence!=="number"||!Number.isFinite(item.confidence)||item.confidence<0||item.confidence>1||!Array.isArray(item.quotes)||item.quotes.length<1||item.quotes.length>3||!item.quotes.every(quote=>words(quote,2000,8)))return null;
  return value as ReturnType<typeof memoryResult>;
}
export interface TripResult{title:string;tests:string;action:string;cost:string;bringBack:string;whyNow:string;sources:string[]}
export function tripResults(text:string,allowed:ReadonlySet<string>):TripResult[]{
  const value=taskJson(text);if(!value||!exact(value,["trips"])||!Array.isArray(value.trips)||value.trips.length>4)return [];
  return value.trips.filter((item):item is TripResult=>record(item)&&exact(item,[...tripFields,"sources"])&&tripFields.every(key=>words(item[key]))&&Array.isArray(item.sources)&&item.sources.length<=8&&new Set(item.sources).size===item.sources.length&&item.sources.every(source=>typeof source==="string"&&allowed.has(source)));
}
