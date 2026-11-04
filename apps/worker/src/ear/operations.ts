import {makeId} from "@ra/core";
import type {Env} from "../env";
import type {EarMessage} from "./index";
export interface EarOperation{op_key:string;account:string|null;generation:string|null;kind:"link"|"capture"|"ignored";discreet:number;processed:number;reply_kind:"linked"|"kept"|"unheard"|"notLinked"|null;reply_state:"pending"|"blocked"|"attempting"|"sent"|"unknown"}
export async function earIdentity(senderHash:string,messageId:string,master:string):Promise<{key:string;eventId:string}>{
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(master),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(JSON.stringify(["ra-ear-operation-v1",senderHash,messageId]))));
  return {key:[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join(""),eventId:[...digest.slice(0,26)].map(byte=>"0123456789ABCDEFGHJKMNPQRSTVWXYZ"[byte&31]).join("")};
}
const read=(env:Env,key:string)=>env.DB.prepare("SELECT * FROM ear_operations WHERE op_key = ?").bind(key).first<EarOperation>();
/** Bind a message to its first link generation before any private work. Duplicate batches may retry safely. */
export async function claimEar(env:Env,message:EarMessage,senderHash:string,key:string):Promise<EarOperation>{
  const previous=await read(env,key);if(previous)return previous;
  const token=makeId(),at=message.at;
  if(message.kind==="text"&&/^[A-HJ-NP-Z2-9]{6}$/.test(message.text.trim().toUpperCase())&&at!==null){
    const code=message.text.trim().toUpperCase();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO ear_operations(op_key,claim_token,account,generation,kind,discreet,reply_kind) SELECT ?,?,account,?,'link',discreet,'linked' FROM ear_codes WHERE code = ? AND expires_at >= ? AND ? >= expires_at - 605000 AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ear_codes.account)").bind(key,token,key,code,Date.now(),at),
      env.DB.prepare("INSERT INTO ear_accounts(account) SELECT old.account FROM ear_links old WHERE old.wa_hash = ? AND EXISTS (SELECT 1 FROM ear_operations WHERE op_key = ? AND claim_token = ?) ON CONFLICT(account) DO UPDATE SET revision = revision + 1").bind(senderHash,key,token),
      env.DB.prepare("DELETE FROM ear_links WHERE account IN (SELECT account FROM ear_operations WHERE op_key = ? AND claim_token = ?)").bind(key,token),
      env.DB.prepare("INSERT OR REPLACE INTO ear_links(wa_hash,account,discreet,linked_at,generation) SELECT ?,account,discreet,?,generation FROM ear_operations WHERE op_key = ? AND claim_token = ?").bind(senderHash,at,key,token),
      env.DB.prepare("DELETE FROM ear_codes WHERE account IN (SELECT account FROM ear_operations WHERE op_key = ? AND claim_token = ?)").bind(key,token),
      env.DB.prepare("INSERT INTO ear_accounts(account) SELECT account FROM ear_operations WHERE op_key = ? AND claim_token = ? ON CONFLICT(account) DO UPDATE SET revision = revision + 1").bind(key,token),
    ]);
    const linked=await read(env,key);if(linked)return linked;
  }
  const link=await env.DB.prepare("SELECT account,generation,linked_at FROM ear_links WHERE wa_hash = ?").bind(senderHash).first<{account:string;generation:string|null;linked_at:number}>();
  // Same-second ownership is ambiguous. Old/unlinked messages are never filed into a newer account.
  const codeLike=message.kind==="text"&&/^[A-HJ-NP-Z2-9]{6}$/.test(message.text.trim().toUpperCase());
  if(link?.generation&&at!==null&&at>link.linked_at&&!codeLike&&message.kind!=="other"){
    await env.DB.prepare("INSERT OR IGNORE INTO ear_operations(op_key,claim_token,account,generation,kind) SELECT ?,?,account,generation,'capture' FROM ear_links WHERE wa_hash = ? AND generation = ? AND linked_at < ? AND NOT EXISTS (SELECT 1 FROM people_erased WHERE account = ear_links.account)").bind(key,token,senderHash,link.generation,at).run();
  }
  const captured=await read(env,key);if(captured)return captured;
  await env.DB.prepare("INSERT OR IGNORE INTO ear_operations(op_key,claim_token,kind,processed,reply_kind) VALUES (?,?,'ignored',1,?)").bind(key,token,link?"unheard":"notLinked").run();
  return (await read(env,key))!;
}
