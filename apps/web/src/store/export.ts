import {exportIndex,readExportRow,localSession,checkLocalSession} from "./db";
import {api} from "./device";

export interface ExportSink {write(bytes:Uint8Array<ArrayBuffer>):Promise<void>;finish():Promise<void>;abort():Promise<void>}
export interface ExportOptions {mode:"all"|"phone";signal?:AbortSignal;progress?(state:{records:number;total:number;bytes:number}):void}
/** Portable JSON with original local media. Originals are downloaded, never uploaded for export. */
export async function exportMind(sink:ExportSink,options:ExportOptions):Promise<{records:number;bytes:number}> {
  let session:ReturnType<typeof localSession>;try{session=localSession()}catch(error){await sink.abort().catch(()=>{});throw error}
  const controller=new AbortController();const stop=()=>controller.abort();
  window.addEventListener("ra-vault-closed",stop);options.signal?.addEventListener("abort",stop,{once:true});if(options.signal?.aborted)stop();
  const check=()=>{checkLocalSession(session);if(controller.signal.aborted)throw new Error("Export stopped. Discard any incomplete export file and try again.")};
  const encoder=new TextEncoder();let bytes=0;let records=0;let total=0;
  const pending=new Uint8Array(16384);let used=0;
  async function flush() {
    if(!used)return;const part=pending.slice(0,used);pending.fill(0);used=0;
    try{check();await sink.write(part);bytes+=part.length;check()}finally{part.fill(0)}
  }
  async function write(data:Uint8Array<ArrayBuffer>) {
    try{for(let at=0;at<data.length;){check();const size=Math.min(data.length-at,pending.length-used);pending.set(data.subarray(at,at+size),used);used+=size;at+=size;if(used===pending.length)await flush()}}
    finally{data.fill(0)}
  }
  const text=(value:string)=>write(encoder.encode(value));
  async function json(value:unknown):Promise<void> {
    check();
    if(value instanceof Blob) {
      await text('{"encoding":"base64","type":'+JSON.stringify(value.type)+',"bytes":'+value.size+',"base64":"');
      for(let at=0;at<value.size;at+=24576) {
        const raw=new Uint8Array(await value.slice(at,at+24576).arrayBuffer());
        try{check();await text(btoa(String.fromCharCode(...raw)))}finally{raw.fill(0)}
      }
      await text('"}');return;
    }
    if(Array.isArray(value)){await text("[");for(let i=0;i<value.length;i++){if(i)await text(",");await json(value[i])}await text("]");return}
    if(value&&typeof value==="object") {
      await text("{");let first=true;
      for(const [key,item] of Object.entries(value))if(item!==undefined){if(!first)await text(",");first=false;await text(JSON.stringify(key)+":");await json(item)}
      await text("}");return;
    }
    await text(JSON.stringify(value)??"null");
  }
  let reader:ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>|undefined;
  let remote:Response|undefined;
  try {
    check();const refs=await exportIndex();check();total=refs.length;
    if(options.mode==="all") {
      remote=await fetch(api("/export"),{credentials:"include",headers:{"X-Ra-Account":session.owner},cache:"no-store",signal:controller.signal});check();
      if(!remote.ok)throw new Error(remote.status===401||remote.status===409?"Sign in to your online Mind before exporting it. Your local work is still here.":"Your online Mind could not be exported. Try again, or explicitly choose the copy on this phone.");
      if(!remote.body||!remote.headers.get("content-type")?.includes("application/json"))throw new Error("The online export returned an unexpected format.");
    }
    await text('{"format":"ra-portable-export","version":1,"account":'+JSON.stringify(session.owner)+',"startedAt":'+Date.now()+',"onlineMindIncluded":'+(options.mode==="all")+',"mind":');
    if(remote?.body) {
      reader=remote.body.getReader();
      for(;;){check();const part=await reader.read();try{check();if(part.done)break;await write(part.value)}finally{part.value?.fill(0)}}
      reader.releaseLock();reader=undefined;
    }else await text("null");
    await text(',"local":{"records":[');
    for(const ref of refs) {
      check();const value=await readExportRow(ref);check();if(records)await text(",");
      await text('{"store":'+JSON.stringify(ref.table)+',"key":'+JSON.stringify(ref.key)+',"value":');await json(value);await text("}");records++;
      options.progress?.({records,total,bytes});
    }
    await text(']},"complete":true,"completedAt":'+Date.now()+"}");await flush();check();await sink.finish();check();return {records,bytes};
  }catch(error){if(reader)await reader.cancel().catch(()=>{});else await remote?.body?.cancel().catch(()=>{});await sink.abort().catch(()=>{});throw error}
  finally{pending.fill(0);window.removeEventListener("ra-vault-closed",stop);options.signal?.removeEventListener("abort",stop)}
}
