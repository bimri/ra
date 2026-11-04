// Pocket v2: correlated, cancellable messages on a main-frame-only native port.
export const POCKET_VERSION = 2;
export interface PocketStatus {
  runtime: "stub" | "unavailable" | "native";
  freeRamMb: number | null;
  device?: { manufacturer:string; model:string; android:string; api:number; abis:string[]; process64Bit:boolean; emulator:boolean; totalRamMb:number; freeStorageMb:number; wifi:boolean; metered:boolean };
}
export type PocketCode = "unsupported" | "invalid-request" | "cancelled" | "timeout" | "disconnected" | "busy" | "locked" | "native-error" | "protocol-error" | "consent-required" | "wifi-required" | "insufficient-memory" | "insufficient-storage" | "download-failed" | "model-corrupt" | "model-missing" | "benchmark-required" | "benchmark-failed" | "capture-corrupt" | "capture-conflict" | "capture-deleted" | "capture-missing" | "capture-incomplete" | "capture-limit" | "needs-review" | "account-erased";
export type CaptureStatus = {state:"absent"|"partial"|"sealed"|"deleted";nextChunk:number};
export type ExportStatus={state:"absent"|"choosing"|"selected"|"writing"|"done"|"cancelled"|"failed";nextChunk:number;bytes:number;sha256?:string};
export type PocketResult<T> = { ok:true; value:T } | { ok:false; error:{ code:PocketCode; message:string } };
export interface PocketProgress { phase:string; loaded:number; total?:number }
export interface PocketOperations {
  status: { input:Record<string,never>; output:PocketStatus };
  "runtime.info": { input:Record<string,never>; output:{ revision:string; accountSessionsSupported?:boolean; captureStorageSupported?:boolean;exportSupported?:boolean } };
  "export.choose":{input:{account:string;exportId:string};output:ExportStatus};
  "export.status":{input:{account:string;exportId:string};output:ExportStatus};
  "export.chunk":{input:{account:string;exportId:string;index:number;iv:string;data:string};output:ExportStatus};
  "export.finish":{input:{account:string;exportId:string;bytes:number};output:ExportStatus};
  "export.cancel":{input:{account:string;exportId:string};output:null};
  "account.import": { input:{account:string;key:string};output:{account:string} };
  "account.challenge": { input:{account:string};output:{challenge:string} };
  "account.prove": { input:{account:string;challenge:string;iv:string;data:string};output:{account:string} };
  "capture.begin": { input:{account:string;captureId:string;iv:string;data:string};output:CaptureStatus };
  "capture.chunk": { input:{account:string;captureId:string;index:number;iv:string;data:string};output:{nextChunk:number} };
  "capture.status": { input:{account:string;captureId:string};output:CaptureStatus };
  "capture.finish": { input:{account:string;captureId:string};output:CaptureStatus };
  "capture.drop": { input:{account:string;captureId:string};output:null };
  "capture.eraseAccount": { input:{account:string};output:null };
  "vault.seal": { input:{ account:string; text:string }; output:string };
  "vault.open": { input:{ account:string; text:string }; output:string };
  "vault.erase": { input:{ account:string }; output:null };
}
export interface RequestOptions { signal?:AbortSignal; timeoutMs?:number; onProgress?(progress:PocketProgress):void }
export const failure = <T = never>(code:PocketCode,message:string):PocketResult<T> => ({ ok:false,error:{code,message} });
const codes = new Set<PocketCode>(["unsupported","invalid-request","cancelled","timeout","disconnected","busy","locked","native-error","protocol-error","consent-required","wifi-required","insufficient-memory","insufficient-storage","download-failed","model-corrupt","model-missing","benchmark-required","benchmark-failed","capture-corrupt","capture-conflict","capture-deleted","capture-missing","capture-incomplete","capture-limit","needs-review","account-erased"]);
type Pending = { operation:keyof PocketOperations; finish(result:PocketResult<unknown>):void; progress?:RequestOptions["onProgress"]; activity():void };
function validStatus(value:unknown):value is PocketStatus {
  if (!value || typeof value !== "object") return false;
  const s = value as PocketStatus;
  if (!["unavailable","native","stub"].includes(s.runtime) || !(s.freeRamMb === null || (typeof s.freeRamMb === "number" && Number.isFinite(s.freeRamMb) && s.freeRamMb >= 0))) return false;
  const d = s.device;
  return !d || (typeof d.manufacturer === "string" && typeof d.model === "string" && typeof d.android === "string" && Number.isInteger(d.api) && Array.isArray(d.abis) && d.abis.every((a) => typeof a === "string") && [d.totalRamMb,d.freeStorageMb].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) && [d.emulator,d.process64Bit,d.wifi,d.metered].every((b) => typeof b === "boolean"));
}

/** No private payloads are retained after settlement; stale or foreign IDs are ignored. */
export class PocketClient {
  private readonly pending = new Map<string,Pending>();
  private readonly lifecycle = new Set<(state:"paused" | "resumed")=>void>();
  private active = true;
  constructor(private readonly send:(text:string)=>void) {}
  request<K extends keyof PocketOperations>(operation:K,payload:PocketOperations[K]["input"],options:RequestOptions = {}):Promise<PocketResult<PocketOperations[K]["output"]>> {
    if (!this.active) return Promise.resolve(failure("disconnected","Pocket is disconnected."));
    if (options.signal?.aborted) return Promise.resolve(failure("cancelled","Operation cancelled."));
    if (this.pending.size >= 16) return Promise.resolve(failure("busy","Pocket is busy. Try again shortly."));
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      let settled = false;
      let timer:ReturnType<typeof setTimeout>;
      let absoluteTimer:ReturnType<typeof setTimeout> | undefined;
      const finish = (result:PocketResult<unknown>) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(absoluteTimer); options.signal?.removeEventListener("abort",abort); this.pending.delete(id);
        resolve(result as PocketResult<PocketOperations[K]["output"]>);
      };
      const cancel = (code:"timeout" | "cancelled") => {
        try { this.send(JSON.stringify({v:POCKET_VERSION,t:"cancel",id})); } catch { /* already disconnected */ }
        finish(failure(code,code === "timeout" ? "Pocket did not respond in time." : "Operation cancelled."));
      };
      const abort = () => cancel("cancelled");
      const timeout=Math.max(1,Math.min(120_000,options.timeoutMs ?? 15_000));
      const activity=() => {};
      timer=setTimeout(()=>cancel("timeout"),timeout);
      this.pending.set(id,{operation,finish,progress:options.onProgress,activity});
      options.signal?.addEventListener("abort",abort,{once:true});
      try {
        const request = JSON.stringify({v:POCKET_VERSION,t:"request",id,operation,payload});
        if (request.length > 65_536) finish(failure("invalid-request","This request is too large for Pocket."));
        else this.send(request);
      } catch { finish(failure("disconnected","Pocket is disconnected.")); }
    });
  }
  receive(text:unknown):void {
    if (typeof text !== "string" || text.length > 262_144) return;
    let event:Record<string,unknown>;
    try { event = JSON.parse(text); } catch { return; }
    if (!event || typeof event !== "object" || event.v !== POCKET_VERSION) return;
    if (event.t === "lifecycle" && (event.state === "paused" || event.state === "resumed")) {
      if (event.state === "paused") this.cancelAll("cancelled","Pocket paused while the app is away.");
      for (const listener of this.lifecycle) listener(event.state);
      return;
    }
    const pending = typeof event.id === "string" ? this.pending.get(event.id) : undefined;
    if (!pending) return;
    if (event.t === "progress" && typeof event.phase === "string" && typeof event.loaded === "number" && Number.isFinite(event.loaded) && event.loaded >= 0 && (event.total === undefined || (typeof event.total === "number" && Number.isFinite(event.total) && event.total >= event.loaded))) {
      pending.activity();
      pending.progress?.({phase:event.phase,loaded:event.loaded,...(typeof event.total === "number" ? {total:event.total} : {})});
    } else if (event.t === "result") {
      if (event.ok === true && "value" in event) {
        const value=event.value as Record<string,unknown> | null;
        const nextValid=value && Number.isInteger(value.nextChunk) && Number(value.nextChunk)>=0 && Number(value.nextChunk)<=63;
        const invalidCapture=["capture.begin","capture.status","capture.finish"].includes(pending.operation) && (!nextValid||!value||!["absent","partial","sealed","deleted"].includes(String(value.state)));
        const invalidChunk=pending.operation==="capture.chunk"&&!nextValid;
        const invalidExport=pending.operation.startsWith("export.")&&pending.operation!=="export.cancel"&&(!value||!["absent","choosing","selected","writing","done","cancelled","failed"].includes(String(value.state))||!Number.isSafeInteger(value.nextChunk)||Number(value.nextChunk)<0||Number(value.nextChunk)>67108864||!Number.isSafeInteger(value.bytes)||Number(value.bytes)<0||Number(value.bytes)>1024*1024*1024*1024||(value.sha256!==undefined&&(typeof value.sha256!=="string"||!/^[a-f0-9]{64}$/.test(value.sha256)))||(value.state==="done"&&typeof value.sha256!=="string"));
        if (invalidCapture || invalidChunk || invalidExport || (pending.operation === "status" && !validStatus(event.value)) || (["vault.open","vault.seal"].includes(pending.operation) && typeof event.value !== "string") || (["vault.erase","capture.drop","capture.eraseAccount","export.cancel"].includes(pending.operation) && event.value !== null)) pending.finish(failure("protocol-error","Pocket returned an invalid result."));
        else pending.finish({ok:true,value:event.value});
      }
      else if (event.ok === false && event.error && typeof event.error === "object") {
        const error = event.error as {code?:unknown; message?:unknown};
        if(error.code==="locked"&&typeof window!=="undefined")window.dispatchEvent(new Event("ra-native-account-locked"));
        if (codes.has(error.code as PocketCode) && typeof error.message === "string") pending.finish(failure(error.code as PocketCode,error.message));
        else pending.finish(failure("protocol-error","Pocket returned an invalid error."));
      } else pending.finish(failure("protocol-error","Pocket returned an invalid result."));
    }
  }
  cancelAll(code:PocketCode = "cancelled",message = "Operation cancelled."):void {
    for (const [id,pending] of [...this.pending]) {
      try { this.send(JSON.stringify({v:POCKET_VERSION,t:"cancel",id})); } catch { /* detached */ }
      pending.finish(failure(code,message));
    }
  }
  subscribe(listener:(state:"paused" | "resumed")=>void):()=>void { this.lifecycle.add(listener); return () => { this.lifecycle.delete(listener); }; }
  close():void { this.active = false; this.cancelAll("disconnected","Pocket is disconnected."); this.lifecycle.clear(); }
}

// Legacy shells remain readable during upgrade. New shells expose no JavascriptInterface.
interface LegacyPocket { status():string; vaultSeal?(account:string,text:string):string; vaultOpen?(account:string,text:string):string; vaultErase?(account:string):void }
declare global { interface Window { RaPocket?:LegacyPocket } }
let connected:PocketClient | null = null;
let nativePort:MessagePort | null = null;
const waiting = new Set<(client:PocketClient | null)=>void>();
export function isAndroidPocket():boolean { return typeof navigator !== "undefined" && /\bRaAndroid\/2\b/.test(navigator.userAgent ?? ""); }
if (typeof window !== "undefined") {
  window.addEventListener("message",(event:MessageEvent) => {
    if (!isAndroidPocket() || event.data !== "ra-pocket:2" || event.ports.length !== 1 || (event.source !== null && event.source !== window) || (event.origin !== "" && event.origin !== location.origin)) return;
    connected?.close(); nativePort?.close();
    nativePort = event.ports[0]!;
    const port = nativePort;
    connected = new PocketClient((text) => port.postMessage(text));
    const client = connected;
    client.subscribe(state=>window.dispatchEvent(new Event(state==="paused"?"ra-pocket-paused":"ra-pocket-resumed")));
    port.onmessage = (message) => client.receive(message.data);
    port.onmessageerror = () => client.close();
    port.start();
    for (const resolve of waiting) resolve(client);
    waiting.clear();
    window.dispatchEvent(new Event("ra-pocket-ready"));
  });
  window.addEventListener("ra-vault-closed",() => {
    connected?.cancelAll("locked","Unlock the local copy first.");
    try{nativePort?.postMessage(JSON.stringify({v:POCKET_VERSION,t:"lock",id:crypto.randomUUID()}))}catch{/* channel already closed */}
  });
  window.addEventListener("pagehide",() => { connected?.close(); nativePort?.close(); connected = null; nativePort = null; });
}
export async function pocket():Promise<PocketClient | null> {
  if (connected) return connected;
  if (!isAndroidPocket()) return null;
  return new Promise((resolve) => {
    const done = (client:PocketClient | null) => { clearTimeout(timer); waiting.delete(done); resolve(client); };
    const timer = setTimeout(() => done(null),5000);
    waiting.add(done);
  });
}
export async function pocketStatus(options:RequestOptions = {}):Promise<PocketResult<PocketStatus>> {
  const client = await pocket();
  if (!client && typeof window !== "undefined" && window.RaPocket) {
    try {
      const previous = JSON.parse(window.RaPocket.status()) as PocketStatus;
      return {ok:true,value:{runtime:"stub",freeRamMb:previous.freeRamMb ?? null}};
    } catch { return failure("protocol-error","The Android app returned an invalid status."); }
  }
  if (!client) return failure("unsupported",isAndroidPocket() ? "Pocket could not connect. Reopen Ra." : "Pocket needs the Android app.");
  const result = await client.request("status",{},options);
  if (result.ok && !validStatus(result.value)) return failure("protocol-error","Pocket returned an invalid status.");
  return result;
}
export function nativeVaultAvailable():boolean { return isAndroidPocket() || (typeof window !== "undefined" && !!window.RaPocket?.vaultSeal); }
export async function nativeVault(operation:"seal" | "open" | "erase",account:string,text = ""):Promise<string | null> {
  if (!isAndroidPocket()) {
    const old = typeof window !== "undefined" ? window.RaPocket : undefined;
    if (operation === "seal") return old?.vaultSeal?.(account,text) ?? null;
    if (operation === "open") { if (!old?.vaultOpen) throw new Error("This local key needs its original Android device."); return old.vaultOpen(account,text); }
    old?.vaultErase?.(account); return null;
  }
  const client = await pocket();
  if (!client) throw new Error("Pocket could not connect to Android Keystore. Reopen Ra.");
  const result = operation === "erase" ? await client.request("vault.erase",{account}) : await client.request(operation === "seal" ? "vault.seal" : "vault.open",{account,text});
  if (!result.ok) throw new Error(result.error.message);
  if (operation !== "erase" && typeof result.value !== "string") throw new Error("Android Keystore returned an invalid envelope.");
  return result.value;
}
