import {api} from "../store/device";
import {localSession,checkLocalSession} from "../store/db";
export interface KeptRecording{audio:HTMLAudioElement;bytes:ArrayBuffer;readonly closed:boolean;close():void}
/** One private recording, owned by an unlock session and a screen lifetime. */
export async function openRecording(id:string,signal:AbortSignal,deps:{send?:typeof fetch;audio?:(url:string)=>HTMLAudioElement;url?:(blob:Blob)=>string;revoke?:(url:string)=>void}={}):Promise<KeptRecording>{
  const scope=localSession(),load=new AbortController();let audio:HTMLAudioElement|null=null,url:string|null=null,bytes:Uint8Array|null=null,closed=false;
  const close=()=>{if(closed)return;closed=true;load.abort();if(audio){audio.onloadedmetadata=null;audio.onerror=null;audio.onended=null;audio.ontimeupdate=null;audio.onplay=null;audio.onpause=null;try{audio.pause()}catch{}try{audio.removeAttribute("src");audio.load()}catch{}}if(url)try{(deps.revoke??URL.revokeObjectURL)(url)}catch{}bytes?.fill(0);signal.removeEventListener("abort",close);if(typeof window!=="undefined")window.removeEventListener("ra-vault-closed",close)};
  signal.addEventListener("abort",close,{once:true});if(signal.aborted)close();
  if(typeof window!=="undefined"&&!closed)window.addEventListener("ra-vault-closed",close,{once:true});
  const timer=setTimeout(()=>load.abort(new Error("Recording loading timed out")),15_000),deadline=load.signal;
  let rejectAbort:(()=>void)|undefined;
  const cancelled=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(deadline.reason);deadline.addEventListener("abort",rejectAbort,{once:true});if(deadline.aborted)rejectAbort()});
  const current=()=>{checkLocalSession(scope);signal.throwIfAborted();deadline.throwIfAborted();if(closed)throw new Error("Recording closed")};
  try{
    current();const pending=(deps.send??fetch)(api("/voice?id="+encodeURIComponent(id)),{credentials:"include",cache:"no-store",headers:{"x-ra-account":scope.owner},signal:deadline});
    let response:Response;try{response=await Promise.race([pending,cancelled])}catch(error){void pending.then(value=>{void value.body?.cancel().catch(()=>{})},()=>{});throw error}
    try{current()}catch(error){void response.body?.cancel().catch(()=>{});throw error}
    if(!response.ok||!response.body){void response.body?.cancel().catch(()=>{});throw new Error("Recording unavailable")}
    const limit=16*1024*1024;if(Number(response.headers.get("content-length"))>limit){void response.body.cancel().catch(()=>{});throw new Error("Recording too large")}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const item=await Promise.race([reader.read(),cancelled]);current();if(item.done)break;size+=item.value.length;if(size>limit){item.value.fill(0);throw new Error("Recording too large")}chunks.push(item.value.slice());item.value.fill(0)}bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}}
    finally{chunks.forEach(chunk=>chunk.fill(0));void reader.cancel().catch(()=>{});reader.releaseLock()}
    current();if(!bytes.length)throw new Error("Recording empty");url=(deps.url??URL.createObjectURL)(new Blob([bytes.buffer as ArrayBuffer],{type:response.headers.get("content-type")??"audio/wav"}));audio=(deps.audio??(url=>new Audio(url)))(url);audio.addEventListener("play",()=>{if(closed)audio?.pause()});
    const media=audio;await Promise.race([new Promise<void>((resolve,reject)=>{media.onloadedmetadata=()=>{try{current();resolve()}catch(error){reject(error)}};media.onerror=()=>reject(new Error("Recording unavailable"));media.load()}),cancelled]);current();media.onloadedmetadata=null;media.onerror=null;
    return {audio:media,bytes:bytes.buffer as ArrayBuffer,get closed(){return closed},close};
  }catch(error){close();throw error}
  finally{clearTimeout(timer);if(rejectAbort)deadline.removeEventListener("abort",rejectAbort)}
}
