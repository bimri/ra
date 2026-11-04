// A random key protects the local copy. Only its passphrase-wrapped form persists.
import { nativeVault, nativeVaultAvailable, pocket } from "../pocket";
import { nativeAccountLink,type NativeSessionClient } from "./native-session";
import {passkeysAvailable,signInForPrf,offlinePrf} from "./passkey";
import {validPrf,prfBytes,wrapWithPrf,unwrapWithPrf,type PrfWrapper} from "./prf";
import {claimWrappedKey} from "./wrapper-claim";
let generation = 0;
let dataKey: CryptoKey | null = null;
let account: string | null = null;
let nativeReady:{link:NativeSessionClient;owner:string;generation:number}|null=null;
let proving:Promise<boolean>|null=null;
const bytes = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const un64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const name = (id: string) => `ra.vault.${id}`;
type Wrapped = { v: 1; salt: string; iv: string; data: string;prf?:PrfWrapper };
export type Envelope = { sealed: 1; iv: string; data: string };
export const vaultReady = () => dataKey !== null;
export const vaultAccount = () => account;
export const vaultEpoch = () => generation;
export const hasVault = (id: string) => localStorage.getItem(name(id)) !== null;

async function wrappingKey(phrase: string, salt: Uint8Array<ArrayBuffer>) {
  const input=bytes(phrase);let material:CryptoKey;
  try{material=await crypto.subtle.importKey("raw",input,"PBKDF2",false,["deriveKey"])}finally{input.fill(0)}
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310_000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function beginOpen():number {
  const opening = ++generation;
  dataKey = null; account = null;
  nativeReady=null;proving=null;
  window.dispatchEvent(new Event("ra-vault-closed"));
  return opening;
}
async function wrappedCopy(id:string,saved:string):Promise<Wrapped> {
  const envelope=JSON.parse(saved) as Wrapped|{native:string};
  const wrapped=("native" in envelope?JSON.parse((await nativeVault("open",id,envelope.native))!):envelope) as Wrapped;
  if(wrapped.v!==1)throw new Error("Unsupported local lock version.");return wrapped;
}
async function phraseRaw(id:string,wrapped:Wrapped,phrase:string):Promise<Uint8Array<ArrayBuffer>> {
  try{return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(wrapped.iv),additionalData:bytes(id)},await wrappingKey(phrase,un64(wrapped.salt)),un64(wrapped.data)))}catch{throw new Error("That passphrase did not open the local copy.")}
}

export async function openVault(id: string, phrase: string): Promise<void> {
  const opening=beginOpen();
  const saved = localStorage.getItem(name(id));
  let expectedRecord=saved;
  if (!saved && phrase.trim().length < 10) throw new Error("Use a passphrase of at least ten characters.");
  let raw: Uint8Array<ArrayBuffer> | undefined;
  try {
  if (saved) {
    raw=await phraseRaw(id,await wrappedCopy(id,saved),phrase);
  } else {
    raw = crypto.getRandomValues(new Uint8Array(32));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(id) }, await wrappingKey(phrase, salt), raw);
    const wrapped = JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(encrypted)) } satisfies Wrapped);
    const native = nativeVaultAvailable() ? await nativeVault("seal",id,wrapped) : null;
    if (opening !== generation) { raw.fill(0); throw new Error("The local copy was locked."); }
    const candidate=native?JSON.stringify({native}):wrapped;
    const winner=await claimWrappedKey(name(id),candidate,()=>{if(opening!==generation)throw new Error("The local copy was locked.")});
    expectedRecord=winner;
    if(winner!==candidate){raw.fill(0);raw=await phraseRaw(id,await wrappedCopy(id,winner),phrase)}
  }
  if(!expectedRecord||localStorage.getItem(name(id))!==expectedRecord)throw new Error("The local copy changed or was locked.");
  await activateRaw(id,raw,opening,()=>localStorage.getItem(name(id))===expectedRecord);
  } finally { raw?.fill(0); }
}

async function activateRaw(id:string,raw:Uint8Array<ArrayBuffer>,opening:number,stillValid:()=>boolean=()=>true):Promise<void> {
  if(opening!==generation||!stillValid())throw new Error("The local copy was locked.");
  if(raw.length!==32)throw new Error("Invalid local data key.");
  let key:CryptoKey;
  let link:NativeSessionClient|null=null;let nativeOpened=false;
  try {
    // An acknowledged deletion must remain locally recoverable if cleanup was interrupted.
    link=localStorage.getItem(`ra.erase.${id}`) ? null : await nativeAccountLink();
    if(link)nativeOpened=await link.importKey(id,raw,()=>opening===generation&&stillValid());
    key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  if (opening !== generation||!stillValid()) throw new Error("The local copy was locked.");
  dataKey = key;
  account = id;
  if(link && nativeOpened)nativeReady={link,owner:id,generation:opening};
  localStorage.setItem("ra.account-session", JSON.stringify({ account:id, nonce:crypto.randomUUID() }));
  window.dispatchEvent(new Event("ra-vault-open"));
  }catch(error){if(opening===generation)closeVault();throw error}
  finally { raw.fill(0); }
}

export function hasVaultPasskey(id:string):boolean {
  try{return validPrf((JSON.parse(localStorage.getItem(name(id))??"null") as Wrapped|null)?.prf)}catch{return false}
}

/** Adds an alternative wrapper to the same data key; existing private records are untouched. */
export async function enableVaultPasskey(phrase:string,signal?:AbortSignal):Promise<void> {
  if(!passkeysAvailable()||nativeVaultAvailable())throw new Error("Use your local passphrase on this device.");
  const owner=account;const epoch=generation;const activeKey=dataKey;
  if(!owner||!activeKey)throw new Error("Unlock the local copy first.");
  const saved=localStorage.getItem(name(owner));if(!saved)throw new Error("The local key is missing.");
  const check=()=>{if(generation!==epoch||account!==owner||dataKey!==activeKey||localStorage.getItem(name(owner))!==saved)throw new Error("The local copy changed or was locked.");if(signal?.aborted)throw new DOMException("Passkey setup cancelled.","AbortError")};
  let raw:Uint8Array<ArrayBuffer>|undefined;let secret:Uint8Array<ArrayBuffer>|null=null;
  try {
    const wrapped=await wrappedCopy(owner,saved);check();raw=await phraseRaw(owner,wrapped,phrase);check();
    // Verify this is still the unlocked key before adding another way to open it.
    const iv=crypto.getRandomValues(new Uint8Array(12));const probe=new Uint8Array([82,97]);
    const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},activeKey,probe);
    const candidate=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
    const plain=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv},candidate,encrypted));
    try{if(plain.length!==probe.length||!plain.every((v,i)=>v===probe[i]))throw new Error("The local key changed.")}finally{plain.fill(0);probe.fill(0)}check();
    const salt=crypto.getRandomValues(new Uint8Array(32));const identity=await signInForPrf(salt,signal);secret=identity.prf;
    if(identity.accountId!==owner){closeVault();throw new Error("That passkey belongs to another Mind. The local copy has been locked.")}
    check();
    if(!secret)throw new Error("This passkey does not support local unlock. Your passphrase still works.");
    const prf=await wrapWithPrf(owner,raw,{credentialId:identity.credentialId,rpId:identity.rpId,prf:secret},salt);check();
    localStorage.setItem(name(owner),JSON.stringify({...wrapped,prf}));
  }finally{raw?.fill(0);secret?.fill(0)}
}

/** Offline: WebAuthn evaluates only the saved credential's PRF; no server sign-in or upload. */
export async function openVaultWithPasskey(id:string,signal?:AbortSignal):Promise<void> {
  const opening=beginOpen();let raw:Uint8Array<ArrayBuffer>|undefined;let secret:Uint8Array<ArrayBuffer>|undefined;
  try {
    const saved=localStorage.getItem(name(id));if(!saved)throw new Error("Set a local passphrase first.");
    const wrapped=await wrappedCopy(id,saved);if(!validPrf(wrapped.prf))throw new Error("Use your local passphrase to open this copy.");
    secret=await offlinePrf(wrapped.prf.credentialId,wrapped.prf.rpId,prfBytes(wrapped.prf.salt),signal);
    if(opening!==generation||signal?.aborted||localStorage.getItem(name(id))!==saved)throw new Error("The local copy changed or was locked.");
    try{raw=await unwrapWithPrf(id,wrapped.prf,secret)}catch{throw new Error("That passkey did not open the local copy. Your passphrase still works.")}
    if(opening!==generation||signal?.aborted)throw new Error("The local copy was locked.");
    await activateRaw(id,raw,opening,()=>!signal?.aborted&&localStorage.getItem(name(id))===saved);
  }finally{raw?.fill(0);secret?.fill(0)}
}

export function removeVaultPasskey():void {
  if(!dataKey||!account)throw new Error("Unlock the local copy first.");
  const saved=localStorage.getItem(name(account));if(!saved)throw new Error("The local key is missing.");
  const wrapped=JSON.parse(saved) as Wrapped;if(wrapped.v!==1)throw new Error("Use this device’s local lock settings.");
  const {prf:_,...phraseOnly}=wrapped;localStorage.setItem(name(account),JSON.stringify(phraseOnly));
}

export function closeVault(): void {
  generation++;
  dataKey = null;
  account = null;
  nativeReady=null;proving=null;
  window.dispatchEvent(new Event("ra-vault-closed"));
}

/** A fresh native challenge proves the still-unlocked key after pause/channel replacement. */
export async function ensureNativeSession():Promise<boolean> {
  const key=dataKey;const owner=account;const epoch=generation;
  if(!key||!owner)throw new Error("Unlock the local copy first.");
  const link=await nativeAccountLink();
  if(!link)return false;
  if(dataKey!==key||account!==owner||generation!==epoch)throw new Error("The local copy was locked.");
  if(nativeReady?.link===link&&nativeReady.owner===owner&&nativeReady.generation===epoch)return true;
  if(proving)return proving;
  const task=link.prove(owner,key,()=>dataKey===key&&account===owner&&generation===epoch).then(supported=>{if(supported)nativeReady={link,owner,generation:epoch};return supported});
  proving=task;
  try{return await task}finally{if(proving===task)proving=null}
}

/** Binary capture chunks use the same account key with a separate record namespace. */
export async function sealPrivateBytes(plain:Uint8Array<ArrayBuffer>,context:string):Promise<{iv:string;data:string}> {
  const key=dataKey;const owner=account;const epoch=generation;
  if(!key||!owner)throw new Error("Unlock the local copy first.");
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:bytes(`${owner}:${context}`)},key,plain);
  if(dataKey!==key||generation!==epoch)throw new Error("The local copy was locked.");
  return {iv:b64(iv),data:b64(new Uint8Array(encrypted))};
}

if(typeof window!=="undefined") {
  window.addEventListener("storage", (event:StorageEvent) => {
    if (!account) return;
    if (event.key === name(account) || event.key === null) closeVault();
    else if (event.key === "ra.account-session") {
      try { if (JSON.parse(event.newValue ?? "null")?.account !== account) closeVault(); }
      catch { closeVault(); }
    }
  });
  window.addEventListener("ra-pocket-paused",()=>{nativeReady=null;proving=null});
  window.addEventListener("ra-native-account-locked",()=>{nativeReady=null;proving=null});
  for(const event of ["ra-pocket-ready","ra-pocket-resumed"])window.addEventListener(event,()=>{nativeReady=null;proving=null;if(vaultReady())void ensureNativeSession().catch(()=>{})});
}

async function encode(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {const raw=new Uint8Array(await value.arrayBuffer());try{return { $raBlob:b64(raw),type:value.type }}finally{raw.fill(0)}}
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encode(v)])));
  return value;
}
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.$raBlob === "string") {const raw=un64(o.$raBlob);try{return new Blob([raw],{type:String(o.type??"")})}finally{raw.fill(0)}}
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}
export async function sealLocal(value: unknown, context: string): Promise<Envelope> {
  const key = dataKey; const owner = account;const epoch=generation;
  if (!key || !owner) throw new Error("Unlock the local copy first.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = bytes(JSON.stringify(await encode(value)));
  try {
    if (dataKey !== key||generation!==epoch) throw new Error("The local copy was locked.");
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(`${owner}:${context}`) }, key, plain);
    if(dataKey!==key||generation!==epoch)throw new Error("The local copy was locked.");
    return { sealed: 1, iv: b64(iv), data: b64(new Uint8Array(encrypted)) };
  } finally {plain.fill(0)}
}
export async function openLocal<T>(value: Envelope, context: string): Promise<T> {
  const key = dataKey; const owner = account;
  if (!key || !owner) throw new Error("Unlock the local copy first.");
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: un64(value.iv), additionalData: bytes(`${owner}:${context}`) }, key, un64(value.data)));
  try {if (dataKey !== key) throw new Error("The local copy was locked.");return decode(JSON.parse(new TextDecoder().decode(plain))) as T}finally{plain.fill(0)}
}
/** Content proof for migration, including actual Blob bytes rather than size/type. */
export async function localValueDigest(value:unknown):Promise<string>{
  const key=dataKey,epoch=generation;if(!key)throw new Error("Unlock the local copy first.");
  const plain=bytes(JSON.stringify(await encode(value)));
  try{if(dataKey!==key||generation!==epoch)throw new Error("The local copy was locked.");const digest=await crypto.subtle.digest("SHA-256",plain);if(dataKey!==key||generation!==epoch)throw new Error("The local copy was locked.");return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}finally{plain.fill(0)}
}

export async function eraseNativeCaptures():Promise<void> {
  const owner=account;const epoch=generation;
  if(!owner)throw new Error("Unlock the local copy first.");
  const client=await pocket();if(!client)return;
  const info=await client.request("runtime.info",{});
  if(!info.ok){if(info.error.code==="unsupported")return;throw new Error(info.error.message)}
  if(info.value.captureStorageSupported!==true)return;
  if(account!==owner||generation!==epoch)throw new Error("The local copy was locked.");
  let result=await client.request("capture.eraseAccount",{account:owner});
  if(!result.ok&&result.error.code==="locked") {
    await ensureNativeSession();
    if(account!==owner||generation!==epoch)throw new Error("The local copy was locked.");
    result=await client.request("capture.eraseAccount",{account:owner});
  }
  if(!result.ok)throw new Error(result.error.message);
  nativeReady=null;proving=null;
  if(account!==owner||generation!==epoch)throw new Error("The local copy was locked.");
}

export async function forgetVault(): Promise<void> {
  const owner=account;const epoch=generation;
  if (owner) {
    await eraseNativeCaptures();
    await nativeVault("erase",owner);
    if(account!==owner||generation!==epoch)throw new Error("The local copy was locked.");
    localStorage.removeItem(name(owner));localStorage.removeItem(`ra.erase.${owner}`);
  }
  closeVault();
}
