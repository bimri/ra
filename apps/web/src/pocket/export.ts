import {pocket,isAndroidPocket,type ExportStatus,type PocketResult} from ".";
import {ensureNativeSession,sealPrivateBytes} from "../auth/vault";
import {localSession,checkLocalSession} from "../store/db";
import type {ExportSink} from "../store/export";
const value=<T>(result:PocketResult<T>)=>{if(!result.ok)throw new Error(result.error.message);return result.value};

async function nativeSink(signal:AbortSignal):Promise<ExportSink> {
  const session=localSession();const check=()=>{checkLocalSession(session);if(signal.aborted)throw new Error("Export cancelled.")};
  const client=await pocket();check();if(!client)throw new Error("Reopen the Android app to export this phone’s copy.");
  const info=value(await client.request("runtime.info",{},{signal}));check();if(!info.exportSupported)throw new Error("Update the Android app to save a complete export.");
  if(!await ensureNativeSession())throw new Error("Unlock the local copy first.");check();
  const exportId=crypto.randomUUID();const payload={account:session.owner,exportId};let paused=false;
  const unsubscribe=client.subscribe(state=>{paused=state==="paused"});
  const delay=()=>new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error("Export cancelled."))};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve()},300);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort()});
  const cleanup=async()=>{try{checkLocalSession(session);await client.request("export.cancel",payload,{timeoutMs:2000})}catch{/* paused/locked export streams close natively */}};
  let status:ExportStatus|undefined;
  try {
    const chosen=await client.request("export.choose",payload,{signal});check();if(chosen.ok)status=chosen.value;else if(chosen.error.code!=="cancelled")throw new Error(chosen.error.message);
    const deadline=Date.now()+120000;
    while(!status||status.state==="choosing") {
      check();if(Date.now()>=deadline)throw new Error("The file chooser timed out. Start a fresh export.");await delay();check();if(paused)continue;
      try{if(!await ensureNativeSession())throw new Error("Unlock the local copy first.")}catch(error){if(paused)continue;throw error}check();
      const next=await client.request("export.status",payload,{signal});check();if(!next.ok&&next.error.code==="cancelled")continue;status=value(next);
    }
    if(status.state!=="selected")throw new Error(status.state==="cancelled"?"Export cancelled.":"The save-file destination is unavailable. Start a fresh export.");
  }catch(error){await cleanup();throw error}finally{unsubscribe()}
  let index=0;let bytes=0;
  return {
    async write(plain){check();const envelope=await sealPrivateBytes(plain,`native-export:${exportId}:chunk:${index}`);check();const next=value(await client.request("export.chunk",{...payload,index,...envelope},{signal}));check();if(next.state!=="writing"||next.nextChunk!==index+1||next.bytes!==bytes+plain.length)throw new Error("The export file could not confirm this chunk.");index++;bytes=next.bytes},
    async finish(){check();const done=value(await client.request("export.finish",{...payload,bytes},{signal}));check();if(done.state!=="done"||done.nextChunk!==index||done.bytes!==bytes||!done.sha256)throw new Error("The export file could not be verified.")},
    abort:cleanup,
  };
}

type DirectWriter={write(bytes:Uint8Array<ArrayBuffer>):Promise<void>;close():Promise<void>;abort():Promise<void>};
type SavePicker=(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<{createWritable():Promise<DirectWriter>}>;
/** Native document picker, browser direct writer, then a bounded browser download fallback. */
export async function chooseExportSink(signal:AbortSignal):Promise<ExportSink> {
  const session=localSession();const check=()=>{checkLocalSession(session);if(signal.aborted)throw new Error("Export cancelled.")};check();
  if(isAndroidPocket())return nativeSink(signal);
  const picker=(window as Window&{showSaveFilePicker?:SavePicker}).showSaveFilePicker;
  if(picker) {
    const handle=await picker.call(window,{suggestedName:"ra-export.json",types:[{description:"Ra portable export",accept:{"application/json":[".json"]}}]});
    check();const writer=await handle.createWritable();try{check()}catch(error){await writer.abort();throw error}
    return {async write(bytes){check();await writer.write(bytes);check()},async finish(){check();await writer.close();check()},abort:()=>writer.abort()};
  }
  const parts:Blob[]=[];let size=0;
  return {
    async write(bytes){check();if(size+bytes.length>64*1024*1024)throw new Error("This browser cannot safely hold this export in memory. Use Ra on Android or a browser with direct file saving; nothing was shortened.");parts.push(new Blob([bytes]));size+=bytes.length},
    async finish(){check();const blob=new Blob(parts,{type:"application/json"});parts.length=0;const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="ra-export.json";document.body.appendChild(link);try{link.click()}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}},
    async abort(){parts.length=0;size=0},
  };
}
