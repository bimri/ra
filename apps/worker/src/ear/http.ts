import {secretOf,type Env} from "../env";
export class EarRetry extends Error{}
export async function boundedBody(body:ReadableStream<Uint8Array>|null,limit:number):Promise<Uint8Array>{
  if(!body)return new Uint8Array();const reader=body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw new Error("Ear body exceeds its limit");chunks.push(value.slice())}const output=new Uint8Array(total);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length}return output}
  finally{for(const chunk of chunks)chunk.fill(0);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export async function smallJson(response:Response):Promise<unknown>{const bytes=await boundedBody(response.body,64*1024);try{return JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes))}finally{bytes.fill(0)}}
export async function graphAccess(env:Env):Promise<{base:string;token:string}|null>{
  if(env.RA_EAR_VERIFIED!=="true"||!/^v\d{1,3}\.\d{1,2}$/.test(env.EAR_GRAPH_VERSION??""))return null;const token=await secretOf(env.EAR_TOKEN);return token?{base:"https://graph.facebook.com/"+env.EAR_GRAPH_VERSION,token}:null;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
export async function downloadEar(env:Env,id:string,send:typeof fetch=fetch):Promise<{bytes:Uint8Array;type:string}>{
  const access=await graphAccess(env);if(!access)throw new EarRetry("Ear media is unavailable.");
  const meta=await send(access.base+"/"+encodeURIComponent(id),{headers:{Authorization:"Bearer "+access.token},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15_000)});if(!meta.ok)throw new EarRetry("Ear media could not be retrieved.");
  const value=await smallJson(meta);if(!record(value)||typeof value.url!=="string"||typeof value.mime_type!=="string")throw new EarRetry("Ear media metadata is incomplete.");
  let url=new URL(value.url);const allowed=(url:URL)=>url.protocol==="https:"&&!url.username&&!url.password&&url.hostname==="lookaside.fbsbx.com";
  for(let step=0;step<4;step++){
    if(!allowed(url))throw new EarRetry("Ear media origin is unavailable.");
    const response=await send(url,{headers:{Authorization:"Bearer "+access.token},redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(15_000)});
    if(response.status>=300&&response.status<400){const next=response.headers.get("location");await response.body?.cancel();if(!next)break;url=new URL(next,url);continue}
    if(!response.ok)throw new EarRetry("Ear media download failed.");
    const bytes=await boundedBody(response.body,8*1024*1024);
    if(typeof value.sha256==="string"){
      const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),hex=[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join(""),base64=btoa(String.fromCharCode(...digest));
      if(value.sha256!==hex&&value.sha256!==base64){bytes.fill(0);throw new EarRetry("Ear media checksum did not match.")}
    }
    return {bytes,type:value.mime_type};
  }
  throw new EarRetry("Ear media redirect is unavailable.");
}
